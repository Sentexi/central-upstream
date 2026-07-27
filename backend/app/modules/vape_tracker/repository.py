from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date, datetime, timedelta, tzinfo
from typing import Any, Iterable


EVENT_READING = "reading"
EVENT_COIL_CHANGE = "coil_change"
EVENT_BASELINE = "baseline"


class CounterRegressionError(ValueError):
    """Raised when a counter decreases without an explicit coil change."""


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vape_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            counter INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            event_type TEXT NOT NULL DEFAULT 'reading',
            usage_date TEXT
        )
        """
    )

    columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(vape_entries)").fetchall()
    }
    if "event_type" not in columns:
        conn.execute(
            "ALTER TABLE vape_entries "
            "ADD COLUMN event_type TEXT NOT NULL DEFAULT 'reading'"
        )
    if "usage_date" not in columns:
        conn.execute("ALTER TABLE vape_entries ADD COLUMN usage_date TEXT")

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vape_entries_timestamp "
        "ON vape_entries(timestamp)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vape_entries_usage_date "
        "ON vape_entries(usage_date)"
    )
    conn.commit()


def serialize_entry(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "date": row["date"],
        "timestamp": row["timestamp"],
        "counter": row["counter"],
        "delta": row["delta"],
        "note": row["note"],
        "event_type": row["event_type"] or EVENT_READING,
        "usage_date": row["usage_date"],
        "created_at": row["created_at"],
    }


def _parse_stored_timestamp(value: str) -> datetime:
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    return datetime.fromisoformat(normalized)


def _last_entry(conn: sqlite3.Connection) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT *
        FROM vape_entries
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
        """
    ).fetchone()


def _usage_date(recorded_at: datetime, previous: sqlite3.Row | None) -> str:
    current_date = recorded_at.date()
    if previous is None:
        return current_date.isoformat()

    previous_timestamp = _parse_stored_timestamp(previous["timestamp"])
    if previous_timestamp.tzinfo is not None and recorded_at.tzinfo is not None:
        previous_timestamp = previous_timestamp.astimezone(recorded_at.tzinfo)
    previous_date = previous_timestamp.date()
    if previous_date != current_date:
        return (current_date - timedelta(days=1)).isoformat()
    return current_date.isoformat()


def _validate_counter_progress(
    counter: int, previous: sqlite3.Row | None
) -> int:
    if previous is None:
        return counter

    previous_counter = int(previous["counter"])
    if counter < previous_counter:
        raise CounterRegressionError(
            "Der Counter ist kleiner als der letzte Stand. "
            "Nutze fuer einen Reset den Button Coil gewechselt."
        )
    return counter - previous_counter


