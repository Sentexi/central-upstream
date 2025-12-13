from flask import Flask
from .core.config import load_config
from .core.module_registry import discover_modules, init_all_modules
from .core.settings_registry import discover_settings_providers
from .core.settings_storage import settings_storage
from .api.routes import api_bp

def create_app():
    app = Flask(__name__)
    load_config(app)

    settings_storage.init_app(app)

    # API-Routen registrieren
    app.register_blueprint(api_bp, url_prefix="/api")

    # Module entdecken & initialisieren
    discover_modules()
    init_all_modules(app)
    discover_settings_providers()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app
