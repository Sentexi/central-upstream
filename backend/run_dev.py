from app import create_app

app = create_app()

if __name__ == "__main__":
    # Flask-Dev-Server starten (ohne venv-Handling – das machst du selbst)
    app.run(debug=True)
