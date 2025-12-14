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

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_relations (
                from_page_id TEXT NOT NULL,
                property_name TEXT NOT NULL,
                property_value TEXT,
                to_page_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                value TEXT,
                PRIMARY KEY (from_page_id, property_name, to_page_id)
            )
            """
        )
        existing_columns = [row["name"] for row in conn.execute("PRAGMA table_info(notion_relations)")]
        if "property_value" not in existing_columns:
            conn.execute("ALTER TABLE notion_relations ADD COLUMN property_value TEXT")
        if "value" not in existing_columns:
            conn.execute("ALTER TABLE notion_relations ADD COLUMN value TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notion_relations_from ON notion_relations(from_page_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notion_relations_to ON notion_relations(to_page_id)"
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_page_cache (
                id TEXT PRIMARY KEY,
                title TEXT,
                url TEXT,
                last_edited_time TEXT,
                raw_json TEXT,
                synced_at TEXT
            )
            """
        )
        conn.commit()


def bulk_upsert(conn: sqlite3.Connection, table: str, rows: Iterable[tuple], sql: str):
    conn.executemany(sql, rows)
