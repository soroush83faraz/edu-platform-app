#!/usr/bin/env bash
# Nightly encrypted, off-box backup. Runs on the VPS HOST (not inside a container) from cron:
#   00 23 * * *  /srv/school/backup.sh >> /srv/school/backups/backup.log 2>&1
# The host clock is Asia/Tehran (bootstrap-server.sh), but cron here is documented in UTC because the compose
# stack runs TZ=UTC and the dump file names are UTC dates: 23:00 UTC = 02:30 Tehran (Iran has no DST since 1401).
#
# Steps (any failure → exit non-zero + backups/LAST_FAILURE; success → ISO timestamp in backups/LAST_OK,
# which deploy/watchdog.sh reads):
#   1. pg_dump -Fc as app_backup (SELECT-only + BYPASSRLS, see db/initdb/01-roles.sh) via `docker compose exec -T db`
#      → backups/db-<YYYY-MM-DD>.dump
#   2. tar.gz of the `files` volume (<project>_files) via a throwaway alpine container → backups/files-<date>.tar.gz
#   3. age -r "$AGE_RECIPIENT" on both → *.age; the plaintext is deleted. The PRIVATE key never touches the server
#      (developer laptop + printed copy in the client's sealed envelope).
#   4. rclone copy both .age files to $RCLONE_REMOTE/<hostname>/ (Arvan S3, see deploy/README.md)
#   5. prune local *.age older than 7 days (and deploy.sh's pre-*.dump older than 14 days)
#
# Environment (from $APP_DIR/.env or the caller):
#   AGE_RECIPIENT         age1… public key(s), space-separated (REQUIRED)
#   RCLONE_REMOTE         default arvan:school-backups
#   BACKUP_SKIP_UPLOAD=1  no rclone (local drill / dev)
#   BACKUP_SKIP_FILES=1   no files-volume tar (dev compose has no files volume)
#   BACKUP_FILES_VOLUME   override the volume name (default <compose project>_files)
#   BACKUP_DIR            default $APP_DIR/backups
#   BACKUP_DB             default app
#   BACKUP_COMPOSE_ARGS   extra `docker compose` args, e.g. "-f docker-compose.dev.yml"; COMPOSE_FILE is honoured too
#   APP_DIR               directory holding compose.yml + .env (default: the script's dir, else its parent, else /srv/school)
#
# Local drill against the dev database (Git Bash):
#   AGE_RECIPIENT=age1… APP_DIR=. COMPOSE_FILE=docker-compose.dev.yml BACKUP_SKIP_UPLOAD=1 BACKUP_SKIP_FILES=1 \
#     bash deploy/backup/backup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${APP_DIR:-}" ]]; then
  if [[ -f "$SCRIPT_DIR/compose.yml" ]]; then APP_DIR="$SCRIPT_DIR"
  elif [[ -f "$SCRIPT_DIR/../compose.yml" ]]; then APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  else APP_DIR="/srv/school"; fi
fi
cd "$APP_DIR"

# Read ONE key from .env without sourcing it (values may contain $ or quotes). Caller env wins.
envget() {
  local key="$1" val=""
  if [[ -f .env ]]; then val="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"; fi
  printf '%s' "$val"
}

AGE_RECIPIENT="${AGE_RECIPIENT:-$(envget AGE_RECIPIENT)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-$(envget RCLONE_REMOTE)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-arvan:school-backups}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
BACKUP_DB="${BACKUP_DB:-app}"
BACKUP_SKIP_UPLOAD="${BACKUP_SKIP_UPLOAD:-0}"
BACKUP_SKIP_FILES="${BACKUP_SKIP_FILES:-0}"
HOST="${BACKUP_HOST:-$(hostname)}"
HOST="${HOST%%.*}"
DATE="$(date -u +%Y-%m-%d)"
START_TS="$(date +%s)"

