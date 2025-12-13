import hashlib
import json
from typing import Any, Dict, List, Optional


def extract_plain_text(rich_text: List[dict]) -> str:
    parts: List[str] = []
    for block in rich_text:
        text = block.get("plain_text") or ""
        parts.append(text)
    return "".join(parts).strip()


def extract_title(properties: Dict[str, Any]) -> Optional[str]:
    for _key, value in properties.items():
        if value.get("type") == "title":
            return extract_plain_text(value.get("title", []))
    return None


def extract_select(properties: Dict[str, Any], names: List[str]) -> Optional[str]:
    for candidate in names:
        prop = properties.get(candidate)
        if prop and prop.get("type") in {"select", "status"}:
            selected = prop.get(prop.get("type"))
            if isinstance(selected, dict):
                return selected.get("name")
    for _key, prop in properties.items():
        if prop.get("type") in {"select", "status"}:
            selected = prop.get(prop.get("type"))
            if isinstance(selected, dict):
                return selected.get("name")
    return None


def extract_date(properties: Dict[str, Any], names: List[str]) -> Optional[str]:
    for candidate in names:
        prop = properties.get(candidate)
        if prop and prop.get("type") == "date":
            date_obj = prop.get("date")
            if isinstance(date_obj, dict):
                return date_obj.get("start")
    for _key, prop in properties.items():
        if prop.get("type") == "date":
            date_obj = prop.get("date")
            if isinstance(date_obj, dict):
                return date_obj.get("start")
    return None


def extract_multi_select(properties: Dict[str, Any], names: List[str]) -> List[str]:
    prop = None
    for candidate in names:
        maybe = properties.get(candidate)
        if maybe and maybe.get("type") == "multi_select":
            prop = maybe
            break
    if not prop:
        for _key, value in properties.items():
            if value.get("type") == "multi_select":
                prop = value
                break
    if not prop:
        return []
    tags = prop.get("multi_select") or []
    return [tag.get("name") for tag in tags if tag.get("name")]


def compute_content_hash(task: Dict[str, Any]) -> str:
    relevant = [
        task.get("title", ""),
        task.get("status", ""),
        task.get("due_date", ""),
        task.get("project", ""),
        task.get("area", ""),
        task.get("priority", ""),
        task.get("assignee", ""),
        task.get("tags_json", ""),
    ]
    payload = "|".join([str(x) for x in relevant])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalize_task(page: Dict[str, Any], property_map: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    properties = page.get("properties", {}) or {}
    property_map = property_map or {}

    def mapped_names(default_names: List[str], key: str) -> List[str]:
        mapped = property_map.get(key)
        return [mapped] if mapped else default_names

    title = extract_title(properties)
    if not title:
        mapped_title = property_map.get("title")
        if mapped_title and mapped_title in properties:
            title_prop = properties[mapped_title]
            if title_prop.get("type") == "title":
                title = extract_plain_text(title_prop.get("title", []))
    if not title:
        for candidate in properties.values():
            if candidate.get("type") == "rich_text":
                title = extract_plain_text(candidate.get("rich_text", []))
                break
    status = extract_select(properties, mapped_names(["Status", "State"], "status"))
    due_date = extract_date(properties, mapped_names(["Due", "Fällig", "Due Date"], "due_date"))
    project = extract_select(properties, mapped_names(["Project", "Projekt"], "project"))
    area = extract_select(properties, mapped_names(["Area", "Team"], "area"))
    priority = extract_select(properties, mapped_names(["Priority", "Prio"], "priority"))
    tags = extract_multi_select(properties, mapped_names(["Tags", "Labels"], "tags"))

    parent = page.get("parent", {}) or {}
    data_source_id = parent.get("data_source_id") or parent.get("database_id")

    task = {
        "id": page.get("id"),
        "database_id": data_source_id,
        "title": title or "",
        "status": status,
        "due_date": due_date,
        "project": project,
        "area": area,
        "priority": priority,
        "assignee": None,
        "tags_json": json.dumps(tags) if tags else None,
        "url": page.get("url"),
        "archived": int(bool(page.get("archived"))),
        "created_time": page.get("created_time"),
        "last_edited_time": page.get("last_edited_time"),
    }
    task["content_hash"] = compute_content_hash(task)
    return task

