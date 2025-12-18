import os

def load_config(app):
    """Lädt Basis-Konfiguration für die Central-Upstream-App."""
    app.config["ENV"] = os.getenv("FLASK_ENV", "development")
    app.config["DEBUG"] = app.config["ENV"] == "development"
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")
    app.config["HEALTH_DB_PATH"] = os.getenv(
        "HEALTH_DB_PATH",
        os.path.join(app.root_path, "data", "health", "health.sqlite"),
    )
    app.config["HEALTH_DB_SCHEMA_PATH"] = os.getenv("HEALTH_DB_SCHEMA_PATH")
    # Hier später: weitere DB-URLs, Feature-Flags, etc.
