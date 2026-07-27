from __future__ import annotations

import json
import math
import os
from datetime import date, datetime, timedelta, timezone
from hmac import compare_digest
from statistics import median, pstdev
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

from flask import Blueprint, current_app, jsonify, request

from ...core.sync_manager import SyncBusyError
from .repository import HealthRepository, NormalizedRecord, _safe_divide

bp = Blueprint("health", __name__)


SYNC_STAGES = {
    "normalizing": "Payload validieren",
    "ingesting": "Import läuft",
    "done": "Import abgeschlossen",
    "error": "Fehler beim Import",
}


def _get_db_path() -> str:
    db_path = current_app.config.get("HEALTH_DB_PATH")
    if not db_path:
        db_path = os.path.join(current_app.root_path, "data", "health", "health.sqlite")

    return db_path


def _sync_status_payload(state: Dict[str, Any]) -> Dict[str, Any]:
    stage = state.get("state")
    if stage in (None, "idle"):
        stage_value: Optional[str] = None
    else:
        stage_value = stage
    return {
        "stage": stage_value,
        "total_records": state.get("total_records") or 0,
        "processed_records": state.get("processed_records") or 0,
        "batch_timestamp": state.get("batch_timestamp"),
    }


def _last_imported_iso(state: Dict[str, Any], repo: HealthRepository) -> Optional[str]:
    iso = state.get("last_completed_at")
    if iso:
        return iso
    return repo.get_last_import_iso()


def _get_repository() -> HealthRepository:
    repo = current_app.extensions.get("health_repo")  # type: ignore[attr-defined]
    if repo:
        return repo

    db_path = _get_db_path()
    table_schemas = _load_table_schemas()
    repo = HealthRepository(db_path, table_schemas=table_schemas)
    current_app.extensions["health_repo"] = repo
    return repo


def _get_workout_repository():
    repo = current_app.extensions.get("health_workout_repo")  # type: ignore[attr-defined]
    if repo is None:
        from .workout_repository import WorkoutRepository

        repo = WorkoutRepository(_get_db_path())
        current_app.extensions["health_workout_repo"] = repo
    return repo


def _get_sync_manager():
    manager = current_app.extensions.get("health_sync_manager")  # type: ignore[attr-defined]
    if manager is None:
        # Fallback for codepaths that bypass init_app (e.g. tests). Lazy
        # creation mirrors the eager path in module.init_app.
        from .sync_manager import HealthSyncManager

        manager = HealthSyncManager(
            repo=_get_repository(),
            workout_repo=_get_workout_repository(),
            app=current_app._get_current_object(),
        )
        current_app.extensions["health_sync_manager"] = manager
    return manager


def _extract_api_key(header_name: str) -> str:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header.removeprefix("Bearer ").strip()
    return request.headers.get(header_name, "").strip()


def _has_valid_ingest_key() -> bool:
    repo = _get_repository()
    header_name, expected_key = repo.get_ingest_api_key()
    provided_key = _extract_api_key(header_name)
    if not expected_key or not provided_key:
        return False
    return compare_digest(provided_key, expected_key)


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


def _mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 8:
        return "*" * len(api_key)
    return f"{api_key[:4]}...{api_key[-4:]}"


