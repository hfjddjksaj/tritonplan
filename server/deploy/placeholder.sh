#!/usr/bin/env bash
# Publish the "moving soon" site (index.html + the real privacy.html) as a
# release, through the same release/symlink mechanism as deploy.sh. Touches
# only the `web` link: not `app`, not the tritonplan service.
#   TP_SSH=root@<ip> bash server/deploy/placeholder.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"
tp_require_ssh

[ -f "$repo/web/public/privacy.html" ] || { echo "error: web/public/privacy.html missing" >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir "$stage/web"
cp "$here/placeholder/index.html" "$stage/web/index.html"
cp "$repo/web/public/privacy.html" "$stage/web/privacy.html"

name="$(tp_release_name)-placeholder"
tp_publish "$stage" "$name"
echo "published release: $name"

# TLS may not be up yet (DNS still propagating): warn, do not fail.
code=$(curl -s -o /dev/null -w '%{http_code}' https://tritonplan.cn/privacy.html || true)
if [ "$code" = "200" ]; then
  echo "https://tritonplan.cn/privacy.html -> 200"
else
  echo "warning: https://tritonplan.cn/privacy.html returned '${code:-no response}' (DNS/TLS may not be ready yet); retry in a minute" >&2
fi
