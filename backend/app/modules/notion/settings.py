from typing import Any, Dict, Tuple
import requests
from app.core.settings_provider import ModuleSettingsProvider, SettingsField


class NotionSettingsProvider(ModuleSettingsProvider):
    module_id = "notion"
    module_name = "Notion"

    def get_settings_schema(self) -> list[SettingsField]:
        return [
            {
                "key": "notion_api_key",
                "label": "Notion API Key",
                "type": "password",
                "required": True,
                "help_text": "Notion Internal Integration Secret (Bearer Token).",
            },
            {
                "key": "notion_db_name",
                "label": "Notion DB Name",
                "type": "string",
                "required": True,
                "help_text": "Eindeutiger Name der Notion Datenbank (für Lookup).",
            },
            {
                "key": "notion_data_source_name",
                "label": "Data Source Name",
                "type": "string",
                "required": False,
                "help_text": "Optional: Name der Data Source, wenn eine Database mehrere Tabellen enthält.",
            },
            {
                "key": "notion_api_base_url",
                "label": "API Base URL",
                "type": "string",
                "required": False,
                "default": "https://api.notion.com/v1",
            },
            {
                "key": "notion_api_version",
                "label": "API Version",
                "type": "string",
                "required": False,
                "default": "2025-09-03",
            },
            {
                "key": "sync_mode",
                "label": "Sync Mode",
                "type": "string",
                "required": False,
                "default": "incremental",
                "help_text": "incremental oder full",
            },
        ]

    def validate_settings(self, settings: Dict[str, Any]) -> Tuple[bool, str | None]:
        token = str(settings.get("notion_api_key", "")).strip()
        if len(token) < 10:
            return False, "Notion API Key ist zu kurz."

        db_name = str(settings.get("notion_db_name", "")).strip()
        if not db_name:
            return False, "Notion DB Name darf nicht leer sein."

        # Optional lightweight validation using search endpoint
        base_url = settings.get("notion_api_base_url", "https://api.notion.com/v1")
        version = settings.get("notion_api_version", "2025-09-03")
        try:
            resp = requests.post(
                f"{base_url}/search",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Notion-Version": version,
                    "Content-Type": "application/json",
                },
                json={"query": db_name, "page_size": 1, "filter": {"value": "database", "property": "object"}},
                timeout=5,
            )
            if resp.status_code == 401:
                return False, "Token ungültig / fehlende Rechte."
            if resp.status_code >= 400:
                return False, f"Notion API Fehler ({resp.status_code})."
        except requests.RequestException:
            # If the network check fails, still accept syntactically valid settings
            return True, None

        return True, None


settings_provider = NotionSettingsProvider()
