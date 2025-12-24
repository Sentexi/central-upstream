from flask import Blueprint, jsonify, request, session

from ..core.user_storage import user_storage

auth_bp = Blueprint("auth", __name__)


def _get_current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return user_storage.get_user_by_id(int(user_id))


@auth_bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))

    if not username or not password:
        return jsonify({"ok": False, "error": "Username and password required."}), 400

    user = user_storage.get_user_by_username(username)
    if not user or not user_storage.verify_password(user, password):
        return jsonify({"ok": False, "error": "Invalid credentials."}), 401

    session["user_id"] = user["id"]
    session["username"] = user["username"]

    return jsonify(
        {
            "ok": True,
            "username": user["username"],
            "must_change": bool(user["must_change"]),
        }
    )


@auth_bp.get("/me")
def me():
    user = _get_current_user()
    if not user:
        return jsonify({"ok": False, "error": "Unauthorized."}), 401

    return jsonify(
        {
            "ok": True,
            "username": user["username"],
            "must_change": bool(user["must_change"]),
        }
    )


@auth_bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@auth_bp.post("/change-credentials")
def change_credentials():
    user = _get_current_user()
    if not user:
        return jsonify({"ok": False, "error": "Unauthorized."}), 401

    payload = request.get_json(silent=True) or {}
    current_password = str(payload.get("current_password", ""))
    new_username = str(payload.get("username", "")).strip()
    new_password = str(payload.get("password", ""))

    if not new_username or not new_password:
        return jsonify({"ok": False, "error": "Username and password required."}), 400

    if not user_storage.verify_password(user, current_password):
        return jsonify({"ok": False, "error": "Current password is incorrect."}), 403

    user_storage.update_user(user["id"], new_username, new_password, must_change=False)
    session["username"] = new_username

    return jsonify({"ok": True, "username": new_username, "must_change": False})
