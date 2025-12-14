import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Callable, Dict, Iterable, List, Optional, Set, Tuple

from flask import current_app

from app.core.settings_storage import settings_storage
from .notion_client import NotionClient
from .repository import NotionRepository
from .utils import (
    extract_property_value,
    extract_rich_text,
    map_notion_type_to_sqlite,
    normalize_column_name,
)


class SyncResult(Dict):
    ok: bool
    fetched_count: int
    upserted_count: int
    duration_ms: int
    error: Optional[str]


DEFAULT_NOTION_VERSION = "2025-09-03"


def _load_settings() -> dict:
    return settings_storage.get_settings_for_module("notion")


def _get_repository() -> NotionRepository:
    db_path = current_app.config.get("NOTION_DB_PATH")
    if not db_path:
        raise RuntimeError("NOTION_DB_PATH is not configured")
    return NotionRepository(db_path)


def _ensure_database_id(repo: NotionRepository, database_id: str) -> str:
    stored_database_id = repo.get_meta("database_id")
    if stored_database_id:
        return stored_database_id

    if not database_id:
        raise RuntimeError("Notion Database ID fehlt.")

    repo.set_meta("database_id", database_id)
    return database_id


def _select_data_source(database: Dict[str, any], repo: NotionRepository, desired_name: Optional[str] = None):
    data_sources = database.get("data_sources") or []
    stored_data_source_id = repo.get_meta("data_source_id")

    if stored_data_source_id:
        for entry in data_sources:
            if entry.get("id") == stored_data_source_id:
                return entry

    if desired_name:
        for entry in data_sources:
            if entry.get("name") == desired_name:
                return entry
        available_names = ", ".join(filter(None, [ds.get("name") for ds in data_sources])) or "keine"
        raise RuntimeError(
            f"Data Source '{desired_name}' nicht gefunden. Verfügbare Data Sources: {available_names}."
        )

    return data_sources[0] if data_sources else None


def _build_property_map(properties: Dict[str, Dict[str, str]]) -> Dict[str, Dict[str, str]]:
    property_map: Dict[str, Dict[str, str]] = {}
    used_columns = []
    for property_name, prop in properties.items():
        notion_type = prop.get("type") or "text"
        sqlite_type = map_notion_type_to_sqlite(notion_type)
        column_name = normalize_column_name(property_name, used_columns)
        used_columns.append(column_name)
        property_map[property_name] = {
            "column": column_name,
            "type": notion_type,
            "id": prop.get("id"),
            "sqlite_type": sqlite_type,
        }
    return property_map


def _row_from_page(page: Dict[str, any], property_map: Dict[str, Dict[str, str]]):
    properties = page.get("properties", {}) or {}
    row: Dict[str, any] = {
        "id": page.get("id"),
        "last_edited_time": page.get("last_edited_time"),
        "created_time": page.get("created_time"),
        "archived": int(bool(page.get("archived"))),
        "url": page.get("url"),
    }

    for prop_name, meta in property_map.items():
        notion_prop = properties.get(prop_name)
        value = extract_property_value(notion_prop, meta.get("type"))
        row[meta.get("column") or prop_name] = value
    return row


def _extract_relations_from_page(
    page: Dict[str, any], property_map: Dict[str, Dict[str, str]]
) -> Tuple[List[Dict[str, any]], Set[str]]:
    properties = page.get("properties") or {}
    relations: List[Dict[str, any]] = []
    targets: Set[str] = set()
    for prop_name, prop_value in properties.items():
        if not isinstance(prop_value, dict):
            continue
        if prop_value.get("type") != "relation":
            continue
        property_value = property_map.get(prop_name, {}).get("column") or prop_name
        rel_entries = prop_value.get("relation") or []
        for idx, rel in enumerate(rel_entries):
            to_page_id = rel.get("id") or rel.get("page_id")
            if not to_page_id:
                continue
            relations.append(
                {
                    "property_name": prop_name,
                    "property_value": property_value,
                    "to_page_id": to_page_id,
                    "position": idx,
                    "value": to_page_id,
                }
            )
            targets.add(to_page_id)
    return relations, targets


def _extract_page_title(page: Dict[str, any]) -> str:
    properties = page.get("properties") or {}
    for prop in properties.values():
        if isinstance(prop, dict) and prop.get("type") == "title":
            title_blocks = prop.get("title") or []
            return extract_rich_text(title_blocks) or ""
    return ""


def _resolve_relation_targets(
    client: NotionClient, repo: NotionRepository, target_ids: Iterable[str], max_workers: int = 3
):
    ids = list(dict.fromkeys(target_ids))
    if not ids:
        return

    synced_at = datetime.utcnow().isoformat() + "Z"

    def fetch_and_store(page_id: str):
        try:
            page = client.retrieve_page(page_id)
            title = _extract_page_title(page)
            repo.upsert_page_cache(
                page_id=page_id,
                title=title or page_id,
                url=page.get("url"),
                last_edited_time=page.get("last_edited_time"),
                raw_json=page,
                synced_at=synced_at,
            )
        except Exception as exc:  # pragma: no cover - best effort
            current_app.logger.warning("Failed to resolve relation target %s: %s", page_id, exc)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for pid in ids:
            executor.submit(fetch_and_store, pid)


