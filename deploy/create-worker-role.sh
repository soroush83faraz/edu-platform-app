#!/usr/bin/env bash
# One-time, on the VPS, run by the OWNER (never by an agent): creates app_worker (migration 0032, deploy/README.md
# «نقش app_worker»). Generates the password here, writes APP_WORKER_PASSWORD + WORKER_DATABASE_URL into .env and
# creates the role in the running db container — the password is never printed. Idempotent: does nothing when the
# role already exists. Afterwards: deploy as usual (0032's apply_grants() hands app_worker its grants), or, if 0032 is
# already applied, it runs apply_grants() itself and recreates the worker.
set -euo pipefail
cd /srv/school
ENV=.env

if docker compose exec -T db psql -U postgres -d app -tAc "SELECT 1 FROM pg_roles WHERE rolname='app_worker'" | grep -q 1; then
  echo "app_worker already exists — nothing to do."
  exit 0
fi

if ! grep -q '^APP_WORKER_PASSWORD=' "$ENV"; then
  PW="$(openssl rand -hex 24)"
  cp "$ENV" "$ENV.bak.$(date +%Y%m%d%H%M%S)"
  printf '\nAPP_WORKER_PASSWORD=%s\nWORKER_DATABASE_URL=postgres://app_worker:%s@db:5432/app\n' "$PW" "$PW" >> "$ENV"
  echo ".env: APP_WORKER_PASSWORD and WORKER_DATABASE_URL added (backup kept)."
fi
PW="$(grep '^APP_WORKER_PASSWORD=' "$ENV" | tail -1 | cut -d= -f2-)"

docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -v worker_pw="$PW" <<'EOSQL'
CREATE ROLE app_worker LOGIN PASSWORD :'worker_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE app_worker SET statement_timeout = '10s';
ALTER ROLE app_worker SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_worker SET lock_timeout = '5s';
EOSQL
echo "app_worker created."

if docker compose exec -T db psql -U postgres -d app -tAc "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='apply_grants' AND pg_get_functiondef(p.oid) LIKE '%app_worker%'" | grep -q 1; then
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d app -c "SET ROLE app_owner; SELECT app.apply_grants();"
  docker compose up -d --force-recreate worker
  echo "0032 was already applied: grants re-applied, worker recreated."
else
  echo "0032 not applied yet: the next deploy applies the grants."
fi
