import json
from typing import Dict, List, Optional

from flask import Blueprint, current_app, jsonify, request

from .repository import NotionRepository
from .sync import run_full_sync

bp = Blueprint("notion", __name__)


def _get_repo() -> NotionRepository:
    db_path = current_app.config.get("NOTION_DB_PATH")
    if not db_path:
        raise RuntimeError("NOTION_DB_PATH fehlt")
    return NotionRepository(db_path)


def _resolve_column(property_map: Dict[str, Dict[str, str]], candidates: List[str]) -> Optional[str]:
    """Find a column name for one of the expected logical fields.

    The Notion property map stores both the original property label and the generated column
    name. We try to match by the normalized property label as well as by the generated column
    name so that custom property names (e.g. "Due date" vs. "due_date") still resolve.
    """

    normalized_candidates = {c.strip().lower().replace(" ", "_") for c in candidates}

    for label, meta in property_map.items():
        normalized_label = label.strip().lower().replace(" ", "_")
        column = (meta.get("column") or "").strip()
        if not column:
            continue

        if column in normalized_candidates or normalized_label in normalized_candidates:
            return column

    for candidate in normalized_candidates:
        if candidate in {"id", "url", "archived", "created_time", "last_edited_time"}:
            return candidate

    return None


def _build_filters(args, property_map: Dict[str, Dict[str, str]]):
    filters: Dict[str, object] = {}

    status_col = _resolve_column(property_map, ["status"])
    if status_col:
        status_raw = args.get("status")
        if status_raw:
            filters[status_col] = status_raw.split(",")

    project_col = _resolve_column(property_map, ["project"])
    if project_col and args.get("project"):
        filters[project_col] = args.get("project")

    area_col = _resolve_column(property_map, ["area"])
    if area_col and args.get("area"):
        filters[area_col] = args.get("area")

    if args.get("archived"):
        filters["archived"] = 1

    return filters


def _build_sort(sort: Optional[str], property_map: Dict[str, Dict[str, str]]) -> Optional[str]:
    if not sort:
        return None

    sort_map = {
        "due_date_asc": "due_date:asc",
        "due_date_desc": "due_date:desc",
        "last_edited_desc": "last_edited_time:desc",
        "title_asc": "title:asc",
    }

    translated = sort_map.get(sort)
    if not translated:
        return None

    key, direction = translated.split(":", 1)
    column = _resolve_column(property_map, [key])
    if not column:
        return None

    return f"{column}:{direction}"


def _task_from_row(row: Dict[str, object], property_map: Dict[str, Dict[str, str]]) -> Dict[str, object]:
    def col(label: str) -> Optional[str]:
        return _resolve_column(property_map, [label]) or label

    return {
        "id": row.get("id"),
        "title": row.get(col("title")) or "",
        "status": row.get(col("status")),
        "due_date": row.get(col("due_date")),
        "project": row.get(col("project")),
        "area": row.get(col("area")),
        "priority": row.get(col("priority")),
        "assignee": row.get(col("assignee")),
        "tags_json": row.get(col("tags")) or row.get(col("tags_json")),
        "url": row.get(col("url")),
        "archived": row.get("archived", 0),
        "created_time": row.get("created_time"),
        "last_edited_time": row.get("last_edited_time"),
    }


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


@bp.get("/filters")
def list_filters():
    repo = _get_repo()
    property_map = repo.get_property_map()

    def distinct(column: Optional[str]) -> List[str]:
        if not column:
            return []
        with repo._connect() as conn:  # noqa: SLF001 - lightweight internal helper
            rows = conn.execute(
                f"SELECT DISTINCT {column} as val FROM notion_rows WHERE {column} IS NOT NULL AND {column} != ''"
            ).fetchall()
        return sorted([row["val"] for row in rows if row["val"] is not None])

    status_col = _resolve_column(property_map, ["status"])
    project_col = _resolve_column(property_map, ["project"])
    area_col = _resolve_column(property_map, ["area"])

    return jsonify(
        {
            "statuses": distinct(status_col),
            "projects": distinct(project_col),
            "areas": distinct(area_col),
        }
    )


@bp.get("/todos")
def list_todos():
    repo = _get_repo()
    args = request.args
    q = args.get("q")
    limit = int(args.get("limit", 50))
    offset = int(args.get("offset", 0))
    property_map = repo.get_property_map()

    filters = _build_filters(args, property_map)
    sort = _build_sort(args.get("sort"), property_map)

    rows, total = repo.query_rows(property_map, q=q, filters=filters, sort=sort, limit=limit, offset=offset)
    items = [_task_from_row(row, property_map) for row in rows]
    return jsonify({"items": items, "total": total, "limit": limit, "offset": offset})


@bp.post("/sync")
def trigger_sync():
    result = run_full_sync()
    status = 200 if result.get("ok") else 500
    return jsonify(result), status


@bp.post("/sync/full")
def trigger_full_sync():
    return trigger_sync()
