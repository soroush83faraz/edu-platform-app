#!/usr/bin/env bash
# Runs ONCE on first `db` start (empty pgdata) via /docker-entrypoint-initdb.d.
# Creates the three application roles and the `app` / `app_test` databases.
#   app_owner  owns every schema; used ONLY by migrate/seed (MIGRATION_DATABASE_URL)
#   app_rw     runtime role: NOSUPERUSER NOBYPASSRLS, DML only -> RLS is enforced (DATABASE_URL)
#   app_backup read-only role for pg_dump (BACKUP_DATABASE_URL)
# Passwords come from APP_OWNER_PASSWORD / APP_RW_PASSWORD / APP_BACKUP_PASSWORD (compose env).
set -euo pipefail

: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD is required}"
: "${APP_RW_PASSWORD:?APP_RW_PASSWORD is required}"
: "${APP_BACKUP_PASSWORD:?APP_BACKUP_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$APP_OWNER_PASSWORD" -v rw_pw="$APP_RW_PASSWORD" -v backup_pw="$APP_BACKUP_PASSWORD" <<'EOSQL'
CREATE ROLE app_owner  LOGIN PASSWORD :'owner_pw';
CREATE ROLE app_rw     LOGIN PASSWORD :'rw_pw'     NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE app_backup LOGIN PASSWORD :'backup_pw' NOSUPERUSER NOINHERIT NOBYPASSRLS;
CREATE DATABASE app      OWNER app_owner ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;
CREATE DATABASE app_test OWNER app_owner ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0;
\c app
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
\c app_test
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER ROLE app_rw SET statement_timeout = '10s';
EOSQL
