#!/usr/bin/env bash
# Server-side deploy: /srv/school/deploy.sh <sha>
# Assumes the image edu-app:<sha> is already loaded (see ship.ps1) and /srv/school/.env exists.
set -euo pipefail

SHA="${1:?usage: deploy.sh <sha>}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

NEW_IMAGE="edu-app:${SHA}"
ENV_FILE=".env"
TS="$(date -u +%Y%m%dT%H%M%SZ)"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

if ! docker image inspect "$NEW_IMAGE" >/dev/null 2>&1; then
  echo "image $NEW_IMAGE not found on this host — run ship.ps1 first" >&2
  exit 1
fi

# 1) remember the currently running tag for rollback
CURRENT="$(grep -E '^APP_IMAGE=' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -n "$CURRENT" && "$CURRENT" != "$NEW_IMAGE" ]]; then
  printf '%s\n' "$CURRENT" > .last_tag
  log "previous image: $CURRENT (saved to .last_tag)"
fi

# 2) pre-migration backup (skipped gracefully when db is not up yet — first deploy)
mkdir -p backups
if docker compose ps --status running db 2>/dev/null | grep -q db; then
  log "pg_dump -> backups/pre-${TS}.dump"
  if ! docker compose exec -T db pg_dump -Fc -U postgres app > "backups/pre-${TS}.dump"; then
    log "pg_dump failed (database 'app' may not exist yet) — continuing"
    rm -f "backups/pre-${TS}.dump"
  fi
else
  log "db not running yet — starting it and skipping pre-migration dump"
  docker compose up -d db
fi

# 3) point .env at the new image
sed -i -E "s|^APP_IMAGE=.*|APP_IMAGE=${NEW_IMAGE}|" "$ENV_FILE"
if grep -qE '^APP_VERSION=' "$ENV_FILE"; then
  sed -i -E "s|^APP_VERSION=.*|APP_VERSION=${SHA}|" "$ENV_FILE"
else
  printf 'APP_VERSION=%s\n' "$SHA" >> "$ENV_FILE"
fi

rollback() {
  log "deploy FAILED — rolling back"
  bash "$DIR/rollback.sh" || true
  exit 1
}

# 4) migrate (one-shot, additive-only SQL) then start app + caddy
log "running migrations"
docker compose run --rm migrate || rollback

log "starting app + caddy"
docker compose up -d app caddy || rollback

# 5) health poll (inside the compose network — app is not published on the host)
log "waiting for /api/health"
for i in $(seq 1 30); do
  if docker compose exec -T app node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>{console.log(JSON.stringify(j));process.exit(j.ok?0:1)}).catch(()=>process.exit(1))" \
      2>/dev/null; then
    log "healthy: $NEW_IMAGE"
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 2
done

rollback
