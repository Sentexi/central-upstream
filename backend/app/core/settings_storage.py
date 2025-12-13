import json
import os
import sqlite3
from typing import Any, Dict


class SettingsStorage:
    """Lightweight SQLite-backed storage for module settings."""

    def __init__(self):
        self.db_path: str | None = None

    def init_app(self, app):
        base_path = app.config.get("SETTINGS_DB_PATH")
        if not base_path:
            base_path = os.path.join(app.root_path, "settings.sqlite")

        directory = os.path.dirname(base_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        self.db_path = base_path
        self._ensure_schema()

    def _connect(self):
        if not self.db_path:
            raise RuntimeError("SettingsStorage is not initialized.")

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS settings (
                    module_id TEXT NOT NULL,
                    key TEXT NOT NULL,
                    value TEXT NOT NULL,
                    UNIQUE(module_id, key)
                )
                """
            )
            conn.commit()

    def get_all_settings(self) -> Dict[str, Dict[str, Any]]:
        all_settings: Dict[str, Dict[str, Any]] = {}
        with self._connect() as conn:
            rows = conn.execute("SELECT module_id, key, value FROM settings").fetchall()
            for row in rows:
                all_settings.setdefault(row["module_id"], {})[row["key"]] = json.loads(
                    row["value"]
                )
        return all_settings

    def get_settings_for_module(self, module_id: str) -> Dict[str, Any]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT key, value FROM settings WHERE module_id = ?", (module_id,)
            ).fetchall()

        return {row["key"]: json.loads(row["value"]) for row in rows}

    def save_settings_for_module(self, module_id: str, values: Dict[str, Any]):
        with self._connect() as conn:
            for key, value in values.items():
                conn.execute(
                    "INSERT OR REPLACE INTO settings (module_id, key, value) VALUES (?, ?, ?)",
                    (module_id, key, json.dumps(value)),
                )
            conn.commit()


settings_storage = SettingsStorage()
