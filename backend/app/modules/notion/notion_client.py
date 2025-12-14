import time
from typing import Any, Dict, Iterable, List, Optional
import requests


class NotionClient:
    """Minimal Notion API client with pagination and retry handling."""

    def __init__(self, token: str, base_url: str, version: str):
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.version = version
        self.session = requests.Session()

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Notion-Version": self.version,
            "Content-Type": "application/json",
        }

    def _request(self, method: str, path: str, json: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        retries = 5
        backoff = 1
        for attempt in range(retries):
            try:
                resp = self.session.request(
                    method,
                    url,
                    headers=self._headers(),
                    json=json,
                    timeout=10,
                )
            except requests.RequestException as exc:
                if attempt == retries - 1:
                    raise
                time.sleep(backoff)
                backoff *= 2
                continue

            if resp.status_code in (401, 403):
                raise PermissionError("Notion API authentication failed")

            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt == retries - 1:
                    resp.raise_for_status()
                retry_after = int(resp.headers.get("Retry-After", backoff))
                time.sleep(retry_after)
                backoff *= 2
                continue

            if resp.status_code >= 400:
                resp.raise_for_status()

            return resp.json()

        raise RuntimeError("Max retries exceeded for Notion API")

    def search_database_by_name(self, name: str) -> Optional[dict]:
        payload = {
            "query": name,
            "filter": {"value": "database", "property": "object"},
            "page_size": 50,
        }
        data = self._request("POST", "/search", json=payload)
        candidates = data.get("results", [])
        exact = None
        fallback = None
        for item in candidates:
            title = self._extract_title(item.get("title", []))
            if title == name:
                exact = item
                break
            if fallback is None:
                fallback = item
        return exact or fallback

    def _extract_title(self, rich_text: List[dict]) -> str:
        parts: List[str] = []
        for block in rich_text:
            text = block.get("plain_text") or ""
            parts.append(text)
        return "".join(parts).strip()

    def retrieve_database(self, database_id: str) -> dict:
        return self._request("GET", f"/databases/{database_id}")

    def retrieve_data_source(self, data_source_id: str) -> dict:
        return self._request("GET", f"/data_sources/{data_source_id}")

    def retrieve_page(self, page_id: str) -> dict:
        return self._request("GET", f"/pages/{page_id}")

    def query_data_source(
        self,
        data_source_id: str,
        filter_obj: Optional[dict] = None,
        sorts: Optional[List[dict]] = None,
        start_cursor: Optional[str] = None,
        page_size: int = 100,
    ) -> Iterable[dict]:
        payload: Dict[str, Any] = {"page_size": page_size}
        if filter_obj:
            payload["filter"] = filter_obj
        if sorts:
            payload["sorts"] = sorts
        if start_cursor:
            payload["start_cursor"] = start_cursor

        while True:
            data = self._request("POST", f"/data_sources/{data_source_id}/query", json=payload)
            for result in data.get("results", []):
                yield result

            if not data.get("has_more"):
                break
            payload["start_cursor"] = data.get("next_cursor")

    def query_database(
        self,
        database_id: str,
        filter_obj: Optional[dict] = None,
        sorts: Optional[List[dict]] = None,
        start_cursor: Optional[str] = None,
        page_size: int = 100,
    ) -> Iterable[dict]:
        payload: Dict[str, Any] = {"page_size": page_size}
        if filter_obj:
            payload["filter"] = filter_obj
        if sorts:
            payload["sorts"] = sorts
        if start_cursor:
            payload["start_cursor"] = start_cursor

        while True:
            data = self._request("POST", f"/databases/{database_id}/query", json=payload)
            for result in data.get("results", []):
                yield result

            if not data.get("has_more"):
                break
            payload["start_cursor"] = data.get("next_cursor")

