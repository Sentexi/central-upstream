import json
import os
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from .schema import ensure_schema


class NotionRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        ensure_schema(self.db_path)

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # Meta helpers
    def get_meta(self, key: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM notion_meta WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None

    def set_meta(self, key: str, value: str):
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO notion_meta (key, value) VALUES (?, ?)", (key, value)
            )
            conn.commit()

    def get_all_meta(self) -> Dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT key, value FROM notion_meta").fetchall()
        return {row["key"]: row["value"] for row in rows}

    # Raw pages
    def upsert_page_raw(
        self,
        page_id: str,
        database_id: str,
        raw_json: dict,
        last_edited_time: str,
        created_time: str,
        archived: bool,
        synced_at: str,
    ):
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO notion_pages_raw
                (id, database_id, raw_json, last_edited_time, created_time, archived, synced_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    page_id,
                    database_id,
                    json.dumps(raw_json),
                    last_edited_time,
                    created_time,
                    int(archived),
                    synced_at,
                ),
            )
            conn.commit()

    def upsert_task(self, task: Dict[str, Any]):
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO notion_tasks
                (id, database_id, title, status, due_date, project, area, priority, assignee, tags_json, url, archived, created_time, last_edited_time, content_hash)
                VALUES (:id, :database_id, :title, :status, :due_date, :project, :area, :priority, :assignee, :tags_json, :url, :archived, :created_time, :last_edited_time, :content_hash)
                """,
                task,
            )
            conn.commit()

    def query_tasks(
        self,
        q: Optional[str] = None,
        status: Optional[List[str]] = None,
        project: Optional[str] = None,
        area: Optional[str] = None,
        due_from: Optional[str] = None,
        due_to: Optional[str] = None,
        archived: bool = False,
        sort: str = "due_date_asc",
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        where = ["archived = ?"]
        params: List[Any] = [int(archived)]

        if q:
            where.append("(title LIKE ? OR project LIKE ? OR area LIKE ?)")
            like = f"%{q}%"
            params.extend([like, like, like])
        if status:
            placeholders = ",".join(["?"] * len(status))
            where.append(f"status IN ({placeholders})")
            params.extend(status)
        if project:
            where.append("project = ?")
            params.append(project)
        if area:
            where.append("area = ?")
            params.append(area)
        if due_from:
            where.append("due_date >= ?")
            params.append(due_from)
        if due_to:
            where.append("due_date <= ?")
            params.append(due_to)

        order_by = "due_date ASC"
        if sort == "last_edited_desc":
            order_by = "last_edited_time DESC"
        elif sort == "due_date_desc":
            order_by = "due_date DESC"
        elif sort == "title_asc":
            order_by = "title COLLATE NOCASE ASC"

        where_clause = " AND ".join(where)
        sql = f"SELECT * FROM notion_tasks WHERE {where_clause} ORDER BY {order_by} LIMIT ? OFFSET ?"
        params_with_limit = params + [limit, offset]

        count_sql = f"SELECT COUNT(*) as cnt FROM notion_tasks WHERE {where_clause}"

        with self._connect() as conn:
            rows = conn.execute(sql, params_with_limit).fetchall()
            total_row = conn.execute(count_sql, params).fetchone()
            total = total_row["cnt"] if total_row else 0

        items = [dict(row) for row in rows]
        return items, total

    def get_filter_values(self) -> Dict[str, List[str]]:
        with self._connect() as conn:
            statuses = [row[0] for row in conn.execute("SELECT DISTINCT status FROM notion_tasks WHERE status IS NOT NULL AND status != '' ORDER BY status").fetchall()]
            projects = [row[0] for row in conn.execute("SELECT DISTINCT project FROM notion_tasks WHERE project IS NOT NULL AND project != '' ORDER BY project").fetchall()]
            areas = [row[0] for row in conn.execute("SELECT DISTINCT area FROM notion_tasks WHERE area IS NOT NULL AND area != '' ORDER BY area").fetchall()]
        return {"statuses": statuses, "projects": projects, "areas": areas}

