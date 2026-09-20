#!/usr/bin/env bash
# Weekly restore DRILL (cron, Friday 03:00 UTC = 06:30 Tehran):
#   0 3 * * 5  /srv/school/restore-test.sh >> /srv/school/backups/restore-test.log 2>&1
#
# Takes the newest db-<date>.dump.age (local backups/ dir, or the bucket with RESTORE_FROM_REMOTE=1), decrypts it
# with the age IDENTITY file, restores it into a scratch database `app_restore_test` (created and dropped every run
# as `postgres` inside the db container), counts rows and compares with the LIVE database; exits non-zero when a
# count is 0 while live is > 0. The live database is never touched.
#
# Environment (from $APP_DIR/.env or the caller):
#   AGE_IDENTITY          path to the age private key file (REQUIRED). On the server this file is normally ABSENT
#                         (the key lives on the developer laptop); run the drill from the laptop with an ssh tunnel,
#                         or copy the key to the server ONLY for the drill and shred it afterwards (`shred -u`).
#   RESTORE_FROM_REMOTE=1 fetch the newest dump from $RCLONE_REMOTE/<hostname>/ instead of backups/
#   RESTORE_FILE          use this exact .age file
#   RESTORE_KEEP_DB=1     keep app_restore_test for inspection (dropped on the next run)
#   BACKUP_DIR, BACKUP_DB, BACKUP_COMPOSE_ARGS, COMPOSE_FILE, APP_DIR, RCLONE_REMOTE — as in backup.sh
#
# Role mapping: the dump was taken by app_backup, objects are owned by app_owner. For the DRILL we restore as
# `postgres` with --no-owner --no-privileges, so everything in the scratch DB belongs to postgres and no grants are
# replayed (fewer moving parts; the counts are what matter). For a REAL restore into `app` do NOT pass those two
# flags: app_owner exists on the cluster, so ownership and grants come back exactly (see docs/ops/runbook.md).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${APP_DIR:-}" ]]; then
  if [[ -f "$SCRIPT_DIR/compose.yml" ]]; then APP_DIR="$SCRIPT_DIR"
  elif [[ -f "$SCRIPT_DIR/../compose.yml" ]]; then APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  else APP_DIR="/srv/school"; fi
fi
cd "$APP_DIR"

envget() {
  local key="$1" val=""
  if [[ -f .env ]]; then val="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"; fi
  printf '%s' "$val"
}

AGE_IDENTITY="${AGE_IDENTITY:-$(envget AGE_IDENTITY)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-$(envget RCLONE_REMOTE)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-arvan:school-backups}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_DB="${BACKUP_DB:-app}"
SCRATCH_DB="app_restore_test"
HOST="${BACKUP_HOST:-$(hostname)}"
HOST="${HOST%%.*}"
START_TS="$(date +%s)"

