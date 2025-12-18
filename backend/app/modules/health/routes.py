from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from statistics import median, pstdev
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

from flask import Blueprint, current_app, jsonify, request

from .repository import HealthRepository, NormalizedRecord

bp = Blueprint("health", __name__)


LOCK_FILENAME = "health.lock"
SYNC_STATUS_FILENAME = "sync_status.json"


def _get_db_path() -> str:
    db_path = current_app.config.get("HEALTH_DB_PATH")
    if not db_path:
        db_path = os.path.join(current_app.root_path, "data", "health", "health.sqlite")

    return db_path


def _get_lock_path() -> str:
    db_path = _get_db_path()
    directory = os.path.dirname(db_path) or current_app.root_path
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, LOCK_FILENAME)


def _get_sync_status_path() -> str:
    db_path = _get_db_path()
    directory = os.path.dirname(db_path) or current_app.root_path
    os.makedirs(directory, exist_ok=True)
    return os.path.join(directory, SYNC_STATUS_FILENAME)


def _set_sync_lock(lock_path: str):
    with open(lock_path, "w", encoding="utf-8") as fh:
        fh.write(datetime.now(timezone.utc).isoformat())


def _clear_sync_lock(lock_path: str):
    try:
        os.remove(lock_path)
    except FileNotFoundError:
        pass


def _is_syncing() -> bool:
    lock_path = _get_lock_path()
    return os.path.exists(lock_path)


def _read_sync_status() -> Dict[str, Any]:
    default_status = {
        "stage": None,
        "total_records": 0,
        "processed_records": 0,
        "batch_timestamp": None,
    }
    status_path = _get_sync_status_path()
    try:
        with open(status_path, "r", encoding="utf-8") as fh:
            status = json.load(fh)
            if isinstance(status, dict):
                default_status.update({key: status.get(key) for key in default_status})
    except FileNotFoundError:
        pass

    return default_status


def _write_sync_status(**kwargs):
    status = _read_sync_status()
    status.update(kwargs)
    status_path = _get_sync_status_path()
    with open(status_path, "w", encoding="utf-8") as fh:
        json.dump(status, fh, ensure_ascii=False, indent=2)


def _get_repository() -> HealthRepository:
    repo = current_app.extensions.get("health_repo")  # type: ignore[attr-defined]
    if repo:
        return repo

    db_path = _get_db_path()
    table_schemas = _load_table_schemas()
    repo = HealthRepository(db_path, table_schemas=table_schemas)
    current_app.extensions["health_repo"] = repo
    return repo


def _load_table_schemas() -> Optional[Dict[str, set[str]]]:
    cached = current_app.extensions.get("health_table_schemas")  # type: ignore[attr-defined]
    if cached is not None:
        return cached

    schema_path = current_app.config.get("HEALTH_DB_SCHEMA_PATH")
    if not schema_path:
        return None

    table_schemas: Optional[Dict[str, set[str]]] = None
    try:
        with open(schema_path, "r", encoding="utf-8") as schema_file:
            loaded = json.load(schema_file)
            if isinstance(loaded, dict):
                table_schemas = {
                    str(table_name): {str(column_name) for column_name in columns}
                    for table_name, columns in loaded.items()
                    if isinstance(columns, list)
                }
    except FileNotFoundError:
        table_schemas = None
    except json.JSONDecodeError:
        table_schemas = None

    current_app.extensions["health_table_schemas"] = table_schemas
    return table_schemas


@bp.get("/settings")
def get_settings():
    ingest_path = "/api/health/ingest"
    ingest_url = urljoin(request.url_root, ingest_path.lstrip("/"))

    return jsonify(
        {
            "module_id": "health",
            "module_name": "Health",
            "ingest_path": ingest_path,
            "ingest_url": ingest_url,
            "hint": "Trage diese URL in der Auto Export App ein, um Health-Daten per POST zu senden.",
        }
    )


@bp.get("/status")
def get_status():
    if _is_syncing():
        return jsonify({"syncing": True, "sync_status": _read_sync_status()})

    repo = _get_repository()
    return jsonify({"syncing": False, "last_imported_at": repo.get_last_import_iso()})


