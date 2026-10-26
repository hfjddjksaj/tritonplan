#!/usr/bin/env bash
# One-time (and safely re-runnable) provisioning of the TritonPlan host:
# Debian 13, run as root. Because it is piped to `bash -s`, it cannot see the
# repo; the config files must already be on the server (see README.md):
#   scp -r server/deploy "$TP_SSH:/root/tritonplan-deploy"
#   ssh "$TP_SSH" 'bash -s' < server/deploy/provision.sh
# Never touches an existing /etc/tritonplan/env (it holds the secrets).
set -euo pipefail

SRC=${TP_DEPLOY_SRC:-/root/tritonplan-deploy}

[ "$(id -u)" -eq 0 ] || { echo "error: run as root" >&2; exit 1; }
for f in Caddyfile tritonplan.service tritonplan-backup.service tritonplan-backup.timer backup.sh env.example; do
  [ -f "$SRC/$f" ] || { echo "error: $SRC/$f not found; scp server/deploy to $SRC first" >&2; exit 1; }
done

export DEBIAN_FRONTEND=noninteractive

echo "== packages"
apt-get update
apt-get install -y ca-certificates curl gnupg sqlite3 debian-keyring debian-archive-keyring apt-transport-https

echo "== Node 24 (NodeSource)"
# The NodeSource script writes its apt source and keyring itself and is
# idempotent; skip it if Node 24 is already there.
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" != "24" ]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
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
apt-get install -y caddy

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

echo "== journald retention (privacy policy: error logs deleted within 14 days)"
install -d /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/tritonplan.conf <<'EOF'
[Journal]
MaxRetentionSec=14day
EOF
systemctl restart systemd-journald

echo "== systemd units and backup script"
install -m 755 "$SRC/backup.sh" /usr/local/bin/tritonplan-backup
install -m 644 "$SRC/tritonplan.service" "$SRC/tritonplan-backup.service" "$SRC/tritonplan-backup.timer" /etc/systemd/system/
systemctl daemon-reload
# The app unit is skipped (ConditionPathExists) until the first deploy.
systemctl enable tritonplan
systemctl enable --now tritonplan-backup.timer

echo "== Caddy config"
install -m 644 "$SRC/Caddyfile" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl enable caddy
systemctl reload-or-restart caddy

echo "provisioning done"
