from __future__ import annotations

import json
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Callable, Dict, List, Optional, Tuple


@dataclass
class NormalizedRecord:
    """A normalized entry from the Auto Export payload."""

    data_type: str
    start_ts: int
    end_ts: int
    payload: Dict


class HealthRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path
        directory = os.path.dirname(self.db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._ensure_metadata_table()
        self._summary_cache: Dict[Tuple[str, str], List[dict]] = {}

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_metadata_table(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS health_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _table_name_for_type(self, data_type: str) -> str:
        slug = re.sub(r"[^a-z0-9_]+", "_", data_type.lower())
        if not slug:
            slug = "generic"
        return f"health_{slug}"

    def _ensure_table(self, conn: sqlite3.Connection, table_name: str):
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_ts INTEGER NOT NULL,
                end_ts INTEGER NOT NULL,
                batch_ts INTEGER NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )

    def _sanitize_column_name(self, key: str) -> str:
        """Return a safe column name derived from a payload key."""

        sanitized = re.sub(r"[^a-z0-9_]+", "_", key.lower()).strip("_")
        if not sanitized:
            sanitized = "col"
        if sanitized[0].isdigit():
            sanitized = f"col_{sanitized}"
        return sanitized

    def _existing_columns(self, conn: sqlite3.Connection, table_name: str) -> List[str]:
        cursor = conn.execute(f"PRAGMA table_info({table_name})")
        return [row[1] for row in cursor.fetchall()]

    def _table_exists(self, conn: sqlite3.Connection, table_name: str) -> bool:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        )
        return cursor.fetchone() is not None

    def _ensure_payload_columns(
        self, conn: sqlite3.Connection, table_name: str, payload: Dict
    ) -> List[str]:
        existing = set(self._existing_columns(conn, table_name))
        payload_columns: List[str] = []
        seen: set[str] = set()

        for key in payload.keys():
            column = self._sanitize_column_name(str(key))
            if column not in existing:
                conn.execute(f'ALTER TABLE {table_name} ADD COLUMN "{column}" TEXT')
                existing.add(column)
            if column not in seen:
                payload_columns.append(column)
                seen.add(column)

        return payload_columns

    def _normalize_value(self, value):
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return value

    def ingest_records(
        self,
        records: List[NormalizedRecord],
        batch_ts: int,
        progress_callback: Optional[Callable[[int], None]] = None,
    ):
        stats: Dict[str, Dict[str, int]] = {}
        inserted = 0
        skipped = 0
        processed = 0

        with self._connect() as conn:
            for record in records:
                table_name = self._table_name_for_type(record.data_type)
                self._ensure_table(conn, table_name)
                was_inserted = self._upsert_record(conn, table_name, record, batch_ts)
                processed += 1
                if progress_callback:
                    progress_callback(processed)

                bucket = stats.setdefault(record.data_type, {"inserted": 0, "skipped": 0})
                if was_inserted:
                    inserted += 1
                    bucket["inserted"] += 1
                else:
                    skipped += 1
                    bucket["skipped"] += 1

            self._set_last_import(conn, batch_ts)
            conn.commit()

        return {"inserted": inserted, "skipped": skipped, "by_type": stats}

    def _upsert_record(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        record: NormalizedRecord,
        batch_ts: int,
    ) -> bool:
        """Insert or skip a record depending on overlap and batch recency."""

        overlapping = conn.execute(
            f"SELECT id, batch_ts FROM {table_name} WHERE start_ts < ? AND end_ts > ?",
            (record.end_ts, record.start_ts),
        ).fetchall()

        if overlapping:
            newest_existing = max(row["batch_ts"] for row in overlapping)
            if newest_existing > batch_ts:
                return False

            conn.execute(
                f"DELETE FROM {table_name} WHERE start_ts < ? AND end_ts > ?",
                (record.end_ts, record.start_ts),
            )

        payload_columns = self._ensure_payload_columns(
            conn, table_name, record.payload
        )

        base_columns = ["start_ts", "end_ts", "batch_ts", "payload"]
        insert_columns = base_columns + payload_columns
        placeholders = ", ".join("?" for _ in insert_columns)
        column_clause = ", ".join(f'"{column}"' for column in insert_columns)

        column_values = {}
        for key, value in record.payload.items():
            column = self._sanitize_column_name(str(key))
            column_values[column] = self._normalize_value(value)

        values = [
            record.start_ts,
            record.end_ts,
            batch_ts,
            json.dumps(record.payload),
            *[column_values.get(column) for column in payload_columns],
        ]

        conn.execute(
            f"INSERT INTO {table_name} ({column_clause}) VALUES ({placeholders})",
            values,
        )
        return True

    def _set_last_import(self, conn: sqlite3.Connection, batch_ts: int):
        conn.execute(
            "INSERT OR REPLACE INTO health_metadata (key, value) VALUES (?, ?)",
            ("last_import_ts", str(batch_ts)),
        )

    def get_last_import_iso(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM health_metadata WHERE key = ?", ("last_import_ts",)
            ).fetchone()

        if not row:
            return None

        ts = int(row["value"])
        return _timestamp_to_iso(ts)

    def _extract_row_date(self, row: sqlite3.Row) -> Optional[date]:
        if "date" in row.keys():
            raw_date = row["date"]
            if raw_date:
                try:
                    dt = datetime.fromisoformat(str(raw_date))
                    return dt.date()
                except ValueError:
                    try:
                        return datetime.strptime(str(raw_date)[:10], "%Y-%m-%d").date()
                    except Exception:
                        pass
        if "start_ts" in row.keys() and row["start_ts"]:
            return datetime.fromtimestamp(int(row["start_ts"]), tz=timezone.utc).date()
        return None

    def _query_rows_in_range(
        self, conn: sqlite3.Connection, table: str, start_ts: int, end_ts: int
    ) -> List[sqlite3.Row]:
        if not self._table_exists(conn, table):
            return []
        try:
            cursor = conn.execute(
                f"SELECT * FROM {table} WHERE start_ts >= ? AND start_ts < ?",
                (start_ts, end_ts),
            )
            return cursor.fetchall()
        except sqlite3.OperationalError:
            return []

    def _gather_numeric(self, row: sqlite3.Row, column: str) -> Optional[float]:
        if column not in row.keys():
            return None
        return _parse_float(row[column])

    def _extract_row_hour(self, row: sqlite3.Row) -> Optional[datetime]:
        """Extract a UTC hour bucket from a row if possible."""

        if "start_ts" in row.keys() and row["start_ts"]:
            dt = datetime.fromtimestamp(int(row["start_ts"]), tz=timezone.utc)
            return dt.replace(minute=0, second=0, microsecond=0)

        if "date" in row.keys():
            raw_date = row["date"]
            if raw_date:
                try:
                    dt = datetime.fromisoformat(str(raw_date))
                    return dt.replace(minute=0, second=0, microsecond=0)
                except ValueError:
                    pass

        return None

    def get_daily_summary(self, start: date, end: date) -> List[dict]:
        if start > end:
            start, end = end, start

        cache_key = (start.isoformat(), end.isoformat())
        if cache_key in self._summary_cache:
            return self._summary_cache[cache_key]

        buckets: Dict[str, _DailyBucket] = {
            day.isoformat(): _DailyBucket(day) for day in _date_range(start, end)
        }

        start_ts = int(
            datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )
        end_ts = int(
            datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )

        with self._connect() as conn:
            sleep_rows = self._query_rows_in_range(
                conn, "health_sleep_analysis", start_ts, end_ts
            )
            for row in sleep_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_sleep(
                    self._gather_numeric(row, "totalsleep"),
                    self._gather_numeric(row, "deep"),
                    self._gather_numeric(row, "core"),
                    self._gather_numeric(row, "rem"),
                )

            hrv_rows = self._query_rows_in_range(
                conn, "health_heart_rate_variability", start_ts, end_ts
            )
            for row in hrv_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_hrv(self._gather_numeric(row, "qty"))

            rhr_rows = self._query_rows_in_range(
                conn, "health_resting_heart_rate", start_ts, end_ts
            )
            for row in rhr_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_rhr(self._gather_numeric(row, "qty"))

            resp_rows = self._query_rows_in_range(
                conn, "health_respiratory_rate", start_ts, end_ts
            )
            for row in resp_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_resp(self._gather_numeric(row, "qty"))

            for table, attr in [
                ("health_active_energy", "active_kcal"),
                ("health_basal_energy_burned", "basal_kcal"),
                ("health_step_count", "steps"),
                ("health_apple_exercise_time", "exercise_min"),
                ("health_apple_stand_hour", "stand_hours"),
                ("health_apple_stand_time", "stand_hours"),
            ]:
                rows = self._query_rows_in_range(conn, table, start_ts, end_ts)
                for row in rows:
                    day = self._extract_row_date(row)
                    if not day:
                        continue
                    key = day.isoformat()
                    if key not in buckets:
                        continue
                    buckets[key].add_sum(attr, self._gather_numeric(row, "qty"))

        summary = [bucket.as_dict() for _, bucket in sorted(buckets.items())]
        self._summary_cache[cache_key] = summary
        return summary

    def get_hourly_summary(self, day: date) -> List[dict]:
        """Return intraday aggregates grouped by hour for a given day."""

        start_dt = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        buckets: Dict[datetime, _HourlyBucket] = {
            start_dt + timedelta(hours=offset): _HourlyBucket(start_dt + timedelta(hours=offset))
            for offset in range(24)
        }

        start_ts = int(start_dt.timestamp())
        end_ts = int((start_dt + timedelta(days=1)).timestamp())

        with self._connect() as conn:
            sleep_rows = self._query_rows_in_range(
                conn, "health_sleep_analysis", start_ts, end_ts
            )
            for row in sleep_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_sleep(
                    self._gather_numeric(row, "totalsleep"),
                    self._gather_numeric(row, "deep"),
                    self._gather_numeric(row, "core"),
                    self._gather_numeric(row, "rem"),
                )

            hrv_rows = self._query_rows_in_range(
                conn, "health_heart_rate_variability", start_ts, end_ts
            )
            for row in hrv_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_hrv(self._gather_numeric(row, "qty"))

            rhr_rows = self._query_rows_in_range(
                conn, "health_resting_heart_rate", start_ts, end_ts
            )
            for row in rhr_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_rhr(self._gather_numeric(row, "qty"))

            resp_rows = self._query_rows_in_range(
                conn, "health_respiratory_rate", start_ts, end_ts
            )
            for row in resp_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_resp(self._gather_numeric(row, "qty"))

            for table, attr in [
                ("health_active_energy", "active_kcal"),
                ("health_basal_energy_burned", "basal_kcal"),
                ("health_step_count", "steps"),
                ("health_apple_exercise_time", "exercise_min"),
                ("health_apple_stand_hour", "stand_hours"),
                ("health_apple_stand_time", "stand_hours"),
            ]:
                rows = self._query_rows_in_range(conn, table, start_ts, end_ts)
                for row in rows:
                    hour = self._extract_row_hour(row)
                    if not hour or hour.date() != day:
                        continue
                    bucket = buckets.get(hour)
                    if not bucket:
                        continue
                    bucket.add_sum(attr, self._gather_numeric(row, "qty"))

        return [bucket.as_dict() for _, bucket in sorted(buckets.items())]


