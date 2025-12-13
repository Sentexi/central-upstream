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
                "key": "notion_database_id",
                "label": "Notion Database ID",
                "type": "string",
                "required": True,
                "help_text": "Notion Database ID (z.B. aus dem Share-Link).",
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

        database_id = str(settings.get("notion_database_id", "")).strip()
        if not database_id:
            return False, "Notion Database ID darf nicht leer sein."

        base_url = settings.get("notion_api_base_url", "https://api.notion.com/v1")
        version = settings.get("notion_api_version", "2025-09-03")
        headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": version,
            "Content-Type": "application/json",
        }

        # 1) Token check
        try:
            auth_resp = requests.get(f"{base_url}/users/me", headers=headers, timeout=5)
        except requests.RequestException:
            return False, "Netzwerkfehler bei der Notion API-Überprüfung."

        if auth_resp.status_code == 401:
            return False, "Token ungültig oder abgelaufen."
        if auth_resp.status_code == 403:
            return False, "Token hat keinen Zugriff auf die Notion API."
        if auth_resp.status_code >= 500:
            return False, "Notion API aktuell nicht erreichbar (Serverfehler)."
        if auth_resp.status_code >= 400:
            return False, f"Notion API Fehler bei Token-Check ({auth_resp.status_code})."

        # 2) Database-ID check
        try:
            db_resp = requests.get(f"{base_url}/databases/{database_id}", headers=headers, timeout=5)
        except requests.RequestException:
            return False, "Netzwerkfehler beim Prüfen der Database ID."

        if db_resp.status_code == 401:
            return False, "Token ungültig für Database Zugriff."
        if db_resp.status_code == 403:
            return False, "Token hat keinen Zugriff auf diese Database."
        if db_resp.status_code == 404:
            return False, "Database ID wurde nicht gefunden."
        if db_resp.status_code >= 500:
            return False, "Notion API aktuell nicht erreichbar (Serverfehler)."
        if db_resp.status_code >= 400:
            return False, f"Notion API Fehler bei Database-Check ({db_resp.status_code})."

        return True, None


settings_provider = NotionSettingsProvider()
