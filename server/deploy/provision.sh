#!/usr/bin/env bash
# One-time (and safely re-runnable) provisioning of the TritonPlan host:
# Debian 13, run as root, from the copy that provision-remote.sh ships:
#   TP_SSH=root@<ip> bash server/deploy/provision-remote.sh
# Do not pipe this script into `bash -s`: bash reads a piped script
# incrementally, and any child that reads stdin (e.g. a dpkg prompt) would eat
# the rest of it.
# Never touches an existing /etc/tritonplan/env (it holds the secrets) and does
# not restart tritonplan.
set -euo pipefail

SRC=${TP_DEPLOY_SRC:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}

[ "$(id -u)" -eq 0 ] || { echo "error: run as root" >&2; exit 1; }
for f in Caddyfile tritonplan.service tritonplan-backup.service tritonplan-backup.timer backup.sh env.example; do
  [ -f "$SRC/$f" ] || { echo "error: $SRC/$f not found" >&2; exit 1; }
done

export DEBIAN_FRONTEND=noninteractive
# A re-run that upgrades a package must never stop at a conffile prompt.
apt_install() {
  apt-get install -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"
}

echo "== packages"
apt-get update
apt_install ca-certificates curl gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https

echo "== Node 24 (NodeSource)"
# The NodeSource script writes its apt source and keyring itself and is
# idempotent; skip it if Node 24 is already there.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt_install nodejs
fi
node --version

echo "== Caddy (official cloudsmith repo)"
if [ ! -f /etc/apt/sources.list.d/caddy-stable.list ]; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    -o /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
fi
apt_install caddy

echo "== user and directories"
id tritonplan >/dev/null 2>&1 ||
  useradd --system --user-group --home /srv/tritonplan --shell /usr/sbin/nologin tritonplan
# /srv/tritonplan and releases stay root-owned 755 so Caddy can traverse and
# read the web root; only data and backups belong to the service user.
mkdir -p /srv/tritonplan/releases /srv/tritonplan/data /srv/tritonplan/backups
chmod 755 /srv/tritonplan /srv/tritonplan/releases
chown tritonplan:tritonplan /srv/tritonplan/data /srv/tritonplan/backups
chmod 750 /srv/tritonplan/data /srv/tritonplan/backups

install -d -m 750 -o root -g tritonplan /etc/tritonplan
if [ ! -f /etc/tritonplan/env ]; then
  install -m 640 -o root -g tritonplan "$SRC/env.example" /etc/tritonplan/env
  echo "created /etc/tritonplan/env from env.example: fill in the secrets by hand"
else
  echo "/etc/tritonplan/env already exists: left untouched"
fi

echo "== log retention (privacy policy: app/Caddy logs live only in the journal, deleted within 14 days)"
install -d /etc/systemd/journald.conf.d
# MaxRetentionSec only deletes whole archived files; MaxFileSec=1day makes the
# active file rotate daily so nothing outlives the 14 days by much.
cat > /etc/systemd/journald.conf.d/tritonplan.conf <<'EOF'
[Journal]
MaxRetentionSec=14day
MaxFileSec=1day
EOF
systemctl restart systemd-journald

# The Tencent image runs rsyslog, which copies journal messages into
# /var/log/syslog under logrotate's ~4-week retention. Keep rsyslog (the host
# security agent relies on auth logs) but keep our services out of it.
if command -v rsyslogd >/dev/null; then
  install -d /etc/rsyslog.d
  cat > /etc/rsyslog.d/10-tritonplan.conf <<'EOF'
# TritonPlan: app and Caddy logs stay only in the 14-day journal (see the
# privacy policy), never in /var/log/syslog.
if $programname == "tritonplan" or $programname == "tritonplan-backup" or $programname == "caddy" then stop
EOF
  systemctl restart rsyslog
fi

echo "== systemd units and backup script"
install -m 755 "$SRC/backup.sh" /usr/local/bin/tritonplan-backup
install -m 644 "$SRC/tritonplan.service" "$SRC/tritonplan-backup.service" "$SRC/tritonplan-backup.timer" /etc/systemd/system/
systemctl daemon-reload
# The app unit is skipped (ConditionPathExists) until the first deploy.
systemctl enable tritonplan
systemctl enable --now tritonplan-backup.timer

echo "== Caddy config"
# Validate the shipped file first so a bad Caddyfile never replaces a working one.
caddy validate --config "$SRC/Caddyfile" --adapter caddyfile
install -m 644 "$SRC/Caddyfile" /etc/caddy/Caddyfile
systemctl enable caddy
systemctl reload-or-restart caddy

echo "provisioning done"
