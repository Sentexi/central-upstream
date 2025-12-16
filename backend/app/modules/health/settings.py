from app.core.settings_provider import ModuleSettingsProvider, SettingsField


class HealthSettingsProvider(ModuleSettingsProvider):
    module_id = "health"
    module_name = "Health"

    def get_settings_schema(self) -> list[SettingsField]:
        # Das Health-Modul stellt die Einstellungen über einen eigenen Endpoint bereit,
        # daher werden hier keine Formular-Felder definiert.
        return []

    def validate_settings(self, settings: dict):
        # Es gibt keine externen Credentials zu prüfen.
        return True, None


settings_provider = HealthSettingsProvider()
