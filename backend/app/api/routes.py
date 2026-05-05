from flask import jsonify, request
from . import api_bp
from ..core.module_registry import get_manifests
from ..core.settings_registry import get_all_providers, get_provider
from ..core.settings_storage import settings_storage


REDACTED_PLACEHOLDER = "__stored__"


def _password_keys_for(provider) -> set:
    return {
        field["key"]
        for field in provider.get_settings_schema()
        if field.get("type") == "password"
    }


@api_bp.get("/modules")
def list_modules():
    """Liefert alle Module-Manifeste fuer das Frontend."""
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


def _redact_schema_defaults(fields: list) -> list:
    redacted = []
    for field in fields:
        copy = dict(field)
        if copy.get("type") == "password":
            default = copy.get("default")
            if isinstance(default, str) and default:
                copy["default"] = REDACTED_PLACEHOLDER
        redacted.append(copy)
    return redacted


@api_bp.get("/settings/schema")
def get_settings_schema():
    modules = []
    for provider in get_all_providers():
        status_meta = provider.get_status_metadata()
        manual_import_meta = provider.get_manual_import_metadata()

        modules.append(
            {
                "module_id": provider.module_id,
                "module_name": provider.module_name,
                "fields": _redact_schema_defaults(provider.get_settings_schema()),
                **({"status": status_meta} if status_meta else {}),
                **({"manual_import": manual_import_meta} if manual_import_meta else {}),
            }
        )
    return jsonify({"modules": modules})


@api_bp.get("/settings/values")
def get_settings_values():
    """Return all stored settings, replacing password fields with a sentinel.

    Password values never leave the backend over this endpoint, so an XSS or a
    leaked browser memory dump cannot exfiltrate stored secrets. The frontend
    treats the sentinel as "value present, leave blank to keep" and only sends
    a real value back when the user types one.
    """

    raw = settings_storage.get_all_settings()
    redacted: dict = {}
    for provider in get_all_providers():
        module_id = provider.module_id
        password_keys = _password_keys_for(provider)
        module_values = dict(raw.get(module_id, {}))
        for key in password_keys:
            if module_values.get(key):
                module_values[key] = REDACTED_PLACEHOLDER
        redacted[module_id] = module_values

    for module_id, module_values in raw.items():
        if module_id not in redacted:
            redacted[module_id] = module_values

    return jsonify(redacted)


def _merge_password_fields(provider, payload: dict, existing: dict) -> dict:
    """Replace blank/sentinel password values with the previously stored value."""

    password_keys = _password_keys_for(provider)
    if not password_keys:
        return payload

    merged = dict(payload)
    for key in password_keys:
        incoming = merged.get(key)
        is_blank = incoming is None or (
            isinstance(incoming, str) and incoming.strip() == ""
        )
        is_sentinel = isinstance(incoming, str) and incoming == REDACTED_PLACEHOLDER
        if is_blank or is_sentinel:
            if key in existing:
                merged[key] = existing[key]
            elif key in merged:
                del merged[key]
    return merged


@api_bp.post("/settings/<module_id>/validate")
def validate_settings(module_id: str):
    payload = request.get_json(silent=True) or {}
    provider = get_provider(module_id)

    if not provider:
        return jsonify({"ok": False, "error": "Modul nicht gefunden"}), 404

    existing = settings_storage.get_settings_for_module(module_id)
    merged_payload = _merge_password_fields(provider, payload, existing)

    ok, error = _validate_against_schema(module_id, merged_payload)
    return jsonify({"ok": ok, "error": error})


@api_bp.post("/settings/<module_id>/save")
def save_settings(module_id: str):
    payload = request.get_json(silent=True) or {}
    provider = get_provider(module_id)

    if not provider:
        return jsonify({"ok": False, "error": "Modul nicht gefunden"}), 404

    existing = settings_storage.get_settings_for_module(module_id)
    merged_payload = _merge_password_fields(provider, payload, existing)

    ok, error = _validate_against_schema(module_id, merged_payload)
    if not ok:
        return jsonify({"ok": False, "error": error})

    schema = provider.get_settings_schema()
    schema_keys = {field["key"] for field in schema}
    read_only_keys = {field["key"] for field in schema if field.get("read_only")}

    filtered = {
        k: v
        for k, v in merged_payload.items()
        if k in schema_keys and k not in read_only_keys
    }
    persisted = {
        **{k: v for k, v in existing.items() if k in read_only_keys},
        **filtered,
    }
    settings_storage.save_settings_for_module(module_id, persisted)

    return jsonify({"ok": True})