def _insert_entry(
    conn: sqlite3.Connection,
    *,
    recorded_at: datetime,
    counter: int,
    delta: int,
    event_type: str,
    usage_date: str | None,
    created_at: str,
    note: str | None = None,
) -> sqlite3.Row:
    cursor = conn.execute(
        """
        INSERT INTO vape_entries (
            date,
            timestamp,
            counter,
            delta,
            note,
            created_at,
            event_type,
            usage_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            recorded_at.date().isoformat(),
            recorded_at.isoformat(),
            counter,
            delta,
            note,
            created_at,
            event_type,
            usage_date,
        ),
    )
    return conn.execute(
        "SELECT * FROM vape_entries WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()


def add_reading(
    conn: sqlite3.Connection,
    *,
    counter: int,
    recorded_at: datetime,
    created_at: str,
    note: str | None = None,
) -> dict[str, Any]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        previous = _last_entry(conn)
        delta = _validate_counter_progress(counter, previous)
        row = _insert_entry(
            conn,
            recorded_at=recorded_at,
            counter=counter,
            delta=delta,
            event_type=EVENT_READING,
            usage_date=_usage_date(recorded_at, previous),
            created_at=created_at,
            note=note,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return serialize_entry(row)


def add_coil_change(
    conn: sqlite3.Connection,
    *,
    final_counter: int,
    recorded_at: datetime,
    created_at: str,
    final_note: str = "final_before_coil_change",
    reset_note: str = "coil_change",
) -> tuple[dict[str, Any], dict[str, Any]]:
    conn.execute("BEGIN IMMEDIATE")
    try:
        previous = _last_entry(conn)
        delta = _validate_counter_progress(final_counter, previous)
        final_reading = _insert_entry(
            conn,
            recorded_at=recorded_at,
            counter=final_counter,
            delta=delta,
            event_type=EVENT_READING,
            usage_date=_usage_date(recorded_at, previous),
            created_at=created_at,
            note=final_note,
        )
        reset = _insert_entry(
            conn,
            recorded_at=recorded_at,
            counter=0,
            delta=0,
            event_type=EVENT_COIL_CHANGE,
            usage_date=recorded_at.date().isoformat(),
            created_at=created_at,
            note=reset_note,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return serialize_entry(final_reading), serialize_entry(reset)


def add_baseline(
    conn: sqlite3.Connection,
    *,
    counter: int,
    recorded_at: datetime,
    created_at: str,
    note: str = "legacy_baseline",
) -> dict[str, Any]:
    """Anchor a known counter without counting it as usage.

    Baselines are reserved for legacy imports with an unknown predecessor.
    They update counter continuity for following readings but never contribute
    puffs, active days, coil changes, latest state, or the visible event log.
    """

    conn.execute("BEGIN IMMEDIATE")
    try:
        row = _insert_entry(
            conn,
            recorded_at=recorded_at,
            counter=counter,
            delta=0,
            event_type=EVENT_BASELINE,
            usage_date=recorded_at.date().isoformat(),
            created_at=created_at,
            note=note,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return serialize_entry(row)


def latest_entry(conn: sqlite3.Connection) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT *
        FROM vape_entries
        WHERE event_type != ?
        ORDER BY timestamp DESC, id DESC
        LIMIT 1
        """,
        (EVENT_BASELINE,),
    ).fetchone()
    return serialize_entry(row) if row else None


