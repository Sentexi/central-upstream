from __future__ import annotations

from datetime import datetime, timezone
from typing import Tuple

import requests
from flask import current_app

from ...core.settings_provider import ModuleSettingsProvider, SettingsField
from ...core.settings_storage import settings_storage


class CaloriesSettingsProvider(ModuleSettingsProvider):
    module_id = "calories"
    module_name = "Calories"

    def get_settings_schema(self) -> list[SettingsField]:
        return [
            {
                "key": "api_key",
                "label": "LLM API Key",
                "type": "password",
                "required": True,
                "default": "",
                "help_text": "OpenAI-kompatibler Key für die strukturierte Kalorien-Extraktion.",
            },
            {
                "key": "last_checked_at",
                "label": "Last checked",
                "type": "string",
                "required": False,
                "default": "",
                "read_only": True,
                "help_text": "Zeitpunkt des letzten Key-Checks.",
            },
            {
                "key": "is_valid",
                "label": "Key gültig",
                "type": "boolean",
                "required": False,
                "default": False,
                "read_only": True,
                "help_text": "Letztes Testergebnis für den LLM-Key.",
            },
        ]

    def validate_settings(self, settings: dict) -> Tuple[bool, str | None]:
        api_key = str(settings.get("api_key", "")).strip()
        if not api_key:
            return False, "Bitte hinterlege einen API-Key."

        ok, error = self._probe_llm(api_key)
        now_iso = datetime.now(timezone.utc).isoformat()

        # Persistiere Status unabhängig vom Save-Aufruf, damit das Frontend den Zustand anzeigen kann.
        settings_storage.save_settings_for_module(
            self.module_id,
            {
                "last_checked_at": now_iso,
                "is_valid": ok,
            },
        )

        if ok:
            return True, None
        return False, error or "LLM-Key konnte nicht validiert werden."

    def _probe_llm(self, api_key: str) -> Tuple[bool, str | None]:
        """Führt eine minimale Probeabfrage gegen ein OpenAI-kompatibles Endpoint aus."""
        endpoint = current_app.config.get(
            "CALORIES_LLM_ENDPOINT",
            "https://api.openai.com/v1/chat/completions",
        )
        model = current_app.config.get("CALORIES_LLM_MODEL", "gpt-4o-mini")
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": "Respond with a tiny JSON object {\"ok\":true}"},
                {"role": "user", "content": "Health check"},
            ],
            "response_format": {"type": "json_object"},
            "max_tokens": 16,
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = requests.post(endpoint, json=payload, headers=headers, timeout=10)
            if response.status_code == 401:
                return False, "Unauthorized / invalid API key"
            if response.status_code >= 500:
                return False, "LLM-Service nicht erreichbar"

            data = response.json()
            content = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )
            if content and "ok" in content:
                return True, None
        except requests.RequestException as exc:
            return False, str(exc)
        except Exception:
            return False, "Unbekannter Fehler beim Test"

        return False, "Antwort war nicht valide"

    def get_status_metadata(self):
        return {
            "endpoint": "/api/calories/settings/status",
            "label": "LLM Key",
            "value_key": "status",
        }


settings_provider = CaloriesSettingsProvider()
