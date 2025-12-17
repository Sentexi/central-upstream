from __future__ import annotations

import math
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from statistics import median
from typing import Dict, Iterable, List, Optional, Tuple

Numeric = Optional[float]


def _start_of_week(day: date) -> date:
    return day - timedelta(days=day.weekday())


def _week_label(day: date) -> str:
    iso_year, iso_week, _ = day.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _percentile(values: List[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    k = (len(ordered) - 1) * fraction
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return ordered[int(k)]
    return ordered[f] * (c - k) + ordered[c] * (k - f)


def _safe_median(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return float(median(values))


@dataclass
class DailyFitnessRow:
    date: str
    exercise_min: float
    active_kcal: float
    steps: float
    distance_km: float
    floors: float
    walking_speed: Optional[float]
    step_length: Optional[float]
    walking_hr_avg: Optional[float]
    stair_up: Optional[float]
    stair_down: Optional[float]

    @property
    def efficiency_index(self) -> Optional[float]:
        if self.walking_speed and self.walking_speed > 0 and self.walking_hr_avg:
            return self.walking_hr_avg / self.walking_speed
        return None


@dataclass
class WeeklyFitnessRow:
    week_start: str
    week_end: str
    iso_year: int
    iso_week: int
    exercise_min_week: float
    steps_week: float
    distance_km_week: float
    active_kcal_week: float
    floors_week: float
    walking_speed_avg: Optional[float]
    step_length_avg: Optional[float]
    efficiency_index_median: Optional[float]
    stair_up_avg: Optional[float]
    stair_down_avg: Optional[float]


class FitnessAnalytics:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._column_cache: Dict[str, List[str]] = {}

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _table_columns(self, conn: sqlite3.Connection, table: str) -> List[str]:
        if table in self._column_cache:
            return self._column_cache[table]
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        columns = [row[1] for row in rows]
        self._column_cache[table] = columns
        return columns

    def _has_column(self, conn: sqlite3.Connection, table: str, column: str) -> bool:
        return column in self._table_columns(conn, table)

    def _ensure_indexes(self, conn: sqlite3.Connection, tables: Iterable[str]):
        for table in tables:
            if self._has_column(conn, table, "start_ts"):
                conn.execute(
                    f"CREATE INDEX IF NOT EXISTS idx_{table}_start_ts ON {table}(start_ts)"
                )
            if self._has_column(conn, table, "end_ts"):
                conn.execute(
                    f"CREATE INDEX IF NOT EXISTS idx_{table}_end_ts ON {table}(end_ts)"
                )
            if self._has_column(conn, table, "date"):
                conn.execute(
                    f"CREATE INDEX IF NOT EXISTS idx_{table}_date ON {table}(date)"
                )

    def _resolve_value_column(self, columns: List[str]) -> Optional[str]:
        for candidate in ("qty", "quantity", "value", "val"):
            if candidate in columns:
                return candidate
        return None

    def _extract_numeric(self, row: sqlite3.Row, key: str) -> Optional[float]:
        try:
            value = row[key]
        except (KeyError, IndexError):
            return None
        try:
            if value is None:
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    def _date_expression(self, columns: List[str]) -> str:
        if "date" in columns:
            return "date(date)"
        if "start_ts" in columns:
            return "date(start_ts, 'unixepoch')"
        if "end_ts" in columns:
            return "date(end_ts, 'unixepoch')"
        return "NULL"

    def _load_daily_entries(
        self,
        conn: sqlite3.Connection,
        table: str,
        start_dt: date,
        end_dt: date,
        *,
        unit_filter: Optional[Iterable[str]] = None,
        source_filter: Optional[Iterable[str]] = None,
    ) -> List[Tuple[str, Optional[float], Optional[str]]]:
        columns = self._table_columns(conn, table)
        value_column = self._resolve_value_column(columns)
        if not value_column:
            return []

        unit_column = None
        for candidate in ("unit", "units"):
            if candidate in columns:
                unit_column = candidate
                break

        date_expr = self._date_expression(columns)
        if date_expr == "NULL":
            return []

        where_clauses = []
        params: List[object] = []
        start_ts = int(datetime.combine(start_dt, time.min).timestamp())
        end_ts = int(datetime.combine(end_dt, time.max).timestamp())

        if "date" in columns:
            where_clauses.append("date >= ? AND date <= ?")
            params.extend([start_dt.isoformat(), end_dt.isoformat()])
        elif "start_ts" in columns:
            where_clauses.append("start_ts BETWEEN ? AND ?")
            params.extend([start_ts, end_ts])

        if unit_filter and unit_column:
            where_clauses.append(
                f"lower({unit_column}) IN ({', '.join('?' for _ in unit_filter)})"
            )
            params.extend([u.lower() for u in unit_filter])

        if source_filter and "source" in columns:
            where_clauses.append(
                f"lower(source) IN ({', '.join('?' for _ in source_filter)})"
            )
            params.extend([s.lower() for s in source_filter])

        where_sql = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
        select_columns = [f"{date_expr} as day", f"{value_column} as value"]
        if unit_column:
            select_columns.append(unit_column)
        query = f"SELECT {', '.join(select_columns)} FROM {table}{where_sql}"

        rows = conn.execute(query, params).fetchall()
        result: List[Tuple[str, Optional[float], Optional[str]]] = []
        for row in rows:
            day = row["day"]
            numeric = self._extract_numeric(row, value_column)
            unit = row[unit_column] if unit_column else None
            result.append((day, numeric, unit))
        return result

    def _convert_value(
        self,
        raw: Optional[float],
        *,
        unit: Optional[str] = None,
        field: str,
    ) -> Optional[float]:
        if raw is None:
            return None

        if field == "distance_km" and unit:
            lowered = unit.lower()
            if lowered in {"m", "meter", "meters"}:
                return raw / 1000
            if lowered in {"mi", "mile", "miles"}:
                return raw * 1.60934
        if field == "walking_speed" and unit:
            lowered = unit.lower()
            if lowered in {"m/s", "meter/second", "meters/second"}:
                return raw * 3.6
        if field == "step_length" and unit:
            lowered = unit.lower()
            if lowered in {"m", "meter", "meters"}:
                return raw * 100  # convert meters to centimeters
        return raw

    def _aggregate_daily(
        self,
        table: str,
        start_dt: date,
        end_dt: date,
        *,
        aggregate: str,
        unit_filter: Optional[Iterable[str]] = None,
        source_filter: Optional[Iterable[str]] = None,
        field: str,
    ) -> Dict[str, float]:
        with self._connect() as conn:
            self._ensure_indexes(conn, [table])
            entries = self._load_daily_entries(
                conn,
                table,
                start_dt,
                end_dt,
                unit_filter=unit_filter,
                source_filter=source_filter,
            )

        buckets: Dict[str, List[float]] = {}
        for day, value, unit in entries:
            normalized = self._convert_value(value, unit=unit, field=field)
            if normalized is None or math.isnan(normalized):
                continue
            buckets.setdefault(day, []).append(normalized)

        aggregated: Dict[str, float] = {}
        for day, values in buckets.items():
            if aggregate == "sum":
                aggregated[day] = float(sum(values))
            elif aggregate == "median":
                median_value = _safe_median(values)
                if median_value is not None:
                    aggregated[day] = median_value
        return aggregated

    def aggregate_daily_range(self, start_dt: date, end_dt: date) -> List[DailyFitnessRow]:
        sum_metrics = {
            "exercise_min": ("health_apple_exercise_time", ["min", "mins"]),
            "active_kcal": ("health_active_energy", ["kcal", "cal", "kj"]),
            "steps": ("health_step_count", None),
            "distance_km": ("health_walking_running_distance", ["km", "mi", "m", "meter", "meters"]),
            "floors": ("health_flights_climbed", None),
        }
        median_metrics = {
            "walking_speed": ("health_walking_speed", ["km/h", "m/s"]),
            "step_length": ("health_walking_step_length", ["cm", "m", "meter", "meters"]),
            "walking_hr_avg": ("health_walking_heart_rate_average", None),
            "stair_up": ("health_stair_speed_up", None),
            "stair_down": ("health_stair_speed_down", None),
        }

        sum_data: Dict[str, Dict[str, float]] = {}
        for key, (table, units) in sum_metrics.items():
            sum_data[key] = self._aggregate_daily(
                table,
                start_dt,
                end_dt,
                aggregate="sum",
                unit_filter=units,
                field=key,
            )

        median_data: Dict[str, Dict[str, float]] = {}
        for key, (table, units) in median_metrics.items():
            median_data[key] = self._aggregate_daily(
                table,
                start_dt,
                end_dt,
                aggregate="median",
                unit_filter=units,
                field=key,
            )

        days = [start_dt + timedelta(days=i) for i in range((end_dt - start_dt).days + 1)]
        daily_rows: List[DailyFitnessRow] = []
        for day in days:
            day_key = day.isoformat()
            daily_rows.append(
                DailyFitnessRow(
                    date=day_key,
                    exercise_min=sum_data["exercise_min"].get(day_key, 0.0),
                    active_kcal=sum_data["active_kcal"].get(day_key, 0.0),
                    steps=sum_data["steps"].get(day_key, 0.0),
                    distance_km=sum_data["distance_km"].get(day_key, 0.0),
                    floors=sum_data["floors"].get(day_key, 0.0),
                    walking_speed=median_data["walking_speed"].get(day_key),
                    step_length=median_data["step_length"].get(day_key),
                    walking_hr_avg=median_data["walking_hr_avg"].get(day_key),
                    stair_up=median_data["stair_up"].get(day_key),
                    stair_down=median_data["stair_down"].get(day_key),
                )
            )

        return daily_rows

    def aggregate_weekly(self, daily_rows: List[DailyFitnessRow]) -> List[WeeklyFitnessRow]:
        buckets: Dict[str, Dict[str, object]] = {}
        for row in daily_rows:
            day = date.fromisoformat(row.date)
            start = _start_of_week(day)
            key = start.isoformat()
            iso_year, iso_week, _ = day.isocalendar()
            bucket = buckets.setdefault(
                key,
                {
                    "week_end": (start + timedelta(days=6)).isoformat(),
                    "iso_year": iso_year,
                    "iso_week": iso_week,
                    "exercise_min": 0.0,
                    "steps": 0.0,
                    "distance_km": 0.0,
                    "active_kcal": 0.0,
                    "floors": 0.0,
                    "walking_speed_values": [],
                    "step_length_values": [],
                    "efficiency_values": [],
                    "stair_up_values": [],
                    "stair_down_values": [],
                },
            )
            bucket["exercise_min"] = float(bucket["exercise_min"]) + row.exercise_min
            bucket["steps"] = float(bucket["steps"]) + row.steps
            bucket["distance_km"] = float(bucket["distance_km"]) + row.distance_km
            bucket["active_kcal"] = float(bucket["active_kcal"]) + row.active_kcal
            bucket["floors"] = float(bucket["floors"]) + row.floors

            if row.walking_speed is not None:
                bucket["walking_speed_values"].append(row.walking_speed)
            if row.step_length is not None:
                bucket["step_length_values"].append(row.step_length)
            if row.efficiency_index is not None:
                bucket["efficiency_values"].append(row.efficiency_index)
            if row.stair_up is not None:
                bucket["stair_up_values"].append(row.stair_up)
            if row.stair_down is not None:
                bucket["stair_down_values"].append(row.stair_down)

        weekly_rows: List[WeeklyFitnessRow] = []
        for key, bucket in buckets.items():
            start = date.fromisoformat(key)
            weekly_rows.append(
                WeeklyFitnessRow(
                    week_start=start.isoformat(),
                    week_end=bucket["week_end"],
                    iso_year=bucket["iso_year"],
                    iso_week=bucket["iso_week"],
                    exercise_min_week=float(bucket["exercise_min"]),
                    steps_week=float(bucket["steps"]),
                    distance_km_week=float(bucket["distance_km"]),
                    active_kcal_week=float(bucket["active_kcal"]),
                    floors_week=float(bucket["floors"]),
                    walking_speed_avg=_safe_median(bucket["walking_speed_values"]),
                    step_length_avg=_safe_median(bucket["step_length_values"]),
                    efficiency_index_median=_safe_median(bucket["efficiency_values"]),
                    stair_up_avg=_safe_median(bucket["stair_up_values"]),
                    stair_down_avg=_safe_median(bucket["stair_down_values"]),
                )
            )

        weekly_rows.sort(key=lambda r: r.week_start)
        self._persist_weekly_cache(weekly_rows)
        return weekly_rows

    def _persist_weekly_cache(self, weekly_rows: List[WeeklyFitnessRow]):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS health_weekly_summary (
                    week_start TEXT PRIMARY KEY,
                    week_end TEXT NOT NULL,
                    iso_year INTEGER NOT NULL,
                    iso_week INTEGER NOT NULL,
                    exercise_min_week REAL NOT NULL,
                    steps_week REAL NOT NULL,
                    distance_km_week REAL NOT NULL,
                    active_kcal_week REAL NOT NULL,
                    floors_week REAL NOT NULL,
                    walking_speed_avg REAL,
                    step_length_avg REAL,
                    efficiency_index_median REAL,
                    stair_up_avg REAL,
                    stair_down_avg REAL
                )
                """
            )
            conn.execute("DELETE FROM health_weekly_summary")
            conn.executemany(
                """
                INSERT INTO health_weekly_summary (
                    week_start, week_end, iso_year, iso_week,
                    exercise_min_week, steps_week, distance_km_week, active_kcal_week, floors_week,
                    walking_speed_avg, step_length_avg, efficiency_index_median, stair_up_avg, stair_down_avg
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        row.week_start,
                        row.week_end,
                        row.iso_year,
                        row.iso_week,
                        row.exercise_min_week,
                        row.steps_week,
                        row.distance_km_week,
                        row.active_kcal_week,
                        row.floors_week,
                        row.walking_speed_avg,
                        row.step_length_avg,
                        row.efficiency_index_median,
                        row.stair_up_avg,
                        row.stair_down_avg,
                    )
                    for row in weekly_rows
                ],
            )
            conn.commit()

    def _consistency_stats(
        self, daily_rows: List[DailyFitnessRow]
    ) -> Tuple[int, int, int]:
        def meets(row: DailyFitnessRow) -> bool:
            return row.exercise_min >= 20 or row.steps >= 8000

        sorted_rows = sorted(daily_rows, key=lambda r: r.date)
        active_days = sum(1 for row in sorted_rows if meets(row))

        longest = 0
        current = 0
        for row in sorted_rows:
            if meets(row):
                current += 1
                longest = max(longest, current)
            else:
                current = 0

        current_streak = 0
        for row in reversed(sorted_rows):
            if meets(row):
                current_streak += 1
            else:
                break

        return active_days, current_streak, longest

    def _efficiency_trend(self, rows: List[DailyFitnessRow]) -> Tuple[str, Optional[float]]:
        series = [row.efficiency_index for row in rows if row.efficiency_index]
        if len(series) < 3:
            return "stable", None

        midpoint = len(series) // 2
        first_half = series[:midpoint]
        second_half = series[midpoint:]
        first_median = _safe_median(first_half) or 0
        second_median = _safe_median(second_half) or 0
        if first_median == 0:
            return "stable", None

        change = (second_median - first_median) / first_median
        if change <= -0.03:
            return "improving", change
        if change >= 0.03:
            return "declining", change
        return "stable", change

    def _mobility_trend(self, rows: List[DailyFitnessRow]) -> Tuple[str, Optional[float]]:
        speed_series = [row.walking_speed for row in rows if row.walking_speed]
        if len(speed_series) < 3:
            return "stable", None
        midpoint = len(speed_series) // 2
        first = _safe_median(speed_series[:midpoint]) or 0
        second = _safe_median(speed_series[midpoint:]) or 0
        if first == 0:
            return "stable", None
        change = (second - first) / first
        if change >= 0.03:
            return "improving", change
        if change <= -0.03:
            return "declining", change
        return "stable", change

    def _traffic_light_by_percentile(
        self, current_value: float, history: List[float]
    ) -> str:
        history = [v for v in history if not math.isnan(v)]
        if len(history) < 3:
            return "yellow"
        upper = _percentile(history, 0.66)
        lower = _percentile(history, 0.33)
        if current_value >= upper:
            return "green"
        if current_value <= lower:
            return "red"
        return "yellow"

    def build_payload(self, range_key: str, group: str) -> Dict[str, object]:
        range_days = {"today": 1, "7d": 7, "14d": 14, "30d": 30}.get(range_key, 7)
        end_dt = date.today()
        start_dt = end_dt - timedelta(days=range_days - 1)
        history_start = end_dt - timedelta(days=120)

        all_daily = self.aggregate_daily_range(history_start, end_dt)
        daily_range = [row for row in all_daily if row.date >= start_dt.isoformat()]
        weekly_all = self.aggregate_weekly(all_daily)
        weekly_range = [
            row
            for row in weekly_all
            if row.week_start <= end_dt.isoformat()
            and row.week_end >= start_dt.isoformat()
        ]

        current_week_start = _start_of_week(end_dt).isoformat()
        current_week = next(
            (row for row in weekly_all if row.week_start == current_week_start), None
        )
        history_weeks = weekly_all[-12:]
        volume_color = (
            self._traffic_light_by_percentile(
                current_week.exercise_min_week if current_week else 0.0,
                [row.exercise_min_week for row in history_weeks],
            )
            if current_week
            else "yellow"
        )

        active_days, current_streak, longest_streak = self._consistency_stats(daily_range)
        range_len = max(len(daily_range), 1)
        ratio = active_days / range_len
        if ratio >= 0.7:
            consistency_color = "green"
        elif ratio >= 0.5:
            consistency_color = "yellow"
        else:
            consistency_color = "red"

        total_steps = sum(row.steps for row in daily_range)
        total_distance = sum(row.distance_km for row in daily_range)
        baseline_distance = _safe_median([row.distance_km_week for row in history_weeks])
        distance_color = self._traffic_light_by_percentile(
            total_distance, [row.distance_km_week for row in history_weeks]
        ) if baseline_distance is not None else "yellow"

        efficiency_direction, efficiency_change = self._efficiency_trend(daily_range)
        if efficiency_direction == "improving":
            efficiency_color = "green"
        elif efficiency_direction == "declining":
            efficiency_color = "red"
        else:
            efficiency_color = "yellow"

        mobility_direction, _ = self._mobility_trend(daily_range)
        mobility_color = {
            "improving": "green",
            "declining": "red",
        }.get(mobility_direction, "yellow")

        notes: List[str] = []
        if current_week and history_weeks:
            reference = _safe_median([row.exercise_min_week for row in history_weeks])
            if reference:
                diff = (current_week.exercise_min_week - reference) / reference
                notes.append(
                    f"Exercise-Minuten {diff:+.0%} vs. 12-Wochen-Median"
                )
        if current_streak:
            notes.append(f"Aktuelle Streak: {current_streak} Tage")
        if efficiency_change is not None:
            notes.append(
                "Walking HR/Speed zeigt Verbesserung" if efficiency_direction == "improving" else "Walking HR/Speed stabil"
                if efficiency_direction == "stable" else "Walking HR/Speed leicht schwächer"
            )
        if not notes:
            notes.append("Keine ausreichenden Fitnessdaten im Zeitraum")

        payload_daily: List[Dict[str, object]] = []
        for row in daily_range:
            row_dict = row.__dict__.copy()
            row_dict["efficiency_index"] = row.efficiency_index
            payload_daily.append(row_dict)

        payload: Dict[str, object] = {
            "range": range_key,
            "group": group,
            "start_date": start_dt.isoformat(),
            "end_date": end_dt.isoformat(),
            "daily": payload_daily,
            "weekly": [row.__dict__ for row in weekly_range],
            "summaries": {
                "volume": {
                    "color": volume_color,
                    "current_week": current_week.__dict__ if current_week else None,
                },
                "consistency": {
                    "color": consistency_color,
                    "active_days": active_days,
                    "range_days": range_len,
                    "current_streak": current_streak,
                    "longest_streak": longest_streak,
                },
                "distance": {
                    "color": distance_color,
                    "steps": total_steps,
                    "distance_km": total_distance,
                },
                "efficiency": {
                    "color": efficiency_color,
                    "direction": efficiency_direction,
                    "change": efficiency_change,
                },
                "mobility": {
                    "color": mobility_color,
                    "direction": mobility_direction,
                },
            },
            "notes": notes[:5],
        }

        return payload
