#!/usr/bin/env bash
set -euo pipefail

pushd frontend >/dev/null
npm ci
npm run build
popd >/dev/null

rm -rf backend/static
mkdir -p backend/static
cp -r frontend/dist/* backend/static/

rm -rf dist build *.egg-info
python -m pip install -U build
python -m build