# Central Upstream – Skeleton

Dieses Repo ist ein Skeleton für:

- Flask-Backend als API-Server mit Modul-Registry
- React-Frontend (geplant mit Vite) mit Modul-Slot-System

Aktuell werden nur Ordnerstruktur und Basis-Dateien erstellt.
Kein venv, keine npm-Installationen – das passiert lokal je nach System.

## Struktur

- \`backend/\` – Flask-App
  - \`app/core\` – Config, Module-Basis, Registry
  - \`app/modules\` – Platz für Backend-Module
  - \`app/api\` – zentrale API-Routen
- \`frontend/\` – React-Skeleton
  - \`src/core\` – Modul-Typen & Registry
  - \`src/modules\` – Platz für Frontend-Module

## Nächste Schritte (manuell)

### Backend

1. Lokale venv anlegen (nicht im Repo):
2. Abhängigkeiten installieren aus \`backend/requirements.txt\`.
3. \`python backend/run_dev.py\` starten.

### Frontend

1. Sicherstellen, dass Node + npm installiert sind.
2. In \`frontend/\`:
   - \`npm install\` (installiert Dependencies lokal)
   - \`npm run dev\` (Dev-Server starten, optional Vite)

Die Implementierung der eigentlichen Module (z.B. \`quick_capture\`) erfolgt später
unter \`backend/app/modules/\` und \`frontend/src/modules/\`.

### Manual-Import Metadaten (Health)

Das Health-Modul liefert in seinem Settings-Schema zusätzlich einen \`manual_import\` Block
(\`GET /api/settings/schema\`), der dem Frontend Dateiuploads beschreibt:

- \`endpoint\`: Ziel-URL für den Upload (\`/api/health/ingest\`)
- \`upload_kind\`: \`\"json\"\` bedeutet, dass die Datei als JSON gelesen und als \`application/json\` gesendet wird (statt multipart).
- \`accept\`: Liste erlaubter MIME-Types/Endungen (z. B. \`[\"application/json\", \".json\"]\`)
- \`help_text\` / \`upload_hint\`: kurze Hinweise für die UI
- \`success_message\` / \`error_message\`: optionale Texte für Upload-Feedback

### Linux (Ubuntu/Debian) – Install via GitHub Release Bundle

sudo apt update
sudo apt install -y unzip python3-venv

mkdir -p /opt/central-upstream && cd /opt/central-upstream

# download release asset (replace OWNER/REPO + TAG)
curl -L -o release_bundle.zip "https://github.com/OWNER/REPO/releases/download/v0.1.3/release_bundle.zip"

unzip -o release_bundle.zip
cp .env.example .env

chmod +x run.sh
./run.sh