log() { printf '[backup %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
# shellcheck disable=SC2086
compose() { docker compose ${BACKUP_COMPOSE_ARGS:-} "$@"; }

mkdir -p "$BACKUP_DIR"
STEP="init"
cleanup_tmp=()
on_exit() {
  local rc=$?
  rm -f "${cleanup_tmp[@]}" 2>/dev/null || true
  if [[ $rc -ne 0 ]]; then
    printf '%s step=%s rc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STEP" "$rc" > "$BACKUP_DIR/LAST_FAILURE"
    log "FAILED at step '$STEP' (rc=$rc) — see $BACKUP_DIR/LAST_FAILURE"
  fi
  exit $rc
}
trap on_exit EXIT

[[ -n "$AGE_RECIPIENT" ]] || { STEP="config"; log "AGE_RECIPIENT is empty — set it in $APP_DIR/.env (age1…)"; exit 2; }
command -v age >/dev/null || { STEP="config"; log "age not installed (apt install age)"; exit 2; }
if [[ "$BACKUP_SKIP_UPLOAD" != "1" ]]; then
  command -v rclone >/dev/null || { STEP="config"; log "rclone not installed (apt install rclone) — or BACKUP_SKIP_UPLOAD=1"; exit 2; }
fi

age_args=()
for r in $AGE_RECIPIENT; do age_args+=(-r "$r"); done

encrypt() { # encrypt <plain> → <plain>.age, deletes <plain>
  local plain="$1"
  age "${age_args[@]}" -o "$plain.age" "$plain"
  rm -f "$plain"
  log "encrypted → $(basename "$plain.age") ($(du -h "$plain.age" | cut -f1))"
}

# ---- 1. database ------------------------------------------------------------------------------------------------
STEP="pg_dump"
DB_PLAIN="$BACKUP_DIR/db-${DATE}.dump"
DB_TMP="$DB_PLAIN.tmp"
cleanup_tmp+=("$DB_TMP")
log "pg_dump -Fc -U app_backup $BACKUP_DB → $(basename "$DB_PLAIN")"
compose exec -T db pg_dump -Fc -U app_backup "$BACKUP_DB" > "$DB_TMP"
[[ -s "$DB_TMP" ]] || { log "dump is empty"; exit 1; }
mv -f "$DB_TMP" "$DB_PLAIN"
STEP="encrypt-db"
encrypt "$DB_PLAIN"
UPLOADS=("$DB_PLAIN.age")

# ---- 2. files volume ---------------------------------------------------------------------------------------------
if [[ "$BACKUP_SKIP_FILES" == "1" ]]; then
  log "files volume: skipped (BACKUP_SKIP_FILES=1)"
else
  STEP="files-volume"
  if [[ -z "${BACKUP_FILES_VOLUME:-}" ]]; then
    PROJECT="$(compose config 2>/dev/null | sed -n 's/^name: *//p' | head -n1)"
    [[ -n "$PROJECT" ]] || { log "cannot resolve compose project name — set BACKUP_FILES_VOLUME"; exit 1; }
    BACKUP_FILES_VOLUME="${PROJECT}_files"
  fi
  docker volume inspect "$BACKUP_FILES_VOLUME" >/dev/null 2>&1 || { log "volume $BACKUP_FILES_VOLUME not found"; exit 1; }
  FILES_PLAIN="$BACKUP_DIR/files-${DATE}.tar.gz"
  FILES_TMP="$FILES_PLAIN.tmp"
  cleanup_tmp+=("$FILES_TMP")
  log "tar of volume $BACKUP_FILES_VOLUME → $(basename "$FILES_PLAIN")"
  docker run --rm -v "${BACKUP_FILES_VOLUME}:/data:ro" alpine tar czf - -C /data . > "$FILES_TMP"
  mv -f "$FILES_TMP" "$FILES_PLAIN"
  STEP="encrypt-files"
  encrypt "$FILES_PLAIN"
  UPLOADS+=("$FILES_PLAIN.age")
fi

# ---- 3. upload ---------------------------------------------------------------------------------------------------
if [[ "$BACKUP_SKIP_UPLOAD" == "1" ]]; then
  log "upload: skipped (BACKUP_SKIP_UPLOAD=1)"
else
  STEP="rclone"
  DEST="${RCLONE_REMOTE%/}/${HOST}/"
  for f in "${UPLOADS[@]}"; do
    log "rclone copy $(basename "$f") → $DEST"
    rclone copy --s3-no-check-bucket --retries 3 --low-level-retries 10 "$f" "$DEST"
  done
  # Verify the object landed (size match) — an upload that "succeeded" but is missing is the failure we care about.
  for f in "${UPLOADS[@]}"; do
    remote_size="$(rclone size --json "${DEST}$(basename "$f")" 2>/dev/null | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')"
    local_size="$(wc -c < "$f" | tr -d ' ')"
    [[ "$remote_size" == "$local_size" ]] || { log "remote size mismatch for $(basename "$f"): $remote_size vs $local_size"; exit 1; }
  done
fi

# ---- 4. prune ----------------------------------------------------------------------------------------------------
STEP="prune"
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'db-*.dump.age' -o -name 'files-*.tar.gz.age' \) -mtime +7 -print -delete | sed 's/^/pruned: /' || true
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pre-*.dump' -mtime +14 -print -delete | sed 's/^/pruned: /' || true

# ---- done --------------------------------------------------------------------------------------------------------
STEP="done"
date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/LAST_OK"
rm -f "$BACKUP_DIR/LAST_FAILURE"
log "OK in $(( $(date +%s) - START_TS ))s: ${UPLOADS[*]##*/}"
