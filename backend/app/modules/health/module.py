from ...core.module_base import BaseModule


class HealthModule(BaseModule):
    id = "health"
    name = "Health"
    version = "0.1.0"

    def init_app(self, app):
        from .routes import bp

        app.register_blueprint(bp, url_prefix="/api/health")

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["health_view", "fitness_view"]
        return manifest

    def check_ready(self) -> bool:
        # Health benötigt keine externen Credentials und ist sofort bereit.
        return True


module = HealthModule()