@bp.get("/sync_status")
def get_sync_status():
    return jsonify(_read_sync_status())


@bp.post("/ingest")
def ingest():
    payload = request.get_json(silent=True) or {}

    if _has_current_payload():
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Es wird bereits ein Payload verarbeitet. Bitte später erneut versuchen.",
                }
            ),
            409,
        )

    current_payload_path = _persist_current_payload(payload)
    normalized = list(_normalize_payload(payload))

    _write_sync_status(
        stage="normalizing",
        total_records=len(normalized),
        processed_records=0,
        batch_timestamp=None,
    )

    if not normalized:
        _write_sync_status(
            stage="error",
            total_records=0,
            processed_records=0,
            batch_timestamp=None,
        )
        _persist_failed_payload(payload)
        _archive_payload(current_payload_path)
        return jsonify({"ok": False, "error": "Keine gültigen Health-Datensätze im Payload gefunden."}), 400

    batch_ts = int(datetime.now(timezone.utc).timestamp())
    repo = _get_repository()
    lock_path = _get_lock_path()
    _set_sync_lock(lock_path)

    processed_records = 0
    _write_sync_status(
        stage="ingesting",
        total_records=len(normalized),
        processed_records=processed_records,
        batch_timestamp=batch_ts,
    )

    stage_status = "error"
    replace_existing = request.args.get("replace_existing", "true").lower() != "false"

    def _progress_callback(processed_count: int):
        nonlocal processed_records
        processed_records = processed_count
        _write_sync_status(
            stage="ingesting",
            total_records=len(normalized),
            processed_records=processed_records,
            batch_timestamp=batch_ts,
        )

    try:
        stats = repo.ingest_records(
            normalized,
            batch_ts,
            _progress_callback,
            replace_existing=replace_existing,
        )
        stage_status = "done"
    finally:
        _write_sync_status(
            stage=stage_status,
            total_records=len(normalized),
            processed_records=processed_records,
            batch_timestamp=batch_ts,
        )
        _clear_sync_lock(lock_path)
        _archive_payload(current_payload_path)

    return (
        jsonify(
            {
                "ok": True,
                "inserted": stats["inserted"],
                "skipped": stats["skipped"],
                "by_type": stats["by_type"],
                "batch_timestamp": datetime.fromtimestamp(batch_ts, tz=timezone.utc).isoformat(),
            }
        ),
        201,
    )


def _persist_failed_payload(payload: Any):
    base_dir = os.path.join(current_app.root_path, "data", "health", "failed")
    timestamp_dir = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target_dir = os.path.join(base_dir, timestamp_dir)
    os.makedirs(target_dir, exist_ok=True)

    filename = "payload.json"
    path = os.path.join(target_dir, filename)
    suffix = 1
    while os.path.exists(path):
        filename = f"payload_{suffix}.json"
        path = os.path.join(target_dir, filename)
        suffix += 1

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)


def _get_current_payload_dir() -> str:
    return os.path.join(current_app.root_path, "data", "health", "current")


def _has_current_payload() -> bool:
    base_dir = _get_current_payload_dir()
    try:
        return any(
            os.path.isfile(os.path.join(base_dir, entry))
            for entry in os.listdir(base_dir)
        )
    except FileNotFoundError:
        return False


def _persist_current_payload(payload: Any) -> str:
    base_dir = _get_current_payload_dir()
    os.makedirs(base_dir, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    filename = f"payload_{timestamp}.json"
    path = os.path.join(base_dir, filename)
    suffix = 1
    while os.path.exists(path):
        filename = f"payload_{timestamp}_{suffix}.json"
        path = os.path.join(base_dir, filename)
        suffix += 1

    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)

    return path


