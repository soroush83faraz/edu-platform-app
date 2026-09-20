#!/usr/bin/env bash
# Host watchdog (cron every 10 minutes):
#   */10 * * * *  /srv/school/watchdog.sh
#
# Checks (each one isolated — a broken check never stops the others):
#   disk     usage of $APP_DIR's filesystem > WATCHDOG_DISK_MAX_PCT (80)
#   mem      MemAvailable < WATCHDOG_MEM_MIN_MB (300)
#   backup   backups/LAST_OK missing or older than WATCHDOG_BACKUP_MAX_H (26) hours, or LAST_FAILURE present
#   health   GET /api/health from inside the app container (app is not published on the host) not ok
#
# Alerting: every alert is appended to $APP_DIR/watchdog.log. Additionally, if ALERT_WEBHOOK is set → POST JSON;
# if KAVENEGAR_API_KEY + ALERT_PHONE are set → SMS through Kavenegar's simple send API (GET). Notifications for a
# check that keeps failing are repeated at most every WATCHDOG_REALERT_MIN (360) minutes (the log line is written
# every run); recovery is logged once. Marker files live in $APP_DIR/backups/.watchdog/.
#
# Environment: read from $APP_DIR/.env (ALERT_WEBHOOK, KAVENEGAR_API_KEY, ALERT_PHONE, ALERT_SENDER) or the caller.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -z "${APP_DIR:-}" ]]; then
  if [[ -f "$SCRIPT_DIR/compose.yml" ]]; then APP_DIR="$SCRIPT_DIR"
  elif [[ -f "$SCRIPT_DIR/../compose.yml" ]]; then APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
  else APP_DIR="/srv/school"; fi
fi
cd "$APP_DIR" || exit 1

envget() {
  local key="$1" val=""
  if [[ -f .env ]]; then val="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"; fi
  printf '%s' "$val"
}

ALERT_WEBHOOK="${ALERT_WEBHOOK:-$(envget ALERT_WEBHOOK)}"
KAVENEGAR_API_KEY="${KAVENEGAR_API_KEY:-$(envget KAVENEGAR_API_KEY)}"
ALERT_PHONE="${ALERT_PHONE:-$(envget ALERT_PHONE)}"
ALERT_SENDER="${ALERT_SENDER:-$(envget ALERT_SENDER)}"
DISK_MAX="${WATCHDOG_DISK_MAX_PCT:-80}"
MEM_MIN="${WATCHDOG_MEM_MIN_MB:-300}"
BACKUP_MAX_H="${WATCHDOG_BACKUP_MAX_H:-26}"
REALERT_MIN="${WATCHDOG_REALERT_MIN:-360}"
LOG="$APP_DIR/watchdog.log"
STATE_DIR="$APP_DIR/backups/.watchdog"
HOST="$(hostname)"; HOST="${HOST%%.*}"
mkdir -p "$STATE_DIR" 2>/dev/null || true

# shellcheck disable=SC2086
compose() { docker compose ${BACKUP_COMPOSE_ARGS:-} "$@"; }
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
logline() { printf '%s %s\n' "$(now_iso)" "$*" | tee -a "$LOG" >/dev/null; }

