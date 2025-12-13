import os
from app.core.module_base import BaseModule
from .routes import bp
from .schema import ensure_schema


class NotionModule(BaseModule):
    id = "notion"
    name = "Notion"
    version = "0.1.0"

    def init_app(self, app):
        db_path = app.config.get("NOTION_DB_PATH")
        if not db_path:
            db_path = os.path.join(app.root_path, "data", "notion.sqlite")
            app.config["NOTION_DB_PATH"] = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        ensure_schema(db_path)
        app.register_blueprint(bp, url_prefix="/api/modules/notion")

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["work_dashboard"]
        return manifest

    def check_ready(self) -> bool:
        # Module is ready when database exists and settings are present
        try:
            from app.core.settings_storage import settings_storage

            settings = settings_storage.get_settings_for_module(self.id)
            return bool(settings.get("notion_api_key") and settings.get("notion_database_id"))
        except Exception:
            return False


module = NotionModule()
