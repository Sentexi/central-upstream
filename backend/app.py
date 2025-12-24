# backend/app.py
from flask import Flask, send_from_directory
import os

package_root = os.path.dirname(__file__)
static_root = os.path.join(package_root, "static")

app = Flask(
    __name__,
    root_path=os.getcwd(),
    static_folder=static_root,
    static_url_path="/",
)

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def spa(path):
    full = os.path.join(app.static_folder, path)
    if os.path.exists(full):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")
