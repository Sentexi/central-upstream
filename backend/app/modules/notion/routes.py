import json
from flask import Blueprint, jsonify, request, current_app

from .repository import NotionRepository
from .sync import run_full_sync

bp = Blueprint("notion", __name__)


def _get_repo() -> NotionRepository:
    db_path = current_app.config.get("NOTION_DB_PATH")
    if not db_path:
        raise RuntimeError("NOTION_DB_PATH fehlt")
    return NotionRepository(db_path)


@bp.get("/columns")
def list_columns():
    repo = _get_repo()
    property_map = repo.get_property_map()
    columns = [
        {"key": entry.get("column"), "label": name, "type": entry.get("type")}
        for name, entry in property_map.items()
    ]
    return jsonify(columns)


@bp.get("/rows")
def list_rows():
    repo = _get_repo()
    args = request.args
    q = args.get("q")
    filters_raw = args.get("filters")
    sort = args.get("sort")
    limit = int(args.get("limit", 50))
    offset = int(args.get("offset", 0))

    filters = {}
    if filters_raw:
        try:
            filters = json.loads(filters_raw)
        except json.JSONDecodeError:
            filters = {}

    property_map = repo.get_property_map()
    rows, total = repo.query_rows(property_map, q=q, filters=filters, sort=sort, limit=limit, offset=offset)
    return jsonify({"items": rows, "total": total, "limit": limit, "offset": offset})


@bp.post("/sync")
def trigger_sync():
    result = run_full_sync()
    status = 200 if result.get("ok") else 500
    return jsonify(result), status


@bp.post("/sync/full")
def trigger_full_sync():
    return trigger_sync()
