from __future__ import annotations

import json
import os
import sqlite3
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import requests
from flask import Blueprint, current_app, jsonify, request

from app.core.settings_storage import settings_storage

calories_bp = Blueprint("calories", __name__)
vape_bp = Blueprint("vape", __name__)

ALLOWED_TYPES = {"breakfast", "lunch", "dinner", "softdrink", "snack"}
ALLOWED_STATUS = {"draft", "saved", "import"}
SOURCE_TYPES = {"manual", "llm", "upload"}


class LLMError(Exception):
    pass


def _ensure_dir(path: str):
    directory = os.path.dirname(path)
    if directory:
        os.makedirs(directory, exist_ok=True)


def _today_str() -> str:
    return date.today().isoformat()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_calories_db_path() -> str:
    path = current_app.config.get("CALORIES_DB_PATH")
    if not path:
        path = os.path.join(current_app.root_path, "data", "calories", "calories.db")
    _ensure_dir(path)
    return path


def _get_vape_db_path() -> str:
    path = current_app.config.get("VAPE_DB_PATH")
    if not path:
        path = os.path.join(current_app.root_path, "data", "vape", "vape.db")
    _ensure_dir(path)
    return path


def _connect(path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_calories_schema(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT,
            raw_text TEXT NOT NULL,
            name TEXT,
            amount_g REAL,
            kcal REAL,
            carbs_g REAL,
            fat_g REAL,
            protein_g REAL,
            caffeine_mg REAL,
            type TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            source TEXT NOT NULL,
            llm_model TEXT,
            import_batch_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            CHECK(status IN ('draft', 'saved', 'import')),
            CHECK(type IN ('breakfast', 'lunch', 'dinner', 'softdrink', 'snack') OR type IS NULL),
            CHECK(source IN ('manual', 'llm', 'upload'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meal_entries_date_status ON meal_entries(date, status)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_meal_entries_timestamp ON meal_entries(timestamp)"
    )
    conn.commit()


def _ensure_vape_schema(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vape_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            counter INTEGER NOT NULL,
            delta INTEGER NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_vape_entries_timestamp ON vape_entries(timestamp)"
    )
    conn.commit()


def _get_calories_conn() -> sqlite3.Connection:
    conn = current_app.extensions.get("calories_db")  # type: ignore[attr-defined]
    if conn:
        return conn
    conn = _connect(_get_calories_db_path())
    _ensure_calories_schema(conn)
    current_app.extensions["calories_db"] = conn
    return conn


def _get_vape_conn() -> sqlite3.Connection:
    conn = current_app.extensions.get("vape_db")  # type: ignore[attr-defined]
    if conn:
        return conn
    conn = _connect(_get_vape_db_path())
    _ensure_vape_schema(conn)
    current_app.extensions["vape_db"] = conn
    return conn


def _coerce_date(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value)).date()
        return parsed.isoformat()
    except Exception:
        try:
            # accept YYYY-MM-DD directly
            parsed = date.fromisoformat(str(value))
            return parsed.isoformat()
        except Exception:
            return None


def _coerce_timestamp(value: Any) -> Optional[str]:
    if not value:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
        except Exception:
            return None
    text = str(value)
    try:
        return datetime.fromisoformat(text).isoformat()
    except Exception:
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
        except Exception:
            return None


def _to_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _serialize_entry(row: sqlite3.Row) -> Dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _call_llm(api_key: str, text: str) -> Tuple[List[Dict[str, Any]], Optional[str], str]:
    endpoint = current_app.config.get(
        "CALORIES_LLM_ENDPOINT", "https://api.openai.com/v1/chat/completions"
    )
    model = current_app.config.get("CALORIES_LLM_MODEL", "gpt-4o-mini")

    system_prompt = (
        "Parse the given food/beverage/vape text into JSON. "
        "Respond with an object: {\"items\": [{\"name\": string, \"amount_g\": number?, "
        "\"kcal\": number?, \"carbs_g\": number?, \"fat_g\": number?, \"protein_g\": number?, "
        "\"caffeine_mg\": number?, \"type\": \"breakfast|lunch|dinner|softdrink|snack\"}], "
        "\"date\": \"YYYY-MM-DD\"?}. If no structured data is found, still return a best-effort item."
    )

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 500,
    }

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(endpoint, json=payload, headers=headers, timeout=30)
        if response.status_code == 401:
            raise LLMError("LLM-Key ist ungültig oder nicht autorisiert.")
        if response.status_code >= 500:
            raise LLMError("LLM-Dienst nicht erreichbar.")

        data = response.json()
        raw_content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )
        parsed = json.loads(raw_content)

        items = parsed.get("items", [])
        parsed_date = parsed.get("date")
        used_model = data.get("model", model)
        return items, parsed_date, used_model
    except json.JSONDecodeError as exc:
        raise LLMError(f"LLM-Antwort konnte nicht geparst werden: {exc}") from exc
    except requests.RequestException as exc:
        raise LLMError(f"LLM-Request fehlgeschlagen: {exc}") from exc
    except Exception as exc:
        raise LLMError(str(exc)) from exc


