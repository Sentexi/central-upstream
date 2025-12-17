from __future__ import annotations

import json
import os
import re
import sqlite3
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional


@dataclass
class NormalizedRecord:
    """A normalized entry from the Auto Export payload."""

    data_type: str
    start_ts: int
    end_ts: int
    payload: Dict


class HealthRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path
        directory = os.path.dirname(self.db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._ensure_metadata_table()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_metadata_table(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS health_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def _table_name_for_type(self, data_type: str) -> str:
        slug = re.sub(r"[^a-z0-9_]+", "_", data_type.lower())
        if not slug:
            slug = "generic"
        return f"health_{slug}"

    def _ensure_table(self, conn: sqlite3.Connection, table_name: str):
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_ts INTEGER NOT NULL,
                end_ts INTEGER NOT NULL,
                batch_ts INTEGER NOT NULL,
                payload TEXT NOT NULL
            )
            """
        )

    def ingest_records(
        self,
        records: List[NormalizedRecord],
        batch_ts: int,
        progress_callback: Optional[Callable[[int], None]] = None,
    ):
        stats: Dict[str, Dict[str, int]] = {}
        inserted = 0
        skipped = 0
        processed = 0

        with self._connect() as conn:
            for record in records:
                table_name = self._table_name_for_type(record.data_type)
                self._ensure_table(conn, table_name)
                was_inserted = self._upsert_record(conn, table_name, record, batch_ts)
                processed += 1
                if progress_callback:
                    progress_callback(processed)

                bucket = stats.setdefault(record.data_type, {"inserted": 0, "skipped": 0})
                if was_inserted:
                    inserted += 1
                    bucket["inserted"] += 1
                else:
                    skipped += 1
                    bucket["skipped"] += 1

            self._set_last_import(conn, batch_ts)
            conn.commit()

        return {"inserted": inserted, "skipped": skipped, "by_type": stats}

    def _upsert_record(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        record: NormalizedRecord,
        batch_ts: int,
    ) -> bool:
        """Insert or skip a record depending on overlap and batch recency."""

        overlapping = conn.execute(
            f"SELECT id, batch_ts FROM {table_name} WHERE start_ts < ? AND end_ts > ?",
            (record.end_ts, record.start_ts),
        ).fetchall()

        if overlapping:
            newest_existing = max(row["batch_ts"] for row in overlapping)
            if newest_existing > batch_ts:
                return False

            conn.execute(
                f"DELETE FROM {table_name} WHERE start_ts < ? AND end_ts > ?",
                (record.end_ts, record.start_ts),
            )

        conn.execute(
            f"INSERT INTO {table_name} (start_ts, end_ts, batch_ts, payload) VALUES (?, ?, ?, ?)",
            (record.start_ts, record.end_ts, batch_ts, json.dumps(record.payload)),
        )
        return True

    def _set_last_import(self, conn: sqlite3.Connection, batch_ts: int):
        conn.execute(
            "INSERT OR REPLACE INTO health_metadata (key, value) VALUES (?, ?)",
            ("last_import_ts", str(batch_ts)),
        )

    def get_last_import_iso(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM health_metadata WHERE key = ?", ("last_import_ts",)
            ).fetchone()

        if not row:
            return None

        ts = int(row["value"])
        return _timestamp_to_iso(ts)


def _timestamp_to_iso(ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
