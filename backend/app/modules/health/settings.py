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

    def get_status_metadata(self):
        return {
            "endpoint": "/api/health/status",
            "label": "Last sync",
            "value_key": "last_imported_at",
            "formatter": "datetime",
            "stage_labels": {
                "normalizing": "Payload validieren",
                "ingesting": "Import läuft",
                "done": "Import abgeschlossen",
                "error": "Fehler beim Import",
            },
            "upload_hint": "Lade einen Health Auto Export als JSON hoch, um den Import manuell zu starten.",
        }

    def get_manual_import_metadata(self):
        return {
            "endpoint": "/api/health/ingest",
            "label": "Manueller Health Import",
            "help_text": "JSON-Export der Health Auto Export App hochladen. Startet direkt einen Sync.",
            "accept": ["application/json", ".json"],
            "upload_kind": "json",
            "success_message": "Sync wird gestartet...",
            "error_message": "Import fehlgeschlagen",
        }


settings_provider = HealthSettingsProvider()
