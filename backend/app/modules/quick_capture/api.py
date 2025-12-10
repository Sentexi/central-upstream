from datetime import datetime
from flask import Blueprint, jsonify, request

bp = Blueprint("quick_capture", __name__)

_TASKS = []


@bp.get("/tasks")
def list_tasks():
    return jsonify(_TASKS)


@bp.post("/tasks")
def add_task():
    data = request.get_json() or {}
    text = data.get("text", "").strip()
    if not text:
        return {"error": "text is required"}, 400

    task = {
        "id": len(_TASKS) + 1,
        "text": text,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    _TASKS.append(task)
    return task, 201
