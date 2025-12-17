from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List
from urllib.parse import urljoin

from flask import Blueprint, current_app, jsonify, request

from .repository import HealthRepository, NormalizedRecord

bp = Blueprint("health", __name__)


LOCK_FILENAME = "health.lock"


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


def _get_repository() -> HealthRepository:
    repo = current_app.extensions.get("health_repo")  # type: ignore[attr-defined]
    if repo:
        return repo

    db_path = _get_db_path()
    repo = HealthRepository(db_path)
    current_app.extensions["health_repo"] = repo
    return repo


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
        return jsonify({"syncing": True})

    repo = _get_repository()
    return jsonify({"syncing": False, "last_imported_at": repo.get_last_import_iso()})


@bp.post("/ingest")
def ingest():
    payload = request.get_json(silent=True) or {}
    current_payload_path = _persist_current_payload(payload)
    normalized = list(_normalize_payload(payload))

    if not normalized:
        _persist_failed_payload(payload)
        _archive_payload(current_payload_path)
        return jsonify({"ok": False, "error": "Keine gültigen Health-Datensätze im Payload gefunden."}), 400

    batch_ts = int(datetime.now(timezone.utc).timestamp())
    repo = _get_repository()
    lock_path = _get_lock_path()
    _set_sync_lock(lock_path)

    try:
        stats = repo.ingest_records(normalized, batch_ts)
    finally:
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


def _persist_current_payload(payload: Any) -> str:
    base_dir = os.path.join(current_app.root_path, "data", "health", "current")
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
