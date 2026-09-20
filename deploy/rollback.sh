#!/usr/bin/env bash
# Server-side rollback: restore the previous image tag saved by deploy.sh and restart the app.
# Migrations are additive-only, so the previous image runs against the new schema.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [[ ! -s .last_tag ]]; then
  echo "no .last_tag — nothing to roll back to" >&2
  exit 1
fi
PREV="$(cat .last_tag)"
echo "[rollback] APP_IMAGE=${PREV}"
sed -i -E "s|^APP_IMAGE=.*|APP_IMAGE=${PREV}|" .env
sed -i -E "s|^APP_VERSION=.*|APP_VERSION=${PREV#edu-app:}|" .env
docker compose up -d --no-deps app
docker compose ps app
