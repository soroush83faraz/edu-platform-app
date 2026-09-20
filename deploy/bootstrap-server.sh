#!/usr/bin/env bash
# One-time VPS bootstrap. Run as root on a fresh Ubuntu 24.04:
#   curl -fsSL <raw-url>/bootstrap-server.sh -o bootstrap.sh
#   bash bootstrap.sh "ssh-ed25519 AAAA... you@laptop"
# Idempotent enough to re-run.
set -euo pipefail

PUBKEY="${1:?usage: bootstrap-server.sh \"<ssh public key>\"}"
DEPLOY_USER="deploy"
APP_DIR="/srv/school"
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }

log "apt update + base packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg ufw fail2ban unattended-upgrades apt-listchanges chrony \
  docker.io docker-compose-v2 git age rclone

log "user ${DEPLOY_USER} + SSH key"
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi
usermod -aG docker "$DEPLOY_USER"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
grep -qxF "$PUBKEY" "/home/${DEPLOY_USER}/.ssh/authorized_keys" || echo "$PUBKEY" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"

log "sshd hardening (key-only, no root)"
cat > /etc/ssh/sshd_config.d/90-hardening.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
X11Forwarding no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
SSHD
sshd -t && systemctl reload ssh

log "ufw 22/80/443"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

log "fail2ban (sshd)"
cat > /etc/fail2ban/jail.d/sshd.local <<'F2B'
[sshd]
enabled = true
maxretry = 5
findtime = 10m
bantime = 1h
F2B
systemctl enable --now fail2ban
systemctl restart fail2ban

log "unattended-upgrades with reboot Fri 04:00"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT
cat > /etc/apt/apt.conf.d/52unattended-upgrades-local <<'APT'
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
APT
# unattended-upgrades has no weekday knob, so reboots (when /var/run/reboot-required exists) happen via a Friday 04:00 timer.
cat > /etc/systemd/system/reboot-window.service <<'SVC'
[Unit]
Description=Allow unattended-upgrades reboot only in the Friday 04:00 window
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'if [ "$(date +%%u)" = "5" ] && [ -f /var/run/reboot-required ]; then /sbin/shutdown -r +5 "weekly maintenance reboot"; fi; exit 0'
SVC
cat > /etc/systemd/system/reboot-window.timer <<'TMR'
[Unit]
Description=Weekly reboot window (Friday 04:00 Asia/Tehran)
[Timer]
OnCalendar=Fri *-*-* 04:00:00
Persistent=true
[Install]
WantedBy=timers.target
TMR
systemctl daemon-reload
systemctl enable --now reboot-window.timer
systemctl enable --now unattended-upgrades

log "2G swap"
if ! swapon --show | grep -q '/swapfile'; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
sysctl -w vm.swappiness=10 >/dev/null
grep -q 'vm.swappiness' /etc/sysctl.d/99-school.conf 2>/dev/null || echo 'vm.swappiness=10' > /etc/sysctl.d/99-school.conf

log "timezone Asia/Tehran + chrony (ir.pool.ntp.org)"
timedatectl set-timezone Asia/Tehran
cat > /etc/chrony/sources.d/ir.sources <<'CHR'
pool ir.pool.ntp.org iburst
pool 0.asia.pool.ntp.org iburst
CHR
systemctl restart chrony

log "docker daemon.json (Arvan/focker mirrors + log rotation)"
install -d /etc/docker
cat > /etc/docker/daemon.json <<'DJ'
{
  "registry-mirrors": ["https://docker.arvancloud.ir", "https://focker.ir"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
DJ
systemctl enable docker
systemctl restart docker

log "app dir ${APP_DIR}"
mkdir -p "${APP_DIR}/backups" "${APP_DIR}/db/initdb"

log "cron for ${DEPLOY_USER}: nightly backup, weekly restore drill, 10-minute watchdog"
# Scripts are copied from deploy/ afterwards (README); until then cron only logs "No such file". Host TZ = Asia/Tehran,
# so 02:30 here is 23:00 UTC (the dump file names are UTC dates). Iran has had no DST since 1401.
crontab -u "$DEPLOY_USER" - <<'CRON'
# m  h  dom mon dow  command                                              (host TZ = Asia/Tehran)
30   2  *   *   *    /srv/school/backup.sh       >> /srv/school/backups/backup.log 2>&1
30   6  *   *   5    /srv/school/restore-test.sh >> /srv/school/backups/restore-test.log 2>&1
*/10 *  *   *   *    /srv/school/watchdog.sh
CRON
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

log "pre-pull base images (should take < 2 min via mirror)"
docker pull postgres:16 || true
docker pull caddy:2 || true

log "done. Next: copy deploy/{compose.yml,Caddyfile,deploy.sh,rollback.sh,watchdog.sh,backup/*.sh,db/initdb/*} and .env to ${APP_DIR} as ${DEPLOY_USER}, run 'rclone config' as ${DEPLOY_USER} (see deploy/README.md), then run ship.ps1 from Windows."
ss -tlnp | awk 'NR==1 || /:22 |:80 |:443 /'
