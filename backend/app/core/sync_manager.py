"""Generic sync slot manager with DB backed state and a background thread.

This module powers the long running sync workflows (currently health, later
notion). Subclasses implement ``_run_job`` with the actual work; this base
class owns:

- DB row that holds the current slot (one row per state table)
- History table that captures one row per finished sync
- Stale detection (PID alive, configurable timeout)
- Daemon thread spawn with Flask app context
- Concurrency token (``run_id``) so a force clear can supersede a running
  thread without race conditions
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional


SYNC_STATES_BUSY = ("normalizing", "ingesting")
SYNC_STATES_FINAL = ("done", "error", "idle")
DEFAULT_STALE_AFTER_SECONDS = 3600


class SyncBusyError(Exception):
    """Raised when a sync is already in progress and not stale."""

    def __init__(self, status: Dict):
        super().__init__("sync already in progress")
        self.status = status


@dataclass
class JobResult:
    inserted: Optional[int] = None
    skipped: Optional[int] = None
    by_type: Dict[str, Any] = field(default_factory=dict)


class _CancelledError(Exception):
    """Raised inside the worker thread when its run_id has been replaced."""


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _timestamp_to_iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


class SyncStateWriter:
    """Handle the worker thread uses to publish progress.

    All write paths use compare and set on ``run_id``. When the slot has
    been taken over (force clear, stale auto clear, or a new sync after
    recovery), the next write raises ``_CancelledError`` so the worker
    stops cleanly without further DB activity.
    """

    def __init__(self, manager: "BaseSyncManager", run_id: str, batch_timestamp: int):
        self._manager = manager
        self.run_id = run_id
        self.batch_timestamp = batch_timestamp
        self._cancelled = False

    @property
    def cancelled(self) -> bool:
        return self._cancelled

    def set_total(self, total_records: int):
        self._manager._update_state_for_run(
            run_id=self.run_id,
            assignments={
                "state": "ingesting",
                "total_records": total_records,
                "processed_records": 0,
            },
            on_lost=self._mark_cancelled,
        )

    def set_progress(self, processed_records: int):
        self._manager._update_state_for_run(
            run_id=self.run_id,
            assignments={"processed_records": processed_records},
            on_lost=self._mark_cancelled,
        )

    def _mark_cancelled(self):
        if not self._cancelled:
            self._cancelled = True
        raise _CancelledError()


class BaseSyncManager:
    """Abstract sync manager. Subclasses implement ``_run_job``.

    Lifecycle:

    1. ``start(client, force=False, **job_kwargs)`` reserves the slot and
       launches the daemon thread. Returns the freshly written state row.
       Raises ``SyncBusyError`` if a non stale sync is already running.

    2. The thread runs ``_run_job(state_writer, **job_kwargs)`` inside an
       app context. Subclass uses ``state_writer`` to publish progress.

    3. On normal return the manager writes a history row with
       ``final_state='done'`` and the optional inserted/skipped counts.
       On exception, history row with ``final_state='error'`` and the
       stringified exception. On ``_CancelledError`` (slot was reassigned
       under the worker), the manager writes nothing (the new owner is
       responsible for its own history row).
    """

    PROGRESS_FLUSH_INTERVAL = 100  # exposed to subclasses if they want it

    def __init__(
        self,
        *,
        db_path: str,
        app,
        table_state: str,
        table_history: str,
    ):
        self._db_path = db_path
        self._app = app
        self._table_state = table_state
        self._table_history = table_history
        self._thread: Optional[threading.Thread] = None
        self._thread_lock = threading.Lock()
        self._ensure_state_table()
        self._ensure_history_table()

    # --- Database helpers --------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_state_table(self):
        with self._connect() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self._table_state} (
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
                f"INSERT OR IGNORE INTO {self._table_state} (id, state) VALUES (1, 'idle')"
            )
            existing = {row[1] for row in conn.execute(f"PRAGMA table_info({self._table_state})")}
            if "run_id" not in existing:
                conn.execute(f"ALTER TABLE {self._table_state} ADD COLUMN run_id TEXT")
            conn.commit()

    def _ensure_history_table(self):
        with self._connect() as conn:
            conn.execute(
                f"""
                CREATE TABLE IF NOT EXISTS {self._table_history} (
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
                f"CREATE INDEX IF NOT EXISTS idx_{self._table_history}_started_at "
                f"ON {self._table_history}(started_at DESC)"
            )
            conn.commit()

    # --- Misc helpers ------------------------------------------------------

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

    def _row_to_state(self, row: Optional[sqlite3.Row]) -> Dict:
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
                "run_id": None,
            }
        keys = row.keys() if hasattr(row, "keys") else []
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
            "run_id": row["run_id"] if "run_id" in keys else None,
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
            INSERT INTO {self._table_history}
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

    # --- Hooks for subclasses ---------------------------------------------

    def _on_slot_archived(self):
        """Called after a stale or force cleared slot has been transitioned.

        Subclasses use this to archive the current payload directory or do
        other module specific cleanup. Default no-op.
        """

    def _on_slot_completed(self, *, success: bool):
        """Called after a normal completion. Default no-op."""

    def _run_job(self, state_writer: SyncStateWriter, **job_kwargs) -> JobResult:
        """Subclass hook. Run the actual sync work."""
        raise NotImplementedError

    # --- Slot lifecycle ----------------------------------------------------

    def acquire_sync_slot(
        self,
        *,
        client: str,
        batch_timestamp: int,
        force: bool = False,
    ) -> str:
        """Reserve the slot atomically. Returns the new ``run_id``.

        Raises ``SyncBusyError`` if a non stale sync is already running.
        """

        now_iso = _now_iso()
        pid = os.getpid()
        run_id = uuid.uuid4().hex
        archived_during_acquire = False
        conn = self._connect()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM {self._table_state} WHERE id = 1"
            ).fetchone()
            current = self._row_to_state(row)

            if current["state"] in SYNC_STATES_BUSY:
                stale_reason: Optional[str]
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
                archived_during_acquire = True

            conn.execute(
                f"""
                UPDATE {self._table_state}
                   SET state = 'normalizing',
                       pid = ?,
                       started_at = ?,
                       finished_at = NULL,
                       total_records = 0,
                       processed_records = 0,
                       batch_timestamp = ?,
                       last_error = NULL,
                       client = ?,
                       run_id = ?
                 WHERE id = 1
                """,
                (pid, now_iso, batch_timestamp, client, run_id),
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

        if archived_during_acquire:
            self._on_slot_archived()
        return run_id

    def _update_state_for_run(
        self,
        *,
        run_id: str,
        assignments: Dict[str, Any],
        on_lost: Callable[[], None],
    ):
        """UPDATE only if run_id matches; otherwise call on_lost."""

        if not assignments:
            return
        keys = list(assignments.keys())
        set_clause = ", ".join(f"{key} = ?" for key in keys)
        params = [assignments[key] for key in keys] + [run_id]
        with self._connect() as conn:
            cur = conn.execute(
                f"UPDATE {self._table_state} SET {set_clause} WHERE id = 1 AND run_id = ?",
                params,
            )
            conn.commit()
            if cur.rowcount == 0:
                on_lost()
                return

    def complete_sync_slot(
        self,
        *,
        run_id: str,
        final_state: str,
        last_error: Optional[str] = None,
        inserted: Optional[int] = None,
        skipped: Optional[int] = None,
    ) -> bool:
        """Transition the slot to a final state and write a history row.

        Returns True if the slot was still owned by ``run_id`` (and therefore
        actually transitioned). Returns False if the slot was reassigned in
        the meantime (caller should not write anything else).
        """

        finished_iso = _now_iso()
        conn = self._connect()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM {self._table_state} WHERE id = 1"
            ).fetchone()
            current = self._row_to_state(row)
            if current.get("run_id") != run_id:
                conn.execute("ROLLBACK")
                return False
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
                    UPDATE {self._table_state}
                       SET state = 'done',
                           finished_at = ?,
                           last_error = NULL,
                           last_completed_at = ?,
                           pid = NULL,
                           run_id = NULL
                     WHERE id = 1 AND run_id = ?
                    """,
                    (finished_iso, finished_iso, run_id),
                )
            else:
                conn.execute(
                    f"""
                    UPDATE {self._table_state}
                       SET state = 'error',
                           finished_at = ?,
                           last_error = ?,
                           pid = NULL,
                           run_id = NULL
                     WHERE id = 1 AND run_id = ?
                    """,
                    (finished_iso, last_error, run_id),
                )
            conn.execute("COMMIT")
            return True
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            raise
        finally:
            conn.close()

    def auto_clear_if_stale(self) -> bool:
        """If the current sync is stale, transition it to error.

        Cheap pre check first so the hot read path of ``/status`` does not
        contend for the write lock during normal operation.
        """

        if self._is_stale(self.get_state()) is None:
            return False

        now_iso = _now_iso()
        cleared = False
        conn = self._connect()
        try:
            conn.isolation_level = None
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                f"SELECT * FROM {self._table_state} WHERE id = 1"
            ).fetchone()
            current = self._row_to_state(row)
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
                UPDATE {self._table_state}
                   SET state = 'error',
                       finished_at = ?,
                       last_error = ?,
                       pid = NULL,
                       run_id = NULL
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
            self._on_slot_archived()
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
                f"SELECT * FROM {self._table_state} WHERE id = 1"
            ).fetchone()
            current = self._row_to_state(row)
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
                UPDATE {self._table_state}
                   SET state = 'error',
                       finished_at = ?,
                       last_error = 'manual force clear',
                       pid = NULL,
                       run_id = NULL
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
            self._on_slot_archived()
        return cleared

    def get_state(self) -> Dict:
        with self._connect() as conn:
            row = conn.execute(
                f"SELECT * FROM {self._table_state} WHERE id = 1"
            ).fetchone()
        return self._row_to_state(row)

    def get_history(self, limit: int = 20) -> List[Dict]:
        limit = max(1, min(int(limit), 200))
        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT id, batch_timestamp, started_at, finished_at, final_state,
                       total_records, processed_records, inserted, skipped,
                       last_error, client
                  FROM {self._table_history}
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

    # --- Threading ---------------------------------------------------------

    def start(self, *, client: str, force: bool = False, **job_kwargs) -> Dict:
        """Reserve a slot and dispatch the worker thread.

        Returns the freshly reserved state row. Raises ``SyncBusyError`` if
        a non stale sync is already running.
        """

        batch_timestamp = int(datetime.now(tz=timezone.utc).timestamp())
        run_id = self.acquire_sync_slot(
            client=client,
            batch_timestamp=batch_timestamp,
            force=force,
        )
        thread = threading.Thread(
            target=self._thread_entry,
            args=(run_id, batch_timestamp, job_kwargs),
            daemon=True,
            name=f"{self.__class__.__name__}-{run_id[:8]}",
        )
        with self._thread_lock:
            self._thread = thread
        thread.start()
        return self.get_state()

    def _thread_entry(self, run_id: str, batch_timestamp: int, job_kwargs: Dict[str, Any]):
        with self._app.app_context():
            writer = SyncStateWriter(self, run_id=run_id, batch_timestamp=batch_timestamp)
            try:
                result = self._run_job(writer, **job_kwargs)
            except _CancelledError:
                # Slot was reassigned, owner is responsible for cleanup.
                return
            except Exception as exc:  # pragma: no cover - error path
                completed = self.complete_sync_slot(
                    run_id=run_id,
                    final_state="error",
                    last_error=str(exc) or exc.__class__.__name__,
                )
                if completed:
                    self._on_slot_completed(success=False)
                return

            inserted = result.inserted if isinstance(result, JobResult) else None
            skipped = result.skipped if isinstance(result, JobResult) else None
            completed = self.complete_sync_slot(
                run_id=run_id,
                final_state="done",
                inserted=inserted,
                skipped=skipped,
            )
            if completed:
                self._on_slot_completed(success=True)
