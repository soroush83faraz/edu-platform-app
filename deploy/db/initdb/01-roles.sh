#!/usr/bin/env bash
# Runs ONCE on first `db` start (empty pgdata) via /docker-entrypoint-initdb.d.
# Creates the three application roles and the `app` / `app_test` databases.
#   app_owner  owns every schema; used ONLY by migrate/seed (MIGRATION_DATABASE_URL). No BYPASSRLS: FORCE RLS binds it.
#   app_rw     runtime role: NOSUPERUSER NOBYPASSRLS, DML only -> RLS is enforced (DATABASE_URL)
#   app_backup read-only role for pg_dump (BACKUP_DATABASE_URL). BYPASSRLS: a dump must see every tenant's rows
#              (without it pg_dump errors out on every FORCE-RLS table); it holds SELECT grants only, so the
#              attribute widens reads, never writes. Treat BACKUP_DATABASE_URL as a full-read credential.
#   app_worker the background worker's own role (WORKER_DATABASE_URL; migration 0032, security review 2026-10-20 F3):
#              NOSUPERUSER NOBYPASSRLS NOINHERIT, member of nothing; app.apply_grants() gives it exactly app_rw's
#              grants and RLS policies plus the claim across organizations (app.claim_jobs) and ops.schedule —
#              which app_rw then loses. Created only when APP_WORKER_PASSWORD is set; without it the worker runs
#              as app_rw (the fallback) until the operator creates the role (deploy/README.md).
# Passwords come from APP_OWNER_PASSWORD / APP_RW_PASSWORD / APP_BACKUP_PASSWORD / APP_WORKER_PASSWORD (compose env).
#
# Existing servers (initialized before these attributes/settings were added) do NOT re-run this file. Apply once
# as the postgres superuser — see deploy/README.md ("operator steps"):
#   ALTER ROLE app_backup BYPASSRLS;
#   ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
#   ALTER ROLE app_rw SET lock_timeout = '5s';
#   (and the app_worker block of deploy/README.md «نقش app_worker»)
set -euo pipefail

: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD is required}"
: "${APP_RW_PASSWORD:?APP_RW_PASSWORD is required}"
: "${APP_BACKUP_PASSWORD:?APP_BACKUP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$APP_OWNER_PASSWORD" -v rw_pw="$APP_RW_PASSWORD" -v backup_pw="$APP_BACKUP_PASSWORD" <<'EOSQL'
CREATE ROLE app_owner  LOGIN PASSWORD :'owner_pw'  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_rw     LOGIN PASSWORD :'rw_pw'     NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE app_backup LOGIN PASSWORD :'backup_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT BYPASSRLS;
CREATE DATABASE app      OWNER app_owner ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;
CREATE DATABASE app_test OWNER app_owner ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;
\c app
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\c app_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Runtime role guard rails (role-level, cluster-wide): no statement runs past 10s, a transaction left open by a
-- crashed request is killed after 30s idle (it would otherwise hold RLS context + locks on a pooled connection),
-- and lock waits fail fast instead of piling up behind a migration.
ALTER ROLE app_rw SET statement_timeout = '10s';
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_rw SET lock_timeout = '5s';
EOSQL

# The worker's own role (migration 0032). The same guard rails as app_rw (a job's own timeout is SET LOCAL per run).
if [ -n "${APP_WORKER_PASSWORD:-}" ]; then
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres -v worker_pw="$APP_WORKER_PASSWORD" <<'EOSQL'
CREATE ROLE app_worker LOGIN PASSWORD :'worker_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
ALTER ROLE app_worker SET statement_timeout = '10s';
ALTER ROLE app_worker SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE app_worker SET lock_timeout = '5s';
EOSQL
else
  echo "01-roles.sh: APP_WORKER_PASSWORD is not set — no app_worker role; the worker connects as app_rw (deploy/README.md)."
fi
