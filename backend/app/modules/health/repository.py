from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from statistics import median
from typing import Callable, Dict, List, Optional, Set, Tuple


@dataclass
class NormalizedRecord:
    """A normalized entry from the Auto Export payload."""

    data_type: str
    start_ts: int
    end_ts: int
    payload: Dict


class SyncBusyError(Exception):
    """Raised when a sync is already in progress and not stale."""

    def __init__(self, status: Dict):
        super().__init__("Health sync already in progress")
        self.status = status


SYNC_STATES_BUSY = ("normalizing", "ingesting")
SYNC_STATES_FINAL = ("done", "error")
DEFAULT_STALE_AFTER_SECONDS = 3600
PROGRESS_FLUSH_INTERVAL = 100
LEGACY_LOCK_FILENAME = "health.lock"
LEGACY_SYNC_STATUS_FILENAME = "sync_status.json"


class HealthRepository:
    API_KEY_TABLE = "health_api_keys"
    DEFAULT_API_KEY_NAME = "X-API-Key"
    SYNC_STATE_TABLE = "health_sync_state"
    SYNC_HISTORY_TABLE = "health_sync_history"

    def __init__(self, db_path: str, table_schemas: Optional[Dict[str, List[str]]] = None):
        self.db_path = db_path
        directory = os.path.dirname(self.db_path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        self._ensure_metadata_table()
        self._ensure_api_key_table()
        self._ensure_sync_state_table()
        self._ensure_sync_history_table()
        self._migrate_legacy_lock_files()
        self._summary_cache: Dict[Tuple[str, str], List[dict]] = {}
        self._fitness_cache: Dict[Tuple[str, str], List[dict]] = {}
        self._fitness_weekly_cache: Dict[Tuple[str, str], List[dict]] = {}
        self._provided_schemas: Optional[Dict[str, set[str]]] = None
        self._indexes_ready: Set[str] = set()
        if table_schemas:
            self._provided_schemas = {
                table: {self._sanitize_column_name(column) for column in columns}
                for table, columns in table_schemas.items()
                if isinstance(columns, (list, tuple, set))
            }

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

    def _ensure_api_key_table(self):
        with self._connect() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.API_KEY_TABLE} (
                    name TEXT PRIMARY KEY,
                    api_key TEXT NOT NULL
                )
                """
            )
            row = conn.execute(
                f"SELECT name, api_key FROM {self.API_KEY_TABLE} LIMIT 1"
            ).fetchone()
            if row is None:
                api_key = secrets.token_urlsafe(32)
                conn.execute(
                    f"INSERT INTO {self.API_KEY_TABLE} (name, api_key) VALUES (?, ?)",
                    (self.DEFAULT_API_KEY_NAME, api_key),
                )
            conn.commit()

    def get_ingest_api_key(self) -> tuple[str, str]:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT name, api_key FROM {self.API_KEY_TABLE} LIMIT 1"
            ).fetchone()
            if row is None:
                api_key = secrets.token_urlsafe(32)
                name = self.DEFAULT_API_KEY_NAME
                conn.execute(
                    f"INSERT INTO {self.API_KEY_TABLE} (name, api_key) VALUES (?, ?)",
                    (name, api_key),
                )
                conn.commit()
                return name, api_key
            return str(row["name"]), str(row["api_key"])

    def rotate_ingest_api_key(self) -> tuple[str, str]:
        api_key = secrets.token_urlsafe(32)
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT name FROM {self.API_KEY_TABLE} LIMIT 1"
            ).fetchone()
            name = str(row["name"]) if row else self.DEFAULT_API_KEY_NAME
            conn.execute(f"DELETE FROM {self.API_KEY_TABLE}")
            conn.execute(
                f"INSERT INTO {self.API_KEY_TABLE} (name, api_key) VALUES (?, ?)",
                (name, api_key),
            )
            conn.commit()
        return name, api_key

    def _ensure_sync_state_table(self):
        with self._connect() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.SYNC_STATE_TABLE} (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    state TEXT NOT NULL,
                    pid INTEGER,
                    started_at TEXT,
                    finished_at TEXT,
                    total_records INTEGER NOT NULL DEFAULT 0,
                    processed_records INTEGER NOT NULL DEFAULT 0,
                    batch_timestamp INTEGER,
                    last_error TEXT,
                    last_completed_at TEXT,
                    client TEXT
                )
                """
            )
            conn.execute(
                f"INSERT OR IGNORE INTO {self.SYNC_STATE_TABLE} (id, state) VALUES (1, 'idle')"
            )
            row = conn.execute(
                f"SELECT last_completed_at FROM {self.SYNC_STATE_TABLE} WHERE id = 1"
            ).fetchone()
            if row is not None and row["last_completed_at"] is None:
                legacy_row = conn.execute(
                    "SELECT value FROM health_metadata WHERE key = 'last_import_ts'"
                ).fetchone()
                if legacy_row is not None:
                    try:
                        legacy_ts = int(legacy_row["value"])
                    except (TypeError, ValueError):
                        legacy_ts = None
                    if legacy_ts is not None:
                        conn.execute(
                            f"UPDATE {self.SYNC_STATE_TABLE} SET last_completed_at = ? WHERE id = 1",
                            (_timestamp_to_iso(legacy_ts),),
                        )
            conn.commit()

    def _ensure_sync_history_table(self):
        with self._connect() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self.SYNC_HISTORY_TABLE} (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    batch_timestamp INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT NOT NULL,
                    final_state TEXT NOT NULL,
                    total_records INTEGER NOT NULL,
                    processed_records INTEGER NOT NULL,
                    inserted INTEGER,
                    skipped INTEGER,
                    last_error TEXT,
                    client TEXT
                )
                """
            )
            conn.execute(
                f"CREATE INDEX IF NOT EXISTS idx_health_sync_history_started_at "
                f"ON {self.SYNC_HISTORY_TABLE}(started_at DESC)"
            )
            conn.commit()

    def _migrate_legacy_lock_files(self):
        directory = os.path.dirname(self.db_path) or "."
        lock_path = os.path.join(directory, LEGACY_LOCK_FILENAME)
        status_path = os.path.join(directory, LEGACY_SYNC_STATUS_FILENAME)
        current_dir = os.path.join(directory, "current")
        archive_dir = os.path.join(directory, "payloads")

        legacy_started_at: Optional[str] = None
        legacy_total = 0
        legacy_processed = 0
        legacy_batch_ts: Optional[int] = None

        if os.path.exists(lock_path):
            try:
                with open(lock_path, "r", encoding="utf-8") as fh:
                    legacy_started_at = fh.read().strip() or None
            except OSError:
                legacy_started_at = None

        if os.path.exists(status_path):
            try:
                with open(status_path, "r", encoding="utf-8") as fh:
                    status_data = json.load(fh)
                if isinstance(status_data, dict):
                    legacy_total = int(status_data.get("total_records") or 0)
                    legacy_processed = int(status_data.get("processed_records") or 0)
                    raw_batch = status_data.get("batch_timestamp")
                    if raw_batch is not None:
                        try:
                            legacy_batch_ts = int(raw_batch)
                        except (TypeError, ValueError):
                            legacy_batch_ts = None
            except (OSError, json.JSONDecodeError, ValueError):
                pass

        if not (os.path.exists(lock_path) or os.path.exists(status_path)):
            return

        finished_iso = _now_iso()
        if legacy_started_at is None:
            legacy_started_at = finished_iso
        if legacy_batch_ts is None:
            try:
                legacy_batch_ts = int(datetime.fromisoformat(
                    legacy_started_at.replace("Z", "+00:00")
                ).timestamp())
            except (TypeError, ValueError):
                legacy_batch_ts = int(datetime.now(tz=timezone.utc).timestamp())

        with self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self.SYNC_HISTORY_TABLE}
                    (batch_timestamp, started_at, finished_at, final_state,
                     total_records, processed_records, inserted, skipped,
                     last_error, client)
                VALUES (?, ?, ?, 'aborted', ?, ?, NULL, NULL, ?, NULL)
                """,
                (
                    legacy_batch_ts,
                    legacy_started_at,
                    finished_iso,
                    legacy_total,
                    legacy_processed,
                    "migrated from legacy lock file at deployment",
                ),
            )
            conn.commit()

        if os.path.isdir(current_dir):
            os.makedirs(archive_dir, exist_ok=True)
            for entry in os.listdir(current_dir):
                source = os.path.join(current_dir, entry)
                if not os.path.isfile(source):
                    continue
                target = os.path.join(archive_dir, entry)
                name, ext = os.path.splitext(entry)
                suffix = 1
                while os.path.exists(target):
                    target = os.path.join(archive_dir, f"{name}_{suffix}{ext}")
                    suffix += 1
                try:
                    os.replace(source, target)
                except OSError:
                    pass

        for path in (lock_path, status_path):
            try:
                os.remove(path)
            except FileNotFoundError:
                pass
            except OSError:
                pass

    @staticmethod
    def _stale_after_seconds() -> int:
        raw = os.getenv("HEALTH_SYNC_STALE_AFTER_SECONDS")
        if raw is None:
            return DEFAULT_STALE_AFTER_SECONDS
        try:
            value = int(raw)
        except ValueError:
            return DEFAULT_STALE_AFTER_SECONDS
        return max(60, value)

    @staticmethod
    def _pid_alive(pid: Optional[int]) -> bool:
        if pid is None or pid <= 0:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return False
        return True

    def _row_to_sync_state(self, row: Optional[sqlite3.Row]) -> Dict:
        if row is None:
            return {
                "state": "idle",
                "pid": None,
                "started_at": None,
                "finished_at": None,
                "total_records": 0,
                "processed_records": 0,
                "batch_timestamp": None,
                "last_error": None,
                "last_completed_at": None,
                "client": None,
            }
        return {
            "state": row["state"],
            "pid": row["pid"],
            "started_at": row["started_at"],
            "finished_at": row["finished_at"],
            "total_records": row["total_records"] or 0,
            "processed_records": row["processed_records"] or 0,
            "batch_timestamp": row["batch_timestamp"],
            "last_error": row["last_error"],
            "last_completed_at": row["last_completed_at"],
            "client": row["client"],
        }

    def _is_stale(self, state_row: Dict) -> Optional[str]:
        if state_row["state"] not in SYNC_STATES_BUSY:
            return None
        pid = state_row.get("pid")
        if pid is not None and not self._pid_alive(pid):
            return "process gone"
        started_at = state_row.get("started_at")
        if not started_at:
            return None
        try:
            started_dt = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        except ValueError:
            return None
        if started_dt.tzinfo is None:
            started_dt = started_dt.replace(tzinfo=timezone.utc)
        age = (datetime.now(tz=timezone.utc) - started_dt).total_seconds()
        if age > self._stale_after_seconds():
            return "timeout"
        return None

    def _write_history_row(
        self,
        conn: sqlite3.Connection,
        state_row: Dict,
        final_state: str,
        last_error: Optional[str],
        finished_at: str,
        inserted: Optional[int] = None,
        skipped: Optional[int] = None,
    ):
        batch_ts = state_row.get("batch_timestamp")
        if batch_ts is None:
            batch_ts = int(datetime.now(tz=timezone.utc).timestamp())
        started_at = state_row.get("started_at") or finished_at
        conn.execute(
            f"""
            INSERT INTO {self.SYNC_HISTORY_TABLE}
                (batch_timestamp, started_at, finished_at, final_state,
                 total_records, processed_records, inserted, skipped,
                 last_error, client)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                batch_ts,
                started_at,
                finished_at,
                final_state,
                state_row.get("total_records") or 0,
                state_row.get("processed_records") or 0,
                inserted,
                skipped,
                last_error,
                state_row.get("client"),
            ),
        )

    def _archive_current_payloads(self):
        directory = os.path.dirname(self.db_path) or "."
        current_dir = os.path.join(directory, "current")
        if not os.path.isdir(current_dir):
            return
        archive_dir = os.path.join(directory, "payloads")
        os.makedirs(archive_dir, exist_ok=True)
        for entry in os.listdir(current_dir):
            source = os.path.join(current_dir, entry)
            if not os.path.isfile(source):
                continue
            target = os.path.join(archive_dir, entry)
            name, ext = os.path.splitext(entry)
            suffix = 1
            while os.path.exists(target):
                target = os.path.join(archive_dir, f"{name}_{suffix}{ext}")
                suffix += 1
            try:
                os.replace(source, target)
            except OSError:
                pass

    def acquire_sync_slot(self, client: str, batch_timestamp: int, force: bool = False):
        """Reserve the sync slot atomically.

        Raises SyncBusyError if a non stale sync is already running.
        On success the state row is set to 'normalizing' with fresh counters.
        """

        now_iso = _now_iso()
        pid = os.getpid()
        conn = self._connect()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM {self.SYNC_STATE_TABLE} WHERE id = 1"
            ).fetchone()
            current = self._row_to_sync_state(row)

            if current["state"] in SYNC_STATES_BUSY:
                stale_reason: Optional[str] = None
                if force:
                    stale_reason = "manual force clear"
                else:
                    stale_reason = self._is_stale(current)
                if stale_reason is None:
                    conn.execute("ROLLBACK")
                    raise SyncBusyError(current)
                self._write_history_row(
                    conn,
                    current,
                    final_state="aborted",
                    last_error=stale_reason,
                    finished_at=now_iso,
                )
                self._archive_current_payloads()

            conn.execute(
                f"""
                UPDATE {self.SYNC_STATE_TABLE}
                   SET state = 'normalizing',
                       pid = ?,
                       started_at = ?,
                       finished_at = NULL,
                       total_records = 0,
                       processed_records = 0,
                       batch_timestamp = ?,
                       last_error = NULL,
                       client = ?
                 WHERE id = 1
                """,
                (pid, now_iso, batch_timestamp, client),
            )
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.close()

    def start_ingesting(self, total_records: int):
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self.SYNC_STATE_TABLE}
                   SET state = 'ingesting',
                       total_records = ?,
                       processed_records = 0
                 WHERE id = 1
                """,
                (total_records,),
            )
            conn.commit()

    def update_sync_progress(self, processed_records: int):
        with self._connect() as conn:
            conn.execute(
                f"""
                UPDATE {self.SYNC_STATE_TABLE}
                   SET processed_records = ?
                 WHERE id = 1
                """,
                (processed_records,),
            )
            conn.commit()

    def complete_sync_slot(
        self,
        final_state: str,
        last_error: Optional[str] = None,
        inserted: Optional[int] = None,
        skipped: Optional[int] = None,
    ):
        """Transition the sync slot to a final state and write a history row."""

        finished_iso = _now_iso()
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT * FROM {self.SYNC_STATE_TABLE} WHERE id = 1"
            ).fetchone()
            current = self._row_to_sync_state(row)
            self._write_history_row(
                conn,
                current,
                final_state=final_state,
                last_error=last_error,
                finished_at=finished_iso,
                inserted=inserted,
                skipped=skipped,
            )
            if final_state == "done":
                conn.execute(
                    f"""
                    UPDATE {self.SYNC_STATE_TABLE}
                       SET state = 'done',
                           finished_at = ?,
                           last_error = NULL,
                           last_completed_at = ?,
                           pid = NULL
                     WHERE id = 1
                    """,
                    (finished_iso, finished_iso),
                )
            else:
                conn.execute(
                    f"""
                    UPDATE {self.SYNC_STATE_TABLE}
                       SET state = 'error',
                           finished_at = ?,
                           last_error = ?,
                           pid = NULL
                     WHERE id = 1
                    """,
                    (finished_iso, last_error),
                )
            conn.commit()

    def auto_clear_if_stale(self) -> bool:
        """If the current sync is stale, transition it to error.

        Returns True if a stale sync was cleared. Uses BEGIN IMMEDIATE so two
        concurrent status reads cannot both write a history row.
        """

        # Cheap pre-check so the hot read path of /status does not contend
        # for the write lock during normal operation.
        if self._is_stale(self.get_sync_state()) is None:
            return False

        now_iso = _now_iso()
        cleared = False
        conn = self._connect()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM {self.SYNC_STATE_TABLE} WHERE id = 1"
            ).fetchone()
            current = self._row_to_sync_state(row)
            stale_reason = self._is_stale(current)
            if stale_reason is None:
                conn.execute("ROLLBACK")
                return False
            self._write_history_row(
                conn,
                current,
                final_state="aborted",
                last_error=f"stale lock auto-cleared ({stale_reason})",
                finished_at=now_iso,
            )
            conn.execute(
                f"""
                UPDATE {self.SYNC_STATE_TABLE}
                   SET state = 'error',
                       finished_at = ?,
                       last_error = ?,
                       pid = NULL
                 WHERE id = 1
                """,
                (now_iso, f"stale lock auto-cleared ({stale_reason})"),
            )
            conn.execute("COMMIT")
            cleared = True
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.close()

        if cleared:
            self._archive_current_payloads()
        return cleared

    def force_clear_sync(self) -> bool:
        """Manually clear the sync slot. Returns True if something was cleared."""

        now_iso = _now_iso()
        cleared = False
        conn = self._connect()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM {self.SYNC_STATE_TABLE} WHERE id = 1"
            ).fetchone()
            current = self._row_to_sync_state(row)
            if current["state"] not in SYNC_STATES_BUSY:
                conn.execute("ROLLBACK")
                return False
            self._write_history_row(
                conn,
                current,
                final_state="aborted",
                last_error="manual force clear",
                finished_at=now_iso,
            )
            conn.execute(
                f"""
                UPDATE {self.SYNC_STATE_TABLE}
                   SET state = 'error',
                       finished_at = ?,
                       last_error = 'manual force clear',
                       pid = NULL
                 WHERE id = 1
                """,
                (now_iso,),
            )
            conn.execute("COMMIT")
            cleared = True
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.close()

        if cleared:
            self._archive_current_payloads()
        return cleared

    def get_sync_state(self) -> Dict:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT * FROM {self.SYNC_STATE_TABLE} WHERE id = 1"
            ).fetchone()
        return self._row_to_sync_state(row)

    def get_sync_history(self, limit: int = 20) -> List[Dict]:
        limit = max(1, min(int(limit), 200))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, batch_timestamp, started_at, finished_at, final_state,
                       total_records, processed_records, inserted, skipped,
                       last_error, client
                  FROM {self.SYNC_HISTORY_TABLE}
                 ORDER BY id DESC
                 LIMIT ?
                """,
                (limit,),
            ).fetchall()

        result: List[Dict] = []
        for row in rows:
            duration = None
            try:
                started = datetime.fromisoformat(str(row["started_at"]).replace("Z", "+00:00"))
                finished = datetime.fromisoformat(str(row["finished_at"]).replace("Z", "+00:00"))
                duration = max(0.0, (finished - started).total_seconds())
            except (TypeError, ValueError):
                duration = None
            result.append(
                {
                    "id": row["id"],
                    "batch_timestamp": row["batch_timestamp"],
                    "started_at": row["started_at"],
                    "finished_at": row["finished_at"],
                    "duration_seconds": duration,
                    "final_state": row["final_state"],
                    "total_records": row["total_records"],
                    "processed_records": row["processed_records"],
                    "inserted": row["inserted"],
                    "skipped": row["skipped"],
                    "last_error": row["last_error"],
                    "client": row["client"],
                }
            )
        return result

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

    def _sanitize_column_name(self, key: str) -> str:
        """Return a safe column name derived from a payload key."""

        sanitized = re.sub(r"[^a-z0-9_]+", "_", key.lower()).strip("_")
        if not sanitized:
            sanitized = "col"
        if sanitized[0].isdigit():
            sanitized = f"col_{sanitized}"
        return sanitized

    def _existing_columns(self, conn: sqlite3.Connection, table_name: str) -> List[str]:
        cursor = conn.execute(f"PRAGMA table_info({table_name})")
        return [row[1] for row in cursor.fetchall()]

    def _table_exists(self, conn: sqlite3.Connection, table_name: str) -> bool:
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,),
        )
        return cursor.fetchone() is not None

    def _ensure_index(self, conn: sqlite3.Connection, table_name: str, column: str):
        key = f"{table_name}:{column}"
        if key in self._indexes_ready:
            return
        try:
            conn.execute(
                f'CREATE INDEX IF NOT EXISTS idx_{table_name}_{column} ON {table_name}("{column}")'
            )
            self._indexes_ready.add(key)
        except sqlite3.OperationalError:
            return

    def _ensure_fitness_indexes(self, conn: sqlite3.Connection):
        fitness_tables = [
            "health_apple_exercise_time",
            "health_active_energy",
            "health_basal_energy_burned",
            "health_step_count",
            "health_walking_running_distance",
            "health_flights_climbed",
            "health_walking_speed",
            "health_walking_step_length",
            "health_walking_heart_rate_average",
            "health_stair_speed_up",
            "health_stair_speed_down",
            "health_body_mass_index",
            "health_weight_body_mass",
            "health_body_fat_percentage",
            "health_lean_body_mass",
            "health_vo2max",
            "health_vo2_max",
        ]
        for table in fitness_tables:
            if not self._table_exists(conn, table):
                continue
            self._ensure_index(conn, table, "start_ts")
            if "date" in {col.lower() for col in self._existing_columns(conn, table)}:
                self._ensure_index(conn, table, "date")

    def _ensure_payload_columns(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        payload: Dict,
        column_cache: Optional[Dict[str, set[str]]] = None,
    ) -> List[str]:
        provided_schema = (
            self._provided_schemas.get(table_name)
            if self._provided_schemas is not None
            else None
        )
        if provided_schema is not None:
            if column_cache is not None:
                column_cache[table_name] = provided_schema

            payload_columns: List[str] = []
            seen: set[str] = set()
            for key in payload.keys():
                column = self._sanitize_column_name(str(key))
                if column in provided_schema and column not in seen:
                    payload_columns.append(column)
                    seen.add(column)

            return payload_columns

        existing = set()
        if column_cache is not None and table_name in column_cache:
            existing = column_cache[table_name]
        else:
            existing = set(self._existing_columns(conn, table_name))
            if column_cache is not None:
                column_cache[table_name] = existing

        payload_columns: List[str] = []
        seen: set[str] = set()

        for key in payload.keys():
            column = self._sanitize_column_name(str(key))
            if column not in existing:
                conn.execute(f'ALTER TABLE {table_name} ADD COLUMN "{column}" TEXT')
                existing.add(column)
                if column_cache is not None:
                    column_cache[table_name] = existing
            if column not in seen:
                payload_columns.append(column)
                seen.add(column)

        return payload_columns

    def _normalize_value(self, value):
        if isinstance(value, (dict, list)):
            return json.dumps(value)
        return value

    def ingest_records(
        self,
        records: List[NormalizedRecord],
        batch_ts: int,
        progress_callback: Optional[Callable[[int], None]] = None,
        replace_existing: bool = False,
    ):
        """Persist normalized records, optionally replacing existing rows in range."""
        stats: Dict[str, Dict[str, int]] = {}
        inserted = 0
        skipped = 0
        processed = 0

        table_cache: Dict[str, bool] = {}
        column_cache: Dict[str, set[str]] = {}

        replacement_ranges: Dict[str, Tuple[int, int]] = {}
        if replace_existing:
            for record in records:
                bounds = replacement_ranges.get(record.data_type)
                if not bounds:
                    replacement_ranges[record.data_type] = (record.start_ts, record.end_ts)
                else:
                    start, end = bounds
                    replacement_ranges[record.data_type] = (
                        min(start, record.start_ts),
                        max(end, record.end_ts),
                    )

        total_records = len(records)
        with self._connect() as conn:
            if replacement_ranges:
                for data_type, (range_start, range_end) in replacement_ranges.items():
                    table_name = self._table_name_for_type(data_type)
                    self._ensure_table(conn, table_name)
                    table_cache[table_name] = True
                    conn.execute(
                        f"DELETE FROM {table_name} WHERE start_ts < ? AND end_ts > ?",
                        (range_end, range_start),
                    )

            for record in records:
                table_name = self._table_name_for_type(record.data_type)
                if table_name not in table_cache:
                    self._ensure_table(conn, table_name)
                    table_cache[table_name] = True

                was_inserted = self._upsert_record(
                    conn,
                    table_name,
                    record,
                    batch_ts,
                    column_cache,
                    skip_overlap_check=replace_existing,
                )
                processed += 1

                # Commit at chunk boundaries so the ingest connection
                # releases its write lock before the progress callback (or
                # any concurrent status read) opens a separate connection.
                # Without this every progress flush self deadlocks against
                # the still open ingest transaction.
                if (
                    processed % PROGRESS_FLUSH_INTERVAL == 0
                    or processed == total_records
                ):
                    conn.commit()
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

        # Neue Daten machen aggregierte Caches ungültig
        self._summary_cache.clear()
        self._fitness_cache.clear()
        self._fitness_weekly_cache.clear()

        return {"inserted": inserted, "skipped": skipped, "by_type": stats}

    def _upsert_record(
        self,
        conn: sqlite3.Connection,
        table_name: str,
        record: NormalizedRecord,
        batch_ts: int,
        column_cache: Optional[Dict[str, set[str]]] = None,
        skip_overlap_check: bool = False,
    ) -> bool:
        """Insert or skip a record depending on overlap and batch recency.

        When ``skip_overlap_check`` is True, caller guarantees stale rows were
        already removed for the covered interval, so the function always
        inserts without querying for overlaps.
        """

        if not skip_overlap_check:
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

        payload_columns = self._ensure_payload_columns(
            conn, table_name, record.payload, column_cache
        )

        base_columns = ["start_ts", "end_ts", "batch_ts", "payload"]
        insert_columns = base_columns + payload_columns
        placeholders = ", ".join("?" for _ in insert_columns)
        column_clause = ", ".join(f'"{column}"' for column in insert_columns)

        column_values = {}
        for key, value in record.payload.items():
            column = self._sanitize_column_name(str(key))
            column_values[column] = self._normalize_value(value)

        values = [
            record.start_ts,
            record.end_ts,
            batch_ts,
            json.dumps(record.payload),
            *[column_values.get(column) for column in payload_columns],
        ]

        conn.execute(
            f"INSERT INTO {table_name} ({column_clause}) VALUES ({placeholders})",
            values,
        )
        return True

    def _set_last_import(self, conn: sqlite3.Connection, batch_ts: int):
        conn.execute(
            "INSERT OR REPLACE INTO health_metadata (key, value) VALUES (?, ?)",
            ("last_import_ts", str(batch_ts)),
        )
        conn.execute(
            f"UPDATE {self.SYNC_STATE_TABLE} SET last_completed_at = ? WHERE id = 1",
            (_timestamp_to_iso(batch_ts),),
        )

    def remove_duplicate_rows(self):
        """Delete duplicated rows that share the same ``start_ts`` and value column.

        Some data sources occasionally submit identical entries multiple times.
        This routine scans all health tables for the columns ``qty``, ``avg``,
        and ``totalsleep`` and removes duplicates where ``start_ts`` and the
        respective column value match, keeping the most recent row (by
        ``batch_ts`` and ``id``).
        """

        target_columns = ("qty", "avg", "totalsleep")

        with self._connect() as conn:
            tables = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'health_%'"
            ).fetchall()

            for table_row in tables:
                table_name = table_row["name"] if isinstance(table_row, sqlite3.Row) else table_row[0]
                existing_columns = set(self._existing_columns(conn, table_name))

                if "start_ts" not in existing_columns:
                    continue

                for column in target_columns:
                    if column not in existing_columns:
                        continue

                    conn.execute(
                        f"""
                        DELETE FROM {table_name}
                        WHERE id IN (
                            SELECT id FROM (
                                SELECT id,
                                       ROW_NUMBER() OVER (
                                           PARTITION BY start_ts, {column}
                                           ORDER BY batch_ts DESC, id DESC
                                       ) AS rn
                                FROM {table_name}
                                WHERE {column} IS NOT NULL
                            )
                            WHERE rn > 1
                        )
                        """
                    )

            if self._table_exists(conn, "health_sleep_analysis"):
                sleep_columns = set(self._existing_columns(conn, "health_sleep_analysis"))
                if {"inbedend", "totalsleep"}.issubset(sleep_columns):
                    conn.execute(
                        """
                        DELETE FROM health_sleep_analysis
                        WHERE id IN (
                            SELECT id FROM (
                                SELECT id,
                                       ROW_NUMBER() OVER (
                                           PARTITION BY inbedend
                                           ORDER BY totalsleep DESC, batch_ts DESC, id DESC
                                       ) AS rn
                                FROM health_sleep_analysis
                                WHERE inbedend IS NOT NULL
                            )
                            WHERE rn > 1
                        )
                        """
                    )

            conn.commit()

        # Deduplizierung kann aggregierte Abfragen verändern
        self._summary_cache.clear()
        self._fitness_cache.clear()
        self._fitness_weekly_cache.clear()

    def get_last_import_iso(self) -> str | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT value FROM health_metadata WHERE key = ?", ("last_import_ts",)
            ).fetchone()

        if not row:
            return None

        ts = int(row["value"])
        return _timestamp_to_iso(ts)

    def _extract_row_date(self, row: sqlite3.Row) -> Optional[date]:
        if "date" in row.keys():
            raw_date = row["date"]
            if raw_date:
                try:
                    dt = datetime.fromisoformat(str(raw_date))
                    return dt.date()
                except ValueError:
                    try:
                        return datetime.strptime(str(raw_date)[:10], "%Y-%m-%d").date()
                    except Exception:
                        pass
        if "start_ts" in row.keys() and row["start_ts"]:
            return datetime.fromtimestamp(int(row["start_ts"]), tz=timezone.utc).date()
        return None

    def _query_rows_in_range(
        self, conn: sqlite3.Connection, table: str, start_ts: int, end_ts: int
    ) -> List[sqlite3.Row]:
        if not self._table_exists(conn, table):
            return []
        try:
            cursor = conn.execute(
                f"SELECT * FROM {table} WHERE start_ts >= ? AND start_ts < ?",
                (start_ts, end_ts),
            )
            return cursor.fetchall()
        except sqlite3.OperationalError:
            return []

    def _gather_numeric(self, row: sqlite3.Row, column: str) -> Optional[float]:
        if column not in row.keys():
            return None
        return _parse_float(row[column])

    def _extract_row_hour(self, row: sqlite3.Row) -> Optional[datetime]:
        """Extract a UTC hour bucket from a row if possible."""

        if "start_ts" in row.keys() and row["start_ts"]:
            dt = datetime.fromtimestamp(int(row["start_ts"]), tz=timezone.utc)
            return dt.replace(minute=0, second=0, microsecond=0)

        if "date" in row.keys():
            raw_date = row["date"]
            if raw_date:
                try:
                    dt = datetime.fromisoformat(str(raw_date))
                    return dt.replace(minute=0, second=0, microsecond=0)
                except ValueError:
                    pass

        return None

    def get_daily_summary(self, start: date, end: date) -> List[dict]:
        if start > end:
            start, end = end, start

        cache_key = (start.isoformat(), end.isoformat())
        if cache_key in self._summary_cache:
            return self._summary_cache[cache_key]

        buckets: Dict[str, _DailyBucket] = {
            day.isoformat(): _DailyBucket(day) for day in _date_range(start, end)
        }

        start_ts = int(
            datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )
        end_ts = int(
            datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )

        def _unit_from_row(row: sqlite3.Row) -> Optional[str]:
            return _extract_unit(row)

        with self._connect() as conn:
            sleep_rows = self._query_rows_in_range(
                conn, "health_sleep_analysis", start_ts, end_ts
            )
            for row in sleep_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_sleep(
                    self._gather_numeric(row, "totalsleep"),
                    self._gather_numeric(row, "deep"),
                    self._gather_numeric(row, "core"),
                    self._gather_numeric(row, "rem"),
                )

            hrv_rows = self._query_rows_in_range(
                conn, "health_heart_rate_variability", start_ts, end_ts
            )
            for row in hrv_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_hrv(self._gather_numeric(row, "qty"))

            rhr_rows = self._query_rows_in_range(
                conn, "health_resting_heart_rate", start_ts, end_ts
            )
            for row in rhr_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_rhr(self._gather_numeric(row, "qty"))

            resp_rows = self._query_rows_in_range(
                conn, "health_respiratory_rate", start_ts, end_ts
            )
            for row in resp_rows:
                day = self._extract_row_date(row)
                if not day:
                    continue
                key = day.isoformat()
                if key not in buckets:
                    continue
                buckets[key].add_resp(self._gather_numeric(row, "qty"))

            sum_tables = [
                ("health_active_energy", "active_kcal", lambda v, row: _normalize_energy_kcal(v, _unit_from_row(row))),
                ("health_basal_energy_burned", "basal_kcal", lambda v, row: _normalize_energy_kcal(v, _unit_from_row(row))),
                ("health_step_count", "steps", lambda v, row: v),
                ("health_apple_exercise_time", "exercise_min", lambda v, row: v),
                ("health_apple_stand_hour", "stand_hours", lambda v, row: v),
                ("health_apple_stand_time", "stand_hours", lambda v, row: v),
            ]

            for table, attr, converter in sum_tables:
                rows = self._query_rows_in_range(conn, table, start_ts, end_ts)
                for row in rows:
                    day = self._extract_row_date(row)
                    if not day:
                        continue
                    key = day.isoformat()
                    if key not in buckets:
                        continue
                    value = self._gather_numeric(row, "qty")
                    normalized = converter(value, row) if converter else value
                    buckets[key].add_sum(attr, normalized)

        summary = [bucket.as_dict() for _, bucket in sorted(buckets.items())]
        self._summary_cache[cache_key] = summary
        return summary

    def get_fitness_daily_aggregates(self, start: date, end: date) -> List[dict]:
        if start > end:
            start, end = end, start

        cache_key = (start.isoformat(), end.isoformat())
        if cache_key in self._fitness_cache:
            return self._fitness_cache[cache_key]

        buckets: Dict[str, _FitnessDailyBucket] = {
            day.isoformat(): _FitnessDailyBucket(day) for day in _date_range(start, end)
        }

        start_ts = int(
            datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )
        end_ts = int(
            datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc).timestamp()
        )

        def _unit_from_row(row: sqlite3.Row) -> Optional[str]:
            return _extract_unit(row)

        with self._connect() as conn:
            self._ensure_fitness_indexes(conn)

            sum_tables = [
                ("health_apple_exercise_time", "exercise_min", lambda v, row: v),
                ("health_active_energy", "active_kcal", lambda v, row: _normalize_energy_kcal(v, _unit_from_row(row))),
                ("health_basal_energy_burned", "basal_kcal", lambda v, row: _normalize_energy_kcal(v, _unit_from_row(row))),
                ("health_step_count", "steps", lambda v, row: v),
                ("health_walking_running_distance", "distance_km", lambda v, row: _normalize_distance_km(v, _unit_from_row(row))),
                ("health_flights_climbed", "floors", lambda v, row: v),
            ]

            for table, attr, converter in sum_tables:
                rows = self._query_rows_in_range(conn, table, start_ts, end_ts)
                for row in rows:
                    day = self._extract_row_date(row)
                    if not day:
                        continue
                    key = day.isoformat()
                    bucket = buckets.get(key)
                    if not bucket:
                        continue
                    value = self._gather_numeric(row, "qty")
                    normalized = converter(value, row) if converter else value
                    bucket.add_sum(attr, normalized)

            median_tables = [
                ("health_walking_speed", "walking_speed", lambda v, row: _normalize_walking_speed(v, _unit_from_row(row))),
                ("health_walking_step_length", "step_length", lambda v, row: v),
                ("health_walking_heart_rate_average", "walking_hr_avg", lambda v, row: v),
                ("health_stair_speed_up", "stair_up", lambda v, row: v),
                ("health_stair_speed_down", "stair_down", lambda v, row: v),
                ("health_body_mass_index", "bmi", lambda v, row: v),
                ("health_weight_body_mass", "weight", lambda v, row: v),
                ("health_body_fat_percentage", "body_fat", lambda v, row: v),
                ("health_lean_body_mass", "lean_mass", lambda v, row: v),
                ("health_vo2max", "vo2max", lambda v, row: v),
                ("health_vo2_max", "vo2max", lambda v, row: v),
            ]

            for table, attr, converter in median_tables:
                rows = self._query_rows_in_range(conn, table, start_ts, end_ts)
                for row in rows:
                    day = self._extract_row_date(row)
                    if not day:
                        continue
                    key = day.isoformat()
                    bucket = buckets.get(key)
                    if not bucket:
                        continue
                    value = self._gather_numeric(row, "qty")
                    normalized = converter(value, row) if converter else value
                    bucket.add_value(attr, normalized)

        summary = [bucket.as_dict() for _, bucket in sorted(buckets.items())]
        self._fitness_cache[cache_key] = summary
        return summary

    def _persist_weekly_summary(self, rows: List[dict]):
        if not rows:
            return

        now_ts = int(datetime.now(timezone.utc).timestamp())
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS health_weekly_summary (
                    week_start TEXT PRIMARY KEY,
                    week_end TEXT NOT NULL,
                    iso_year INTEGER,
                    iso_week INTEGER,
                    exercise_min_week REAL,
                    active_kcal_week REAL,
                    basal_kcal_week REAL,
                    steps_week REAL,
                    distance_km_week REAL,
                    floors_week REAL,
                    walking_speed_week REAL,
                    step_length_week REAL,
                    walking_hr_avg_week REAL,
                    stair_up_week REAL,
                    stair_down_week REAL,
                    weight_week REAL,
                    vo2max_week REAL,
                    created_at_ts INTEGER NOT NULL
                )
                """
            )
            existing_cols = set(self._existing_columns(conn, "health_weekly_summary"))
            for column, col_type in [
                ("basal_kcal_week", "REAL"),
                ("weight_week", "REAL"),
                ("vo2max_week", "REAL"),
            ]:
                if column not in existing_cols:
                    try:
                        conn.execute(f"ALTER TABLE health_weekly_summary ADD COLUMN {column} {col_type}")
                        existing_cols.add(column)
                    except sqlite3.OperationalError:
                        pass
            self._ensure_index(conn, "health_weekly_summary", "week_start")
            for row in rows:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO health_weekly_summary (
                        week_start, week_end, iso_year, iso_week,
                        exercise_min_week, active_kcal_week, basal_kcal_week, steps_week, distance_km_week, floors_week,
                        walking_speed_week, step_length_week, walking_hr_avg_week, stair_up_week, stair_down_week,
                        weight_week, vo2max_week, created_at_ts
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row.get("week_start"),
                        row.get("week_end"),
                        row.get("iso_year"),
                        row.get("iso_week"),
                        row.get("exercise_min_week"),
                        row.get("active_kcal_week"),
                        row.get("basal_kcal_week"),
                        row.get("steps_week"),
                        row.get("distance_km_week"),
                        row.get("floors_week"),
                        row.get("walking_speed_week"),
                        row.get("step_length_week"),
                        row.get("walking_hr_avg_week"),
                        row.get("stair_up_week"),
                        row.get("stair_down_week"),
                        row.get("weight_week"),
                        row.get("vo2max_week"),
                        now_ts,
                    ),
                )
            conn.commit()

    def get_fitness_weekly_summary(self, start: date, end: date) -> List[dict]:
        if start > end:
            start, end = end, start

        cache_key = (start.isoformat(), end.isoformat())
        if cache_key in self._fitness_weekly_cache:
            return self._fitness_weekly_cache[cache_key]

        daily = self.get_fitness_daily_aggregates(start, end)
        buckets: Dict[str, _WeeklyFitnessBucket] = {}

        for entry in daily:
            raw_date = entry.get("date")
            if not raw_date:
                continue
            try:
                day = date.fromisoformat(str(raw_date))
            except ValueError:
                continue
            iso_year, iso_week, iso_weekday = day.isocalendar()
            week_start = day - timedelta(days=iso_weekday - 1)
            week_end = week_start + timedelta(days=6)
            key = week_start.isoformat()
            bucket = buckets.get(key)
            if not bucket:
                bucket = _WeeklyFitnessBucket(week_start, week_end, iso_year, iso_week)
                buckets[key] = bucket
            bucket.add_day(entry)

        weekly = [bucket.as_dict() for _, bucket in sorted(buckets.items())]
        self._fitness_weekly_cache[cache_key] = weekly
        self._persist_weekly_summary(weekly)
        return weekly

    def get_hourly_summary(self, day: date) -> List[dict]:
        """Return intraday aggregates grouped by hour for a given day."""

        start_dt = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
        buckets: Dict[datetime, _HourlyBucket] = {
            start_dt + timedelta(hours=offset): _HourlyBucket(start_dt + timedelta(hours=offset))
            for offset in range(24)
        }

        start_ts = int(start_dt.timestamp())
        end_ts = int((start_dt + timedelta(days=1)).timestamp())

        with self._connect() as conn:
            sleep_rows = self._query_rows_in_range(
                conn, "health_sleep_analysis", start_ts, end_ts
            )
            for row in sleep_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_sleep(
                    self._gather_numeric(row, "totalsleep"),
                    self._gather_numeric(row, "deep"),
                    self._gather_numeric(row, "core"),
                    self._gather_numeric(row, "rem"),
                )

            hrv_rows = self._query_rows_in_range(
                conn, "health_heart_rate_variability", start_ts, end_ts
            )
            for row in hrv_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_hrv(self._gather_numeric(row, "qty"))

            rhr_rows = self._query_rows_in_range(
                conn, "health_resting_heart_rate", start_ts, end_ts
            )
            for row in rhr_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_rhr(self._gather_numeric(row, "qty"))

            resp_rows = self._query_rows_in_range(
                conn, "health_respiratory_rate", start_ts, end_ts
            )
            for row in resp_rows:
                hour = self._extract_row_hour(row)
                if not hour or hour.date() != day:
                    continue
                bucket = buckets.get(hour)
                if not bucket:
                    continue
                bucket.add_resp(self._gather_numeric(row, "qty"))

            for table, attr in [
                ("health_active_energy", "active_kcal"),
                ("health_basal_energy_burned", "basal_kcal"),
                ("health_step_count", "steps"),
                ("health_apple_exercise_time", "exercise_min"),
                ("health_apple_stand_hour", "stand_hours"),
                ("health_apple_stand_time", "stand_hours"),
            ]:
                rows = self._query_rows_in_range(conn, table, start_ts, end_ts)
                for row in rows:
                    hour = self._extract_row_hour(row)
                    if not hour or hour.date() != day:
                        continue
                    bucket = buckets.get(hour)
                    if not bucket:
                        continue
                    bucket.add_sum(attr, self._gather_numeric(row, "qty"))

        return [bucket.as_dict() for _, bucket in sorted(buckets.items())]


