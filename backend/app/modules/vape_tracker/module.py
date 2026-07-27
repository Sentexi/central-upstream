from ...core.module_base import BaseModule


class VapeTrackerModule(BaseModule):
    id = "vape_tracker"
    name = "Vape Tracker"
    version = "0.1.0"

    def init_app(self, app):
        from .routes import bp, close_vape_conn

        app.register_blueprint(bp, url_prefix="/api/vape")
        app.teardown_appcontext(close_vape_conn)

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["vape_tracker_view"]
        return manifest


module = VapeTrackerModule()
