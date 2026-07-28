import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from flask import Flask

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.modules.health.repository import NormalizedRecord  # noqa: E402
from app.modules.health.routes import bp  # noqa: E402
from app.modules.health.workout_repository import (  # noqa: E402
    WorkoutRepository,
    classify_sport,
)


def _record(
    external_id: str,
    name: str,
    start: datetime,
    *,
    duration_seconds: float = 1800,
    distance_km: float | None = 4.2,
    heart_rate: bool = True,
    route: bool = False,
) -> NormalizedRecord:
    end = start + timedelta(seconds=duration_seconds)
    payload = {
        "id": external_id,
        "name": name,
        "start": start.isoformat(),
        "end": end.isoformat(),
        "duration": duration_seconds,
        "activeEnergyBurned": {"qty": 418.4, "units": "kJ"},
    }
    if distance_km is not None:
        payload["distance"] = {"qty": distance_km, "units": "km"}
    if heart_rate:
        payload["heartRateData"] = [
            {
                "date": (start + timedelta(seconds=10)).isoformat(),
                "Min": 125,
                "Avg": 140,
                "Max": 150,
                "units": "bpm",
            },
            {
                "date": (end - timedelta(seconds=10)).isoformat(),
                "Min": 135,
                "Avg": 155,
                "Max": 165,
                "units": "bpm",
            },
        ]
    if route:
        payload["route"] = [
            {
                "timestamp": (start + timedelta(seconds=5)).isoformat(),
                "latitude": 52.1,
                "longitude": 13.1,
                "altitude": 40,
                "speed": 2.5,
            }
        ]
    return NormalizedRecord(
        data_type="workouts",
        start_ts=int(start.timestamp()),
        end_ts=int(end.timestamp()),
        payload=payload,
    )


@pytest.fixture()
def workout_repo(tmp_path):
    return WorkoutRepository(str(tmp_path / "health.sqlite"))


@pytest.mark.parametrize(
    ("name", "sport_type"),
    [
        ("Outdoor Run", "running"),
        ("Lauftraining", "running"),
        ("Outdoor Ausf\u00fchren", "running"),
        ("Outdoor Spaziergang", "walking"),
        ("Pool Swimming", "swimming"),
        ("Funktionelles Krafttraining", "strength"),
        ("Radfahren outdoor", "cycling"),
        ("Yoga", "other"),
    ],
)
def test_sportklassifikation_deutsch_und_englisch(name, sport_type):
    assert classify_sport(name) == sport_type


def test_workout_ingest_ist_idempotent_und_ersetzt_nur_dieselbe_session(
    workout_repo,
):
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    first = _record("run-1", "Outdoor Run", start, route=True)
    stats = workout_repo.ingest_records([first], batch_ts=100)
    assert stats["inserted"] == 1

    # Spaeterer Teil-Export aktualisiert die Distanz, enthaelt aber keine
    # Heart-Rate- oder Route-Arrays. Die vorhandenen Samples bleiben erhalten.
    updated = _record(
        "run-1",
        "Outdoor Run",
        start,
        distance_km=4.5,
        heart_rate=False,
        route=False,
    )
    workout_repo.ingest_records([updated], batch_ts=200)

    with sqlite3.connect(workout_repo.db_path) as conn:
        assert conn.execute(
            "SELECT COUNT(*) FROM health_workout_sessions"
        ).fetchone()[0] == 1
        distance, energy = conn.execute(
            """
            SELECT distance_meters, active_energy_kcal
            FROM health_workout_sessions
            """
        ).fetchone()
        assert distance == pytest.approx(4500)
        assert energy == pytest.approx(100)
        assert conn.execute(
            "SELECT COUNT(*) FROM health_workout_hr_samples"
        ).fetchone()[0] == 2
        assert conn.execute(
            "SELECT COUNT(*) FROM health_workout_route_points"
        ).fetchone()[0] == 1
        raw_payload = conn.execute(
            "SELECT raw_payload FROM health_workout_sessions"
        ).fetchone()[0]
        assert "heartRateData" not in json.loads(raw_payload)
        assert "route" not in json.loads(raw_payload)