def _timestamp_to_iso(ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _parse_float(value) -> Optional[float]:
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        sanitized = stripped.replace(",", ".")
        try:
            return float(sanitized)
        except ValueError:
            return None

    return None


def _median(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return float(median(values))


def _extract_unit(row: sqlite3.Row) -> Optional[str]:
    for key in ("unit", "units"):
        if key in row.keys():
            raw = row[key]
            if raw is not None:
                return str(raw)
    return None


def _normalize_energy_kcal(value: Optional[float], unit: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    if unit:
        normalized = unit.lower()
        if normalized in {"kj", "kilojoule", "kilojoules"}:
            return value / 4.184
        if normalized in {"j", "joule", "joules"}:
            return value / 4184
        if normalized in {"kcal", "cal", "calorie", "calories"}:
            return value
    return value


def _normalize_distance_km(value: Optional[float], unit: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    if unit:
        normalized = unit.lower()
        if normalized in {"km", "kilometer", "kilometre"}:
            return value
        if normalized in {"mi", "mile", "miles"}:
            return value * 1.60934
    # Default assumption: meter
    return value / 1000


def _normalize_walking_speed(value: Optional[float], unit: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    if unit:
        normalized = unit.lower()
        if normalized in {"km/h", "kph"}:
            return value
        if normalized in {"m/s", "meter/second", "metre/second"}:
            return value * 3.6
    return value


def _safe_divide(numerator: Optional[float], denominator: Optional[float]) -> Optional[float]:
    if numerator is None or denominator is None or denominator == 0:
        return None
    return numerator / denominator


class _DailyBucket:
    def __init__(self, day: date):
        self.day = day
        self.sleep_total = 0.0
        self.sleep_deep = 0.0
        self.sleep_core = 0.0
        self.sleep_rem = 0.0
        self._sleep_seen = False

        self.active_kcal = 0.0
        self.basal_kcal = 0.0
        self.steps = 0.0
        self.exercise_min = 0.0
        self.stand_hours = 0.0
        self._stand_seen = False

        self.hrv_values: List[float] = []
        self.rhr_values: List[float] = []
        self.resp_values: List[float] = []

    def add_sleep(self, total: Optional[float], deep: Optional[float], core: Optional[float], rem: Optional[float]):
        if total is not None:
            self.sleep_total += total
            self._sleep_seen = True
        if deep is not None:
            self.sleep_deep += deep
            self._sleep_seen = True
        if core is not None:
            self.sleep_core += core
            self._sleep_seen = True
        if rem is not None:
            self.sleep_rem += rem
            self._sleep_seen = True

    def add_hrv(self, value: Optional[float]):
        if value is not None:
            self.hrv_values.append(value)

    def add_rhr(self, value: Optional[float]):
        if value is not None:
            self.rhr_values.append(value)

    def add_resp(self, value: Optional[float]):
        if value is not None:
            self.resp_values.append(value)

    def add_sum(self, attr: str, value: Optional[float]):
        if value is None:
            return
        if attr == "active_kcal":
            self.active_kcal += value
        elif attr == "basal_kcal":
            self.basal_kcal += value
        elif attr == "steps":
            self.steps += value
        elif attr == "exercise_min":
            self.exercise_min += value
        elif attr == "stand_hours":
            self.stand_hours += value
            self._stand_seen = True

    def as_dict(self) -> dict:
        return {
            "date": self.day.isoformat(),
            "sleep_total": self.sleep_total if self._sleep_seen else None,
            "sleep_deep": self.sleep_deep if self._sleep_seen else None,
            "sleep_core": self.sleep_core if self._sleep_seen else None,
            "sleep_rem": self.sleep_rem if self._sleep_seen else None,
            "hrv": _median(self.hrv_values),
            "rhr": _median(self.rhr_values),
            "resp": _median(self.resp_values),
            "active_kcal": self.active_kcal if self.active_kcal else None,
            "basal_kcal": self.basal_kcal if self.basal_kcal else None,
            "steps": self.steps if self.steps else None,
            "exercise_min": self.exercise_min if self.exercise_min else None,
            "stand_hours": self.stand_hours if self._stand_seen else None,
        }


class _HourlyBucket:
    def __init__(self, hour: datetime):
        self.hour = hour
        self.sleep_total = 0.0
        self.sleep_deep = 0.0
        self.sleep_core = 0.0
        self.sleep_rem = 0.0
        self._sleep_seen = False

        self.active_kcal = 0.0
        self.basal_kcal = 0.0
        self.steps = 0.0
        self.exercise_min = 0.0
        self.stand_hours = 0.0
        self._stand_seen = False

        self.hrv_values: List[float] = []
        self.rhr_values: List[float] = []
        self.resp_values: List[float] = []

    def add_sleep(
        self, total: Optional[float], deep: Optional[float], core: Optional[float], rem: Optional[float]
    ):
        if total is not None:
            self.sleep_total += total
            self._sleep_seen = True
        if deep is not None:
            self.sleep_deep += deep
            self._sleep_seen = True
        if core is not None:
            self.sleep_core += core
            self._sleep_seen = True
        if rem is not None:
            self.sleep_rem += rem
            self._sleep_seen = True

    def add_hrv(self, value: Optional[float]):
        if value is not None:
            self.hrv_values.append(value)

    def add_rhr(self, value: Optional[float]):
        if value is not None:
            self.rhr_values.append(value)

    def add_resp(self, value: Optional[float]):
        if value is not None:
            self.resp_values.append(value)

    def add_sum(self, attr: str, value: Optional[float]):
        if value is None:
            return
        if attr == "active_kcal":
            self.active_kcal += value
        elif attr == "basal_kcal":
            self.basal_kcal += value
        elif attr == "steps":
            self.steps += value
        elif attr == "exercise_min":
            self.exercise_min += value
        elif attr == "stand_hours":
            self.stand_hours += value
            self._stand_seen = True

    def as_dict(self) -> dict:
        return {
            "date": self.hour.strftime("%H:%M"),
            "sleep_total": self.sleep_total if self._sleep_seen else None,
            "sleep_deep": self.sleep_deep if self._sleep_seen else None,
            "sleep_core": self.sleep_core if self._sleep_seen else None,
            "sleep_rem": self.sleep_rem if self._sleep_seen else None,
            "hrv": _median(self.hrv_values),
            "rhr": _median(self.rhr_values),
            "resp": _median(self.resp_values),
            "active_kcal": self.active_kcal if self.active_kcal else None,
            "basal_kcal": self.basal_kcal if self.basal_kcal else None,
            "steps": self.steps if self.steps else None,
            "exercise_min": self.exercise_min if self.exercise_min else None,
            "stand_hours": self.stand_hours if self._stand_seen else None,
        }


class _FitnessDailyBucket:
    def __init__(self, day: date):
        self.day = day
        self.exercise_min = 0.0
        self._exercise_seen = False
        self.active_kcal = 0.0
        self._active_seen = False
        self.basal_kcal = 0.0
        self._basal_seen = False
        self.steps = 0.0
        self._steps_seen = False
        self.distance_km = 0.0
        self._distance_seen = False
        self.floors = 0.0
        self._floors_seen = False

        self.walking_speed_values: List[float] = []
        self.step_length_values: List[float] = []
        self.walking_hr_values: List[float] = []
        self.stair_up_values: List[float] = []
        self.stair_down_values: List[float] = []
        self.vo2max_values: List[float] = []

        self.bmi_values: List[float] = []
        self.weight_values: List[float] = []
        self.body_fat_values: List[float] = []
        self.lean_mass_values: List[float] = []

    def add_sum(self, attr: str, value: Optional[float]):
        if value is None:
            return
        if attr == "exercise_min":
            self.exercise_min += value
            self._exercise_seen = True
        elif attr == "active_kcal":
            self.active_kcal += value
            self._active_seen = True
        elif attr == "basal_kcal":
            self.basal_kcal += value
            self._basal_seen = True
        elif attr == "steps":
            self.steps += value
            self._steps_seen = True
        elif attr == "distance_km":
            self.distance_km += value
            self._distance_seen = True
        elif attr == "floors":
            self.floors += value
            self._floors_seen = True

    def add_value(self, attr: str, value: Optional[float]):
        if value is None:
            return
        if attr == "walking_speed":
            self.walking_speed_values.append(value)
        elif attr == "step_length":
            self.step_length_values.append(value)
        elif attr == "walking_hr_avg":
            self.walking_hr_values.append(value)
        elif attr == "stair_up":
            self.stair_up_values.append(value)
        elif attr == "stair_down":
            self.stair_down_values.append(value)
        elif attr == "vo2max":
            self.vo2max_values.append(value)
        elif attr == "bmi":
            self.bmi_values.append(value)
        elif attr == "weight":
            self.weight_values.append(value)
        elif attr == "body_fat":
            self.body_fat_values.append(value)
        elif attr == "lean_mass":
            self.lean_mass_values.append(value)

    def as_dict(self) -> dict:
        return {
            "date": self.day.isoformat(),
            "exercise_min": self.exercise_min if self._exercise_seen else None,
            "active_kcal": self.active_kcal if self._active_seen else None,
            "basal_kcal": self.basal_kcal if self._basal_seen else None,
            "steps": self.steps if self._steps_seen else None,
            "distance_km": self.distance_km if self._distance_seen else None,
            "floors": self.floors if self._floors_seen else None,
            "walking_speed": _median(self.walking_speed_values),
            "step_length": _median(self.step_length_values),
            "walking_hr_avg": _median(self.walking_hr_values),
            "stair_up": _median(self.stair_up_values),
            "stair_down": _median(self.stair_down_values),
            "vo2max": _median(self.vo2max_values),
            "bmi": _median(self.bmi_values),
            "weight": _median(self.weight_values),
            "body_fat": _median(self.body_fat_values),
            "lean_mass": _median(self.lean_mass_values),
        }


class _WeeklyFitnessBucket:
    def __init__(self, week_start: date, week_end: date, iso_year: int, iso_week: int):
        self.week_start = week_start
        self.week_end = week_end
        self.iso_year = iso_year
        self.iso_week = iso_week
        self.exercise_min = 0.0
        self._exercise_seen = False
        self.active_kcal = 0.0
        self._active_seen = False
        self.steps = 0.0
        self._steps_seen = False
        self.distance_km = 0.0
        self._distance_seen = False
        self.floors = 0.0
        self._floors_seen = False
        self.basal_kcal = 0.0
        self._basal_seen = False

        self.walking_speed_values: List[float] = []
        self.step_length_values: List[float] = []
        self.walking_hr_values: List[float] = []
        self.stair_up_values: List[float] = []
        self.stair_down_values: List[float] = []
        self.weight_values: List[float] = []
        self.vo2max_values: List[float] = []

    def add_day(self, entry: dict):
        for attr in ("exercise_min", "active_kcal", "basal_kcal", "steps", "distance_km", "floors"):
            value = entry.get(attr)
            if value is None:
                continue
            if attr == "exercise_min":
                self.exercise_min += value
                self._exercise_seen = True
            elif attr == "active_kcal":
                self.active_kcal += value
                self._active_seen = True
            elif attr == "basal_kcal":
                self.basal_kcal += value
                self._basal_seen = True
            elif attr == "steps":
                self.steps += value
                self._steps_seen = True
            elif attr == "distance_km":
                self.distance_km += value
                self._distance_seen = True
            elif attr == "floors":
                self.floors += value
                self._floors_seen = True

        if entry.get("walking_speed") is not None:
            self.walking_speed_values.append(entry["walking_speed"])
        if entry.get("step_length") is not None:
            self.step_length_values.append(entry["step_length"])
        if entry.get("walking_hr_avg") is not None:
            self.walking_hr_values.append(entry["walking_hr_avg"])
        if entry.get("stair_up") is not None:
            self.stair_up_values.append(entry["stair_up"])
        if entry.get("stair_down") is not None:
            self.stair_down_values.append(entry["stair_down"])
        if entry.get("weight") is not None:
            self.weight_values.append(entry["weight"])
        if entry.get("vo2max") is not None:
            self.vo2max_values.append(entry["vo2max"])

    def as_dict(self) -> dict:
        return {
            "week_start": self.week_start.isoformat(),
            "week_end": self.week_end.isoformat(),
            "iso_year": self.iso_year,
            "iso_week": self.iso_week,
            "week_label": f"{self.iso_year}-W{self.iso_week:02d}",
            "exercise_min_week": self.exercise_min if self._exercise_seen else None,
            "active_kcal_week": self.active_kcal if self._active_seen else None,
            "basal_kcal_week": self.basal_kcal if self._basal_seen else None,
            "steps_week": self.steps if self._steps_seen else None,
            "distance_km_week": self.distance_km if self._distance_seen else None,
            "floors_week": self.floors if self._floors_seen else None,
            "walking_speed_week": _median(self.walking_speed_values),
            "step_length_week": _median(self.step_length_values),
            "walking_hr_avg_week": _median(self.walking_hr_values),
            "stair_up_week": _median(self.stair_up_values),
            "stair_down_week": _median(self.stair_down_values),
            "weight_week": _median(self.weight_values),
            "vo2max_week": _median(self.vo2max_values),
        }


def _date_range(start: date, end: date):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)