log() { printf '[restore-test %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# shellcheck disable=SC2086
compose() { docker compose ${BACKUP_COMPOSE_ARGS:-} "$@"; }
psql_pg() { compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$1" -tAc "$2"; }

[[ -n "$AGE_IDENTITY" && -f "$AGE_IDENTITY" ]] || { log "AGE_IDENTITY must point at the age private key file"; exit 2; }
command -v age >/dev/null || { log "age not installed"; exit 2; }

TMP_DIR="$(mktemp -d)"
STEP="init"
on_exit() {
  local rc=$?
  rm -rf "$TMP_DIR" 2>/dev/null || true
  if [[ "${RESTORE_KEEP_DB:-0}" != "1" ]]; then
    compose exec -T db psql -U postgres -d postgres -qc "DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)" >/dev/null 2>&1 || true
  fi
  if [[ $rc -ne 0 ]]; then
    log "FAILED at step '$STEP' (rc=$rc)"
    printf '%s FAILED step=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STEP" > "$BACKUP_DIR/LAST_RESTORE_TEST"
  fi
  exit $rc
}
trap on_exit EXIT

# ---- 1. pick the newest dump -------------------------------------------------------------------------------------
STEP="locate"
if [[ -n "${RESTORE_FILE:-}" ]]; then
  SRC="$RESTORE_FILE"
elif [[ "${RESTORE_FROM_REMOTE:-0}" == "1" ]]; then
  command -v rclone >/dev/null || { log "rclone not installed"; exit 2; }
  REMOTE_DIR="${RCLONE_REMOTE%/}/${HOST}/"
  NEWEST="$(rclone lsf --include 'db-*.dump.age' "$REMOTE_DIR" | sort | tail -n1)"
  [[ -n "$NEWEST" ]] || { log "no db-*.dump.age in $REMOTE_DIR"; exit 1; }
  log "fetching $NEWEST from $REMOTE_DIR"
  rclone copy --s3-no-check-bucket "${REMOTE_DIR}${NEWEST}" "$TMP_DIR/"
  SRC="$TMP_DIR/$NEWEST"
else
  SRC="$(ls -1 "$BACKUP_DIR"/db-*.dump.age 2>/dev/null | sort | tail -n1 || true)"
  [[ -n "$SRC" ]] || { log "no db-*.dump.age in $BACKUP_DIR (run backup.sh first)"; exit 1; }
fi
log "source: $SRC ($(du -h "$SRC" | cut -f1))"

# ---- 2. decrypt --------------------------------------------------------------------------------------------------
STEP="decrypt"
PLAIN="$TMP_DIR/restore.dump"
age -d -i "$AGE_IDENTITY" -o "$PLAIN" "$SRC"
[[ -s "$PLAIN" ]] || { log "decrypted dump is empty"; exit 1; }

# ---- 3. scratch database -----------------------------------------------------------------------------------------
STEP="create-scratch"
compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -qc "DROP DATABASE IF EXISTS ${SCRATCH_DB} WITH (FORCE)"
compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres -qc \
  "CREATE DATABASE ${SCRATCH_DB} ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8' TEMPLATE template0"

STEP="pg_restore"
log "pg_restore --no-owner --no-privileges → $SCRATCH_DB"
RESTORE_LOG="$TMP_DIR/pg_restore.log"
set +e
compose exec -T db pg_restore -U postgres -d "$SCRATCH_DB" --no-owner --no-privileges < "$PLAIN" 2> "$RESTORE_LOG"
RC=$?
set -e
if [[ $RC -ne 0 ]]; then
  log "pg_restore exited $RC; stderr:"
  sed 's/^/    /' "$RESTORE_LOG"
  exit 1
fi
if [[ -s "$RESTORE_LOG" ]]; then log "pg_restore warnings: $(grep -c . "$RESTORE_LOG")"; sed 's/^/    /' "$RESTORE_LOG" | head -n 20; fi

# ---- 4. counts: restored vs live ----------------------------------------------------------------------------------
STEP="counts"
Q_PERSON="select count(*) from iam.person"
Q_WORK="select count(*) from workspace.work_item"
Q_AUDIT="select coalesce(max(at)::text, '-') from audit.audit_log"
R_PERSON="$(psql_pg "$SCRATCH_DB" "$Q_PERSON")"
R_WORK="$(psql_pg "$SCRATCH_DB" "$Q_WORK")"
R_AUDIT="$(psql_pg "$SCRATCH_DB" "$Q_AUDIT")"
# Live counts as app_backup (SELECT-only + BYPASSRLS → sees every tenant, like the dump did).
L_PERSON="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U app_backup -d "$BACKUP_DB" -tAc "$Q_PERSON")"
L_WORK="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U app_backup -d "$BACKUP_DB" -tAc "$Q_WORK")"
L_AUDIT="$(compose exec -T db psql -v ON_ERROR_STOP=1 -U app_backup -d "$BACKUP_DB" -tAc "$Q_AUDIT")"
MIGR="$(psql_pg "$SCRATCH_DB" "select count(*) from drizzle.__drizzle_migrations")"

ELAPSED=$(( $(date +%s) - START_TS ))
printf '\n%-28s %12s %12s\n' "table" "restored" "live"
printf '%-28s %12s %12s\n' "iam.person" "$R_PERSON" "$L_PERSON"
printf '%-28s %12s %12s\n' "workspace.work_item" "$R_WORK" "$L_WORK"
printf '%-28s %12s %12s\n' "audit.audit_log max(at)" "$R_AUDIT" "$L_AUDIT"
printf '%-28s %12s\n' "migrations in dump" "$MIGR"
printf 'elapsed: %ss\n\n' "$ELAPSED"

STEP="verdict"
FAIL=0
[[ "$R_PERSON" == "0" && "$L_PERSON" != "0" ]] && { log "iam.person restored 0 rows while live has $L_PERSON"; FAIL=1; }
[[ "$R_WORK" == "0" && "$L_WORK" != "0" ]] && { log "workspace.work_item restored 0 rows while live has $L_WORK"; FAIL=1; }
[[ "$R_AUDIT" == "-" && "$L_AUDIT" != "-" ]] && { log "audit.audit_log restored empty while live is not"; FAIL=1; }
[[ "$MIGR" == "0" ]] && { log "no migration ledger in the dump"; FAIL=1; }
if [[ $FAIL -ne 0 ]]; then exit 1; fi

printf '%s OK person=%s work_item=%s audit_max=%s elapsed=%ss src=%s\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$R_PERSON" "$R_WORK" "$R_AUDIT" "$ELAPSED" "$(basename "$SRC")" > "$BACKUP_DIR/LAST_RESTORE_TEST"
log "OK — restore drill passed in ${ELAPSED}s"
