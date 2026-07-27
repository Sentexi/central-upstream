from ...core.module_base import BaseModule


class CaloriesModule(BaseModule):
    id = "calories"
    name = "Calories"
    version = "0.1.0"

    def init_app(self, app):
        from .routes import calories_bp, close_calories_conn

        app.register_blueprint(calories_bp, url_prefix="/api/calories")
        app.teardown_appcontext(close_calories_conn)

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["calories_view"]
        return manifest

    def check_ready(self) -> bool:
        # Modul ist grundsätzlich immer verfügbar; UI kann je nach Key-Status einschränken.
        return True


module = CaloriesModule()
