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
    "Estimated Time (min)": {"column": "estimated_time_min", "type": "number", "sqlite_type": "REAL"},
    "Actual time (min)": {"column": "actual_time_min", "type": "number", "sqlite_type": "REAL"},
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
            "estimated_time_min": 30,
            "actual_time_min": 55,
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
            "estimated_time_min": 20,
            "actual_time_min": 45,
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
            "estimated_time_min": 60,
            "actual_time_min": None,
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
            "estimated_time_min": 120,
            "actual_time_min": None,
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
            "estimated_time_min": 240,
            "actual_time_min": None,
            "archived": 0,
        },
        # notion archiv-flag zaehlt nirgends
        {
            "id": "task-archived-flag",
            "title": "Archivierter Task (Flag)",
            "status": "In progress",
            "done_time": None,
            "created_time": "2026-06-24T08:00:00.000+02:00",
            "last_edited_time": "2026-06-24T08:00:00.000+02:00",
            "estimated_time_min": 45,
            "actual_time_min": None,
            "archived": 1,
        },
        # status Archived (eigener notion-status) zaehlt ebenfalls nirgends
        {
            "id": "task-archived-status",
            "title": "Archivierter Task (Status)",
            "status": "Archived",
            "done_time": None,
            "created_time": "2026-06-26T08:00:00.000+02:00",
            "last_edited_time": "2026-06-26T08:00:00.000+02:00",
            "estimated_time_min": 90,
            "actual_time_min": None,
            "archived": 0,
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
    # weder abandoned (06-22) noch future (06-23) noch archiv-flag (06-24)
    # noch status Archived (06-26)
    assert created_days == {"2026-06-19": 1, "2026-06-20": 1, "2026-06-21": 1}


def test_stats_minuten_beziehen_sich_beidseitig_auf_estimated_time(client):
    """Die Aufwandskarte vergleicht Erfuellungsaufwand (Estimated Time) rein
    vs. raus. Actual time darf in keine der beiden Serien einfliessen."""

    payload = client.get("/api/modules/notion/stats").get_json()
    created_minutes = {
        entry["date"]: entry["created_minutes"]
        for entry in payload["daily_flow"]
        if entry["created_minutes"]
    }
    completed_minutes = {
        entry["date"]: entry["completed_minutes"]
        for entry in payload["daily_flow"]
        if entry["completed_minutes"]
    }
    assert created_minutes == {"2026-06-19": 20, "2026-06-20": 30, "2026-06-21": 60}
    # 30 und 20 sind die estimated werte, die actual werte (55, 45) duerfen
    # nirgends auftauchen
    assert completed_minutes == {"2026-07-01": 30, "2026-06-25": 20}


def test_stats_summary_zaehlt_done_status(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    assert payload["summary"]["completed"] == 2
    assert payload["summary"]["created"] == 3
    # open enthaelt den offenen task und den future task, aber weder
    # abandoned noch archiv-flag noch status Archived
    assert payload["summary"]["open"] == 2


def test_stats_workspace_zaehlt_abandoned_und_archived_nicht(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    total_open_by_workspace = sum(
        entry["count"] for entry in payload["open_by_workspace"]
    )
    assert total_open_by_workspace == 2
