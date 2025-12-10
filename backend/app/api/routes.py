from flask import jsonify
from . import api_bp
from app.core.module_registry import get_manifests

@api_bp.get("/modules")
def list_modules():
    """
    Liefert alle Module-Manifeste für das Frontend.

    In der Skeleton-Version ist die Liste leer,
    bis mindestens ein Modul angelegt wird.
    """
    return jsonify(get_manifests())
