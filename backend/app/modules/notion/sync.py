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


def _ensure_database_id(client: NotionClient, repo: NotionRepository, db_name: str) -> str:
    database_id = repo.get_meta("database_id")
    if database_id:
        return database_id
    database_obj = client.search_database_by_name(db_name)
    if not database_obj:
        raise RuntimeError("Notion Datenbank nicht gefunden. Stelle sicher, dass der Token Zugriff hat.")
    database_id = database_obj.get("id")
    repo.set_meta("database_id", database_id)
    repo.set_meta("database_name", db_name)
    return database_id


def sync_notion_database(force_full: bool = False) -> SyncResult:
    start_time = time.time()
    settings = _load_settings()
    token = settings.get("notion_api_key")
    db_name = settings.get("notion_db_name")
    base_url = settings.get("notion_api_base_url", "https://api.notion.com/v1")
    version = settings.get("notion_api_version", "2022-06-28")
    if not token or not db_name:
        return SyncResult(ok=False, error="Notion Settings unvollständig", mode="none", fetched_count=0, upserted_count=0, duration_ms=0)

    repo = _get_repository()
    client = NotionClient(token, base_url, version)

    try:
        database_id = _ensure_database_id(client, repo, db_name)
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
        for page in client.query_database(database_id, filter_obj=filter_obj, sorts=sorts):
            fetched_count += 1
            task = normalize_task(page, property_map)
            repo.upsert_page_raw(
                page_id=page.get("id"),
                database_id=database_id,
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

