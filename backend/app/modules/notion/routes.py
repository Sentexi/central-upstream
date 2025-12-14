import json
import sqlite3
from typing import Dict, List, Optional

from flask import Blueprint, current_app, jsonify, request

from .repository import NotionRepository
from .sync_manager import sync_manager

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


def _detect_done_statuses(repo: NotionRepository, status_col: Optional[str]) -> List[str]:
    if not status_col:
        return []

    keywords = ["done", "complete", "closed", "finished", "resolved", "erledigt"]

    with repo._connect() as conn:  # noqa: SLF001 - internal helper
        rows = conn.execute(
            f"SELECT DISTINCT {status_col} AS status FROM notion_rows WHERE {status_col} IS NOT NULL"
        ).fetchall()

    statuses = [str(row["status"]) for row in rows if row["status"] is not None]
    return [status for status in statuses if any(key in status.lower() for key in keywords)]


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


@bp.get("/stats")
def get_stats():
    repo = _get_repo()
    property_map = repo.get_property_map()
    status_col = _resolve_column(property_map, ["status"])
    workspace_col = _resolve_column(property_map, ["workspace", "area", "team"])
    completion_col = _resolve_column(
        property_map, ["completed_at", "done_at", "finished_at", "closed_at", "completed_on"]
    )
    completion_expr = completion_col or "last_edited_time"

    with repo._connect() as conn:  # noqa: SLF001 - internal helper
        done_statuses = _detect_done_statuses(repo, status_col)

        created_rows = conn.execute(
            """
            SELECT DATE(created_time) AS date, COUNT(*) AS created
            FROM notion_rows
            WHERE created_time IS NOT NULL
              AND created_time >= date('now', '-120 days')
            GROUP BY DATE(created_time)
            ORDER BY date
            """
        ).fetchall()

        completed_rows = []
        if status_col and done_statuses:
            placeholders = ",".join(["?"] * len(done_statuses))
            completed_rows = conn.execute(
                f"""
                SELECT DATE({completion_expr}) AS date, COUNT(*) AS completed
                FROM notion_rows
                WHERE {completion_expr} IS NOT NULL
                  AND {completion_expr} >= date('now', '-120 days')
                  AND {status_col} IN ({placeholders})
                GROUP BY DATE({completion_expr})
                ORDER BY date
                """,
                done_statuses,
            ).fetchall()

        weekly_incoming_rows = conn.execute(
            """
            SELECT strftime('%Y-W%W', created_time) AS period, COUNT(*) AS incoming
            FROM notion_rows
            WHERE created_time IS NOT NULL
              AND created_time >= date('now', '-180 days')
            GROUP BY strftime('%Y-%W', created_time)
            ORDER BY period
            """
        ).fetchall()

        weekly_completed_rows = []
        if status_col and done_statuses:
            placeholders = ",".join(["?"] * len(done_statuses))
            weekly_completed_rows = conn.execute(
                f"""
                SELECT strftime('%Y-W%W', {completion_expr}) AS period, COUNT(*) AS completed
                FROM notion_rows
                WHERE {completion_expr} IS NOT NULL
                  AND {completion_expr} >= date('now', '-180 days')
                  AND {status_col} IN ({placeholders})
                GROUP BY strftime('%Y-%W', {completion_expr})
                ORDER BY period
                """,
                done_statuses,
            ).fetchall()

        workspace_expr = f"COALESCE({workspace_col}, 'Unassigned')" if workspace_col else "'Unassigned'"
        where_clauses = ["archived = 0"]
        open_params = []
        if status_col and done_statuses:
            placeholders = ",".join(["?"] * len(done_statuses))
            where_clauses.append(f"({status_col} NOT IN ({placeholders}) OR {status_col} IS NULL)")
            open_params.extend(done_statuses)
        where_clause = " AND ".join(where_clauses)

        workspace_rows = conn.execute(
            f"""
            SELECT {workspace_expr} AS workspace, COUNT(*) AS count
            FROM notion_rows
            WHERE {where_clause}
            GROUP BY {workspace_expr}
            ORDER BY count DESC
            LIMIT 18
            """,
            open_params,
        ).fetchall()

        open_count_row = conn.execute(
            f"SELECT COUNT(*) AS cnt FROM notion_rows WHERE {where_clause}", open_params
        ).fetchone()

        completed_count = 0
        if status_col and done_statuses:
            placeholders = ",".join(["?"] * len(done_statuses))
            completed_count_row = conn.execute(
                f"SELECT COUNT(*) AS cnt FROM notion_rows WHERE {status_col} IN ({placeholders})",
                done_statuses,
            ).fetchone()
            completed_count = completed_count_row["cnt"] if completed_count_row else 0

        last7_incoming = conn.execute(
            """
            SELECT COUNT(*) AS cnt
            FROM notion_rows
            WHERE created_time IS NOT NULL
              AND created_time >= date('now', '-7 days')
            """
        ).fetchone()

        last7_completed = 0
        if status_col and done_statuses:
            placeholders = ",".join(["?"] * len(done_statuses))
            last7_completed_row = conn.execute(
                f"""
                SELECT COUNT(*) AS cnt
                FROM notion_rows
                WHERE {completion_expr} IS NOT NULL
                  AND {completion_expr} >= date('now', '-7 days')
                  AND {status_col} IN ({placeholders})
                """,
                done_statuses,
            ).fetchone()
            last7_completed = last7_completed_row["cnt"] if last7_completed_row else 0

        creation_heatmap_rows = conn.execute(
            """
            SELECT CAST(strftime('%w', created_time) AS INTEGER) AS weekday,
                   CAST(strftime('%H', created_time) AS INTEGER) AS hour,
                   COUNT(*) AS count
            FROM notion_rows
            WHERE created_time IS NOT NULL
              AND created_time >= date('now', '-120 days')
            GROUP BY CAST(strftime('%w', created_time) AS INTEGER),
                     CAST(strftime('%H', created_time) AS INTEGER)
            ORDER BY weekday, hour
            """
        ).fetchall()

        completion_heatmap_rows: List[sqlite3.Row] = []
        if status_col and done_statuses:
            placeholders = ",".join(["?"] * len(done_statuses))
            completion_heatmap_rows = conn.execute(
                f"""
                SELECT CAST(strftime('%w', {completion_expr}) AS INTEGER) AS weekday,
                       CAST(strftime('%H', {completion_expr}) AS INTEGER) AS hour,
                       COUNT(*) AS count
                FROM notion_rows
                WHERE {completion_expr} IS NOT NULL
                  AND {completion_expr} >= date('now', '-120 days')
                  AND {status_col} IN ({placeholders})
                GROUP BY CAST(strftime('%w', {completion_expr}) AS INTEGER),
                         CAST(strftime('%H', {completion_expr}) AS INTEGER)
                ORDER BY weekday, hour
                """,
                done_statuses,
            ).fetchall()

    daily_created_map = {row["date"]: row["created"] for row in created_rows}
    daily_completed_map = {row["date"]: row["completed"] for row in completed_rows}
    all_days = sorted(set(daily_created_map.keys()) | set(daily_completed_map.keys()))
    daily_flow = [
        {"date": day, "created": daily_created_map.get(day, 0), "completed": daily_completed_map.get(day, 0)}
        for day in all_days
    ]

    weekly_map: Dict[str, Dict[str, object]] = {}
    for row in weekly_incoming_rows:
        weekly_map[row["period"]] = {"period": row["period"], "incoming": row["incoming"], "completed": 0}
    for row in weekly_completed_rows:
        entry = weekly_map.setdefault(row["period"], {"period": row["period"], "incoming": 0, "completed": 0})
        entry["completed"] = row["completed"]
    weekly_flow = [
        {**entry, "net": int(entry.get("incoming", 0)) - int(entry.get("completed", 0))}
        for entry in sorted(weekly_map.values(), key=lambda item: item["period"])
    ]

    return jsonify(
        {
            "daily_flow": daily_flow,
            "weekly_flow": weekly_flow,
            "open_by_workspace": [
                {"workspace": row["workspace"], "count": row["count"]} for row in workspace_rows
            ],
            "summary": {
                "open": open_count_row["cnt"] if open_count_row else 0,
                "completed": completed_count,
                "incoming_last_7d": last7_incoming["cnt"] if last7_incoming else 0,
                "completed_last_7d": last7_completed,
            },
            "creation_heatmap": [
                {"weekday": row["weekday"], "hour": row["hour"], "count": row["count"]}
                for row in creation_heatmap_rows
            ],
            "completion_heatmap": [
                {"weekday": row["weekday"], "hour": row["hour"], "count": row["count"]}
                for row in completion_heatmap_rows
            ],
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
    data = request.get_json(silent=True) or {}
    force_full = bool(data.get("force_full"))
    status = sync_manager.start_sync(force_full=force_full)
    return jsonify(status), 202


@bp.get("/sync/status")
def sync_status():
    status = sync_manager.get_status()
    return jsonify(status)
