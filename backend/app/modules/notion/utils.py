import json
import re
from typing import Any, Dict, Iterable


def normalize_column_name(name: str, existing: Iterable[str]) -> str:
    base = name.strip().lower()
    base = re.sub(r"\s+", "_", base)
    base = re.sub(r"[^a-z0-9_]+", "", base)
    if not base:
        base = "col"

    candidate = base
    counter = 2
    existing_set = set(existing)
    while candidate in existing_set:
        candidate = f"{base}_{counter}"
        counter += 1
    existing_set.add(candidate)
    return candidate


def map_notion_type_to_sqlite(notion_type: str) -> str:
    if notion_type in {"title", "rich_text", "select", "status", "email", "url", "phone_number"}:
        return "TEXT"
    if notion_type == "number":
        return "REAL"
    if notion_type == "checkbox":
        return "INTEGER"
    if notion_type == "date":
        return "TEXT"
    if notion_type in {"multi_select", "people", "relation", "files", "formula", "rollup"}:
        return "TEXT"
    return "TEXT"


def extract_rich_text(blocks: list[dict]) -> str:
    return "".join([block.get("plain_text") or "" for block in blocks])


def extract_property_value(prop: Dict[str, Any], notion_type: str) -> Any:
    if not prop:
        return None

    if notion_type == "title":
        return extract_rich_text(prop.get("title", []))
    if notion_type == "rich_text":
        return extract_rich_text(prop.get("rich_text", []))
    if notion_type in {"select", "status"}:
        selected = prop.get(notion_type)
        if isinstance(selected, dict):
            return selected.get("name")
        return None
    if notion_type == "email":
        return prop.get("email")
    if notion_type == "url":
        return prop.get("url")
    if notion_type == "phone_number":
        return prop.get("phone_number")
    if notion_type == "number":
        return prop.get("number")
    if notion_type == "checkbox":
        return int(bool(prop.get("checkbox")))
    if notion_type == "date":
        date_obj = prop.get("date") or {}
        if isinstance(date_obj, dict):
            return date_obj.get("start")
        return None
    if notion_type == "multi_select":
        values = prop.get("multi_select") or []
        return json.dumps([item.get("name") for item in values if item.get("name")])
    if notion_type in {"people", "relation", "files", "formula", "rollup"}:
        return json.dumps(prop.get(notion_type))
    return None
