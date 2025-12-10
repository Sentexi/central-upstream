import os

def load_config(app):
    """Lädt Basis-Konfiguration für die Central-Upstream-App."""
    app.config["ENV"] = os.getenv("FLASK_ENV", "development")
    app.config["DEBUG"] = app.config["ENV"] == "development"
    app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret")
    # Hier später: DB-URL, Feature-Flags, etc.