def run_full_sync(progress_callback: Optional[Callable[[int, int], None]] = None) -> SyncResult:
    start_time = time.time()
    settings = _load_settings()
    token = settings.get("notion_api_key")
    database_id = settings.get("notion_database_id")
    data_source_name = (settings.get("notion_data_source_name") or "").strip()
    base_url = settings.get("notion_api_base_url", "https://api.notion.com/v1")
    version = settings.get("notion_api_version") or DEFAULT_NOTION_VERSION
    version = DEFAULT_NOTION_VERSION if version != DEFAULT_NOTION_VERSION else version

    fetched_count = 0
    upserted_count = 0

    def _result(ok: bool, error: Optional[str] = None) -> SyncResult:
        return SyncResult(
            ok=ok,
            mode="full",
            fetched_count=fetched_count,
            upserted_count=upserted_count,
            duration_ms=int((time.time() - start_time) * 1000),
            error=error,
        )

    missing_fields = []
    if not token:
        missing_fields.append("API Key")
    if not database_id:
        missing_fields.append("Database ID")
    if missing_fields:
        return _result(False, f"Notion Einstellungen unvollständig: {', '.join(missing_fields)} fehlen.")

    repo = _get_repository()
    client = NotionClient(token, base_url, version)

    try:
        database_id = _ensure_database_id(repo, database_id)
    except Exception as exc:
        return _result(False, f"Fehler beim Prüfen der Database ID: {exc}")

    try:
        database = client.retrieve_database(database_id)
    except PermissionError as exc:
        return _result(False, f"Notion API Zugriff verweigert für Database {database_id}: {exc}")
    except Exception as exc:
        return _result(False, f"Fehler beim Laden der Notion Database {database_id}: {exc}")

    if not data_source_name:
        data_source_name = (repo.get_meta("data_source_name") or "").strip()

    try:
        chosen_data_source = _select_data_source(database, repo, data_source_name or None)
    except Exception as exc:
        return _result(False, str(exc))

    using_data_source = bool(chosen_data_source and chosen_data_source.get("id"))
    if chosen_data_source and not chosen_data_source.get("id"):
        return _result(False, "Gewählte Data Source enthält keine ID.")

    try:
        if using_data_source:
            data_source_id = chosen_data_source.get("id")
            source_label = f"Data Source {chosen_data_source.get('name') or data_source_id}"
            repo.set_meta("data_source_id", data_source_id)
            if chosen_data_source.get("name"):
                repo.set_meta("data_source_name", chosen_data_source.get("name"))

            data_source = client.retrieve_data_source(data_source_id)
            properties = data_source.get("properties", {})
            query_iter = client.query_data_source(data_source_id)
        else:
            source_label = f"Database {database_id}"
            repo.set_meta("data_source_id", "")
            if chosen_data_source and chosen_data_source.get("name"):
                repo.set_meta("data_source_name", chosen_data_source.get("name"))

            properties = database.get("properties", {})
            query_iter = client.query_database(database_id)
    except PermissionError as exc:
        return _result(False, f"Notion API Zugriff verweigert für {source_label}: {exc}")
    except Exception as exc:
        return _result(False, f"Fehler beim Vorbereiten des Sync ({source_label}): {exc}")

    property_map = _build_property_map(properties)
    repo.save_schema_json(properties)
    repo.save_property_map(property_map)
    repo.ensure_wide_table(property_map)

    try:
        pages = list(query_iter)
    except PermissionError as exc:
        return _result(False, f"Zugriff verweigert beim Lesen aus {source_label}: {exc}")
    except Exception as exc:
        return _result(False, f"Fehler während des Syncs aus {source_label}: {exc}")

    total_pages = len(pages)
    if progress_callback:
        progress_callback(0, total_pages)

    relation_targets: Set[str] = set()

    for page in pages:
        fetched_count += 1
        repo.upsert_page_raw(
            page_id=page.get("id"),
            raw_json=page,
            last_edited_time=page.get("last_edited_time"),
            created_time=page.get("created_time"),
            archived=page.get("archived", False),
            synced_at=datetime.utcnow().isoformat() + "Z",
        )
        row_data = _row_from_page(page, property_map)
        repo.upsert_row(row_data)
        relations, targets = _extract_relations_from_page(page, property_map)
        repo.replace_relations_for_page(page.get("id"), relations)
        relation_targets.update(targets)
        upserted_count += 1
        if progress_callback:
            progress_callback(upserted_count, total_pages)

    missing_relation_targets = repo.filter_missing_or_stale_targets(relation_targets)
    if missing_relation_targets:
        _resolve_relation_targets(client, repo, missing_relation_targets)

    repo.update_relation_columns(property_map)

    now_iso = datetime.utcnow().isoformat() + "Z"
    repo.set_meta("last_full_sync", now_iso)
    repo.set_meta("last_incremental_sync", now_iso)
    repo.set_meta("notion_api_version", version)

    return _result(True, None)
