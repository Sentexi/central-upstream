import sys
from pathlib import Path

import pytest
from flask import Flask


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.modules.vape_tracker.repository import (  # noqa: E402
    add_baseline,
    add_reading,
    build_overview,
    ensure_schema,
)
from app.modules.vape_tracker.routes import bp, close_vape_conn  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    app = Flask(__name__)
    app.config.update(
        TESTING=True,
        VAPE_DB_PATH=str(tmp_path / "vape.db"),
        VAPE_TIMEZONE="Europe/Berlin",
    )
    app.register_blueprint(bp, url_prefix="/api/vape")
    app.teardown_appcontext(close_vape_conn)
    return app.test_client()


def _reading(client, counter, timestamp):
    return client.post(
        "/api/vape",
        json={"counter": counter, "timestamp": timestamp},
    )


def test_morning_delta_is_attributed_to_previous_day(client):
    assert _reading(client, 100, "2026-07-20T08:00:00+02:00").status_code == 201
    assert _reading(client, 160, "2026-07-20T23:00:00+02:00").status_code == 201
    assert _reading(client, 190, "2026-07-21T08:00:00+02:00").status_code == 201
    assert _reading(client, 250, "2026-07-21T23:00:00+02:00").status_code == 201

    response = client.get(
        "/api/vape/overview"
        "?granularity=day"
        "&date_from=2026-07-20"
        "&date_to=2026-07-21"
    )
    assert response.status_code == 200
    data = response.get_json()

    assert [bucket["total_puffs"] for bucket in data["buckets"]] == [190, 60]
    assert data["summary"]["total_puffs"] == 250
    assert data["summary"]["average_per_day"] == 125


def test_coil_change_logs_final_counter_and_resets_atomically(client):
    _reading(client, 100, "2026-07-20T20:00:00+02:00")

    response = client.post(
        "/api/vape/coil-change",
        json={"counter": 130, "timestamp": "2026-07-21T08:00:00+02:00"},
    )
    assert response.status_code == 201
    data = response.get_json()
    assert data["final_reading"]["delta"] == 30
    assert data["reset"]["counter"] == 0
    assert data["reset"]["event_type"] == "coil_change"

    latest = client.get("/api/vape/latest").get_json()["latest"]
    assert latest["counter"] == 0
    assert latest["event_type"] == "coil_change"

    _reading(client, 40, "2026-07-21T23:00:00+02:00")
    overview = client.get(
        "/api/vape/overview"
        "?granularity=day"
        "&date_from=2026-07-20"
        "&date_to=2026-07-21"
    ).get_json()
    assert [bucket["total_puffs"] for bucket in overview["buckets"]] == [130, 40]
    assert overview["summary"]["coil_changes"] == 1


def test_counter_cannot_drop_without_explicit_coil_change(client):
    _reading(client, 100, "2026-07-20T20:00:00+02:00")

    response = _reading(client, 90, "2026-07-21T08:00:00+02:00")

    assert response.status_code == 409
    assert "Coil gewechselt" in response.get_json()["error"]
    assert client.get("/api/vape/latest").get_json()["latest"]["counter"] == 100


def test_weekly_and_monthly_buckets_return_daily_averages(client):
    _reading(client, 70, "2026-07-06T08:00:00+02:00")
    _reading(client, 140, "2026-07-13T08:00:00+02:00")
    _reading(client, 210, "2026-07-20T08:00:00+02:00")

    weekly = client.get(
        "/api/vape/overview"
        "?granularity=week"
        "&date_from=2026-07-06"
        "&date_to=2026-07-19"
    ).get_json()
    assert len(weekly["buckets"]) == 2
    assert weekly["buckets"][0]["average_per_day"] == 70
    assert weekly["buckets"][1]["average_per_day"] == 70
    assert weekly["summary"]["days_with_data"] == 3

    monthly = client.get(
        "/api/vape/overview"
        "?granularity=month"
        "&date_from=2026-07-01"
        "&date_to=2026-07-31"
    ).get_json()
    assert len(monthly["buckets"]) == 1
    assert monthly["buckets"][0]["total_puffs"] == 210
    assert monthly["buckets"][0]["average_per_day"] == 70


def test_existing_schema_is_upgraded_without_losing_rows(tmp_path):
    import sqlite3

    db_path = tmp_path / "legacy-vape.db"
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE vape_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            counter INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        INSERT INTO vape_entries (
            date, timestamp, counter, delta, note, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            "2026-07-20",
            "2026-07-20T20:00:00+02:00",
            100,
            100,
            None,
            "2026-07-20T18:00:00+00:00",
        ),
    )
    conn.commit()
    conn.close()

    app = Flask(__name__)
    app.config.update(
        TESTING=True,
        VAPE_DB_PATH=str(db_path),
        VAPE_TIMEZONE="Europe/Berlin",
    )
    app.register_blueprint(bp, url_prefix="/api/vape")
    app.teardown_appcontext(close_vape_conn)

    with app.test_client() as legacy_client:
        overview = legacy_client.get(
            "/api/vape/overview"
            "?granularity=day"
            "&date_from=2026-07-20"
            "&date_to=2026-07-20"
        )
        assert overview.status_code == 200
        assert overview.get_json()["summary"]["total_puffs"] == 100

    conn = sqlite3.connect(db_path)
    columns = {
        row[1] for row in conn.execute("PRAGMA table_info(vape_entries)")
    }
    count = conn.execute("SELECT COUNT(*) FROM vape_entries").fetchone()[0]
    conn.close()
    assert {"event_type", "usage_date"}.issubset(columns)
    assert count == 1


def test_legacy_baseline_anchors_counter_without_creating_phantom_puffs(tmp_path):
    import sqlite3
    from datetime import date, datetime, timezone

    conn = sqlite3.connect(tmp_path / "baseline.db")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)

    add_baseline(
        conn,
        counter=1941,
        recorded_at=datetime.fromisoformat("2025-12-26T08:00:00+01:00"),
        created_at="2026-07-27T20:00:00+00:00",
        note="legacy_baseline | first source row",
    )
    add_reading(
        conn,
        counter=2002,
        recorded_at=datetime.fromisoformat("2025-12-26T23:00:00+01:00"),
        created_at="2026-07-27T20:00:00+00:00",
        note="legacy_evening",
    )

    overview = build_overview(
        conn,
        date_from=date(2025, 12, 26),
        date_to=date(2025, 12, 26),
        granularity="day",
        local_timezone=timezone.utc,
    )
    assert overview["summary"]["total_puffs"] == 61
    assert overview["summary"]["days_with_data"] == 1
    assert [entry["event_type"] for entry in overview["entries"]] == ["reading"]
    assert overview["latest"]["counter"] == 2002
    conn.close()
