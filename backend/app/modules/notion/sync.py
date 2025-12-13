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


def _ensure_data_source_id(client: NotionClient, repo: NotionRepository, database_id: str) -> str:
    stored_data_source_id = repo.get_meta("data_source_id")
    if stored_data_source_id:
        return stored_data_source_id

    database = client.retrieve_database(database_id)
    data_sources = database.get("data_sources") or []
    if not data_sources:
        raise RuntimeError("Keine Data Sources für die Notion Database gefunden.")

    chosen = data_sources[0]
    data_source_id = chosen.get("id")
    if not data_source_id:
        raise RuntimeError("Gewählte Data Source enthält keine ID.")

    repo.set_meta("data_source_id", data_source_id)
    if chosen.get("name"):
        repo.set_meta("data_source_name", chosen.get("name"))
    return data_source_id


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
    base_url = settings.get("notion_api_base_url", "https://api.notion.com/v1")
    version = settings.get("notion_api_version") or DEFAULT_NOTION_VERSION
    version = DEFAULT_NOTION_VERSION if version != DEFAULT_NOTION_VERSION else version

    if not token or not database_id:
        return SyncResult(ok=False, error="Notion Settings unvollständig", fetched_count=0, upserted_count=0, duration_ms=0)

    repo = _get_repository()
    client = NotionClient(token, base_url, version)

    try:
        database_id = _ensure_database_id(repo, database_id)
        data_source_id = _ensure_data_source_id(client, repo, database_id)
    except PermissionError as exc:
        return SyncResult(ok=False, error=str(exc), fetched_count=0, upserted_count=0, duration_ms=0)
    except Exception as exc:
        return SyncResult(ok=False, error=str(exc), fetched_count=0, upserted_count=0, duration_ms=0)

    fetched_count = 0
    upserted_count = 0

    try:
        data_source = client.retrieve_data_source(data_source_id)
        properties = data_source.get("properties", {})
        property_map = _build_property_map(properties)
        repo.save_schema_json(properties)
        repo.save_property_map(property_map)
        repo.ensure_wide_table(property_map)

        for page in client.query_data_source(data_source_id):
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
        return SyncResult(ok=False, error=str(exc), fetched_count=fetched_count, upserted_count=upserted_count, duration_ms=int((time.time()-start_time)*1000))
    except Exception as exc:
        return SyncResult(ok=False, error=str(exc), fetched_count=fetched_count, upserted_count=upserted_count, duration_ms=int((time.time()-start_time)*1000))

    now_iso = datetime.utcnow().isoformat() + "Z"
    repo.set_meta("last_full_sync", now_iso)
    repo.set_meta("last_incremental_sync", now_iso)
    repo.set_meta("notion_api_version", version)

    duration_ms = int((time.time() - start_time) * 1000)
    return SyncResult(
        ok=True,
        fetched_count=fetched_count,
        upserted_count=upserted_count,
        duration_ms=duration_ms,
        error=None,
    )
