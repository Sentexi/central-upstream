from copy import deepcopy
from datetime import datetime
from threading import Lock, Thread
from typing import Any, Dict

from flask import current_app

from .sync import SyncResult, run_full_sync


class NotionSyncManager:
    def __init__(self) -> None:
        self._lock = Lock()
        self._state: Dict[str, Any] = {
            "status": "idle",
            "processed": 0,
            "total": 0,
            "mode": "refresh",
            "error": None,
            "result": None,
            "started_at": None,
            "finished_at": None,
        }
        self._thread: Thread | None = None

    def start_sync(self, force_full: bool = False) -> Dict[str, Any]:
        with self._lock:
            if self._state.get("status") == "running":
                return deepcopy(self._state)

            app = current_app._get_current_object()
            self._state.update(
                {
                    "status": "running",
                    "processed": 0,
                    "total": 0,
                    "mode": "full" if force_full else "refresh",
                    "error": None,
                    "started_at": datetime.utcnow().isoformat() + "Z",
                    "finished_at": None,
                }
            )

            self._thread = Thread(target=self._run_sync, args=(app, force_full), daemon=True)
            self._thread.start()
            return deepcopy(self._state)

    def _run_sync(self, app, force_full: bool) -> None:  # pragma: no cover - background worker
        with app.app_context():
            def _report_progress(processed: int, total: int) -> None:
                with self._lock:
                    self._state["processed"] = processed
                    self._state["total"] = total

            result: SyncResult = run_full_sync(progress_callback=_report_progress)

            with self._lock:
                self._state["result"] = result
                self._state["status"] = "completed" if result.get("ok") else "error"
                self._state["error"] = None if result.get("ok") else (result.get("error") or "Sync failed")
                self._state["finished_at"] = datetime.utcnow().isoformat() + "Z"

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return deepcopy(self._state)


sync_manager = NotionSyncManager()
