from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import unicodedata
from datetime import datetime, timedelta, timezone
from statistics import median
from typing import Callable, Dict, Iterable, List, Optional

from .repository import NormalizedRecord


ANALYSIS_VERSION = 1
PHASE_GAP_DAYS = 28

SPORT_LABELS = {
    "running": "Joggen",
    "walking": "Gehen",
    "swimming": "Schwimmen",
    "strength": "Krafttraining",
    "cycling": "Radfahren",
    "other": "Weitere",
}
SPORT_ORDER = tuple(SPORT_LABELS)

DISTANCE_CLASSES = (
    ("short", "Kurz", None, 3.0),
    ("typical", "Typisch", 3.0, 5.0),
    ("extended", "Erweitert", 5.0, 7.5),
    ("long", "Lang", 7.5, 10.0),
    ("very_long", "Sehr lang", 10.0, None),
)

RANGE_DELTAS = {
    "90d": timedelta(days=90),
    "1y": timedelta(days=365),
}


def classify_sport(name: str, payload: Optional[dict] = None) -> str:
    """Map localized Health workout names to a stable internal sport family."""

    payload = payload or {}
    raw_values = [
        name,
        payload.get("type"),
        payload.get("workoutType"),
        payload.get("workoutActivityType"),
        payload.get("activityType"),
    ]
    haystack = " ".join(str(value) for value in raw_values if value)
    normalized = unicodedata.normalize("NFKD", haystack.casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))

    keyword_groups = (
        (
            "strength",
            (
                "strength",
                "kraft",
                "gewichtstraining",
                "weight training",
                "functional training",
                "traditional strength",
                "core training",
            ),
        ),
        (
            "swimming",
            ("swim", "schwimm", "pool swim", "open water"),
        ),
        (
            "running",
            (
                "running",
                "outdoor run",
                "indoor run",
                "trail run",
                "treadmill run",
                "jog",
                "laufen",
                "lauftraining",
                "laufband",
                "ausfuhren",
            ),
        ),
        (
            "walking",
            (
                "walking",
                "outdoor walk",
                "indoor walk",
                "walk",
                "gehen",
                "spaziergang",
                "hiking",
                "wandern",
            ),
        ),
        (
            "cycling",
            ("cycling", "bike", "biking", "radfahren", "fahrrad"),
        ),
    )
    for sport_type, keywords in keyword_groups:
        if any(keyword in normalized for keyword in keywords):
            return sport_type
    return "other"


