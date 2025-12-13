from flask import Blueprint, jsonify, request

from .repository import NotionRepository
from .sync import sync_notion_database
from flask import current_app

bp = Blueprint("notion", __name__)


def _get_repo() -> NotionRepository:
    db_path = current_app.config.get("NOTION_DB_PATH")
    if not db_path:
        raise RuntimeError("NOTION_DB_PATH fehlt")
    return NotionRepository(db_path)


@bp.get("/todos")
def list_todos():
    repo = _get_repo()
    args = request.args
    q = args.get("q")
    status = args.get("status")
    status_list = status.split(",") if status else None
    project = args.get("project") or None
    area = args.get("area") or None
    due_from = args.get("due_from") or None
    due_to = args.get("due_to") or None
    archived = args.get("archived", "0") == "1"
    sort = args.get("sort", "due_date_asc")
    limit = int(args.get("limit", 50))
    offset = int(args.get("offset", 0))

    items, total = repo.query_tasks(
        q=q,
        status=status_list,
        project=project,
        area=area,
        due_from=due_from,
        due_to=due_to,
        archived=archived,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    return jsonify({"items": items, "total": total, "limit": limit, "offset": offset})


@bp.get("/filters")
def get_filters():
    repo = _get_repo()
    filters = repo.get_filter_values()
    return jsonify(filters)


@bp.post("/sync")
def trigger_sync():
    payload = request.get_json(silent=True) or {}
    force_full = bool(payload.get("force_full", False))
    result = sync_notion_database(force_full=force_full)
    status = 200 if result.get("ok") else 500
    return jsonify(result), status

