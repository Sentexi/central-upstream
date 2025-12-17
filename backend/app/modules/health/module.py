from app.core.module_base import BaseModule


class HealthModule(BaseModule):
    id = "health"
    name = "Health"
    version = "0.1.0"

    def init_app(self, app):
        from .routes import bp

        app.register_blueprint(bp, url_prefix="/api/health")

    def check_ready(self) -> bool:
        # Health benötigt keine externen Credentials und ist sofort bereit.
        return True

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["dashboard_view"]
        return manifest


module = HealthModule()
