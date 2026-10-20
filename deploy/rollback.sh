#!/usr/bin/env bash
# Server-side rollback: restore the previous image tag saved by deploy.sh and restart the app and the background
# worker — or stop the worker when the previous image predates it (no scripts/worker.mjs: it would crash-loop).
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
if docker run --rm --entrypoint test "$PREV" -f /app/scripts/worker.mjs 2>/dev/null; then
  docker compose up -d --no-deps worker
else
  echo "[rollback] ${PREV} has no worker — stopping it" >&2
  docker compose stop worker 2>/dev/null || true
fi
docker compose ps app worker
