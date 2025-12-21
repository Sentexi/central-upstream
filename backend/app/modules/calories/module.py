from ...core.module_base import BaseModule


class CaloriesModule(BaseModule):
    id = "calories"
    name = "Calories & Vape"
    version = "0.1.0"

    def init_app(self, app):
        from .routes import calories_bp, vape_bp, close_calories_conn, close_vape_conn

        app.register_blueprint(calories_bp, url_prefix="/api/calories")
        app.register_blueprint(vape_bp, url_prefix="/api/vape")
        app.teardown_appcontext(close_calories_conn)
        app.teardown_appcontext(close_vape_conn)

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["calories_view"]
        return manifest

    def check_ready(self) -> bool:
        # Modul ist grundsätzlich immer verfügbar; UI kann je nach Key-Status einschränken.
        return True


module = CaloriesModule()
