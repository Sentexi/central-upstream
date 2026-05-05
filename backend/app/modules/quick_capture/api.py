import os
import sqlite3
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request

bp = Blueprint("quick_capture", __name__)


def _db_path() -> str:
    explicit = current_app.config.get("QUICK_CAPTURE_DB_PATH")
    if explicit:
        return explicit
    base = os.path.join(current_app.root_path, "data", "quick_capture")
    os.makedirs(base, exist_ok=True)
    return os.path.join(base, "tasks.sqlite")


def _connect() -> sqlite3.Connection:
    path = _db_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_schema(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def _serialize(row: sqlite3.Row) -> dict:
    return {"id": row["id"], "text": row["text"], "created_at": row["created_at"]}


@bp.get("/tasks")
def list_tasks():
    with _connect() as conn:
        _ensure_schema(conn)
        rows = conn.execute(
            "SELECT id, text, created_at FROM tasks ORDER BY id ASC"
        ).fetchall()
    return jsonify([_serialize(row) for row in rows])


@bp.post("/tasks")
def add_task():
    data = request.get_json(silent=True) or {}
    text = str(data.get("text", "")).strip()
    if not text:
        return {"error": "text is required"}, 400

    if len(text) > 4000:
        return {"error": "text too long"}, 400

    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    with _connect() as conn:
        _ensure_schema(conn)
        cursor = conn.execute(
            "INSERT INTO tasks (text, created_at) VALUES (?, ?)",
            (text, created_at),
        )
        conn.commit()
        new_id = cursor.lastrowid

    return {"id": new_id, "text": text, "created_at": created_at}, 201
