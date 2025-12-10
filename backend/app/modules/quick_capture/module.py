from app.core.module_base import BaseModule


class QuickCaptureModule(BaseModule):
    id = "quick_capture"
    name = "Quick Capture"
    version = "0.1.0"

    def init_app(self, app):
        from .api import bp

        app.register_blueprint(bp, url_prefix="/api/quick-capture")

    def get_manifest(self) -> dict:
        manifest = super().get_manifest()
        manifest["slots"] = ["today_view"]
        return manifest

    def check_ready(self) -> bool:
        return True


module = QuickCaptureModule()
