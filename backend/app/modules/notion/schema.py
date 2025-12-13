import sqlite3
from typing import Iterable


def ensure_schema(db_path: str):
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_pages_raw (
                id TEXT PRIMARY KEY,
                database_id TEXT,
                raw_json TEXT,
                last_edited_time TEXT,
                created_time TEXT,
                archived INTEGER,
                synced_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_pages_raw_last_edited_time ON notion_pages_raw(last_edited_time)"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_tasks (
                id TEXT PRIMARY KEY,
                database_id TEXT,
                title TEXT,
                status TEXT,
                due_date TEXT,
                project TEXT,
                area TEXT,
                priority TEXT,
                assignee TEXT,
                tags_json TEXT,
                url TEXT,
                archived INTEGER,
                created_time TEXT,
                last_edited_time TEXT,
                content_hash TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_status ON notion_tasks(status)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON notion_tasks(due_date)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_last_edited_time ON notion_tasks(last_edited_time)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_project ON notion_tasks(project)"
        )
        conn.commit()


def bulk_upsert(conn: sqlite3.Connection, table: str, rows: Iterable[tuple], sql: str):
    conn.executemany(sql, rows)
