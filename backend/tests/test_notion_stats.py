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
    repo.upsert_row(
        {
            "id": "task-done",
            "title": "Erledigter Task",
            "status": "Done",
            "done_time": "2026-07-01T10:00:00.000+02:00",
            "created_time": "2026-06-20T08:00:00.000+02:00",
            "last_edited_time": "2026-07-05T09:00:00.000+02:00",
            "archived": 0,
        }
    )
    repo.upsert_row(
        {
            "id": "task-open",
            "title": "Offener Task",
            "status": "In progress",
            "done_time": None,
            "created_time": "2026-06-21T08:00:00.000+02:00",
            "last_edited_time": "2026-07-06T09:00:00.000+02:00",
            "archived": 0,
        }
    )

    app = Flask(__name__)
    app.config["NOTION_DB_PATH"] = db_path
    app.register_blueprint(bp, url_prefix="/api/modules/notion")
    return app.test_client()


def test_stats_completion_nutzt_done_time_statt_last_edited(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    completed_days = {
        entry["date"]: entry["completed"]
        for entry in payload["daily_flow"]
        if entry["completed"]
    }
    assert completed_days == {"2026-07-01": 1}


def test_stats_summary_zaehlt_done_status(client):
    payload = client.get("/api/modules/notion/stats").get_json()
    assert payload["summary"]["completed"] == 1
    assert payload["summary"]["open"] == 1
