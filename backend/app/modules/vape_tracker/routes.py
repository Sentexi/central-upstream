from __future__ import annotations

import os
import sqlite3
from datetime import date, datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Blueprint, current_app, g, jsonify, request

from .repository import (
    CounterRegressionError,
    add_coil_change,
    add_reading,
    build_overview,
    ensure_schema,
    latest_entry,
    recent_entries,
)


bp = Blueprint("vape_tracker", __name__)

GRANULARITIES = {"day", "week", "month"}
RANGE_DAYS = {
    "14d": 14,
    "30d": 30,
    "90d": 90,
    "6m": 183,
    "12m": 365,
}


def _timezone() -> tzinfo:
    name = current_app.config.get("VAPE_TIMEZONE", "Europe/Berlin")
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        current_app.logger.warning(
            "Unknown VAPE_TIMEZONE %s, falling back to the system timezone",
            name,
        )
        return datetime.now().astimezone().tzinfo or timezone.utc


def _now() -> datetime:
    return datetime.now(_timezone())


def _created_at() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_timestamp(value: object) -> datetime:
    if value in (None, ""):
        return _now()

    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            parsed = datetime.fromtimestamp(value, tz=timezone.utc)
        else:
            text = str(value).strip()
            normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
            parsed = datetime.fromisoformat(normalized)
    except (TypeError, ValueError, OSError) as exc:
        raise ValueError("timestamp ist ungueltig") from exc

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_timezone())
    return parsed.astimezone(_timezone())


def _parse_counter(payload: dict) -> int:
    value = payload.get("counter")
    if isinstance(value, bool) or value in (None, ""):
        raise ValueError("counter ist erforderlich")
    try:
        counter = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("counter muss eine ganze Zahl sein") from exc
    if counter < 0:
        raise ValueError("counter darf nicht negativ sein")
    return counter


def _db_path() -> str:
    path = current_app.config.get("VAPE_DB_PATH")
    if not path:
        path = os.path.join(
            current_app.root_path, "data", "vape", "vape.db"
        )
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)
    return path


def _get_conn() -> sqlite3.Connection:
    conn = g.get("vape_tracker_db")
    if conn is None:
        conn = sqlite3.connect(_db_path())
        conn.row_factory = sqlite3.Row
        ensure_schema(conn)
        g.vape_tracker_db = conn
    return conn


def close_vape_conn(_error=None) -> None:
    conn = g.pop("vape_tracker_db", None)
    if conn is not None:
        conn.close()


def _error_response(exc: Exception, status: int):
    return jsonify({"ok": False, "error": str(exc)}), status


@bp.post("")
@bp.post("/entries")
def create_reading():
    payload = request.get_json(silent=True) or {}
    try:
        counter = _parse_counter(payload)
        recorded_at = _parse_timestamp(payload.get("timestamp"))
        entry = add_reading(
            _get_conn(),
            counter=counter,
            recorded_at=recorded_at,
            created_at=_created_at(),
        )
    except ValueError as exc:
        status = 409 if isinstance(exc, CounterRegressionError) else 400
        return _error_response(exc, status)
    return jsonify({"ok": True, "entry": entry}), 201


@bp.post("/coil-change")
def create_coil_change():
    payload = request.get_json(silent=True) or {}
    try:
        counter = _parse_counter(payload)
        recorded_at = _parse_timestamp(payload.get("timestamp"))
        final_reading, reset = add_coil_change(
            _get_conn(),
            final_counter=counter,
            recorded_at=recorded_at,
            created_at=_created_at(),
        )
    except ValueError as exc:
        status = 409 if isinstance(exc, CounterRegressionError) else 400
        return _error_response(exc, status)
    return (
        jsonify(
            {
                "ok": True,
                "final_reading": final_reading,
                "reset": reset,
            }
        ),
        201,
    )


@bp.get("/latest")
def get_latest():
    return jsonify({"ok": True, "latest": latest_entry(_get_conn())})


@bp.get("/entries")
def get_entries():
    try:
        limit = min(max(int(request.args.get("limit", "12")), 1), 100)
    except ValueError:
        return _error_response(ValueError("limit ist ungueltig"), 400)
    return jsonify(
        {"ok": True, "entries": recent_entries(_get_conn(), limit=limit)}
    )


def _resolve_range() -> tuple[date, date]:
    end_raw = request.args.get("date_to")
    start_raw = request.args.get("date_from")
    if end_raw or start_raw:
        if not (end_raw and start_raw):
            raise ValueError("date_from und date_to muessen gemeinsam gesetzt sein")
        try:
            start = date.fromisoformat(start_raw)
            end = date.fromisoformat(end_raw)
        except ValueError as exc:
            raise ValueError("Datumsbereich ist ungueltig") from exc
        if start > end:
            raise ValueError("date_from darf nicht nach date_to liegen")
        if (end - start).days > 730:
            raise ValueError("Datumsbereich darf hoechstens 731 Tage umfassen")
        return start, end

    range_key = request.args.get("range", "30d")
    days = RANGE_DAYS.get(range_key)
    if days is None:
        raise ValueError("range ist ungueltig")
    end = _now().date()
    return end - timedelta(days=days - 1), end


@bp.get("/overview")
def overview():
    granularity = request.args.get("granularity", "day")
    if granularity not in GRANULARITIES:
        return _error_response(ValueError("granularity ist ungueltig"), 400)
    try:
        date_from, date_to = _resolve_range()
    except ValueError as exc:
        return _error_response(exc, 400)

    return jsonify(
        {
            "ok": True,
            **build_overview(
                _get_conn(),
                date_from=date_from,
                date_to=date_to,
                granularity=granularity,
                local_timezone=_timezone(),
            ),
        }
    )