def _timestamp_to_iso(ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _parse_float(value) -> Optional[float]:
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        sanitized = stripped.replace(",", ".")
        try:
            return float(sanitized)
        except ValueError:
            return None

    return None


def _median(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return float(median(values))


class _DailyBucket:
    def __init__(self, day: date):
        self.day = day
        self.sleep_total = 0.0
        self.sleep_deep = 0.0
        self.sleep_core = 0.0
        self.sleep_rem = 0.0
        self._sleep_seen = False

        self.active_kcal = 0.0
        self.basal_kcal = 0.0
        self.steps = 0.0
        self.exercise_min = 0.0
        self.stand_hours = 0.0
        self._stand_seen = False

        self.hrv_values: List[float] = []
        self.rhr_values: List[float] = []
        self.resp_values: List[float] = []

    def add_sleep(self, total: Optional[float], deep: Optional[float], core: Optional[float], rem: Optional[float]):
        if total is not None:
            self.sleep_total += total
            self._sleep_seen = True
        if deep is not None:
            self.sleep_deep += deep
            self._sleep_seen = True
        if core is not None:
            self.sleep_core += core
            self._sleep_seen = True
        if rem is not None:
            self.sleep_rem += rem
            self._sleep_seen = True

    def add_hrv(self, value: Optional[float]):
        if value is not None:
            self.hrv_values.append(value)

    def add_rhr(self, value: Optional[float]):
        if value is not None:
            self.rhr_values.append(value)

    def add_resp(self, value: Optional[float]):
        if value is not None:
            self.resp_values.append(value)

    def add_sum(self, attr: str, value: Optional[float]):
        if value is None:
            return
        if attr == "active_kcal":
            self.active_kcal += value
        elif attr == "basal_kcal":
            self.basal_kcal += value
        elif attr == "steps":
            self.steps += value
        elif attr == "exercise_min":
            self.exercise_min += value
        elif attr == "stand_hours":
            self.stand_hours += value
            self._stand_seen = True

    def as_dict(self) -> dict:
        return {
            "date": self.day.isoformat(),
            "sleep_total": self.sleep_total if self._sleep_seen else None,
            "sleep_deep": self.sleep_deep if self._sleep_seen else None,
            "sleep_core": self.sleep_core if self._sleep_seen else None,
            "sleep_rem": self.sleep_rem if self._sleep_seen else None,
            "hrv": _median(self.hrv_values),
            "rhr": _median(self.rhr_values),
            "resp": _median(self.resp_values),
            "active_kcal": self.active_kcal if self.active_kcal else None,
            "basal_kcal": self.basal_kcal if self.basal_kcal else None,
            "steps": self.steps if self.steps else None,
            "exercise_min": self.exercise_min if self.exercise_min else None,
            "stand_hours": self.stand_hours if self._stand_seen else None,
        }


class _HourlyBucket:
    def __init__(self, hour: datetime):
        self.hour = hour
        self.sleep_total = 0.0
        self.sleep_deep = 0.0
        self.sleep_core = 0.0
        self.sleep_rem = 0.0
        self._sleep_seen = False

        self.active_kcal = 0.0
        self.basal_kcal = 0.0
        self.steps = 0.0
        self.exercise_min = 0.0
        self.stand_hours = 0.0
        self._stand_seen = False

        self.hrv_values: List[float] = []
        self.rhr_values: List[float] = []
        self.resp_values: List[float] = []

    def add_sleep(
        self, total: Optional[float], deep: Optional[float], core: Optional[float], rem: Optional[float]
    ):
        if total is not None:
            self.sleep_total += total
            self._sleep_seen = True
        if deep is not None:
            self.sleep_deep += deep
            self._sleep_seen = True
        if core is not None:
            self.sleep_core += core
            self._sleep_seen = True
        if rem is not None:
            self.sleep_rem += rem
            self._sleep_seen = True

    def add_hrv(self, value: Optional[float]):
        if value is not None:
            self.hrv_values.append(value)

    def add_rhr(self, value: Optional[float]):
        if value is not None:
            self.rhr_values.append(value)

    def add_resp(self, value: Optional[float]):
        if value is not None:
            self.resp_values.append(value)

    def add_sum(self, attr: str, value: Optional[float]):
        if value is None:
            return
        if attr == "active_kcal":
            self.active_kcal += value
        elif attr == "basal_kcal":
            self.basal_kcal += value
        elif attr == "steps":
            self.steps += value
        elif attr == "exercise_min":
            self.exercise_min += value
        elif attr == "stand_hours":
            self.stand_hours += value
            self._stand_seen = True

    def as_dict(self) -> dict:
        return {
            "date": self.hour.strftime("%H:%M"),
            "sleep_total": self.sleep_total if self._sleep_seen else None,
            "sleep_deep": self.sleep_deep if self._sleep_seen else None,
            "sleep_core": self.sleep_core if self._sleep_seen else None,
            "sleep_rem": self.sleep_rem if self._sleep_seen else None,
            "hrv": _median(self.hrv_values),
            "rhr": _median(self.rhr_values),
            "resp": _median(self.resp_values),
            "active_kcal": self.active_kcal if self.active_kcal else None,
            "basal_kcal": self.basal_kcal if self.basal_kcal else None,
            "steps": self.steps if self.steps else None,
            "exercise_min": self.exercise_min if self.exercise_min else None,
            "stand_hours": self.stand_hours if self._stand_seen else None,
        }


def _date_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)
