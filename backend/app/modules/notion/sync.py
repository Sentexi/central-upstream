import json
import time
from datetime import datetime
from typing import Dict, Optional

from flask import current_app

from app.core.settings_storage import settings_storage
from .notion_client import NotionClient
from .repository import NotionRepository
from .utils import normalize_task


class SyncResult(Dict):
    ok: bool
    mode: str
    fetched_count: int
    upserted_count: int
    duration_ms: int
    error: Optional[str]


def _load_settings() -> dict:
    return settings_storage.get_settings_for_module("notion")


def _get_repository() -> NotionRepository:
    db_path = current_app.config.get("NOTION_DB_PATH")
    if not db_path:
        raise RuntimeError("NOTION_DB_PATH is not configured")
    return NotionRepository(db_path)


def _ensure_database_id(repo: NotionRepository, database_id: str) -> str:
    database_id = repo.get_meta("database_id")
    if database_id:
        return database_id
    if not database_id:
        raise RuntimeError("Notion Database ID fehlt.")
    repo.set_meta("database_id", database_id)
    return database_id


def _ensure_data_source_id(
    client: NotionClient, repo: NotionRepository, database_id: str, preferred_name: Optional[str] = None
) -> str:
    data_source_id = repo.get_meta("data_source_id")
    if data_source_id:
        return data_source_id

    database = client.retrieve_database(database_id)
    data_sources = database.get("data_sources") or []
    if not data_sources:
        raise RuntimeError("Keine Data Sources für die Notion Database gefunden.")

    stored_name = repo.get_meta("data_source_name")
    preferred = preferred_name or stored_name or repo.get_meta("database_name")

    chosen = None
    if len(data_sources) == 1:
        chosen = data_sources[0]
    else:
        if preferred:
            chosen = next(
                (item for item in data_sources if item.get("name") and item.get("name") == preferred), None
            )
            if not chosen:
                chosen = next(
                    (
                        item
                        for item in data_sources
                        if item.get("name") and preferred and item.get("name").lower() == preferred.lower()
                    ),
                    None,
                )
        if not chosen:
            names = ", ".join([item.get("name") or "<ohne Name>" for item in data_sources])
            raise RuntimeError(
                "Mehrere Data Sources gefunden. Wähle eine per name oder speichere data_source_id in notion_meta (" + names + ")."
            )

    data_source_id = chosen.get("id")
    if not data_source_id:
        raise RuntimeError("Gewählte Data Source enthält keine ID.")

    repo.set_meta("data_source_id", data_source_id)
    if chosen.get("name"):
        repo.set_meta("data_source_name", chosen.get("name"))
    return data_source_id


DEFAULT_NOTION_VERSION = "2025-09-03"


def sync_notion_database(force_full: bool = False) -> SyncResult:
    start_time = time.time()
    settings = _load_settings()
    token = settings.get("notion_api_key")
    database_id = settings.get("notion_database_id")
    base_url = settings.get("notion_api_base_url", "https://api.notion.com/v1")
    version = settings.get("notion_api_version") or DEFAULT_NOTION_VERSION
    if version != DEFAULT_NOTION_VERSION:
        version = DEFAULT_NOTION_VERSION
    if not token or not database_id:
        return SyncResult(ok=False, error="Notion Settings unvollständig", mode="none", fetched_count=0, upserted_count=0, duration_ms=0)

    repo = _get_repository()
    client = NotionClient(token, base_url, version)
    preferred_data_source_name = settings.get("notion_data_source_name")

    try:
        database_id = _ensure_database_id(repo, database_id)
        data_source_id = _ensure_data_source_id(client, repo, database_id, preferred_name=preferred_data_source_name)
    except PermissionError as exc:
        return SyncResult(ok=False, error=str(exc), mode="none", fetched_count=0, upserted_count=0, duration_ms=0)
    except Exception as exc:
        return SyncResult(ok=False, error=str(exc), mode="none", fetched_count=0, upserted_count=0, duration_ms=0)

    last_incremental = repo.get_meta("last_incremental_sync")
    mode = "full"
    if not force_full and last_incremental:
        mode = "incremental"

    filter_obj = None
    sorts = [
        {"timestamp": "last_edited_time", "direction": "descending"},
    ]
    if mode == "incremental" and last_incremental:
        filter_obj = {
            "timestamp": "last_edited_time",
            "last_edited_time": {"after": last_incremental},
        }

    fetched_count = 0
    upserted_count = 0
    property_map_json = repo.get_meta("property_map_json")
    property_map = json.loads(property_map_json) if property_map_json else {}

    try:
        for page in client.query_data_source(data_source_id, filter_obj=filter_obj, sorts=sorts):
            fetched_count += 1
            task = normalize_task(page, property_map)
            repo.upsert_page_raw(
                page_id=page.get("id"),
                database_id=data_source_id,
                raw_json=page,
                last_edited_time=page.get("last_edited_time"),
                created_time=page.get("created_time"),
                archived=page.get("archived", False),
                synced_at=datetime.utcnow().isoformat() + "Z",
            )
            repo.upsert_task(task)
            upserted_count += 1
    except PermissionError as exc:
        return SyncResult(ok=False, error=str(exc), mode=mode, fetched_count=fetched_count, upserted_count=upserted_count, duration_ms=int((time.time()-start_time)*1000))
    except Exception as exc:
        return SyncResult(ok=False, error=str(exc), mode=mode, fetched_count=fetched_count, upserted_count=upserted_count, duration_ms=int((time.time()-start_time)*1000))

    now_iso = datetime.utcnow().isoformat() + "Z"
    repo.set_meta("last_incremental_sync", now_iso)
    if mode == "full":
        repo.set_meta("last_full_sync", now_iso)
    repo.set_meta("notion_api_version", version)

    duration_ms = int((time.time() - start_time) * 1000)
    return SyncResult(
        ok=True,
        mode=mode,
        fetched_count=fetched_count,
        upserted_count=upserted_count,
        duration_ms=duration_ms,
        error=None,
    )