def recent_entries(
    conn: sqlite3.Connection, *, limit: int = 12
) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT *
        FROM vape_entries
        WHERE event_type != ?
        ORDER BY timestamp DESC, id DESC
        LIMIT ?
        """,
        (EVENT_BASELINE, limit),
    ).fetchall()
    return [serialize_entry(row) for row in rows]


def _derive_timeline(
    rows: Iterable[sqlite3.Row],
    local_timezone: tzinfo,
) -> tuple[dict[str, int], dict[str, int], set[str]]:
    daily_puffs: dict[str, int] = defaultdict(int)
    coil_changes: dict[str, int] = defaultdict(int)
    observed_dates: set[str] = set()
    previous_counter: int | None = None
    previous_timestamp: datetime | None = None

    for row in rows:
        timestamp = _parse_stored_timestamp(row["timestamp"])
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=local_timezone)
        else:
            timestamp = timestamp.astimezone(local_timezone)
        event_type = row["event_type"] or EVENT_READING
        counter = int(row["counter"])

        if event_type == EVENT_BASELINE:
            previous_counter = counter
            previous_timestamp = timestamp
            continue

        if event_type == EVENT_COIL_CHANGE:
            coil_changes[timestamp.date().isoformat()] += 1
            previous_counter = 0
            previous_timestamp = timestamp
            continue

        if previous_counter is None:
            delta = max(0, int(row["delta"]))
        elif counter >= previous_counter:
            delta = counter - previous_counter
        else:
            # Compatibility with legacy rows where a lower counter implicitly
            # represented a coil change and the new counter already contained
            # the first puffs of the new coil.
            delta = counter
            coil_changes[timestamp.date().isoformat()] += 1

        if previous_timestamp is not None and previous_timestamp.date() != timestamp.date():
            usage_day = timestamp.date() - timedelta(days=1)
        else:
            usage_day = timestamp.date()

        usage_key = usage_day.isoformat()
        daily_puffs[usage_key] += delta
        observed_dates.add(usage_key)

        if row["note"] == "coil_change" and previous_counter is None:
            coil_changes[timestamp.date().isoformat()] += 1

        previous_counter = counter
        previous_timestamp = timestamp

    return dict(daily_puffs), dict(coil_changes), observed_dates


def _date_range(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _bucket_start(day: date, granularity: str) -> date:
    if granularity == "week":
        return day - timedelta(days=day.weekday())
    if granularity == "month":
        return day.replace(day=1)
    return day


def _bucket_end(start: date, granularity: str) -> date:
    if granularity == "week":
        return start + timedelta(days=6)
    if granularity == "month":
        next_month = (
            start.replace(year=start.year + 1, month=1)
            if start.month == 12
            else start.replace(month=start.month + 1)
        )
        return next_month - timedelta(days=1)
    return start


def build_overview(
    conn: sqlite3.Connection,
    *,
    date_from: date,
    date_to: date,
    granularity: str,
    local_timezone: tzinfo,
) -> dict[str, Any]:
    rows = conn.execute(
        """
        SELECT *
        FROM vape_entries
        ORDER BY timestamp ASC, id ASC
        """
    ).fetchall()
    daily_puffs, coil_changes, observed_dates = _derive_timeline(
        rows, local_timezone
    )

    buckets: dict[str, dict[str, Any]] = {}
    for day in _date_range(date_from, date_to):
        bucket_start = _bucket_start(day, granularity)
        key = bucket_start.isoformat()
        bucket = buckets.setdefault(
            key,
            {
                "period_start": key,
                "period_end": min(
                    _bucket_end(bucket_start, granularity), date_to
                ).isoformat(),
                "total_puffs": 0,
                "days": 0,
                "observed_days": 0,
                "coil_changes": 0,
            },
        )
        day_key = day.isoformat()
        bucket["total_puffs"] += daily_puffs.get(day_key, 0)
        bucket["days"] += 1
        if day_key in observed_dates:
            bucket["observed_days"] += 1
        bucket["coil_changes"] += coil_changes.get(day_key, 0)

    bucket_list = []
    for bucket in buckets.values():
        bucket["average_per_day"] = (
            bucket["total_puffs"] / bucket["observed_days"]
            if bucket["observed_days"]
            else 0
        )
        bucket_list.append(bucket)

    period_days = (date_to - date_from).days + 1
    total_puffs = sum(
        daily_puffs.get(day.isoformat(), 0)
        for day in _date_range(date_from, date_to)
    )
    period_coil_changes = sum(
        coil_changes.get(day.isoformat(), 0)
        for day in _date_range(date_from, date_to)
    )

    previous_to = date_from - timedelta(days=1)
    previous_from = previous_to - timedelta(days=period_days - 1)
    previous_total = sum(
        daily_puffs.get(day.isoformat(), 0)
        for day in _date_range(previous_from, previous_to)
    )
    previous_observed_days = sum(
        1
        for day in _date_range(previous_from, previous_to)
        if day.isoformat() in observed_dates
    )
    days_with_data = sum(
        1
        for day in _date_range(date_from, date_to)
        if day.isoformat() in observed_dates
    )
    previous_has_data = previous_observed_days > 0
    average_per_day = total_puffs / days_with_data if days_with_data else 0
    previous_average = (
        previous_total / previous_observed_days
        if previous_has_data
        else None
    )
    change_percent = (
        ((average_per_day - previous_average) / previous_average) * 100
        if previous_average not in (None, 0)
        else None
    )

    today_key = date_to.isoformat()
    return {
        "range": {
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
        },
        "granularity": granularity,
        "buckets": bucket_list,
        "summary": {
            "total_puffs": total_puffs,
            "average_per_day": average_per_day,
            "period_days": period_days,
            "days_with_data": days_with_data,
            "coil_changes": period_coil_changes,
            "today_puffs": daily_puffs.get(today_key, 0),
            "previous_average_per_day": previous_average,
            "change_percent": change_percent,
        },
        "latest": latest_entry(conn),
        "entries": recent_entries(conn),
    }