def _settings_payload(reveal: bool = False, override_api_key: Optional[str] = None) -> Dict[str, Any]:
    ingest_path = "/api/health/ingest"
    ingest_url = urljoin(request.url_root, ingest_path.lstrip("/"))
    api_header, api_key = _get_repository().get_ingest_api_key()
    if override_api_key is not None:
        api_key = override_api_key

    curl_template = (
        "curl -X POST "
        f"\"{ingest_url}\" "
        "-H \"Content-Type: application/json\" "
        f"-H \"{api_header}: <api-key>\" "
        "-d @export.json"
    )

    payload: Dict[str, Any] = {
        "module_id": "health",
        "module_name": "Health",
        "ingest_path": ingest_path,
        "ingest_url": ingest_url,
        "auth_header": api_header,
        "auth_key_preview": _mask_api_key(api_key),
        "auth_key_set": bool(api_key),
        "curl_template": curl_template,
        "reveal_endpoint": "/api/health/settings/api-key/reveal",
        "rotate_endpoint": "/api/health/settings/api-key/rotate",
        "hint": "Trage diese URL in der Auto Export App ein. Den Schluessel kannst du ueber Anzeigen oder Rotieren abrufen.",
    }
    if reveal:
        payload["auth_key"] = api_key
        payload["curl_example"] = (
            "curl -X POST "
            f"\"{ingest_url}\" "
            "-H \"Content-Type: application/json\" "
            f"-H \"{api_header}: {api_key}\" "
            "-d @export.json"
        )
    return payload


@bp.get("/settings")
def get_settings():
    return jsonify(_settings_payload(reveal=False))


@bp.post("/settings/api-key/reveal")
def reveal_api_key():
    return jsonify(_settings_payload(reveal=True))


@bp.post("/settings/api-key/rotate")
def rotate_api_key():
    _, new_key = _get_repository().rotate_ingest_api_key()
    return jsonify(_settings_payload(reveal=True, override_api_key=new_key))


@bp.get("/status")
def get_status():
    manager = _get_sync_manager()
    manager.auto_clear_if_stale()
    state = manager.get_state()
    is_syncing = state["state"] in ("normalizing", "ingesting")
    payload: Dict[str, Any] = {
        "syncing": is_syncing,
        "sync_status": _sync_status_payload(state),
        "last_imported_at": _last_imported_iso(state, _get_repository()),
        "last_error": state.get("last_error"),
        "stages": SYNC_STAGES,
        "upload_hint": "Lade einen Health Auto Export als JSON hoch, um den Import manuell zu starten.",
    }
    return jsonify(payload)


@bp.get("/sync_status")
def get_sync_status():
    manager = _get_sync_manager()
    manager.auto_clear_if_stale()
    return jsonify(_sync_status_payload(manager.get_state()))


@bp.get("/history")
def get_history():
    manager = _get_sync_manager()
    raw_limit = request.args.get("limit", "20")
    try:
        limit = int(raw_limit)
    except ValueError:
        limit = 20
    return jsonify({"items": manager.get_history(limit=limit)})


@bp.post("/force_clear")
def force_clear():
    manager = _get_sync_manager()
    cleared = manager.force_clear_sync()
    state = manager.get_state()
    return jsonify(
        {
            "ok": True,
            "cleared": cleared,
            "sync_status": _sync_status_payload(state),
            "last_error": state.get("last_error"),
        }
    )


def _run_ingest(payload: Any, client: str, force: bool = False):
    """Hand the payload to the sync manager and return 202 on accept."""

    manager = _get_sync_manager()
    replace_existing = request.args.get("replace_existing", "true").lower() != "false"

    try:
        state = manager.start_ingest(
            payload=payload,
            client=client,
            replace_existing=replace_existing,
            force=force,
        )
    except SyncBusyError as exc:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Es wird bereits ein Sync verarbeitet. Bitte später erneut versuchen.",
                    "sync_status": _sync_status_payload(exc.status),
                }
            ),
            409,
        )

    return (
        jsonify(
            {
                "ok": True,
                "syncing": True,
                "sync_status": _sync_status_payload(state),
                "stages": SYNC_STAGES,
            }
        ),
        202,
    )


@bp.post("/ingest")
def ingest():
    if not _has_valid_ingest_key():
        return jsonify({"ok": False, "error": "Unauthorized."}), 401

    payload = request.get_json(silent=True) or {}
    return _run_ingest(payload, client="iphone", force=False)


