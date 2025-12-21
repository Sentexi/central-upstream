# backend/app.py
from flask import Flask, send_from_directory
import os

app = Flask(__name__, static_folder="static", static_url_path="/")

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def spa(path):
    full = os.path.join(app.static_folder, path)
    if os.path.exists(full):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")
