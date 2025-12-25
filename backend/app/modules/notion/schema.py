import sqlite3
from typing import Iterable


def ensure_schema(db_path: str):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
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

        existing_relation_columns = [
            row["name"] for row in conn.execute("PRAGMA table_info(notion_relations)")
        ]
        if existing_relation_columns and "from_page_id" in existing_relation_columns:
            conn.execute("ALTER TABLE notion_relations RENAME TO notion_page_relations")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_page_relations (
                from_page_id TEXT NOT NULL,
                property_name TEXT NOT NULL,
                property_value TEXT,
                to_page_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (from_page_id, property_name, to_page_id)
            )
            """
        )
        existing_page_relation_columns = [
            row["name"] for row in conn.execute("PRAGMA table_info(notion_page_relations)")
        ]
        if "property_value" not in existing_page_relation_columns:
            conn.execute("ALTER TABLE notion_page_relations ADD COLUMN property_value TEXT")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS notion_relations (
                to_page_id TEXT PRIMARY KEY,
                value TEXT,
                synced_at TEXT
            )
            """
        )
        existing_relation_cache_columns = [
            row["name"] for row in conn.execute("PRAGMA table_info(notion_relations)")
        ]
        if "value" not in existing_relation_cache_columns:
            conn.execute("ALTER TABLE notion_relations ADD COLUMN value TEXT")
        if "synced_at" not in existing_relation_cache_columns:
            conn.execute("ALTER TABLE notion_relations ADD COLUMN synced_at TEXT")

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notion_page_relations_from ON notion_page_relations(from_page_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_notion_page_relations_to ON notion_page_relations(to_page_id)"
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
