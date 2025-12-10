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
