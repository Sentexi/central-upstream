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
            CREATE TABLE IF NOT EXISTS notion_rows_raw (
                id TEXT PRIMARY KEY,
                raw_json TEXT,
                last_edited_time TEXT,
                created_time TEXT,
                archived INTEGER,
                synced_at TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_rows (
                id TEXT PRIMARY KEY,
                last_edited_time TEXT,
                created_time TEXT,
                archived INTEGER,
                url TEXT
            )
            """
        )
        conn.commit()


def bulk_upsert(conn: sqlite3.Connection, table: str, rows: Iterable[tuple], sql: str):
    conn.executemany(sql, rows)
