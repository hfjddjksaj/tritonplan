#!/usr/bin/env bash
# Build locally, ship a new release to the server, switch the symlinks, restart
# the service and wait for /api/health. Run from Git Bash at any directory:
#   TP_SSH=root@<ip> bash server/deploy/deploy.sh
# Rollback: see README.md (point both links at the previous release, restart).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
tp_require_ssh

cd "$repo"
npm run build -w @triton/web
npm run build -w @triton/server
[ -f web/dist/index.html ] || { echo "error: web/dist/index.html missing after build" >&2; exit 1; }
[ -f server/dist/main.mjs ] || { echo "error: server/dist/main.mjs missing after build" >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cp -r web/dist "$stage/web"
mkdir "$stage/app"
cp server/dist/main.mjs "$stage/app/main.mjs"

name="$(tp_release_name)"
tp_publish "$stage" "$name"

echo "restarting tritonplan..."
ssh "$TP_SSH" 'systemctl restart tritonplan'

# Up to 10 s for the app to answer on loopback.
if ssh "$TP_SSH" 'for i in $(seq 1 10); do curl -fsS http://127.0.0.1:8787/api/health && exit 0; sleep 1; done; exit 1'; then
  echo
  echo "deployed release: $name"
else
  echo "error: health check failed after 10 s; recent logs:" >&2
  ssh "$TP_SSH" 'journalctl -u tritonplan -n 30 --no-pager' >&2 || true
  echo "release $name is live but unhealthy; roll back per server/deploy/README.md" >&2
  exit 1
fi
