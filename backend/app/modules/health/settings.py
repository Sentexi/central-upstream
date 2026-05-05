import sqlite3
from urllib.parse import urljoin

from flask import request

from .routes import _get_repository
from ...core.settings_provider import ModuleSettingsProvider, SettingsField


class HealthSettingsProvider(ModuleSettingsProvider):
    module_id = "health"
    module_name = "Health"

    def get_settings_schema(self) -> list[SettingsField]:
        ingest_path = "/api/health/ingest"
        ingest_url = urljoin(request.url_root, ingest_path.lstrip("/")) if request else ingest_path
        try:
            api_header, _ = _get_repository().get_ingest_api_key()
            syncing = False
        except sqlite3.OperationalError as exc:
            if "database is locked" not in str(exc).lower():
                raise
            api_header = "syncing"
            syncing = True

        api_key_help = (
            "Wird aus Sicherheitsgruenden nicht direkt angezeigt. "
            "Klicke Anzeigen oder Rotieren, um den Schluessel zu erhalten."
        )
        if syncing:
            api_key_help = "Sync laeuft, der Schluessel kann gleich abgerufen werden."

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
                "help_text": "Nur lesend, kopiere den Pfad falls du die Basis-URL manuell setzen musst.",
                "read_only": True,
            },
            {
                "key": "ingest_api_header",
                "label": "API Header",
                "type": "string",
                "required": False,
                "default": api_header,
                "help_text": "Header-Name fuer den Ingest.",
                "read_only": True,
            },
            {
                "key": "ingest_api_key",
                "label": "API Key",
                "type": "password",
                "required": False,
                "default": "",
                "help_text": api_key_help,
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
            "endpoint": "/api/health/manual_ingest",
            "label": "Manueller Health Import",
            "help_text": "JSON-Export der Health Auto Export App hochladen. Startet direkt einen Sync.",
            "accept": ["application/json", ".json"],
            "upload_kind": "json",
            "success_message": "Sync wird gestartet...",
            "error_message": "Import fehlgeschlagen",
        }


settings_provider = HealthSettingsProvider()