def _archive_payload(source_path: str):
    if not source_path or not os.path.exists(source_path):
        return

    target_dir = os.path.join(current_app.root_path, "data", "health", "payloads")
    os.makedirs(target_dir, exist_ok=True)

    filename = os.path.basename(source_path)
    name, ext = os.path.splitext(filename)
    target_path = os.path.join(target_dir, filename)
    suffix = 1
    while os.path.exists(target_path):
        target_path = os.path.join(target_dir, f"{name}_{suffix}{ext}")
        suffix += 1

    os.replace(source_path, target_path)


def _normalize_payload(payload: Any) -> Iterable[NormalizedRecord]:
    records: List[Dict[str, Any]] = []
    if isinstance(payload, dict):
        records = _extract_auto_export_records(payload)

        if not records:
            for key in ("records", "data", "items"):
                if key in payload and isinstance(payload[key], list):
                    records = payload[key]
                    break
        if not records and isinstance(payload.get("record"), dict):
            records = [payload["record"]]
    elif isinstance(payload, list):
        records = payload

    for record in records:
        if not isinstance(record, dict):
            continue

        data_type = _extract_type(record)
        if not data_type:
            continue

        start_dt = _parse_dt(
            record.get("start")
            or record.get("start_at")
            or record.get("start_time")
            or record.get("startDate")
        )
        end_dt = _parse_dt(
            record.get("end")
            or record.get("end_at")
            or record.get("end_time")
            or record.get("endDate")
        )

        if not start_dt:
            continue

        if not end_dt:
            end_dt = start_dt

        if end_dt < start_dt:
            start_dt, end_dt = end_dt, start_dt

        yield NormalizedRecord(
            data_type=data_type,
            start_ts=int(start_dt.timestamp()),
            end_ts=int(end_dt.timestamp()),
            payload=record,
        )


