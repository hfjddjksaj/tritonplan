#!/usr/bin/env bash
# Ship server/deploy to the host (fresh every time, so a re-run never installs
# stale files) and run provision.sh from that copy. Local Git Bash:
#   TP_SSH=root@<ip> bash server/deploy/provision-remote.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
tp_require_ssh

tar -C "$here" -cf - . |
  ssh "$TP_SSH" 'rm -rf /root/tritonplan-deploy && mkdir -p /root/tritonplan-deploy && tar -C /root/tritonplan-deploy -xf -'
ssh "$TP_SSH" bash /root/tritonplan-deploy/provision.sh
