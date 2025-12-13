import json
import time
from datetime import datetime
from typing import Dict, Optional

from flask import current_app

from app.core.settings_storage import settings_storage
from .notion_client import NotionClient
from .repository import NotionRepository
from .utils import extract_property_value, map_notion_type_to_sqlite, normalize_column_name


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


def run_full_sync() -> SyncResult:
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
        for page in query_iter:
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
            upserted_count += 1
    except PermissionError as exc:
        return _result(False, f"Zugriff verweigert beim Lesen aus {source_label}: {exc}")
    except Exception as exc:
        return _result(False, f"Fehler während des Syncs aus {source_label}: {exc}")

    now_iso = datetime.utcnow().isoformat() + "Z"
    repo.set_meta("last_full_sync", now_iso)
    repo.set_meta("last_incremental_sync", now_iso)
    repo.set_meta("notion_api_version", version)

    return _result(True, None)