def test_aelterer_import_ueberschreibt_neuere_workout_version_nicht(workout_repo):
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    newer = _record("run-1", "Outdoor Run", start, distance_km=5.0)
    older = _record("run-1", "Outdoor Run", start, distance_km=3.0)
    workout_repo.ingest_records([newer], batch_ts=200)
    stats = workout_repo.ingest_records([older], batch_ts=100)

    assert stats["skipped"] == 1
    with sqlite3.connect(workout_repo.db_path) as conn:
        assert conn.execute(
            "SELECT distance_meters FROM health_workout_sessions"
        ).fetchone()[0] == pytest.approx(5000)


def test_schema_update_reklassifiziert_bisher_unbekannte_workouts(workout_repo):
    start = datetime(2026, 7, 27, 18, 33, tzinfo=timezone.utc)
    workout_repo.ingest_records(
        [_record("run-localized", "Outdoor Ausf\u00fchren", start)],
        batch_ts=100,
    )
    with sqlite3.connect(workout_repo.db_path) as conn:
        conn.execute(
            """
            UPDATE health_workout_sessions
            SET sport_type = 'other'
            WHERE external_id = 'run-localized'
            """
        )

    refreshed_repo = WorkoutRepository(workout_repo.db_path)

    with sqlite3.connect(refreshed_repo.db_path) as conn:
        assert conn.execute(
            """
            SELECT sport_type
            FROM health_workout_sessions
            WHERE external_id = 'run-localized'
            """
        ).fetchone()[0] == "running"
    payload = refreshed_repo.get_overview("all")
    assert payload["running"]["workout_count"] == 1
    assert all(item["sport_type"] != "other" for item in payload["sports"])


def test_overview_fokussiert_joggen_und_bildet_andere_workouts_ab(workout_repo):
    base = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    records = [
        _record("run-1", "Outdoor Run", base, distance_km=4.0),
        _record("run-2", "Lauftraining", base + timedelta(days=7), distance_km=4.5),
        _record("run-3", "Outdoor Run", base + timedelta(days=60), distance_km=6.0),
        _record("walk-1", "Outdoor Spaziergang", base + timedelta(days=2), distance_km=2.0),
        _record("swim-1", "Pool Swimming", base + timedelta(days=3), distance_km=1.0),
        _record(
            "strength-1",
            "Funktionelles Krafttraining",
            base + timedelta(days=4),
            distance_km=None,
        ),
    ]
    workout_repo.ingest_records(records, batch_ts=100)

    payload = workout_repo.get_overview("all")
    assert [item["sport_type"] for item in payload["sports"]] == [
        "running",
        "walking",
        "swimming",
        "strength",
    ]
    assert payload["running"]["available"] is True
    assert payload["running"]["workout_count"] == 3
    assert payload["running"]["summary"]["typical_distance_km"] == pytest.approx(4.5)
    assert len(payload["running"]["phases"]) == 2
    assert payload["running"]["phases"][1]["gap_before_days"] == 53
    assert payload["running"]["phases"][1]["is_current"] is True
    assert [item["key"] for item in payload["running"]["distance_classes"]] == [
        "typical",
        "extended",
    ]


def test_overview_erfindet_ohne_jogging_keine_laufwerte(workout_repo):
    start = datetime(2026, 1, 1, 10, tzinfo=timezone.utc)
    workout_repo.ingest_records(
        [_record("walk-1", "Outdoor Spaziergang", start, distance_km=2.0)],
        batch_ts=100,
    )

    payload = workout_repo.get_overview("all")
    assert payload["running"]["available"] is False
    assert payload["running"]["workout_count"] == 0
    assert payload["running"]["summary"]["typical_distance_km"] is None
    assert payload["running"]["summary"]["median_pace_seconds_per_km"] is None
    assert payload["sports"][0]["sport_type"] == "walking"


def test_workout_overview_endpoint_validiert_range(workout_repo):
    app = Flask(__name__)
    app.extensions["health_workout_repo"] = workout_repo
    app.register_blueprint(bp, url_prefix="/api/health")
    client = app.test_client()

    assert client.get("/api/health/workouts/overview?range=all").status_code == 200
    assert client.get("/api/health/workouts/overview?range=forever").status_code == 400
