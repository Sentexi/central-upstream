"""Health specific sync manager.

Wires the BaseSyncManager up against the health.sqlite tables and the
HealthRepository ingest pipeline. The actual ingest work runs inside the
daemon thread spawned by the base class.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from typing import Any

from ...core.sync_manager import BaseSyncManager, JobResult, SyncStateWriter
from .repository import HealthRepository
from .workout_repository import WorkoutRepository


LEGACY_LOCK_FILENAME = "health.lock"
LEGACY_SYNC_STATUS_FILENAME = "sync_status.json"


class HealthSyncManager(BaseSyncManager):
    def __init__(
        self,
        repo: HealthRepository,
        app,
        workout_repo: WorkoutRepository | None = None,
    ):
        super().__init__(
            db_path=repo.db_path,
            app=app,
            table_state="health_sync_state",
            table_history="health_sync_history",
        )
        self._repo = repo
        self._workout_repo = workout_repo or WorkoutRepository(repo.db_path)
        self._migrate_legacy_lock_files()

    # --- Public entrypoint -------------------------------------------------

    def start_ingest(
        self,
        *,
        payload: Any,
        client: str,
        replace_existing: bool = True,
        force: bool = False,
    ):
        """Reserve the slot, persist the payload, dispatch the worker thread.

        Order matters: acquiring the slot may archive any stale payload that
        is still sitting in ``current/`` (via ``_on_slot_archived``). We
        persist the new payload only AFTER acquire so that archive sweep
        cannot accidentally take our fresh file with it.
        """

        # Imported here to avoid a circular import at module load time.
        from .routes import _persist_current_payload

        batch_timestamp = int(datetime.now(tz=timezone.utc).timestamp())
        run_id = self.acquire_sync_slot(
            client=client,
            batch_timestamp=batch_timestamp,
            force=force,
        )
        try:
            payload_path = _persist_current_payload(payload)
        except Exception:
            # We have already taken the slot. Release it as error so the
            # state row does not stay in 'normalizing' forever.
            self.complete_sync_slot(
                run_id=run_id,
                final_state="error",
                last_error="failed to persist payload to disk",
            )
            raise

        thread = threading.Thread(
            target=self._thread_entry,
            args=(
                run_id,
                batch_timestamp,
                {"payload_path": payload_path, "replace_existing": replace_existing},
            ),
            daemon=True,
            name=f"{self.__class__.__name__}-{run_id[:8]}",
        )
        with self._thread_lock:
            self._thread = thread
        thread.start()
        return self.get_state()

    # --- BaseSyncManager hooks --------------------------------------------

    def _on_slot_archived(self):
        self._archive_current_payloads()

    def _run_job(
        self,
        state_writer: SyncStateWriter,
        *,
        payload_path: str,
        replace_existing: bool = True,
    ) -> JobResult:
        # Imports inside the method to avoid a circular import at module
        # load time: routes.py imports SyncBusyError from core.sync_manager,
        # and HealthSyncManager is created from module.py which is imported
        # before routes.py during app discovery.
        from .routes import (
            _archive_payload,
            _normalize_payload,
            _persist_failed_payload,
        )

        try:
            with open(payload_path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            self._persist_payload_failure(payload_path, _persist_failed_payload, _archive_payload, payload=None)
            raise ValueError(f"payload could not be read: {exc}")

        try:
            normalized = list(_normalize_payload(payload))
        except Exception as exc:  # pragma: no cover - defensive
            self._persist_payload_failure(payload_path, _persist_failed_payload, _archive_payload, payload)
            raise ValueError(f"payload could not be normalized: {exc}")

        if not normalized:
            self._persist_payload_failure(payload_path, _persist_failed_payload, _archive_payload, payload)
            raise ValueError("no valid records in payload")

        state_writer.set_total(len(normalized))

        def _on_progress(processed_count: int):
            state_writer.set_progress(processed_count)

        workout_records = [
            record
            for record in normalized
            if record.data_type.casefold() == "workouts"
        ]
        generic_records = [
            record
            for record in normalized
            if record.data_type.casefold() != "workouts"
        ]

        stats = {
            "inserted": 0,
            "skipped": 0,
            "by_type": {},
        }
        if generic_records:
            generic_stats = self._repo.ingest_records(
                generic_records,
                batch_ts=state_writer.batch_timestamp,
                progress_callback=_on_progress,
                replace_existing=replace_existing,
            )
            stats["inserted"] += generic_stats["inserted"]
            stats["skipped"] += generic_stats["skipped"]
            stats["by_type"].update(generic_stats["by_type"])
            self._repo.remove_duplicate_rows()

        if workout_records:
            generic_count = len(generic_records)

            def _on_workout_progress(processed_count: int):
                state_writer.set_progress(generic_count + processed_count)

            workout_stats = self._workout_repo.ingest_records(
                workout_records,
                batch_ts=state_writer.batch_timestamp,
                progress_callback=_on_workout_progress,
            )
            stats["inserted"] += workout_stats["inserted"]
            stats["skipped"] += workout_stats["skipped"]
            stats["by_type"].update(workout_stats["by_type"])

        # Keep the legacy metadata fallback current even for workout-only
        # payloads, which deliberately bypass the generic table-per-type store.
        if not generic_records:
            self._repo.ingest_records(
                [],
                batch_ts=state_writer.batch_timestamp,
                replace_existing=False,
            )

        _archive_payload(payload_path)

        return JobResult(
            inserted=stats["inserted"],
            skipped=stats["skipped"],
            by_type=stats["by_type"],
        )

    # --- Helpers -----------------------------------------------------------

    @staticmethod
    def _persist_payload_failure(
        payload_path: str,
        persist_failed_fn,
        archive_fn,
        payload: Any,
    ):
        if payload is not None:
            try:
                persist_failed_fn(payload)
            except Exception:  # pragma: no cover - best effort
                pass
        try:
            archive_fn(payload_path)
        except Exception:  # pragma: no cover - best effort
            pass

    def _archive_current_payloads(self):
        directory = os.path.dirname(self._db_path) or "."
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

    def _migrate_legacy_lock_files(self):
        directory = os.path.dirname(self._db_path) or "."
        lock_path = os.path.join(directory, LEGACY_LOCK_FILENAME)
        status_path = os.path.join(directory, LEGACY_SYNC_STATUS_FILENAME)
        current_dir = os.path.join(directory, "current")
        archive_dir = os.path.join(directory, "payloads")

        if not (os.path.exists(lock_path) or os.path.exists(status_path)):
            return

        legacy_started_at = None
        legacy_total = 0
        legacy_processed = 0
        legacy_batch_ts = None

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

        finished_iso = datetime.now(tz=timezone.utc).isoformat()
        if legacy_started_at is None:
            legacy_started_at = finished_iso
        if legacy_batch_ts is None:
            try:
                legacy_batch_ts = int(
                    datetime.fromisoformat(legacy_started_at.replace("Z", "+00:00")).timestamp()
                )
            except (TypeError, ValueError):
                legacy_batch_ts = int(datetime.now(tz=timezone.utc).timestamp())

        with self._connect() as conn:
            conn.execute(
                f"""
                INSERT INTO {self._table_history}
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