@bp.post("/manual_ingest")
def manual_ingest():
    payload = request.get_json(silent=True)
    if payload is None:
        return jsonify({"ok": False, "error": "Erwarte JSON-Body."}), 400
    force = request.args.get("force", "false").lower() == "true"
    return _run_ingest(payload, client="browser", force=force)


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


def _fitness_tertile_color(value: Optional[float], series: List[float]) -> str:
    valid = [v for v in series if v is not None]
    if not valid or value is None:
        return "yellow"
    sorted_vals = sorted(valid)
    rank = sum(1 for v in sorted_vals if v <= value) / len(sorted_vals)
    if rank >= 2 / 3:
        return "green"
    if rank >= 1 / 3:
        return "yellow"
    return "red"


def _consistency_stats(
    daily: List[Dict[str, Any]], min_exercise: int = 20, min_steps: int = 8000
) -> Dict[str, int]:
    active_days = 0
    current_streak = 0
    longest_streak = 0

    sorted_days = sorted(daily, key=lambda d: d.get("date") or "")
    for entry in sorted_days:
        exercise = entry.get("exercise_min") or 0
        steps = entry.get("steps") or 0
        meets_threshold = exercise >= min_exercise or steps >= min_steps
        if meets_threshold:
            active_days += 1
            current_streak += 1
            longest_streak = max(longest_streak, current_streak)
        else:
            current_streak = 0

    return {"active_days": active_days, "current_streak": current_streak, "longest_streak": longest_streak}


def _consistency_color(active_days: int, total_days: int) -> str:
    if total_days <= 0:
        return "yellow"
    ratio = active_days / total_days
    if ratio >= 0.7:
        return "green"
    if ratio >= 0.43:
        return "yellow"
    return "red"


def _percent_delta(current: Optional[float], baseline: Optional[float]) -> Optional[float]:
    if current is None or baseline is None or baseline == 0:
        return None
    return (current - baseline) / baseline


def _format_percent_delta(current: Optional[float], baseline: Optional[float]) -> str:
    pct = _percent_delta(current, baseline)
    if pct is None:
        return "Keine Baseline"
    return f"{pct:+.0%}"


def _sum_metric(entries: List[Dict[str, Any]], key: str) -> Optional[float]:
    values = [row.get(key) for row in entries if row.get(key) is not None]
    if not values:
        return None
    return float(sum(values))


def _trend_delta(series: List[Dict[str, Any]], value_key: str, window: int = 7) -> tuple[Optional[float], Optional[float]]:
    sorted_series = sorted(series, key=lambda row: row.get("date") or "")
    values = [row.get(value_key) for row in sorted_series if row.get(value_key) is not None]
    if len(values) < 4:
        return None, None
    recent = values[-window:]
    previous = values[-2 * window : -window] if len(values) >= 2 * window else values[:-window]
    if not previous or not recent:
        return None, None
    prev_med = median(previous)
    recent_med = median(recent)
    return recent_med, _percent_delta(recent_med, prev_med)


def _sleep_duration_score(hours: Optional[float]) -> Optional[int]:
    if hours is None:
        return None
    if hours <= 3:
        return 0
    if hours >= 8:
        return 100
    return round((hours - 3) / 5 * 100)


def _previous_sleep_average(
    baseline: List[Dict[str, Any]], today_str: Optional[str], days: int = 3
) -> Optional[float]:
    if today_str is None:
        return None
    try:
        today = date.fromisoformat(str(today_str))
    except (TypeError, ValueError):
        return None

    entries: List[tuple[date, float]] = []
    for row in baseline:
        raw_date = row.get("date")
        sleep_total = row.get("sleep_total")
        if sleep_total is None or raw_date is None:
            continue
        try:
            entry_date = date.fromisoformat(str(raw_date))
        except ValueError:
            continue
        if entry_date < today:
            entries.append((entry_date, sleep_total))

    entries.sort(key=lambda pair: pair[0], reverse=True)
    values = [sleep for _, sleep in entries[:days]]
    if not values:
        return None
    return sum(values) / len(values)


