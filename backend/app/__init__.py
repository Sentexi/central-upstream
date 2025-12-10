from flask import Flask
from .core.config import load_config
from .core.module_registry import discover_modules, init_all_modules
from .api.routes import api_bp

def create_app():
    app = Flask(__name__)
    load_config(app)

    # API-Routen registrieren
    app.register_blueprint(api_bp, url_prefix="/api")

    # Module entdecken & initialisieren
    discover_modules()
    init_all_modules(app)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app
