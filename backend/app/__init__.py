import os
from flask import Flask, jsonify, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix
from .core.config import load_config
from .core.module_registry import discover_modules, init_all_modules
from .core.settings_registry import discover_settings_providers
from .core.settings_storage import settings_storage
from .core.user_storage import user_storage
from .api.auth import auth_bp
from .api.routes import api_bp


def _proxy_hops() -> int:
    raw = os.getenv("PROXY_HOPS", "1").strip()
    try:
        value = int(raw)
    except ValueError:
        return 1
    return max(0, value)


def create_app():
    package_root = os.path.dirname(os.path.dirname(__file__))
    static_root = os.path.join(package_root, "static")

    app = Flask(
        __name__,
        root_path=os.getcwd(),
        static_folder=static_root,
        static_url_path="/",
    )
    load_config(app)

    hops = _proxy_hops()
    if hops > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app, x_for=hops, x_proto=hops, x_host=hops, x_prefix=hops
        )

    settings_storage.init_app(app)
    user_storage.init_app(app)

    app.register_blueprint(api_bp, url_prefix="/api")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    @app.before_request
    def require_authentication():
        if not request.path.startswith("/api/"):
            return None
        if request.path.startswith("/api/auth/"):
            return None
        if request.path.startswith("/api/health/ingest"):
            return None
        if not session.get("user_id"):
            return jsonify({"ok": False, "error": "Unauthorized."}), 401
        session.permanent = True
        return None

    discover_modules()
    init_all_modules(app)
    discover_settings_providers()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.route("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.route("/<path:path>")
    def spa(path):
        full = os.path.join(app.static_folder, path)
        if os.path.exists(full):
            return send_from_directory(app.static_folder, path)
        return send_from_directory(app.static_folder, "index.html")

    return app