def _weighted_sleep_score(
    current_hours: Optional[float], baseline: List[Dict[str, Any]], today_str: Optional[str]
) -> int:
    current_score = _sleep_duration_score(current_hours)
    prev_avg = _previous_sleep_average(baseline, today_str)
    prev_score = _sleep_duration_score(prev_avg)

    weighted_scores: List[tuple[int, float]] = []
    if current_score is not None:
        weighted_scores.append((current_score, 0.66))
    if prev_score is not None:
        weighted_scores.append((prev_score, 0.33))

    if not weighted_scores:
        return 0

    total_weight = sum(weight for _, weight in weighted_scores)
    combined = sum(score * weight for score, weight in weighted_scores)
    return round(combined / total_weight)


def _hrv_score(value: Optional[float], median_value: Optional[float], deviation: Optional[float]) -> int:
    if value is None or median_value is None or not deviation:
        return 0

    z = (value - median_value) / deviation
    if z >= 2:
        return 100
    if z >= 1:
        return round(90 + (z - 1) * 10)
    if z >= 0:
        return round(70 + z * 20)
    if z >= -1:
        return round(35 + (z + 1) * 35)
    if z >= -2:
        return round((z + 2) * 35)
    return 0


def _rhr_score(value: Optional[float], median_value: Optional[float], deviation: Optional[float]) -> int:
    if value is None or median_value is None or not deviation:
        return 0

    z = (value - median_value) / deviation
    if z >= 2:
        return 0
    if z > 0:
        decay = 1.0
        numerator = math.exp(-decay * z) - math.exp(-decay * 2)
        denominator = 1 - math.exp(-decay * 2)
        return max(0, round(50 * numerator / denominator))
    if z >= -1:
        return round(50 + (abs(z) * 50))
    if z >= -2:
        # From 100 at -1 sigma down to 40 at -2 sigma
        return round(100 - (abs(z + 1) * 60))
    return 40


def _steps_score(steps: Optional[float]) -> int:
    if steps is None or steps <= 0:
        return 0
    if steps >= 10000:
        return 100
    return round(min(steps / 10000 * 100, 100))


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


def _shift_sleep_date(date_str: str, range_key: str) -> str:
    return date_str