def _extract_type(record: Dict[str, Any]) -> str | None:
    candidates = [
        record.get("type"),
        record.get("metric"),
        record.get("category"),
        record.get("kind"),
    ]
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_auto_export_records(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten Health Auto Export payloads into generic records.

    The Auto Export format nests lists under ``data`` with a ``metrics`` list
    (and potentially other arrays). Each metric contains a ``name`` and a
    ``data`` list with entries that hold the actual values. We lift these
    entries into flat records and annotate them with a ``metric`` value so the
    ingest pipeline can categorize them.
    """

    data_section = payload.get("data")
    if not isinstance(data_section, dict):
        return []

    records: List[Dict[str, Any]] = []

    metrics = data_section.get("metrics")
    if isinstance(metrics, list):
        for metric in metrics:
            if not isinstance(metric, dict):
                continue

            name = metric.get("name")
            unit = metric.get("units")
            entries = metric.get("data")
            if not isinstance(name, str) or not isinstance(entries, list):
                continue

            for entry in entries:
                if not isinstance(entry, dict):
                    continue

                record = dict(entry)
                record.setdefault("metric", name)
                if unit is not None:
                    record.setdefault("units", unit)

                # Many entries only provide a single timestamp as "date". Mirror
                # it into start/end so our parser can derive a valid interval.
                if "date" in record:
                    record.setdefault("start", record.get("date"))
                    record.setdefault("end", record.get("date"))

                records.append(record)

    # Fall back: include other lists under the data section as generic records
    # and tag them with the respective key to ensure a metric/type is present.
    for key, items in data_section.items():
        if key == "metrics" or not isinstance(items, list):
            continue

        for item in items:
            if not isinstance(item, dict):
                continue

            record = dict(item)
            record.setdefault("metric", key)
            if "date" in record:
                record.setdefault("start", record.get("date"))
                record.setdefault("end", record.get("date"))
            records.append(record)

    return records


def _parse_dt(value: Any):
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)

    if isinstance(value, str):
        # Normalize Zulu suffix to ISO-friendly offset
        sanitized = value.replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(sanitized)
        except ValueError:
            return None

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt

    return None


RANGE_DAYS = {"today": 1, "7d": 7, "14d": 14, "30d": 30}


def _stddev(values: List[float]) -> Optional[float]:
    if len(values) < 2:
        return None
    try:
        return float(pstdev(values))
    except Exception:
        return None


def _sigma_range(median_value: Optional[float], deviation: Optional[float], factor: int = 2):
    if median_value is None or deviation is None:
        return None, None
    return median_value - factor * deviation, median_value + factor * deviation


def _recent_values(values: Iterable[Optional[float]], limit: int = 21) -> List[float]:
    filtered = [v for v in values if v is not None]
    if limit <= 0:
        return filtered
    return filtered[-limit:]


def _format_sleep_duration(hours: Optional[float]) -> Optional[str]:
    if hours is None:
        return None
    total_minutes = int(round(hours * 60))
    h, m = divmod(total_minutes, 60)
    return f"{h}h {m:02d}m"


def _robust_stats(values: List[float]) -> tuple[Optional[float], Optional[float]]:
    if not values:
        return None, None

    med = float(median(values))
    mad = float(median([abs(v - med) for v in values]))
    if mad == 0:
        mad = 1e-6
    return med, mad


def _z_score(value: Optional[float], med: Optional[float], mad: Optional[float]) -> float:
    if value is None or med is None or mad is None:
        return 0.0
    return (value - med) / mad


def _score_positive(z: float) -> int:
    clamped = max(min(z, 2.5), -2.5)
    normalized = (clamped + 2.5) / 5
    return round(normalized * 100)


def _score_negative(z: float) -> int:
    return _score_positive(-z)


def _color_for_score(score: int) -> str:
    if score >= 70:
        return "green"
    if score >= 45:
        return "yellow"
    return "red"


def _format_delta(value: Optional[float], baseline: Optional[float], unit: str = "") -> str:
    if value is None or baseline is None:
        return "Keine Baseline"
    diff = value - baseline
    if baseline != 0:
        pct = diff / baseline * 100
        return f"{diff:+.1f}{unit} ({pct:+.0f}%)"
    return f"{diff:+.1f}{unit}"


def _latest_entry_with_data(entries: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for entry in reversed(entries):
        if any(
            entry.get(key) is not None
            for key in ("hrv", "rhr", "sleep_total", "steps", "exercise_min")
        ):
            return entry
    return entries[-1] if entries else None


def _build_energy_payload(series: List[Dict[str, Any]], baseline: List[Dict[str, Any]], range_key: str):
    current = _latest_entry_with_data(series)
    today = current.get("date") if current else None

    sleep_values = [row["sleep_total"] for row in baseline if row.get("sleep_total") is not None]
    hrv_values = _recent_values((row.get("hrv") for row in baseline), limit=21)
    rhr_values = _recent_values((row.get("rhr") for row in baseline), limit=21)
    resp_values = [row["resp"] for row in baseline if row.get("resp") is not None]
    steps_values = [row["steps"] for row in baseline if row.get("steps") is not None]
    exercise_values = [row["exercise_min"] for row in baseline if row.get("exercise_min") is not None]

    sleep_med, sleep_mad = _robust_stats(sleep_values)
    hrv_med, hrv_mad = _robust_stats(hrv_values)
    rhr_med, rhr_mad = _robust_stats(rhr_values)
    resp_med, resp_mad = _robust_stats(resp_values)
    steps_med, _ = _robust_stats(steps_values)
    exercise_med, _ = _robust_stats(exercise_values)

    hrv_std = _stddev(hrv_values)
    rhr_std = _stddev(rhr_values)
    hrv_low, hrv_high = _sigma_range(hrv_med, hrv_std)
    rhr_low, rhr_high = _sigma_range(rhr_med, rhr_std)

    z_sleep = _z_score(current.get("sleep_total") if current else None, sleep_med, sleep_mad)
    z_hrv = _z_score(current.get("hrv") if current else None, hrv_med, hrv_mad)
    z_rhr = _z_score(current.get("rhr") if current else None, rhr_med, rhr_mad)
    z_resp = _z_score(current.get("resp") if current else None, resp_med, resp_mad)

    sleep_score = _score_positive(z_sleep)
    hrv_score = _score_positive(z_hrv)
    rhr_score = _score_negative(z_rhr)

    readiness = round(sleep_score * 0.4 + hrv_score * 0.35 + rhr_score * 0.25)
    if abs(z_resp) > 1.5:
        readiness = max(0, readiness - 5)

    readiness_color = _color_for_score(readiness)

    tiles = {
        "readiness": {
            "label": "Readiness",
            "score": readiness,
            "color": readiness_color,
            "date": today,
            "delta_text": _format_delta(current.get("hrv") if current else None, hrv_med, " ms"),
            "components": {
                "sleep": sleep_score,
                "hrv": hrv_score,
                "rhr": rhr_score,
            },
        },
        "sleep": {
            "label": "Schlaf",
            "value": current.get("sleep_total") if current else None,
            "unit": "h",
            "display_value": _format_sleep_duration(current.get("sleep_total") if current else None),
            "delta_text": _format_delta(current.get("sleep_total") if current else None, sleep_med, " h"),
            "score": sleep_score,
            "color": _color_for_score(sleep_score),
        },
        "hrv": {
            "label": "HRV",
            "value": current.get("hrv") if current else None,
            "unit": "ms",
            "delta_text": _format_delta(current.get("hrv") if current else None, hrv_med, " ms"),
            "score": hrv_score,
            "color": _color_for_score(hrv_score),
            "baseline": hrv_med,
            "range_min": hrv_low,
            "range_max": hrv_high,
        },
        "rhr": {
            "label": "Ruhepuls",
            "value": current.get("rhr") if current else None,
            "unit": "bpm",
            "delta_text": _format_delta(current.get("rhr") if current else None, rhr_med, " bpm"),
            "score": rhr_score,
            "color": _color_for_score(rhr_score),
            "baseline": rhr_med,
            "range_min": rhr_low,
            "range_max": rhr_high,
        },
        "load": {
            "label": "Load",
            "steps": current.get("steps") if current else None,
            "exercise_min": current.get("exercise_min") if current else None,
            "active_kcal": current.get("active_kcal") if current else None,
            "delta_text": _format_delta(
                current.get("steps") if current else None, steps_med, " steps"
            ),
            "score": readiness,
            "color": readiness_color,
        },
    }

    signals: List[str] = []
    if z_hrv <= -1:
        signals.append("HRV unter Baseline")
    if z_rhr >= 1:
        signals.append("Ruhepuls erhöht")
    if z_sleep <= -1:
        signals.append("Schlaf kürzer als üblich")
    if abs(z_resp) >= 1.5:
        signals.append("Atemfrequenz auffällig")

    series_payload = {
        "hrv": [{"date": row["date"], "value": row.get("hrv")} for row in series],
        "rhr": [{"date": row["date"], "value": row.get("rhr")} for row in series],
        "sleep_total": [
            {"date": row["date"], "value": row.get("sleep_total")} for row in series
        ],
        "activity": [
            {
                "date": row["date"],
                "steps": row.get("steps"),
                "exercise_min": row.get("exercise_min"),
                "active_kcal": row.get("active_kcal"),
            }
            for row in series
        ],
    }

    return {
        "range": range_key,
        "tiles": tiles,
        "series": series_payload,
        "signals": signals,
        "baseline": {
            "sleep": sleep_med,
            "hrv": hrv_med,
            "rhr": rhr_med,
            "resp": resp_med,
            "steps": steps_med,
            "exercise_min": exercise_med,
        },
    }


@bp.get("/energy-monitor")
def energy_monitor():
    range_key = request.args.get("range", "7d").lower()
    days = RANGE_DAYS.get(range_key, 7)

    today = date.today()
    start = today - timedelta(days=days - 1)

    repo = _get_repository()
    if range_key == "today":
        series = repo.get_hourly_summary(today)
    else:
        series = repo.get_daily_summary(start, today)
    baseline_start = today - timedelta(days=max(30, days) - 1)
    baseline = repo.get_daily_summary(baseline_start, today)

    payload = _build_energy_payload(series, baseline, range_key)
    return jsonify(payload)
