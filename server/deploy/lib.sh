# Shared by deploy.sh and placeholder.sh (sourced, not executed). Runs in local
# Git Bash. Both scripts publish a release the same way so the
# /srv/tritonplan/{web,app} symlinks always point into releases/<name>/.
# shellcheck shell=bash

tp_require_ssh() {
  if [ -z "${TP_SSH:-}" ]; then
    echo "error: set TP_SSH (e.g. TP_SSH=root@<server-ip>); it is never stored in the repo" >&2
    exit 1
  fi
}

# UTC timestamp, sorts chronologically as a string.
tp_release_name() { date -u +%Y%m%dT%H%M%SZ; }

# tp_publish <stage-dir> <release-name>
# <stage-dir> holds `web/` and/or `app/`. It is tarred, copied over, unpacked to
# releases/<name>/, the live release's own web/assets are carried over (see
# below), each top-level dir is symlinked to /srv/tritonplan/<dir> (atomic
# swap), and all but the newest 5 unlinked releases are deleted.
# Does NOT restart anything.
tp_publish() {
  local stage=$1 name=$2 tgz
  tgz="$(mktemp)"
  # shellcheck disable=SC2064
  trap "rm -f '$tgz'" RETURN
  tar -C "$stage" -czf "$tgz" .
  scp -q "$tgz" "$TP_SSH:/tmp/tp-release-$name.tgz"
  ssh "$TP_SSH" bash -s -- "$name" <<'REMOTE'
set -euo pipefail
name=$1
root=/srv/tritonplan
rel=$root/releases/$name
tgz=/tmp/tp-release-$name.tgz

mkdir -p "$rel"
# Root-owned, world-readable: Caddy (user caddy) and the service (user
# tritonplan) only read releases; neither can modify them.
tar -xzf "$tgz" -C "$rel" --no-same-owner
rm -f "$tgz"

# A tab opened before this deploy still loads code-split chunks (the campus map,
# its data, the font) by their old hashed names; a missing one 404s and breaks
# that tab. So the new release also serves the live release's OWN assets. Only
# those it shipped itself (listed in its web-assets.list), not what it carried
# over in turn, so old files don't pile up release after release. Never
# overwrites a newer file. A plain loop rather than `cp -n` (its exit status
# changed across coreutils 9.x) or rsync (not installed by provision.sh).
if [ -d "$rel/web/assets" ]; then
  ls -1 "$rel/web/assets" > "$rel/web-assets.list"
  prev=$(readlink -f "$root/web" 2>/dev/null || true)
  if [ -n "$prev" ] && [ -d "$prev/assets" ]; then
    list=$(dirname "$prev")/web-assets.list
    if [ -f "$list" ]; then names=$(cat "$list"); else names=$(ls -1 "$prev/assets"); fi
    carried=0
    while IFS= read -r f; do
      if [ -n "$f" ] && [ -e "$prev/assets/$f" ] && [ ! -e "$rel/web/assets/$f" ]; then
        cp -pR "$prev/assets/$f" "$rel/web/assets/"
        carried=$((carried + 1))
      fi
    done <<< "$names"
    echo "carried $carried asset(s) over from $(basename "$(dirname "$prev")")"
  fi
fi

chown -R root:root "$rel"
chmod -R u=rwX,go=rX "$rel"

for d in "$rel"/*/; do
  [ -d "$d" ] || { echo "error: release $name contains no directories" >&2; exit 1; }
  d=$(basename "$d")
  # ln to a temp name then rename: the live link is never absent or half-made.
  ln -sfn "$rel/$d" "$root/$d.new"
  mv -T "$root/$d.new" "$root/$d"
done

# Keep the newest 5 releases, never deleting one a live link points at.
mapfile -t all < <(ls -1 "$root/releases" | sort)
live=$(readlink -f "$root/web" "$root/app" 2>/dev/null || true)
n=${#all[@]}
for ((i = 0; i < n - 5; i++)); do
  r=$root/releases/${all[i]}
  case "$live" in *"$r/"*) continue ;; esac
  rm -rf "$r"
done
REMOTE
}
