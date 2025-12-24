from flask import Flask, jsonify, request, session
from hmac import compare_digest
from .core.config import load_config
from .core.module_registry import discover_modules, init_all_modules
from .core.settings_registry import discover_settings_providers
from .core.settings_storage import settings_storage
from .core.user_storage import user_storage
from .api.auth import auth_bp
from .api.routes import api_bp

def create_app():
    app = Flask(__name__)
    load_config(app)

    settings_storage.init_app(app)
    user_storage.init_app(app)

    # API-Routen registrieren
    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    def _extract_api_key():
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            return auth_header.removeprefix("Bearer ").strip()
        return request.headers.get("X-API-Key", "").strip()

    def _has_valid_ingest_key():
        expected_key = app.config.get("HEALTH_INGEST_API_KEY", "")
        provided_key = _extract_api_key()
        if not expected_key or not provided_key:
            return False
        return compare_digest(provided_key, expected_key)

    @app.before_request
    def require_authentication():
        if not request.path.startswith("/api/"):
            return None
        if request.path.startswith("/api/auth/"):
            return None
        if request.path.startswith("/api/health/ingest") and _has_valid_ingest_key():
            return None
        if not session.get("user_id"):
            return jsonify({"ok": False, "error": "Unauthorized."}), 401
        return None

    # Module entdecken & initialisieren
    discover_modules()
    init_all_modules(app)
    discover_settings_providers()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app
