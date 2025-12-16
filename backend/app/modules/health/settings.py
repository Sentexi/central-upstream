from urllib.parse import urljoin

from flask import request

from app.core.settings_provider import ModuleSettingsProvider, SettingsField


class HealthSettingsProvider(ModuleSettingsProvider):
    module_id = "health"
    module_name = "Health"

    def get_settings_schema(self) -> list[SettingsField]:
        ingest_path = "/api/health/ingest"
        ingest_url = urljoin(request.url_root, ingest_path.lstrip("/")) if request else ingest_path

        return [
            {
                "key": "ingest_url",
                "label": "Endpoint URL",
                "type": "string",
                "required": False,
                "default": ingest_url,
                "help_text": "Auto Export sendet den JSON-Export per POST an diese URL.",
                "read_only": True,
            },
            {
                "key": "ingest_path",
                "label": "Endpoint Pfad",
                "type": "string",
                "required": False,
                "default": ingest_path,
                "help_text": "Nur lesend – kopiere den Pfad, falls du die Basis-URL manuell setzen musst.",
                "read_only": True,
            },
        ]

    def validate_settings(self, settings: dict):
        # Es gibt keine externen Credentials zu prüfen.
        return True, None


settings_provider = HealthSettingsProvider()
