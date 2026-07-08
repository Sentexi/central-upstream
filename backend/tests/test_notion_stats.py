import sys
from pathlib import Path

import pytest
from flask import Flask

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.modules.notion.repository import NotionRepository  # noqa: E402
from app.modules.notion.routes import bp  # noqa: E402


PROPERTY_MAP = {
    "Name": {"column": "title", "type": "title", "sqlite_type": "TEXT"},
    "Status": {"column": "status", "type": "status", "sqlite_type": "TEXT"},
    "Done time": {"column": "done_time", "type": "date", "sqlite_type": "TEXT"},
}


@pytest.fixture()
def client(tmp_path):
    db_path = str(tmp_path / "notion.sqlite")
    repo = NotionRepository(db_path)
    repo.save_property_map(PROPERTY_MAP)
    repo.ensure_wide_table(PROPERTY_MAP)
    rows = [
        # regulaerer done task mit done_time, completed zaehlt auf done_time
        {
            "id": "task-done",
            "title": "Erledigter Task",
            "status": "Done",
            "done_time": "2026-07-01T10:00:00.000+02:00",
            "created_time": "2026-06-20T08:00:00.000+02:00",
            "last_edited_time": "2026-07-05T09:00:00.000+02:00",
            "archived": 0,
        },
        # done task von vor der Done time property, faellt auf last_edited zurueck
        {
            "id": "task-done-legacy",
            "title": "Alt erledigter Task ohne done_time",
            "status": "Done",
            "done_time": None,
            "created_time": "2026-06-19T08:00:00.000+02:00",
            "last_edited_time": "2026-06-25T09:00:00.000+02:00",
            "archived": 0,
        },
        # offener task, zaehlt in created und open
        {
            "id": "task-open",
            "title": "Offener Task",
            "status": "In progress",
            "done_time": None,
            "created_time": "2026-06-21T08:00:00.000+02:00",
            "last_edited_time": "2026-07-06T09:00:00.000+02:00",
            "archived": 0,
        },
        # abandoned zaehlt nirgends, weder created noch done noch open
        {
            "id": "task-abandoned",
            "title": "Abgebrochener Task",
            "status": "Abandoned",
            "done_time": None,
            "created_time": "2026-06-22T08:00:00.000+02:00",
            "last_edited_time": "2026-07-02T09:00:00.000+02:00",
            "archived": 0,
        },
        # future zaehlt nicht in created/done, bleibt aber im open bestand
        {
            "id": "task-future",
            "title": "Zukunftstask",
            "status": "Future",
            "done_time": None,
            "created_time": "2026-06-23T08:00:00.000+02:00",
            "last_edited_time": "2026-06-23T08:00:00.000+02:00",
            "archived": 0,
        },
        # archivierte tasks zaehlen nirgends
        {
            "id": "task-archived",
            "title": "Archivierter Task",
            "status": "In progress",
            "done_time": None,
            "created_time": "2026-06-24T08:00:00.000+02:00",
            "last_edited_time": "2026-06-24T08:00:00.000+02:00",
            "archived": 1,
        },
    ]
    for row in rows:
        repo.upsert_row(row)

    app = Flask(__name__)
    app.config["NOTION_DB_PATH"] = db_path
    app.register_blueprint(bp, url_prefix="/api/modules/notion")
    return app.test_client()


def test_stats_completion_nutzt_done_time_mit_last_edited_fallback(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    completed_days = {
        entry["date"]: entry["completed"]
        for entry in payload["daily_flow"]
        if entry["completed"]
    }
    assert completed_days == {"2026-07-01": 1, "2026-06-25": 1}


def test_stats_created_ohne_abandoned_future_archived(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    created_days = {
        entry["date"]: entry["created"]
        for entry in payload["daily_flow"]
        if entry["created"]
    }
    assert created_days == {"2026-06-19": 1, "2026-06-20": 1, "2026-06-21": 1}


def test_stats_summary_zaehlt_done_status(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    assert payload["summary"]["completed"] == 2
    assert payload["summary"]["created"] == 3
    # open enthaelt den offenen task und den future task, aber weder
    # abandoned noch archived
    assert payload["summary"]["open"] == 2


def test_stats_workspace_zaehlt_abandoned_nicht(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    total_open_by_workspace = sum(
        entry["count"] for entry in payload["open_by_workspace"]
    )
    assert total_open_by_workspace == 2
