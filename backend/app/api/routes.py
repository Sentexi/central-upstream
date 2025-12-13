from flask import jsonify, request
from . import api_bp
from app.core.module_registry import get_manifests
from app.core.settings_registry import get_all_providers, get_provider
from app.core.settings_storage import settings_storage

@api_bp.get("/modules")
def list_modules():
    """
    Liefert alle Module-Manifeste für das Frontend.

    In der Skeleton-Version ist die Liste leer,
    bis mindestens ein Modul angelegt wird.
    """
    return jsonify(get_manifests())


def _validate_against_schema(module_id: str, settings: dict):
    provider = get_provider(module_id)
    if not provider:
        return False, "Unbekanntes Modul"

    schema = provider.get_settings_schema()
    missing = []
    for field in schema:
        if field.get("required"):
            value = settings.get(field["key"])
            if value is None or (isinstance(value, str) and value.strip() == ""):
                missing.append(field["label"] or field["key"])

    if missing:
        return False, "Pflichtfelder fehlen: " + ", ".join(missing)

    return provider.validate_settings(settings)


@api_bp.get("/settings/schema")
def get_settings_schema():
    modules = []
    for provider in get_all_providers():
        modules.append(
            {
                "module_id": provider.module_id,
                "module_name": provider.module_name,
                "fields": provider.get_settings_schema(),
            }
        )
    return jsonify({"modules": modules})


@api_bp.get("/settings/values")
def get_settings_values():
    return jsonify(settings_storage.get_all_settings())


@api_bp.post("/settings/<module_id>/validate")
def validate_settings(module_id: str):
    payload = request.get_json(silent=True) or {}
    provider = get_provider(module_id)

    if not provider:
        return jsonify({"ok": False, "error": "Modul nicht gefunden"}), 404

    ok, error = _validate_against_schema(module_id, payload)
    return jsonify({"ok": ok, "error": error})


@api_bp.post("/settings/<module_id>/save")
def save_settings(module_id: str):
    payload = request.get_json(silent=True) or {}
    provider = get_provider(module_id)

    if not provider:
        return jsonify({"ok": False, "error": "Modul nicht gefunden"}), 404

    ok, error = _validate_against_schema(module_id, payload)
    if not ok:
        return jsonify({"ok": False, "error": error})

    # Persist only keys that are part of the schema
    schema_keys = {field["key"] for field in provider.get_settings_schema()}
    filtered = {k: v for k, v in payload.items() if k in schema_keys}
    settings_storage.save_settings_for_module(module_id, filtered)

    return jsonify({"ok": True})
