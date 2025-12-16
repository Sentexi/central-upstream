from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List
from urllib.parse import urljoin

from flask import Blueprint, current_app, jsonify, request

from .repository import HealthRepository, NormalizedRecord

bp = Blueprint("health", __name__)


def _get_repository() -> HealthRepository:
    repo = current_app.extensions.get("health_repo")  # type: ignore[attr-defined]
    if repo:
        return repo

    db_path = current_app.config.get("HEALTH_DB_PATH")
    if not db_path:
        db_path = os.path.join(current_app.root_path, "health.sqlite")

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
    repo = _get_repository()
    return jsonify({"last_imported_at": repo.get_last_import_iso()})


@bp.post("/ingest")
def ingest():
    payload = request.get_json(silent=True) or {}
    normalized = list(_normalize_payload(payload))

    if not normalized:
        return jsonify({"ok": False, "error": "Keine gültigen Health-Datensätze im Payload gefunden."}), 400

    batch_ts = int(datetime.now(timezone.utc).timestamp())
    repo = _get_repository()
    stats = repo.ingest_records(normalized, batch_ts)

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


def _normalize_payload(payload: Any) -> Iterable[NormalizedRecord]:
    records: List[Dict[str, Any]] = []
    if isinstance(payload, dict):
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