notify() { # notify <check> <message>
  local check="$1" msg="$2" text
  text="[school/${HOST}] ${check}: ${msg}"
  if [[ -n "$ALERT_WEBHOOK" ]]; then
    local json
    json="$(printf '{"host":"%s","check":"%s","message":"%s","at":"%s"}' "$HOST" "$check" "${msg//\"/\\\"}" "$(now_iso)")"
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' --data "$json" "$ALERT_WEBHOOK" >/dev/null 2>&1 \
      || logline "notify: webhook POST failed"
  fi
  if [[ -n "$KAVENEGAR_API_KEY" && -n "$ALERT_PHONE" ]]; then
    # https://kavenegar.com/rest.html — simple send: GET /v1/{API-KEY}/sms/send.json?receptor=&message=[&sender=]
    curl -fsS -m 15 -G "https://api.kavenegar.com/v1/${KAVENEGAR_API_KEY}/sms/send.json" \
      --data-urlencode "receptor=${ALERT_PHONE}" --data-urlencode "message=${text}" \
      ${ALERT_SENDER:+--data-urlencode "sender=${ALERT_SENDER}"} >/dev/null 2>&1 \
      || logline "notify: kavenegar SMS failed"
  fi
}

alert() { # alert <check> <message> — log every time, notify at most every REALERT_MIN minutes
  local check="$1" msg="$2" marker="$STATE_DIR/$1" send=1
  logline "ALERT $check: $msg"
  if [[ -f "$marker" ]]; then
    local last now; last="$(cat "$marker" 2>/dev/null || echo 0)"; now="$(date +%s)"
    (( now - last < REALERT_MIN * 60 )) && send=0
  fi
  if [[ $send -eq 1 ]]; then date +%s > "$marker"; notify "$check" "$msg"; fi
}

recovered() { # recovered <check>
  local marker="$STATE_DIR/$1"
  if [[ -f "$marker" ]]; then rm -f "$marker"; logline "RECOVERED $1"; notify "$1" "recovered"; fi
}

# ---- disk --------------------------------------------------------------------------------------------------------
check_disk() {
  local pct
  pct="$(df -P "$APP_DIR" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
  [[ -n "$pct" ]] || { logline "disk: df failed"; return; }
  if (( pct > DISK_MAX )); then alert disk "usage ${pct}% > ${DISK_MAX}% on $(df -P "$APP_DIR" | awk 'NR==2{print $6}')"; else recovered disk; fi
}

# ---- memory ------------------------------------------------------------------------------------------------------
check_mem() {
  local avail
  avail="$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null)"
  [[ -n "$avail" ]] || avail="$(free -m 2>/dev/null | awk '/^Mem:/ {print $7}')"
  [[ -n "$avail" ]] || { logline "mem: cannot read /proc/meminfo or free"; return; }
  if (( avail < MEM_MIN )); then alert mem "available ${avail} MB < ${MEM_MIN} MB"; else recovered mem; fi
}

# ---- backup freshness --------------------------------------------------------------------------------------------
check_backup() {
  local f="$APP_DIR/backups/LAST_OK" ts age_h
  if [[ -f "$APP_DIR/backups/LAST_FAILURE" ]]; then
    alert backup "last run failed: $(tr -d '\n' < "$APP_DIR/backups/LAST_FAILURE")"; return
  fi
  if [[ ! -f "$f" ]]; then alert backup "backups/LAST_OK missing (backup.sh never succeeded on this host)"; return; fi
  ts="$(date -d "$(tr -d '\n' < "$f")" +%s 2>/dev/null)" || ts="$(stat -c %Y "$f" 2>/dev/null)"
  [[ -n "$ts" ]] || { logline "backup: cannot parse LAST_OK"; return; }
  age_h=$(( ( $(date +%s) - ts ) / 3600 ))
  if (( age_h > BACKUP_MAX_H )); then alert backup "LAST_OK is ${age_h}h old (> ${BACKUP_MAX_H}h)"; else recovered backup; fi
}

# ---- app health --------------------------------------------------------------------------------------------------
check_health() {
  local out
  if ! compose ps --status running app 2>/dev/null | grep -q app; then alert health "app container not running"; return; fi
  out="$(compose exec -T app node -e \
    "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>{console.log(JSON.stringify(j));process.exit(j.ok?0:1)}).catch(e=>{console.log(String(e));process.exit(1)})" 2>&1)"
  if [[ $? -ne 0 ]]; then alert health "/api/health not ok: ${out:0:200}"; return; fi
  if printf '%s' "$out" | grep -q '"pendingMigrations":[1-9]'; then alert health "pending migrations: ${out:0:200}"; return; fi
  recovered health
}

check_disk   || logline "disk check crashed"
check_mem    || logline "mem check crashed"
check_backup || logline "backup check crashed"
check_health || logline "health check crashed"
exit 0
