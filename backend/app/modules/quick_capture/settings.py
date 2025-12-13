from app.core.settings_provider import ModuleSettingsProvider, SettingsField


class QuickCaptureSettingsProvider(ModuleSettingsProvider):
    module_id = "quick_capture"
    module_name = "Quick Capture"

    def get_settings_schema(self) -> list[SettingsField]:
        return [
            {
                "key": "api_token",
                "label": "API Token",
                "type": "password",
                "required": True,
                "help_text": "Token für die Synchronisation mit deinem Inbox-Backend.",
                "default": "",
            },
            {
                "key": "capture_inbox",
                "label": "Inbox-Name",
                "type": "string",
                "required": False,
                "help_text": "Optional: Lege fest, in welcher Inbox Quick Capture speichert.",
                "default": "default",
            },
        ]

    def validate_settings(self, settings: dict):
        token = settings.get("api_token", "").strip()
        if len(token) < 8:
            return False, "API Token muss mindestens 8 Zeichen haben."

        # Demo-Validierung: Wir prüfen nur, ob ein Token vorhanden ist.
        return True, None


settings_provider = QuickCaptureSettingsProvider()
