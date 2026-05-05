#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

# .env laden (optional)
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PYTHON_BIN="${PYTHON_BIN:-python3}"
PORT="${PORT:-8000}"

if [ ! -d ".venv" ]; then
  "$PYTHON_BIN" -m venv .venv
fi

if [ ! -f ".venv/bin/activate" ]; then
  rm -rf .venv
  "$PYTHON_BIN" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

python -m pip install -U pip

# pick newest wheel (by version in filename)
WHEEL="$(ls -1 ./wheels/central_upstream-*.whl | sort -V | tail -n 1)"
python -m pip install --force-reinstall --no-cache-dir "$WHEEL"

# SQLite/Volumes: nutzt ihr z.B. /app/data im Docker; hier lokal ./data
export PYTHONPATH="$APP_DIR"

# Gunicorn Starttarget ggf. anpassen:
exec gunicorn -w "${WEB_CONCURRENCY:-2}" -k gthread --timeout "${GUNICORN_TIMEOUT:-600}" \
  -b "0.0.0.0:${PORT}" "backend.app:create_app()"