def _load_entry_for_display(
    current: Optional[Dict[str, Any]],
    series: List[Dict[str, Any]],
    baseline: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not current or not current.get("date"):
        return current

    try:
        current_date = date.fromisoformat(str(current.get("date")))
    except (TypeError, ValueError):
        return current

    if current_date != date.today():
        return current

    previous_date = (current_date - timedelta(days=1)).isoformat()
    previous_entry = next((row for row in reversed(series) if row.get("date") == previous_date), None)
    if previous_entry:
        return previous_entry

    return next((row for row in reversed(baseline) if row.get("date") == previous_date), current)


def _extend_with_previous_day(
    series: List[Dict[str, Any]], baseline: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    if not series:
        return series

    first_date_str = series[0].get("date")
    try:
        first_date = date.fromisoformat(str(first_date_str))
    except (TypeError, ValueError):
        return series

    previous_date = (first_date - timedelta(days=1)).isoformat()
    previous_entry = next((row for row in baseline if row.get("date") == previous_date), None)
    if not previous_entry:
        return series

    return sorted([previous_entry, *series], key=lambda row: row.get("date") or "")


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

    sleep_score = _weighted_sleep_score(
        current.get("sleep_total") if current else None, baseline, today
    )
    hrv_score = _hrv_score(current.get("hrv") if current else None, hrv_med, hrv_std)
    rhr_score = _rhr_score(current.get("rhr") if current else None, rhr_med, rhr_std)
    load_entry = _load_entry_for_display(current, series, baseline)
    load_steps = load_entry.get("steps") if load_entry else None
    load_exercise_min = load_entry.get("exercise_min") if load_entry else None
    load_active_kcal = load_entry.get("active_kcal") if load_entry else None

    steps_score = _steps_score(load_steps)

    readiness = round(hrv_score * 0.45 + sleep_score * 0.3 + rhr_score * 0.25)
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
            "steps": load_steps,
            "exercise_min": load_exercise_min,
            "active_kcal": load_active_kcal,
            "delta_text": _format_delta(load_steps, steps_med, " steps"),
            "score": steps_score,
            "color": _color_for_score(steps_score),
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

    extended_resting_and_sleep_series = _extend_with_previous_day(series, baseline)

    series_payload = {
        "hrv": [{"date": row["date"], "value": row.get("hrv")} for row in series],
        "rhr": [
            {"date": row["date"], "value": row.get("rhr")} for row in extended_resting_and_sleep_series
        ],
        "sleep_total": [
            {
                "date": _shift_sleep_date(row["date"], range_key),
                "value": row.get("sleep_total"),
            }
            for row in extended_resting_and_sleep_series
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


def _fitness_progress_notes(
    range_daily: List[Dict[str, Any]],
    baseline_daily: List[Dict[str, Any]],
    consistency: Dict[str, int],
    efficiency_change: Optional[float],
) -> List[str]:
    notes: List[str] = []
    if range_daily:
        exercise_values = [row.get("exercise_min") for row in range_daily if row.get("exercise_min") is not None]
        baseline_exercise = [row.get("exercise_min") for row in baseline_daily if row.get("exercise_min") is not None]
        if exercise_values and baseline_exercise:
            current_avg = sum(exercise_values) / len(exercise_values)
            baseline_med = median(baseline_exercise)
            pct = _percent_delta(current_avg, baseline_med)
            if pct is not None:
                notes.append(f"Exercise-Minuten {pct:+.0%} vs. 4-Wochen-Median")

        steps_values = [row.get("steps") for row in range_daily if row.get("steps") is not None]
        baseline_steps = [row.get("steps") for row in baseline_daily if row.get("steps") is not None]
        if steps_values and baseline_steps:
            current_total = sum(steps_values)
            baseline_med = median(baseline_steps)
            pct = _percent_delta(current_total / len(steps_values), baseline_med)
            if pct is not None:
                notes.append(f"Steps {pct:+.0%} vs. 4-Wochen-Median")

    if consistency.get("current_streak"):
        notes.append(f"Streak {consistency['current_streak']} Tage")

    if efficiency_change is not None:
        direction = "verbessert sich" if efficiency_change < 0 else "verschlechtert sich"
        notes.append(f"Walking HR/Speed {direction} ({efficiency_change:+.0%})")

    return notes[:5]


def _build_fitness_payload(
    range_key: str,
    group_key: str,
    daily_series: List[Dict[str, Any]],
    weekly_series: List[Dict[str, Any]],
    weekly_baseline: List[Dict[str, Any]],
    baseline_daily: List[Dict[str, Any]],
):
    weekly_values = [row.get("exercise_min_week") for row in weekly_baseline if row.get("exercise_min_week") is not None]
    weekly_median = median(weekly_values) if weekly_values else None
    weekly_volume = weekly_series[-1] if weekly_series else None
    weekly_volume_value = weekly_volume.get("exercise_min_week") if weekly_volume else None
    volume_color = _fitness_tertile_color(weekly_volume_value, weekly_values)
    volume_delta = _format_delta(weekly_volume_value, weekly_median, " min")

    consistency = _consistency_stats(daily_series)
    consistency_color = _consistency_color(consistency["active_days"], len(daily_series))

    steps_total = _sum_metric(daily_series, "steps")
    distance_total = _sum_metric(daily_series, "distance_km")

    distance_week_values = [
        row.get("distance_km_week") for row in weekly_baseline if row.get("distance_km_week") is not None
    ]
    distance_baseline = median(distance_week_values) if distance_week_values else None
    distance_color = _fitness_tertile_color(
        steps_total,
        [row.get("steps_week") for row in weekly_baseline if row.get("steps_week") is not None],
    )

    efficiency_series: List[Dict[str, Any]] = []
    for row in daily_series:
        idx = _safe_divide(row.get("walking_hr_avg"), row.get("walking_speed"))
        efficiency_series.append({"date": row.get("date"), "hr_speed_index": idx})

    efficiency_value = next((row["hr_speed_index"] for row in reversed(efficiency_series) if row.get("hr_speed_index") is not None), None)
    efficiency_recent, efficiency_change = _trend_delta(efficiency_series, "hr_speed_index")
    efficiency_baseline = (
        efficiency_recent / (1 + efficiency_change) if efficiency_recent is not None and efficiency_change is not None else None
    )
    efficiency_color = "yellow"
    if efficiency_change is not None:
        if efficiency_change <= -0.03:
            efficiency_color = "green"
        elif efficiency_change >= 0.03:
            efficiency_color = "red"

    mobility_series = [row for row in daily_series if row.get("walking_speed") is not None or row.get("step_length") is not None]
    mobility_change_value, mobility_change = _trend_delta(mobility_series, "walking_speed")
    mobility_baseline = (
        mobility_change_value / (1 + mobility_change) if mobility_change_value is not None and mobility_change is not None else None
    )
    mobility_color = "yellow"
    if mobility_change is not None:
        if mobility_change >= 0.03:
            mobility_color = "green"
        elif mobility_change <= -0.03:
            mobility_color = "red"

    tiles = {
        "volume": {
            "label": "Weekly Volume",
            "value": weekly_volume_value,
            "unit": "min",
            "delta_text": volume_delta,
            "color": volume_color,
            "detail": weekly_volume.get("week_label") if weekly_volume else None,
        },
        "consistency": {
            "label": "Consistency",
            "value": consistency["active_days"],
            "unit": f"/{len(daily_series)}",
            "color": consistency_color,
            "streak": consistency["current_streak"],
            "longest": consistency["longest_streak"],
        },
        "distance": {
            "label": "Distance & Steps",
            "value": distance_total if distance_total else None,
            "unit": "km",
            "secondary": steps_total if steps_total else None,
            "secondary_unit": "Steps",
            "color": distance_color,
            "delta_text": _format_percent_delta(distance_total, distance_baseline),
        },
        "efficiency": {
            "label": "Efficiency Proxy",
            "value": efficiency_value,
            "unit": "HR/Speed",
            "color": efficiency_color,
            "delta_text": _format_percent_delta(efficiency_recent, efficiency_baseline),
        },
        "mobility": {
            "label": "Mobility",
            "value": mobility_change_value,
            "unit": "km/h",
            "color": mobility_color,
            "delta_text": _format_percent_delta(mobility_change_value, mobility_baseline),
        },
    }

    exercise_daily = [{"date": row.get("date"), "value": row.get("exercise_min")} for row in daily_series]
    exercise_weekly = [
        {"date": row.get("week_start"), "value": row.get("exercise_min_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]

    steps_daily = [{"date": row.get("date"), "value": row.get("steps")} for row in daily_series]
    distance_daily = [{"date": row.get("date"), "value": row.get("distance_km")} for row in daily_series]
    steps_weekly = [
        {"date": row.get("week_start"), "value": row.get("steps_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]
    distance_weekly = [
        {"date": row.get("week_start"), "value": row.get("distance_km_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]

    active_daily = [{"date": row.get("date"), "value": row.get("active_kcal")} for row in daily_series]
    resting_daily = [{"date": row.get("date"), "value": row.get("basal_kcal")} for row in daily_series]
    floors_daily = [{"date": row.get("date"), "value": row.get("floors")} for row in daily_series]
    active_weekly = [
        {"date": row.get("week_start"), "value": row.get("active_kcal_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]
    resting_weekly = [
        {"date": row.get("week_start"), "value": row.get("basal_kcal_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]
    floors_weekly = [
        {"date": row.get("week_start"), "value": row.get("floors_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]

    weight_daily = [{"date": row.get("date"), "value": row.get("weight")} for row in daily_series]
    weight_weekly = [
        {"date": row.get("week_start"), "value": row.get("weight_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]

    vo2_daily = [{"date": row.get("date"), "value": row.get("vo2max")} for row in daily_series]
    vo2_weekly = [
        {"date": row.get("week_start"), "value": row.get("vo2max_week"), "label": row.get("week_label")}
        for row in weekly_series
    ]

    efficiency_chart = [
        {"date": row.get("date"), "value": _safe_divide(row.get("walking_hr_avg"), row.get("walking_speed")), "speed": row.get("walking_speed"), "hr": row.get("walking_hr_avg")}
        for row in daily_series
    ]
    stair_up = [{"date": row.get("date"), "value": row.get("stair_up")} for row in daily_series if row.get("stair_up") is not None]
    stair_down = [{"date": row.get("date"), "value": row.get("stair_down")} for row in daily_series if row.get("stair_down") is not None]

    notes = _fitness_progress_notes(daily_series, baseline_daily, consistency, efficiency_change)

    return {
        "range": range_key,
        "group": group_key,
        "tiles": tiles,
        "charts": {
            "exercise": {"daily": exercise_daily, "weekly": exercise_weekly},
            "steps_distance": {
                "steps": steps_daily,
                "distance": distance_daily,
                "steps_weekly": steps_weekly,
                "distance_weekly": distance_weekly,
            },
            "active_floors": {
                "active_kcal": active_daily,
                "resting_kcal": resting_daily,
                "floors": floors_daily,
                "active_kcal_weekly": active_weekly,
                "resting_kcal_weekly": resting_weekly,
                "floors_weekly": floors_weekly,
            },
            "efficiency": {
                "efficiency_index": efficiency_chart,
                "stair_up": stair_up,
                "stair_down": stair_down,
            },
            "weight": {"daily": weight_daily, "weekly": weight_weekly},
            "vo2max": {"daily": vo2_daily, "weekly": vo2_weekly},
        },
        "notes": notes,
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


@bp.get("/fitness")
def fitness_dashboard():
    range_key = request.args.get("range", "7d").lower()
    group_key = request.args.get("group", "daily").lower()
    if group_key not in {"daily", "weekly"}:
        group_key = "daily"

    days = RANGE_DAYS.get(range_key, 7)
    today = date.today()
    start = today - timedelta(days=days - 1)

    repo = _get_repository()
    daily_series = repo.get_fitness_daily_aggregates(start, today)
    weekly_baseline_start = today - timedelta(days=7 * 12 - 1)
    weekly_series_full = repo.get_fitness_weekly_summary(weekly_baseline_start, today)

    weekly_series = [
        row
        for row in weekly_series_full
        if row.get("week_start") and date.fromisoformat(str(row["week_start"])) >= start - timedelta(days=6)
    ]
    baseline_daily = repo.get_fitness_daily_aggregates(start - timedelta(days=28), start - timedelta(days=1))

    payload = _build_fitness_payload(
        range_key,
        group_key,
        daily_series,
        weekly_series,
        weekly_series_full[-12:],
        baseline_daily,
    )
    return jsonify(payload)


@bp.get("/workouts/overview")
def workout_overview():
    range_key = request.args.get("range", "all").lower()
    if range_key not in {"90d", "1y", "all"}:
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "Ungueltiger Zeitraum. Erlaubt sind 90d, 1y und all.",
                }
            ),
            400,
        )

    payload = _get_workout_repository().get_overview(range_key)
    return jsonify(payload)
