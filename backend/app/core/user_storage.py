import os
import sqlite3
from typing import Any, Dict, Optional

from werkzeug.security import check_password_hash, generate_password_hash


class UserStorage:
    """Lightweight SQLite-backed storage for application users."""

    def __init__(self):
        self.db_path: str | None = None

    def init_app(self, app):
        base_path = app.config.get("USER_DB_PATH")
        if not base_path:
            base_path = os.path.join(app.root_path, "users.sqlite")

        directory = os.path.dirname(base_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        self.db_path = base_path
        self._ensure_schema()
        self._ensure_default_user()

    def _connect(self):
        if not self.db_path:
            raise RuntimeError("UserStorage is not initialized.")

        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    must_change INTEGER NOT NULL DEFAULT 0
                )
                """
            )
            conn.commit()

    def _ensure_default_user(self):
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) as count FROM users").fetchone()
            if row and row["count"] > 0:
                return

            conn.execute(
                "INSERT INTO users (username, password_hash, must_change) VALUES (?, ?, ?)",
                ("admin", generate_password_hash("admin"), 1),
            )
            conn.commit()

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, password_hash, must_change FROM users WHERE username = ?",
                (username,),
            ).fetchone()

        return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT id, username, password_hash, must_change FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()

        return dict(row) if row else None

    def verify_password(self, user: Dict[str, Any], password: str) -> bool:
        return check_password_hash(user["password_hash"], password)

    def update_user(
        self,
        user_id: int,
        username: str,
        password: str,
        must_change: bool = False,
    ):
        with self._connect() as conn:
            conn.execute(
                """
                UPDATE users
                SET username = ?, password_hash = ?, must_change = ?
                WHERE id = ?
                """,
                (username, generate_password_hash(password), int(must_change), user_id),
            )
            conn.commit()


user_storage = UserStorage()
