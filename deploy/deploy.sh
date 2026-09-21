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

# 2) pre-migration backup as the dump role. app_backup (SELECT-only grants + BYPASSRLS, see db/initdb/01-roles.sh)
#    is the same role the nightly backup uses through BACKUP_DATABASE_URL, so a missing grant on a new schema fails
#    HERE, at deploy time. Skipped only when the database has never been migrated (first deploy); once a ledger
#    exists, a failed dump aborts the deploy before `migrate` touches anything.
mkdir -p backups
if docker compose ps --status running db 2>/dev/null | grep -q db; then
  HAS_LEDGER="$(docker compose exec -T db psql -U app_backup -d app -tAc \
    "select to_regclass('drizzle.__drizzle_migrations') is not null" 2>/dev/null || echo f)"
  if [[ "$HAS_LEDGER" == "t" ]]; then
    log "pg_dump (app_backup) -> backups/pre-${TS}.dump"
    if ! docker compose exec -T db pg_dump -Fc -U app_backup app > "backups/pre-${TS}.dump"; then
      rm -f "backups/pre-${TS}.dump"
      log "pre-migration pg_dump FAILED — aborting before migrate (nothing changed). On a server initialized before" \
          "BYPASSRLS was added to 01-roles.sh run once: docker compose exec -T db psql -U postgres -c 'ALTER ROLE app_backup BYPASSRLS'"
      exit 1
    fi
  else
    log "database 'app' has no migration ledger yet (first deploy) — skipping pre-migration dump"
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

# 4) migrate (one-shot, additive-only SQL), seed the permission catalog (one-shot, idempotent, compiled into the
#    image from the TypeScript source — scripts/seed-catalog.js), then start app + caddy. `--no-deps` on the seed:
#    migrate just ran. `up -d app` re-runs both one-shots through depends_on (each a no-op the second time).
log "running migrations"
docker compose run --rm migrate || rollback

log "seeding the permission catalog"
docker compose run --rm --no-deps seed || rollback

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
    log "next: from the dev machine run the end-to-end smoke against the live site —" \
        "BASE_URL=https://<PUBLIC_HOST> SMOKE_IDENTIFIER=<qa login> SMOKE_PASSWORD=<qa password> pnpm smoke:prod" \
        "(docs/ops/runbook.md «استقرار»). Rollback: bash $DIR/rollback.sh"
    exit 0
  fi
  sleep 2
done

rollback