def _fallback_items(text: str) -> List[Dict[str, Any]]:
    return [
        {
            "name": text[:80],
            "kcal": None,
            "type": None,
            "carbs_g": None,
            "fat_g": None,
            "protein_g": None,
            "caffeine_mg": None,
            "amount_g": None,
        }
    ]


def _normalize_item(
    item: Dict[str, Any],
    resolved_date: str,
    raw_text: str,
    timestamp: Optional[str],
    llm_model: Optional[str],
    status: str = "draft",
    source: str = "llm",
    import_batch_id: Optional[str] = None,
) -> Dict[str, Any]:
    entry_type = item.get("type")
    if entry_type not in ALLOWED_TYPES:
        entry_type = None

    entry = {
        "date": resolved_date,
        "timestamp": timestamp,
        "raw_text": raw_text,
        "name": item.get("name"),
        "amount_g": _to_float(item.get("amount_g")),
        "kcal": _to_float(item.get("kcal")),
        "carbs_g": _to_float(item.get("carbs_g")),
        "fat_g": _to_float(item.get("fat_g")),
        "protein_g": _to_float(item.get("protein_g")),
        "caffeine_mg": _to_float(item.get("caffeine_mg")),
        "type": entry_type,
        "status": status if status in ALLOWED_STATUS else "draft",
        "source": source if source in SOURCE_TYPES else "llm",
        "llm_model": llm_model,
        "import_batch_id": import_batch_id,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    return entry


def _resolve_date(preferred: Optional[str], llm_date: Optional[str]) -> str:
    if preferred:
        return preferred
    if llm_date:
        coerced = _coerce_date(llm_date)
        if coerced:
            return coerced
    return _today_str()


def _load_settings() -> Dict[str, Any]:
    return settings_storage.get_settings_for_module("calories")


@calories_bp.get("/settings/status")
def calories_settings_status():
    settings = _load_settings()
    return jsonify(
        {
            "has_key": bool(settings.get("api_key")),
            "is_valid": bool(settings.get("is_valid")),
            "last_checked_at": settings.get("last_checked_at"),
            "status": "valid" if settings.get("is_valid") else "missing_or_invalid",
        }
    )


@calories_bp.post("/settings/test")
def calories_settings_test():
    payload = request.get_json(silent=True) or {}
    api_key = str(payload.get("api_key") or "").strip() or str(
        _load_settings().get("api_key") or ""
    ).strip()

    if not api_key:
        return jsonify({"ok": False, "error": "Kein API-Key vorhanden."}), 400

    try:
        _call_llm(api_key, "probe")
        ok = True
        error = None
    except LLMError as exc:
        ok = False
        error = str(exc)

    now_iso = _now_iso()
    settings_storage.save_settings_for_module(
        "calories",
        {
            "api_key": api_key,
            "last_checked_at": now_iso,
            "is_valid": ok,
        },
    )

    return (
        jsonify({"ok": ok, "error": error, "last_checked_at": now_iso}),
        200 if ok else 400,
    )


@calories_bp.post("/ingest")
def ingest_text():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text", "")).strip()
    if not text:
        return jsonify({"ok": False, "error": "text ist erforderlich"}), 400

    user_date = _coerce_date(payload.get("date"))
    user_timestamp = _coerce_timestamp(payload.get("timestamp"))

    settings = _load_settings()
    api_key = str(settings.get("api_key") or "").strip()
    if not api_key:
        return jsonify({"ok": False, "error": "LLM-Key fehlt oder ist ungültig."}), 400

    try:
        llm_items, llm_date, llm_model = _call_llm(api_key, text)
    except LLMError as exc:
        llm_items, llm_date, llm_model = _fallback_items(text), None, None
        llm_error = str(exc)
    else:
        llm_error = None

    resolved_date = _resolve_date(user_date, llm_date)
    if not llm_items:
        llm_items = _fallback_items(text)

    conn = _get_calories_conn()
    inserted: List[Dict[str, Any]] = []
    with conn:
        for item in llm_items:
            entry = _normalize_item(
                item,
                resolved_date=resolved_date,
                raw_text=text,
                timestamp=user_timestamp or _coerce_timestamp(item.get("timestamp")),
                llm_model=llm_model,
                status="draft",
                source="llm",
            )
            cursor = conn.execute(
                """
                INSERT INTO meal_entries (date, timestamp, raw_text, name, amount_g, kcal, carbs_g, fat_g, protein_g, caffeine_mg, type, status, source, llm_model, import_batch_id, created_at, updated_at)
                VALUES (:date, :timestamp, :raw_text, :name, :amount_g, :kcal, :carbs_g, :fat_g, :protein_g, :caffeine_mg, :type, :status, :source, :llm_model, :import_batch_id, :created_at, :updated_at)
                """,
                entry,
            )
            entry["id"] = cursor.lastrowid
            inserted.append(entry)
    response_body = {"ok": True, "drafts": inserted}
    if llm_error:
        response_body["llm_error"] = llm_error
    return jsonify(response_body)


@calories_bp.get("/drafts")
def list_drafts():
    conn = _get_calories_conn()
    rows = conn.execute(
        "SELECT * FROM meal_entries WHERE status = 'draft' ORDER BY created_at DESC LIMIT 100"
    ).fetchall()
    return jsonify({"drafts": [_serialize_entry(r) for r in rows]})


@calories_bp.post("/drafts/<int:entry_id>/accept")
def accept_draft(entry_id: int):
    conn = _get_calories_conn()
    with conn:
        updated = conn.execute(
            "UPDATE meal_entries SET status = 'saved', updated_at = :ts WHERE id = :id AND status = 'draft'",
            {"ts": _now_iso(), "id": entry_id},
        )
        if updated.rowcount == 0:
            return jsonify({"ok": False, "error": "Draft nicht gefunden"}), 404
    row = conn.execute("SELECT * FROM meal_entries WHERE id = ?", (entry_id,)).fetchone()
    return jsonify({"ok": True, "entry": _serialize_entry(row)})


@calories_bp.delete("/drafts/<int:entry_id>")
def delete_draft(entry_id: int):
    conn = _get_calories_conn()
    with conn:
        deleted = conn.execute(
            "DELETE FROM meal_entries WHERE id = :id AND status = 'draft'", {"id": entry_id}
        )
        if deleted.rowcount == 0:
            return jsonify({"ok": False, "error": "Draft nicht gefunden"}), 404
    return jsonify({"ok": True})


def _resolve_range() -> Tuple[str, str]:
    date_from = _coerce_date(request.args.get("date_from"))
    date_to = _coerce_date(request.args.get("date_to"))
    if date_from and date_to:
        return date_from, date_to

    range_param = request.args.get("range", "7d")
    end = date.today()
    if range_param == "today":
        start = end
    else:
        try:
            days = int(range_param.replace("d", ""))
        except Exception:
            days = 7
        start = end - timedelta(days=days - 1)

    return start.isoformat(), end.isoformat()


def _aggregate_summary(conn: sqlite3.Connection, date_from: str, date_to: str):
    rows = conn.execute(
        """
        SELECT date, type, SUM(COALESCE(kcal, 0)) AS kcal,
               SUM(COALESCE(carbs_g, 0)) AS carbs_g,
               SUM(COALESCE(fat_g, 0)) AS fat_g,
               SUM(COALESCE(protein_g, 0)) AS protein_g,
               SUM(COALESCE(caffeine_mg, 0)) AS caffeine_mg
        FROM meal_entries
        WHERE date BETWEEN ? AND ? AND status IN ('saved', 'import')
        GROUP BY date, type
        ORDER BY date ASC
        """,
        (date_from, date_to),
    ).fetchall()

    day_index: Dict[str, Dict[str, Any]] = {}
    totals = {"kcal": 0.0, "carbs_g": 0.0, "fat_g": 0.0, "protein_g": 0.0, "caffeine_mg": 0.0}

    for row in rows:
        day = day_index.setdefault(
            row["date"],
            {
                "date": row["date"],
                "types": {t: 0.0 for t in ALLOWED_TYPES},
                "total_kcal": 0.0,
                "macros": {"carbs_g": 0.0, "fat_g": 0.0, "protein_g": 0.0, "caffeine_mg": 0.0},
            },
        )
        if row["type"] in ALLOWED_TYPES:
            day["types"][row["type"]] += row["kcal"] or 0.0
        day["total_kcal"] += row["kcal"] or 0.0
        day["macros"]["carbs_g"] += row["carbs_g"] or 0.0
        day["macros"]["fat_g"] += row["fat_g"] or 0.0
        day["macros"]["protein_g"] += row["protein_g"] or 0.0
        day["macros"]["caffeine_mg"] += row["caffeine_mg"] or 0.0

        totals["kcal"] += row["kcal"] or 0.0
        totals["carbs_g"] += row["carbs_g"] or 0.0
        totals["fat_g"] += row["fat_g"] or 0.0
        totals["protein_g"] += row["protein_g"] or 0.0
        totals["caffeine_mg"] += row["caffeine_mg"] or 0.0

    days = sorted(day_index.values(), key=lambda d: d["date"])
    return days, totals


@calories_bp.get("/summary")
def calories_summary():
    date_from, date_to = _resolve_range()
    conn = _get_calories_conn()
    days, totals = _aggregate_summary(conn, date_from, date_to)
    return jsonify(
        {
            "range": {"date_from": date_from, "date_to": date_to},
            "days": days,
            "totals": totals,
            "types": sorted(ALLOWED_TYPES),
        }
    )


@calories_bp.get("/day/<date_value>")
def calories_day(date_value: str):
    day = _coerce_date(date_value)
    if not day:
        return jsonify({"ok": False, "error": "Ungültiges Datum"}), 400

    conn = _get_calories_conn()
    rows = conn.execute(
        """
        SELECT * FROM meal_entries
        WHERE date = ?
        ORDER BY COALESCE(timestamp, created_at) ASC, created_at ASC
        """,
        (day,),
    ).fetchall()
    return jsonify({"ok": True, "entries": [_serialize_entry(r) for r in rows]})


@calories_bp.delete("/entry/<int:entry_id>")
def delete_entry(entry_id: int):
    conn = _get_calories_conn()
    with conn:
        deleted = conn.execute("DELETE FROM meal_entries WHERE id = ?", (entry_id,))
        if deleted.rowcount == 0:
            return jsonify({"ok": False, "error": "Eintrag nicht gefunden"}), 404
    return jsonify({"ok": True})


def _extract_import_entries(payload: Any) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    batch_id = None
    entries_payload = payload
    if isinstance(payload, dict):
        entries_payload = payload.get("entries") or []
        batch_id = payload.get("import_batch_id")

    entries: List[Dict[str, Any]] = []
    if isinstance(entries_payload, list):
        for raw in entries_payload:
            if not isinstance(raw, dict):
                continue
            entries.append(raw)
    return entries, batch_id


@calories_bp.post("/import")
def import_entries():
    payload: Any
    batch_id: Optional[str] = None
    if request.files:
        uploaded = request.files.get("file")
        if not uploaded:
            return jsonify({"ok": False, "error": "Keine Datei übergeben"}), 400
        try:
            payload = json.load(uploaded.stream)
        except Exception:
            return jsonify({"ok": False, "error": "Upload ist keine gültige JSON-Datei"}), 400
        batch_id = request.form.get("import_batch_id") or None
    else:
        payload = request.get_json(silent=True) or {}

    entries, detected_batch_id = _extract_import_entries(payload)
    batch_id = batch_id or detected_batch_id or f"batch-{int(datetime.utcnow().timestamp())}"

    if not entries:
        return jsonify({"ok": False, "error": "Keine gültigen Einträge im Payload"}), 400

    conn = _get_calories_conn()
    inserted = 0
    with conn:
        for raw in entries:
            item_date = _coerce_date(raw.get("date")) or _today_str()
            ts = _coerce_timestamp(raw.get("timestamp"))
            entry = _normalize_item(
                raw,
                resolved_date=item_date,
                raw_text=raw.get("raw_text") or raw.get("name") or json.dumps(raw),
                timestamp=ts,
                llm_model=raw.get("llm_model"),
                status="import",
                source="upload",
            )
            entry["import_batch_id"] = raw.get("import_batch_id") or batch_id
            cursor = conn.execute(
                """
                INSERT INTO meal_entries (date, timestamp, raw_text, name, amount_g, kcal, carbs_g, fat_g, protein_g, caffeine_mg, type, status, source, llm_model, import_batch_id, created_at, updated_at)
                VALUES (:date, :timestamp, :raw_text, :name, :amount_g, :kcal, :carbs_g, :fat_g, :protein_g, :caffeine_mg, :type, :status, :source, :llm_model, :import_batch_id, :created_at, :updated_at)
                """,
                entry,
            )
            entry["id"] = cursor.lastrowid
            inserted += 1
    return jsonify({"ok": True, "inserted": inserted, "import_batch_id": batch_id})


@calories_bp.get("/imports")
def list_import_batches():
    limit = int(request.args.get("limit", 10))
    conn = _get_calories_conn()
    rows = conn.execute(
        """
        SELECT import_batch_id, COUNT(*) AS count, MIN(date) AS first_date, MAX(date) AS last_date, MAX(created_at) AS created_at
        FROM meal_entries
        WHERE status = 'import' AND import_batch_id IS NOT NULL
        GROUP BY import_batch_id
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (limit,),
    ).fetchall()
    return jsonify({"imports": [_serialize_entry(r) for r in rows]})


def _parse_timestamp(value: Any) -> datetime:
    ts = _coerce_timestamp(value)
    if ts:
        return datetime.fromisoformat(ts)
    return datetime.now(timezone.utc)


@vape_bp.post("")
def add_vape_entry():
    payload = request.get_json(silent=True) or {}
    if "counter" not in payload:
        return jsonify({"ok": False, "error": "counter ist erforderlich"}), 400
    try:
        counter = int(payload.get("counter"))
    except Exception:
        return jsonify({"ok": False, "error": "counter muss eine Zahl sein"}), 400

    ts = _parse_timestamp(payload.get("timestamp"))
    ts_iso = ts.isoformat()
    date_str = ts.date().isoformat()

    conn = _get_vape_conn()
    last = conn.execute(
        "SELECT * FROM vape_entries ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()

    last_counter = last["counter"] if last else None
    if last_counter is not None and counter >= last_counter:
        delta = counter - last_counter
        note = payload.get("note")
    else:
        delta = counter
        note = payload.get("note") or "coil_change"

    entry = {
        "date": date_str,
        "timestamp": ts_iso,
        "counter": counter,
        "delta": delta,
        "note": note,
        "created_at": _now_iso(),
    }

    with conn:
        cursor = conn.execute(
            """
            INSERT INTO vape_entries (date, timestamp, counter, delta, note, created_at)
            VALUES (:date, :timestamp, :counter, :delta, :note, :created_at)
            """,
            entry,
        )
        entry["id"] = cursor.lastrowid

    return jsonify({"ok": True, "entry": entry})


@vape_bp.get("/latest")
def latest_vape():
    conn = _get_vape_conn()
    row = conn.execute(
        "SELECT * FROM vape_entries ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()
    if not row:
        return jsonify({"ok": True, "latest": None})
    return jsonify({"ok": True, "latest": _serialize_entry(row)})


def _aggregate_vape_series(conn: sqlite3.Connection, date_from: str, date_to: str):
    rows = conn.execute(
        """
        SELECT date, SUM(delta) AS delta, SUM(CASE WHEN note = 'coil_change' THEN 1 ELSE 0 END) AS coil_changes
        FROM vape_entries
        WHERE date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date ASC
        """,
        (date_from, date_to),
    ).fetchall()

    days = []
    total = 0
    events: List[str] = []
    for row in rows:
        delta = row["delta"] or 0
        day = {"date": row["date"], "delta": delta, "coil_change": bool(row["coil_changes"])}
        days.append(day)
        total += delta
        if row["coil_changes"]:
            events.append(row["date"])

    average = total / len(days) if days else 0
    return days, total, average, events


@vape_bp.get("/series")
def vape_series():
    date_from, date_to = _resolve_range()
    conn = _get_vape_conn()
    days, total, average, events = _aggregate_vape_series(conn, date_from, date_to)
    latest_row = conn.execute(
        "SELECT * FROM vape_entries ORDER BY timestamp DESC LIMIT 1"
    ).fetchone()

    return jsonify(
        {
            "range": {"date_from": date_from, "date_to": date_to},
            "days": days,
            "total": total,
            "average": average,
            "events": events,
            "latest": _serialize_entry(latest_row) if latest_row else None,
        }
    )
