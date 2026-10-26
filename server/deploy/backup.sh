#!/usr/bin/env bash
# Nightly SQLite backup. Installed as /usr/local/bin/tritonplan-backup and run
# by tritonplan-backup.timer as user tritonplan.
set -euo pipefail
umask 077

DB=/srv/tritonplan/data/tritonplan.db
DIR=/srv/tritonplan/backups
OUT="$DIR/tritonplan-$(date -u +%F).db"
TMP="$OUT.tmp"

# Before the app has ever run there is no database; sqlite3 would happily
# create an empty one at that path, which the app would then adopt.
if [ ! -f "$DB" ]; then
  echo "backup: $DB does not exist yet (app never ran); nothing to back up"
  exit 0
fi

# .backup is safe on a live WAL database (a plain cp is not). Write to a temp
# name and only move it over today's file once it checks out, so a failed run
# never destroys a good backup. (.backup needs a fresh target, hence rm of tmp.)
rm -f "$TMP"
trap 'rm -f "$TMP"' EXIT
sqlite3 "$DB" ".timeout 5000" ".backup '$TMP'"

# A backup that does not pass integrity_check is worse than none: fail loudly.
check=$(sqlite3 "$TMP" 'pragma integrity_check')
if [ "$check" != "ok" ]; then
  echo "backup: integrity_check failed on $TMP: $check" >&2
  exit 1
fi
mv -f "$TMP" "$OUT"
echo "backup: wrote $OUT"

find "$DIR" -name 'tritonplan-*.db' -mtime +14 -delete

# Off-site copy is deferred until the user has a Tencent COS bucket and
# rclone.conf; without the file this step is skipped and nothing fails.
# The destination can be set in /etc/tritonplan/backup.env (TP_RCLONE_DEST=...).
if [ -f /etc/tritonplan/rclone.conf ]; then
  command -v rclone >/dev/null || { echo "backup: rclone.conf exists but rclone is not installed" >&2; exit 1; }
  rclone --config /etc/tritonplan/rclone.conf copy "$OUT" "${TP_RCLONE_DEST:-cos:tritonplan-backups}"
fi