class WorkoutRepository:
    """Normalized persistence and read model for Health Auto Export workouts."""

    def __init__(self, db_path: str):
        self.db_path = db_path
        directory = os.path.dirname(os.path.abspath(db_path))
        os.makedirs(directory, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _ensure_schema(self):
        with self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS health_workout_sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    external_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    sport_type TEXT NOT NULL,
                    start_ts INTEGER NOT NULL,
                    end_ts INTEGER NOT NULL,
                    duration_seconds REAL,
                    distance_meters REAL,
                    active_energy_kcal REAL,
                    avg_heart_rate REAL,
                    min_heart_rate REAL,
                    max_heart_rate REAL,
                    elevation_gain_meters REAL,
                    intensity_value REAL,
                    intensity_unit TEXT,
                    location TEXT,
                    is_indoor INTEGER,
                    batch_ts INTEGER NOT NULL,
                    raw_payload TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_health_workout_sessions_sport_start
                    ON health_workout_sessions(sport_type, start_ts DESC);
                CREATE INDEX IF NOT EXISTS idx_health_workout_sessions_distance
                    ON health_workout_sessions(distance_meters, start_ts DESC);

                CREATE TABLE IF NOT EXISTS health_workout_hr_samples (
                    workout_id INTEGER NOT NULL,
                    sample_ts INTEGER NOT NULL,
                    min_bpm REAL,
                    avg_bpm REAL,
                    max_bpm REAL,
                    source TEXT,
                    PRIMARY KEY (workout_id, sample_ts),
                    FOREIGN KEY (workout_id)
                        REFERENCES health_workout_sessions(id)
                        ON DELETE CASCADE
                ) WITHOUT ROWID;

                CREATE TABLE IF NOT EXISTS health_workout_route_points (
                    workout_id INTEGER NOT NULL,
                    point_index INTEGER NOT NULL,
                    sample_ts INTEGER,
                    latitude REAL,
                    longitude REAL,
                    altitude_meters REAL,
                    speed_mps REAL,
                    horizontal_accuracy REAL,
                    PRIMARY KEY (workout_id, point_index),
                    FOREIGN KEY (workout_id)
                        REFERENCES health_workout_sessions(id)
                        ON DELETE CASCADE
                ) WITHOUT ROWID;

                CREATE TABLE IF NOT EXISTS health_workout_analysis (
                    workout_id INTEGER PRIMARY KEY,
                    analysis_version INTEGER NOT NULL,
                    pace_seconds_per_km REAL,
                    distance_class TEXT,
                    heart_rate_sample_count INTEGER NOT NULL DEFAULT 0,
                    heart_rate_coverage_pct REAL,
                    route_point_count INTEGER NOT NULL DEFAULT 0,
                    updated_at_ts INTEGER NOT NULL,
                    FOREIGN KEY (workout_id)
                        REFERENCES health_workout_sessions(id)
                        ON DELETE CASCADE
                );
                """
            )
            self._reclassify_other_sessions(conn)
            conn.commit()

    @staticmethod
    def _reclassify_other_sessions(conn: sqlite3.Connection) -> None:
        """Revisit unknown sports when the classifier gains new definitions."""

        rows = conn.execute(
            """
            SELECT id, name, raw_payload
            FROM health_workout_sessions
            WHERE sport_type = 'other'
            """
        ).fetchall()
        updates = []
        for row in rows:
            try:
                payload = json.loads(row["raw_payload"])
            except (TypeError, json.JSONDecodeError):
                payload = {}
            if not isinstance(payload, dict):
                payload = {}

            sport_type = classify_sport(row["name"], payload)
            if sport_type != "other":
                updates.append((sport_type, row["id"]))

        conn.executemany(
            """
            UPDATE health_workout_sessions
            SET sport_type = ?
            WHERE id = ? AND sport_type = 'other'
            """,
            updates,
        )

    def ingest_records(
        self,
        records: List[NormalizedRecord],
        *,
        batch_ts: int,
        progress_callback: Optional[Callable[[int], None]] = None,
    ) -> Dict:
        inserted = 0
        skipped = 0

        with self._connect() as conn:
            for index, record in enumerate(records, start=1):
                if self._upsert_workout(conn, record, batch_ts=batch_ts):
                    inserted += 1
                else:
                    skipped += 1

                if index % 25 == 0 or index == len(records):
                    conn.commit()
                    if progress_callback:
                        progress_callback(index)

        return {
            "inserted": inserted,
            "skipped": skipped,
            "by_type": {
                "workouts": {
                    "inserted": inserted,
                    "skipped": skipped,
                }
            },
        }

    def _upsert_workout(
        self,
        conn: sqlite3.Connection,
        record: NormalizedRecord,
        *,
        batch_ts: int,
    ) -> bool:
        incoming_payload = record.payload
        external_id = self._external_id(incoming_payload, record)
        existing = conn.execute(
            """
            SELECT id, batch_ts, raw_payload
            FROM health_workout_sessions
            WHERE external_id = ?
            """,
            (external_id,),
        ).fetchone()
        if existing is not None and int(existing["batch_ts"]) > batch_ts:
            return False
        payload = _merge_payload(
            existing["raw_payload"] if existing else None,
            incoming_payload,
        )
        name = str(payload.get("name") or payload.get("workoutName") or "Workout").strip()

        duration_seconds = _number(payload.get("duration"))
        if duration_seconds is None:
            duration_seconds = max(0, record.end_ts - record.start_ts)

        distance_meters = _distance_meters(payload.get("distance"))
        active_energy_kcal = _energy_kcal(
            payload.get("activeEnergyBurned") or payload.get("activeEnergy")
        )
        elevation_gain_meters = _distance_meters(
            payload.get("elevationUp") or payload.get("elevationGain")
        )
        intensity_value, intensity_unit = _quantity(payload.get("intensity"))
        min_hr, avg_hr, max_hr = _heart_rate_summary(payload)
        is_indoor = payload.get("isIndoor")
        if not isinstance(is_indoor, bool):
            is_indoor = None

        values = (
            external_id,
            name,
            classify_sport(name, payload),
            record.start_ts,
            record.end_ts,
            duration_seconds,
            distance_meters,
            active_energy_kcal,
            avg_hr,
            min_hr,
            max_hr,
            elevation_gain_meters,
            intensity_value,
            intensity_unit,
            _optional_text(payload.get("location")),
            int(is_indoor) if is_indoor is not None else None,
            batch_ts,
            json.dumps(
                _compact_raw_payload(payload),
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        )
        conn.execute(
            """
            INSERT INTO health_workout_sessions (
                external_id, name, sport_type, start_ts, end_ts,
                duration_seconds, distance_meters, active_energy_kcal,
                avg_heart_rate, min_heart_rate, max_heart_rate,
                elevation_gain_meters, intensity_value, intensity_unit,
                location, is_indoor, batch_ts, raw_payload
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(external_id) DO UPDATE SET
                name = excluded.name,
                sport_type = excluded.sport_type,
                start_ts = excluded.start_ts,
                end_ts = excluded.end_ts,
                duration_seconds = COALESCE(excluded.duration_seconds, duration_seconds),
                distance_meters = COALESCE(excluded.distance_meters, distance_meters),
                active_energy_kcal = COALESCE(excluded.active_energy_kcal, active_energy_kcal),
                avg_heart_rate = COALESCE(excluded.avg_heart_rate, avg_heart_rate),
                min_heart_rate = COALESCE(excluded.min_heart_rate, min_heart_rate),
                max_heart_rate = COALESCE(excluded.max_heart_rate, max_heart_rate),
                elevation_gain_meters = COALESCE(
                    excluded.elevation_gain_meters, elevation_gain_meters
                ),
                intensity_value = COALESCE(excluded.intensity_value, intensity_value),
                intensity_unit = COALESCE(excluded.intensity_unit, intensity_unit),
                location = COALESCE(excluded.location, location),
                is_indoor = COALESCE(excluded.is_indoor, is_indoor),
                batch_ts = excluded.batch_ts,
                raw_payload = excluded.raw_payload
            """,
            values,
        )
        effective = conn.execute(
            """
            SELECT id, duration_seconds, distance_meters
            FROM health_workout_sessions
            WHERE external_id = ?
            """,
            (external_id,),
        ).fetchone()
        workout_id = int(effective["id"])

        if "heartRateData" in incoming_payload:
            self._replace_heart_rate_samples(
                conn,
                workout_id=workout_id,
                samples=incoming_payload.get("heartRateData"),
            )
        if "route" in incoming_payload:
            self._replace_route_points(
                conn,
                workout_id=workout_id,
                points=incoming_payload.get("route"),
            )

        self._refresh_analysis(
            conn,
            workout_id=workout_id,
            duration_seconds=effective["duration_seconds"],
            distance_meters=effective["distance_meters"],
            batch_ts=batch_ts,
        )
        return True

    @staticmethod
    def _external_id(payload: dict, record: NormalizedRecord) -> str:
        raw_id = payload.get("id") or payload.get("uuid") or payload.get("workoutId")
        if raw_id is not None and str(raw_id).strip():
            return str(raw_id).strip()
        stable = "|".join(
            (
                str(payload.get("name") or "workout"),
                str(record.start_ts),
                str(record.end_ts),
            )
        )
        return f"generated-{hashlib.sha256(stable.encode('utf-8')).hexdigest()[:24]}"

    @staticmethod
    def _replace_heart_rate_samples(
        conn: sqlite3.Connection,
        *,
        workout_id: int,
        samples,
    ):
        conn.execute(
            "DELETE FROM health_workout_hr_samples WHERE workout_id = ?",
            (workout_id,),
        )
        if not isinstance(samples, list):
            return

        rows = []
        for sample in samples:
            if not isinstance(sample, dict):
                continue
            sample_ts = _parse_timestamp(sample.get("date") or sample.get("timestamp"))
            if sample_ts is None:
                continue
            min_bpm = _number(sample.get("Min") if "Min" in sample else sample.get("min"))
            avg_bpm = _number(sample.get("Avg") if "Avg" in sample else sample.get("avg"))
            max_bpm = _number(sample.get("Max") if "Max" in sample else sample.get("max"))
            if min_bpm is None and avg_bpm is None and max_bpm is None:
                continue
            rows.append(
                (
                    workout_id,
                    sample_ts,
                    min_bpm,
                    avg_bpm,
                    max_bpm,
                    _optional_text(sample.get("source")),
                )
            )
        conn.executemany(
            """
            INSERT OR REPLACE INTO health_workout_hr_samples (
                workout_id, sample_ts, min_bpm, avg_bpm, max_bpm, source
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

    @staticmethod
    def _replace_route_points(
        conn: sqlite3.Connection,
        *,
        workout_id: int,
        points,
    ):
        conn.execute(
            "DELETE FROM health_workout_route_points WHERE workout_id = ?",
            (workout_id,),
        )
        if not isinstance(points, list):
            return

        rows = []
        for point_index, point in enumerate(points):
            if not isinstance(point, dict):
                continue
            rows.append(
                (
                    workout_id,
                    point_index,
                    _parse_timestamp(point.get("timestamp") or point.get("date")),
                    _number(point.get("latitude")),
                    _number(point.get("longitude")),
                    _number(point.get("altitude")),
                    _number(point.get("speed")),
                    _number(point.get("horizontalAccuracy")),
                )
            )
        conn.executemany(
            """
            INSERT INTO health_workout_route_points (
                workout_id, point_index, sample_ts, latitude, longitude,
                altitude_meters, speed_mps, horizontal_accuracy
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )

    @staticmethod
    def _refresh_analysis(
        conn: sqlite3.Connection,
        *,
        workout_id: int,
        duration_seconds: Optional[float],
        distance_meters: Optional[float],
        batch_ts: int,
    ):
        pace = None
        distance_class = None
        if (
            duration_seconds is not None
            and distance_meters is not None
            and duration_seconds > 0
            and distance_meters > 0
        ):
            pace = duration_seconds / (distance_meters / 1000.0)
            distance_class = _distance_class(distance_meters / 1000.0)

        hr_row = conn.execute(
            """
            SELECT COUNT(*) AS sample_count,
                   MIN(sample_ts) AS first_sample,
                   MAX(sample_ts) AS last_sample
            FROM health_workout_hr_samples
            WHERE workout_id = ?
            """,
            (workout_id,),
        ).fetchone()
        route_count = conn.execute(
            "SELECT COUNT(*) FROM health_workout_route_points WHERE workout_id = ?",
            (workout_id,),
        ).fetchone()[0]

        coverage = None
        if (
            hr_row["sample_count"] >= 2
            and duration_seconds is not None
            and duration_seconds > 0
        ):
            covered_seconds = max(
                0,
                int(hr_row["last_sample"]) - int(hr_row["first_sample"]),
            )
            coverage = min(100.0, covered_seconds / duration_seconds * 100.0)

        conn.execute(
            """
            INSERT INTO health_workout_analysis (
                workout_id, analysis_version, pace_seconds_per_km,
                distance_class, heart_rate_sample_count,
                heart_rate_coverage_pct, route_point_count, updated_at_ts
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(workout_id) DO UPDATE SET
                analysis_version = excluded.analysis_version,
                pace_seconds_per_km = excluded.pace_seconds_per_km,
                distance_class = excluded.distance_class,
                heart_rate_sample_count = excluded.heart_rate_sample_count,
                heart_rate_coverage_pct = excluded.heart_rate_coverage_pct,
                route_point_count = excluded.route_point_count,
                updated_at_ts = excluded.updated_at_ts
            """,
            (
                workout_id,
                ANALYSIS_VERSION,
                pace,
                distance_class,
                int(hr_row["sample_count"]),
                coverage,
                int(route_count),
                batch_ts,
            ),
        )

    def get_overview(self, range_key: str = "all") -> Dict:
        if range_key not in {"90d", "1y", "all"}:
            raise ValueError("unsupported workout range")

        start_ts = None
        if range_key in RANGE_DELTAS:
            start_ts = int(
                (datetime.now(tz=timezone.utc) - RANGE_DELTAS[range_key]).timestamp()
            )

        query = """
            SELECT s.*, a.pace_seconds_per_km, a.distance_class,
                   a.heart_rate_sample_count, a.heart_rate_coverage_pct,
                   a.route_point_count
            FROM health_workout_sessions AS s
            LEFT JOIN health_workout_analysis AS a ON a.workout_id = s.id
        """
        params: tuple = ()
        if start_ts is not None:
            query += " WHERE s.start_ts >= ?"
            params = (start_ts,)
        query += " ORDER BY s.start_ts ASC"

        with self._connect() as conn:
            rows = [dict(row) for row in conn.execute(query, params).fetchall()]

        sports = self._sport_summaries(rows)
        running_rows = [row for row in rows if row["sport_type"] == "running"]
        running = self._running_overview(running_rows)

        return {
            "range": range_key,
            "sports": sports,
            "running": running,
            "data_quality": {
                "workout_count": len(rows),
                "with_distance": sum(row["distance_meters"] is not None for row in rows),
                "with_heart_rate": sum(
                    int(row.get("heart_rate_sample_count") or 0) > 0 for row in rows
                ),
                "with_route": sum(
                    int(row.get("route_point_count") or 0) > 0 for row in rows
                ),
            },
        }

    @staticmethod
    def _sport_summaries(rows: List[dict]) -> List[dict]:
        summaries = []
        for sport_type in SPORT_ORDER:
            matching = [row for row in rows if row["sport_type"] == sport_type]
            if not matching:
                continue
            summaries.append(
                {
                    "sport_type": sport_type,
                    "label": SPORT_LABELS[sport_type],
                    "workout_count": len(matching),
                    "total_duration_minutes": _scaled_sum_or_none(
                        (row["duration_seconds"] for row in matching),
                        divisor=60.0,
                    ),
                    "total_distance_km": _scaled_sum_or_none(
                        (row["distance_meters"] for row in matching),
                        divisor=1000.0,
                    ),
                    "last_workout_at": _iso_timestamp(
                        max(int(row["start_ts"]) for row in matching)
                    ),
                    "workout_names": sorted({str(row["name"]) for row in matching}),
                }
            )
        return summaries

    def _running_overview(self, rows: List[dict]) -> dict:
        phases = self._running_phases(rows)
        distance_classes = self._running_distance_classes(rows)
        distance_values = [
            float(row["distance_meters"]) / 1000.0
            for row in rows
            if row["distance_meters"] is not None
        ]
        pace_values = [
            float(row["pace_seconds_per_km"])
            for row in rows
            if row["pace_seconds_per_km"] is not None
        ]
        current_phase = phases[-1] if phases else None

        recent = [
            _workout_summary(row)
            for row in sorted(rows, key=lambda item: int(item["start_ts"]), reverse=True)[
                :8
            ]
        ]
        return {
            "available": bool(rows),
            "workout_count": len(rows),
            "summary": {
                "current_phase_workouts": (
                    current_phase["workout_count"] if current_phase else 0
                ),
                "current_phase_start_at": (
                    current_phase["start_at"] if current_phase else None
                ),
                "typical_distance_km": (
                    median(distance_values) if distance_values else None
                ),
                "total_distance_km": sum(distance_values) if distance_values else None,
                "median_pace_seconds_per_km": (
                    median(pace_values) if pace_values else None
                ),
                "last_workout_at": (
                    _iso_timestamp(max(int(row["start_ts"]) for row in rows))
                    if rows
                    else None
                ),
            },
            "phases": phases,
            "distance_classes": distance_classes,
            "recent_workouts": recent,
        }

    @staticmethod
    def _running_phases(rows: List[dict]) -> List[dict]:
        if not rows:
            return []

        ordered = sorted(rows, key=lambda row: int(row["start_ts"]))
        groups: List[dict] = []
        current_rows: List[dict] = []
        gap_before_days = None
        previous = None

        for row in ordered:
            if previous is not None:
                gap_days = max(
                    0.0,
                    (int(row["start_ts"]) - int(previous["end_ts"])) / 86400.0,
                )
                if gap_days > PHASE_GAP_DAYS:
                    groups.append(
                        _phase_summary(current_rows, gap_before_days=gap_before_days)
                    )
                    current_rows = []
                    gap_before_days = round(gap_days)
            current_rows.append(row)
            previous = row

        groups.append(_phase_summary(current_rows, gap_before_days=gap_before_days))
        if groups:
            groups[-1]["is_current"] = True
        return groups

    @staticmethod
    def _running_distance_classes(rows: List[dict]) -> List[dict]:
        result = []
        for key, label, _, _ in DISTANCE_CLASSES:
            matching = [row for row in rows if row.get("distance_class") == key]
            if not matching:
                continue
            paces = [
                float(row["pace_seconds_per_km"])
                for row in matching
                if row["pace_seconds_per_km"] is not None
            ]
            ordered_paces = [
                float(row["pace_seconds_per_km"])
                for row in sorted(matching, key=lambda item: int(item["start_ts"]))
                if row["pace_seconds_per_km"] is not None
            ]
            result.append(
                {
                    "key": key,
                    "label": label,
                    "workout_count": len(matching),
                    "median_pace_seconds_per_km": (
                        median(paces) if paces else None
                    ),
                    "trend_seconds_per_km": _pace_trend(ordered_paces),
                    "total_distance_km": sum(
                        float(row["distance_meters"]) / 1000.0
                        for row in matching
                        if row["distance_meters"] is not None
                    ),
                }
            )
        return result

    def count_sessions(self) -> int:
        with self._connect() as conn:
            return int(
                conn.execute("SELECT COUNT(*) FROM health_workout_sessions").fetchone()[0]
            )


def _phase_summary(rows: List[dict], *, gap_before_days: Optional[int]) -> dict:
    start_ts = int(rows[0]["start_ts"])
    end_ts = int(rows[-1]["end_ts"])
    paces = [
        float(row["pace_seconds_per_km"])
        for row in rows
        if row["pace_seconds_per_km"] is not None
    ]
    heart_rates = [
        float(row["avg_heart_rate"])
        for row in rows
        if row["avg_heart_rate"] is not None
    ]
    distances = [
        float(row["distance_meters"]) / 1000.0
        for row in rows
        if row["distance_meters"] is not None
    ]
    return {
        "id": f"phase-{start_ts}",
        "label": _phase_label(start_ts, end_ts),
        "start_at": _iso_timestamp(start_ts),
        "end_at": _iso_timestamp(end_ts),
        "gap_before_days": gap_before_days,
        "is_current": False,
        "workout_count": len(rows),
        "total_distance_km": sum(distances) if distances else None,
        "median_pace_seconds_per_km": median(paces) if paces else None,
        "median_heart_rate": median(heart_rates) if heart_rates else None,
        "workouts": [_workout_summary(row) for row in rows],
    }


def _workout_summary(row: dict) -> dict:
    return {
        "id": int(row["id"]),
        "external_id": row["external_id"],
        "name": row["name"],
        "start_at": _iso_timestamp(int(row["start_ts"])),
        "duration_seconds": row["duration_seconds"],
        "distance_km": (
            float(row["distance_meters"]) / 1000.0
            if row["distance_meters"] is not None
            else None
        ),
        "pace_seconds_per_km": row.get("pace_seconds_per_km"),
        "avg_heart_rate": row["avg_heart_rate"],
        "location": row["location"],
        "has_heart_rate": int(row.get("heart_rate_sample_count") or 0) > 0,
        "has_route": int(row.get("route_point_count") or 0) > 0,
    }


def _phase_label(start_ts: int, end_ts: int) -> str:
    month_names = (
        "Jan",
        "Feb",
        "Mrz",
        "Apr",
        "Mai",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Okt",
        "Nov",
        "Dez",
    )
    start = datetime.fromtimestamp(start_ts, tz=timezone.utc)
    end = datetime.fromtimestamp(end_ts, tz=timezone.utc)
    start_label = f"{month_names[start.month - 1]} {start.year}"
    end_label = f"{month_names[end.month - 1]} {end.year}"
    return start_label if start_label == end_label else f"{start_label} bis {end_label}"


def _distance_class(distance_km: float) -> str:
    if distance_km < 3.0:
        return "short"
    if distance_km <= 5.0:
        return "typical"
    if distance_km <= 7.5:
        return "extended"
    if distance_km <= 10.0:
        return "long"
    return "very_long"


def _pace_trend(paces: List[float]) -> Optional[float]:
    if len(paces) < 4:
        return None
    split_at = len(paces) // 2
    return median(paces[split_at:]) - median(paces[:split_at])


def _parse_timestamp(value) -> Optional[int]:
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.astimezone(timezone.utc).timestamp())


def _quantity(value) -> tuple[Optional[float], Optional[str]]:
    if isinstance(value, dict):
        raw_quantity = value.get("qty") if "qty" in value else value.get("value")
        return _number(raw_quantity), _optional_text(
            value.get("units") or value.get("unit")
        )
    return _number(value), None


def _distance_meters(value) -> Optional[float]:
    quantity, unit = _quantity(value)
    if quantity is None:
        return None
    normalized = (unit or "m").strip().casefold()
    if normalized in {"km", "kilometer", "kilometers"}:
        return quantity * 1000.0
    if normalized in {"mi", "mile", "miles"}:
        return quantity * 1609.344
    if normalized in {"yd", "yard", "yards"}:
        return quantity * 0.9144
    if normalized in {"ft", "foot", "feet"}:
        return quantity * 0.3048
    return quantity


def _energy_kcal(value) -> Optional[float]:
    if isinstance(value, list):
        values = [_energy_kcal(item) for item in value]
        valid = [item for item in values if item is not None]
        return sum(valid) if valid else None
    quantity, unit = _quantity(value)
    if quantity is None:
        return None
    normalized = (unit or "kcal").strip().casefold()
    if normalized == "kj":
        return quantity / 4.184
    if normalized in {"j", "joule", "joules"}:
        return quantity / 4184.0
    if normalized in {"cal", "calorie", "calories"}:
        return quantity / 1000.0
    return quantity


def _heart_rate_summary(
    payload: dict,
) -> tuple[Optional[float], Optional[float], Optional[float]]:
    samples = payload.get("heartRateData")
    min_values: List[float] = []
    avg_values: List[float] = []
    max_values: List[float] = []
    if isinstance(samples, list):
        for sample in samples:
            if not isinstance(sample, dict):
                continue
            min_value = _number(
                sample.get("Min") if "Min" in sample else sample.get("min")
            )
            avg_value = _number(
                sample.get("Avg") if "Avg" in sample else sample.get("avg")
            )
            max_value = _number(
                sample.get("Max") if "Max" in sample else sample.get("max")
            )
            if min_value is not None:
                min_values.append(min_value)
            if avg_value is not None:
                avg_values.append(avg_value)
            if max_value is not None:
                max_values.append(max_value)

    summary = payload.get("heartRate")
    if isinstance(summary, dict):
        summary_min, _ = _quantity(summary.get("min"))
        summary_avg, _ = _quantity(summary.get("avg"))
        summary_max, _ = _quantity(summary.get("max"))
    else:
        summary_min = summary_avg = summary_max = None

    direct_avg, _ = _quantity(payload.get("avgHeartRate"))
    direct_max, _ = _quantity(payload.get("maxHeartRate"))
    return (
        summary_min if summary_min is not None else (min(min_values) if min_values else None),
        direct_avg
        if direct_avg is not None
        else summary_avg
        if summary_avg is not None
        else (sum(avg_values) / len(avg_values) if avg_values else None),
        direct_max
        if direct_max is not None
        else summary_max
        if summary_max is not None
        else (max(max_values) if max_values else None),
    )


def _number(value) -> Optional[float]:
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _merge_payload(existing_raw, incoming: dict) -> dict:
    if not existing_raw:
        return dict(incoming)
    try:
        existing = json.loads(existing_raw)
    except (TypeError, json.JSONDecodeError):
        existing = {}
    if not isinstance(existing, dict):
        existing = {}
    return {**existing, **incoming}


def _compact_raw_payload(payload: dict) -> dict:
    return {
        key: value
        for key, value in payload.items()
        if key not in {"heartRateData", "route"}
    }


def _optional_text(value) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _scaled_sum_or_none(
    values: Iterable[Optional[float]],
    *,
    divisor: float,
) -> Optional[float]:
    valid = [float(value) for value in values if value is not None]
    if not valid:
        return None
    return sum(valid) / divisor


def _iso_timestamp(timestamp: int) -> str:
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()
