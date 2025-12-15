import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from .schema import ensure_schema


class NotionRepository:
    def __init__(self, db_path: str):
        self.db_path = db_path
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        ensure_schema(self.db_path)

    def _connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    # Meta helpers
    def get_meta(self, key: str) -> Optional[str]:
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM notion_meta WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None

    def set_meta(self, key: str, value: str):
        with self._connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO notion_meta (key, value) VALUES (?, ?)", (key, value)
            )
            conn.commit()

    def get_all_meta(self) -> Dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute("SELECT key, value FROM notion_meta").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def save_schema_json(self, schema: Dict[str, Any]):
        self.set_meta("schema_json", json.dumps(schema))

    def get_schema_json(self) -> Optional[Dict[str, Any]]:
        value = self.get_meta("schema_json")
        return json.loads(value) if value else None

    def save_property_map(self, property_map: Dict[str, Dict[str, Any]]):
        self.set_meta("property_map_json", json.dumps(property_map))

    def get_property_map(self) -> Dict[str, Dict[str, Any]]:
        value = self.get_meta("property_map_json")
        return json.loads(value) if value else {}

    # Schema helpers
    def _existing_columns(self, table: str) -> List[str]:
        with self._connect() as conn:
            rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return [row["name"] for row in rows]

    def ensure_wide_table(self, property_map: Dict[str, Dict[str, Any]]):
        existing = set(self._existing_columns("notion_rows"))
        base_columns = {
            "id": "TEXT",
            "last_edited_time": "TEXT",
            "created_time": "TEXT",
            "archived": "INTEGER",
            "url": "TEXT",
        }
        missing_base = set(base_columns.keys()) - existing
        if missing_base:
            with self._connect() as conn:
                for column in missing_base:
                    conn.execute(f"ALTER TABLE notion_rows ADD COLUMN {column} {base_columns[column]}")
                conn.commit()
            existing.update(missing_base)

        columns_to_add: List[Tuple[str, str]] = []
        for entry in property_map.values():
            column = entry.get("column")
            sqlite_type = entry.get("sqlite_type", "TEXT")
            if column and column not in existing:
                columns_to_add.append((column, sqlite_type))

        if columns_to_add:
            with self._connect() as conn:
                for column, col_type in columns_to_add:
                    conn.execute(f"ALTER TABLE notion_rows ADD COLUMN {column} {col_type}")
                conn.commit()

    # Data upserts
    def upsert_page_raw(
        self,
        page_id: str,
        raw_json: dict,
        last_edited_time: str,
        created_time: str,
        archived: bool,
        synced_at: str,
    ):
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO notion_rows_raw
                (id, raw_json, last_edited_time, created_time, archived, synced_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    page_id,
                    json.dumps(raw_json),
                    last_edited_time,
                    created_time,
                    int(archived),
                    synced_at,
                ),
            )
            conn.commit()

    def upsert_row(self, row_data: Dict[str, Any]):
        columns = list(row_data.keys())
        placeholders = ":" + ", :".join(columns)
        column_clause = ", ".join(columns)
        update_clause = ", ".join([f"{col}=excluded.{col}" for col in columns if col != "id"])
        sql = (
            f"INSERT INTO notion_rows ({column_clause}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {update_clause}"
        )
        with self._connect() as conn:
            conn.execute(sql, row_data)
            conn.commit()

    def replace_relations_for_page(
        self, page_id: str, relations: Iterable[Dict[str, Any]]
    ) -> None:
        rows = [
            (
                page_id,
                rel.get("property_name"),
                rel.get("property_value"),
                rel.get("to_page_id"),
                rel.get("position", 0),
                rel.get("value"),
            )
            for rel in relations
        ]
        with self._connect() as conn:
            conn.execute("DELETE FROM notion_relations WHERE from_page_id = ?", (page_id,))
            if rows:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO notion_relations
                    (from_page_id, property_name, property_value, to_page_id, position, value)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    rows,
                )
            conn.commit()

    def get_relations_for_pages(
        self, page_ids: Iterable[str]
    ) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
        page_ids = list(page_ids)
        if not page_ids:
            return {}
        placeholders = ",".join(["?"] * len(page_ids))
        sql = (
            f"SELECT from_page_id, property_name, property_value, to_page_id, position, value "
            f"FROM notion_relations WHERE from_page_id IN ({placeholders})"
            " ORDER BY position"
        )
        with self._connect() as conn:
            rows = conn.execute(sql, page_ids).fetchall()

        relations: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
        for row in rows:
            page_relations = relations.setdefault(row["from_page_id"], {})
            prop_relations = page_relations.setdefault(row["property_name"], [])
            prop_relations.append(
                {
                    "to_page_id": row["to_page_id"],
                    "position": row["position"],
                    "property_value": row["property_value"],
                    "value": row["value"],
                }
            )
        return relations

    def update_relation_columns(self, property_map: Dict[str, Dict[str, Any]]) -> None:
        relation_properties: Dict[str, Dict[str, Any]] = {
            name: meta for name, meta in property_map.items() if meta.get("type") == "relation"
        }
        if not relation_properties:
            return

        relation_columns = {name: meta.get("column") or name for name, meta in relation_properties.items()}

        with self._connect() as conn:
            page_rows = conn.execute("SELECT id FROM notion_rows").fetchall()
            page_ids = [row["id"] for row in page_rows if row["id"]]

        if not page_ids:
            return

        relations = self.get_relations_for_pages(page_ids)

        to_page_ids: List[str] = []
        for rels in relations.values():
            for entries in rels.values():
                to_page_ids.extend(
                    [entry.get("to_page_id") for entry in entries if entry.get("to_page_id")]
                )
        cached_targets = self.get_cached_pages(to_page_ids)

        updates: List[Tuple[Any, ...]] = []
        for page_id in page_ids:
            row_relations = relations.get(page_id, {})
            row_updates: Dict[str, str] = {}
            for prop_name, entries in row_relations.items():
                column_name = relation_columns.get(prop_name)
                if not column_name:
                    column_name = next(
                        (
                            entry.get("property_value")
                            for entry in entries
                            if entry.get("property_value")
                        ),
                        None,
                    )
                if not column_name:
                    continue
                relation_values: List[Optional[str]] = []
                for entry in sorted(entries, key=lambda e: e.get("position", 0)):
                    target = cached_targets.get(entry.get("to_page_id")) or {}
                    title = target.get("title") or ""
                    relation_value = entry.get("value") or title or entry.get("to_page_id")
                    relation_values.append(relation_value)
                if relation_values:
                    row_updates[column_name] = json.dumps(relation_values)
            if row_updates:
                columns_clause = ", ".join([f"{col} = ?" for col in row_updates.keys()])
                values = list(row_updates.values())
                values.append(page_id)
                updates.append((columns_clause, values))

        if not updates:
            return

        with self._connect() as conn:
            for columns_clause, values in updates:
                conn.execute(
                    f"UPDATE notion_rows SET {columns_clause} WHERE id = ?",  # noqa: S608
                    values,
                )
            conn.commit()

    def get_cached_pages(self, ids: Iterable[str]) -> Dict[str, Dict[str, Any]]:
        id_list = list(ids)
        if not id_list:
            return {}
        placeholders = ",".join(["?"] * len(id_list))
        sql = f"SELECT * FROM notion_page_cache WHERE id IN ({placeholders})"
        with self._connect() as conn:
            rows = conn.execute(sql, id_list).fetchall()
        return {row["id"]: dict(row) for row in rows}

    def filter_missing_or_stale_targets(
        self, ids: Iterable[str], max_age_days: int = 7
    ) -> List[str]:
        id_list = list(ids)
        if not id_list:
            return []

        cached = self.get_cached_pages(id_list)
        cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        missing: List[str] = []
        for page_id in id_list:
            entry = cached.get(page_id)
            if not entry:
                missing.append(page_id)
                continue
            synced_at = entry.get("synced_at")
            try:
                synced_dt = datetime.fromisoformat(synced_at.replace("Z", "+00:00")) if synced_at else None
            except ValueError:
                synced_dt = None
            if not synced_dt or synced_dt < cutoff:
                missing.append(page_id)
        return missing

    def upsert_page_cache(
        self,
        page_id: str,
        title: Optional[str],
        url: Optional[str],
        last_edited_time: Optional[str],
        raw_json: Optional[dict],
        synced_at: str,
    ) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO notion_page_cache
                (id, title, url, last_edited_time, raw_json, synced_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    page_id,
                    title,
                    url,
                    last_edited_time,
                    json.dumps(raw_json) if raw_json is not None else None,
                    synced_at,
                ),
            )
            conn.commit()

    # Queries
    def query_rows(
        self,
        property_map: Dict[str, Dict[str, Any]],
        q: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
        sort: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        filters = filters or {}
        where: List[str] = []
        params: List[Any] = []

        text_columns = [entry.get("column") for entry in property_map.values() if entry.get("sqlite_type") == "TEXT"]
        text_columns.extend(["url"])

        if q and text_columns:
            like = f"%{q}%"
            clauses = [f"{col} LIKE ?" for col in text_columns if col]
            where.append("(" + " OR ".join(clauses) + ")")
            params.extend([like] * len(clauses))

        for label, value in filters.items():
            column_name = None
            entry = property_map.get(label)
            if entry:
                column_name = entry.get("column")
                notion_type = entry.get("type")
            else:
                column_name = label
                notion_type = None

            if not column_name:
                continue

            if isinstance(value, dict) and ("from" in value or "to" in value):
                if value.get("from"):
                    where.append(f"{column_name} >= ?")
                    params.append(value.get("from"))
                if value.get("to"):
                    where.append(f"{column_name} <= ?")
                    params.append(value.get("to"))
                continue

            if isinstance(value, list):
                placeholders = ",".join(["?"] * len(value))
                where.append(f"{column_name} IN ({placeholders})")
                params.extend(value)
                continue

            if notion_type == "checkbox":
                value = int(bool(value))

            where.append(f"{column_name} = ?")
            params.append(value)

        where_clause = " AND ".join(where) if where else "1=1"

        order_clause = "last_edited_time DESC"
        if sort:
            parts = sort.split(":")
            if len(parts) == 2:
                col, direction = parts
                direction = direction.lower() in {"desc", "descending"}
                column_name = property_map.get(col, {}).get("column") or col
                order_clause = f"{column_name} {'DESC' if direction else 'ASC'}"

        sql = f"SELECT * FROM notion_rows WHERE {where_clause} ORDER BY {order_clause} LIMIT ? OFFSET ?"
        params_with_limit = params + [limit, offset]
        count_sql = f"SELECT COUNT(*) as cnt FROM notion_rows WHERE {where_clause}"

        with self._connect() as conn:
            rows = conn.execute(sql, params_with_limit).fetchall()
            total_row = conn.execute(count_sql, params).fetchone()

        total = total_row["cnt"] if total_row else 0
        return [dict(row) for row in rows], total
