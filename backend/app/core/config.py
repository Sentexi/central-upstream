import os
import secrets
from pathlib import Path


def _data_dir(app) -> Path:
    explicit = os.getenv("DATA_DIR")
    if explicit:
        path = Path(explicit)
    else:
        path = Path(app.root_path) / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _resolve_secret_key(app) -> str:
    """Return a strong SECRET_KEY, prefer ENV, then on-disk file, then generate.

    The previous default ``"dev-secret"`` is gone. If neither ENV nor the
    persisted file contain a key, a fresh one is generated and written next to
    the application data directory so subsequent restarts read the same value.
    Operators are encouraged to copy the value into ``.env`` and remove the
    file, but the auto-fallback keeps existing deployments alive across
    upgrades.
    """

    env_value = os.getenv("SECRET_KEY", "").strip()
    if env_value and env_value != "dev-secret":
        return env_value

    secret_file = _data_dir(app) / ".secret_key"
    if secret_file.exists():
        existing = secret_file.read_text(encoding="utf-8").strip()
        if existing:
            return existing

    generated = secrets.token_urlsafe(64)
    secret_file.write_text(generated, encoding="utf-8")
    try:
        os.chmod(secret_file, 0o600)
    except OSError:
        pass
    return generated


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def load_config(app):
    """Load base configuration for the Central Upstream app."""

    app.config["ENV"] = os.getenv("FLASK_ENV", "production")
    app.config["DEBUG"] = app.config["ENV"] == "development"
    app.config["SECRET_KEY"] = _resolve_secret_key(app)

    app.config["SESSION_COOKIE_HTTPONLY"] = True
    app.config["SESSION_COOKIE_SAMESITE"] = os.getenv(
        "SESSION_COOKIE_SAMESITE", "Lax"
    )
    app.config["SESSION_COOKIE_SECURE"] = _bool_env(
        "SESSION_COOKIE_SECURE", default=False
    )
    app.config["PERMANENT_SESSION_LIFETIME"] = int(
        os.getenv("SESSION_LIFETIME_SECONDS", str(60 * 60 * 24 * 14))
    )

    app.config["HEALTH_DB_PATH"] = os.getenv(
        "HEALTH_DB_PATH",
        os.path.join(app.root_path, "data", "health", "health.sqlite"),
    )
    app.config["HEALTH_DB_SCHEMA_PATH"] = os.getenv("HEALTH_DB_SCHEMA_PATH")
    app.config["HEALTH_INGEST_API_KEY"] = os.getenv("HEALTH_INGEST_API_KEY", "")
