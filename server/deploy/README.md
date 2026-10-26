# TritonPlan server runbook

Host: one Debian 13 box (Tencent Cloud Lighthouse). Caddy terminates TLS for
`tritonplan.cn` (`www` redirects to the apex) and serves the static planner from
`/srv/tritonplan/web`; `/api/*` is proxied to the Hono server on
`127.0.0.1:8787`, run by systemd as user `tritonplan`.

```
/srv/tritonplan/
  releases/<UTC timestamp>[-placeholder]/{web,app}   root-owned, read-only
  web -> releases/<name>/web      served by Caddy
  app -> releases/<name>/app      main.mjs run by the service
  data/      tritonplan.db (+ -wal/-shm)   tritonplan:tritonplan 750
  backups/   tritonplan-YYYY-MM-DD.db      tritonplan:tritonplan 750
/etc/tritonplan/env   secrets, root:tritonplan 640
```

`TP_SSH` (e.g. `root@<server-ip>`) always comes from your environment; it is
never stored in the repo. Scripts run in Git Bash on your machine.

## First-time setup

```sh
TP_SSH=... bash server/deploy/provision-remote.sh      # safe to re-run
TP_SSH=... bash server/deploy/placeholder.sh           # "moving soon" site + privacy.html
```

`provision-remote.sh` ships `server/deploy` to `/root/tritonplan-deploy` afresh
each time (so a re-run never installs stale files) and runs `provision.sh` from
that copy (not piped, so no child process can swallow the script).
Provisioning installs Node 24, Caddy, the `tritonplan` user, directories, the
service and nightly backup timer, the Caddyfile, and the log-retention config.
The service is enabled but skipped until the first deploy
(`ConditionPathExists`).

Notes on re-runs: provisioning does not restart `tritonplan`, so a changed unit
file takes effect at the next deploy (or `systemctl restart tritonplan`). If DNS
was not resolving when Caddy first started, run `systemctl reload caddy` once it
does so Caddy retries the certificates.

### Filling secrets

Claude never handles secret values. In the Tencent Cloud console open the web
terminal for the instance, then:

```sh
nano /etc/tritonplan/env      # set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, RESEND_API_KEY
systemctl restart tritonplan
```

`provision.sh` never overwrites an existing `env`. Values with spaces or `<>`
are double-quoted (systemd strips the quotes).

## Deploy

```sh
TP_SSH=root@<ip> bash server/deploy/deploy.sh
```

Builds web and server locally, uploads a release, swaps both symlinks
atomically, restarts the service, waits up to 10 s for `/api/health`, and keeps
only the newest 5 releases (never one a live link points at). It prints the
release name.

## Rollback

```sh
ssh "$TP_SSH"
ls /srv/tritonplan/releases                      # find the previous release
R=/srv/tritonplan/releases/<previous>
ln -sfn $R/web /srv/tritonplan/web
ln -sfn $R/app /srv/tritonplan/app
systemctl restart tritonplan
curl -fsS http://127.0.0.1:8787/api/health
```

A `-placeholder` release has no `app/`; only roll the `web` link to it.

### Cutover rollback (moving from GitHub Pages to tritonplan.cn)

The old site stays on GitHub Pages until the cutover merge. To undo the cutover:
`git revert -m 1 <merge commit>` on `main` and push (never rewrite history).
That redeploys the old Pages site. Old localStorage data was never deleted by
the migration, so users keep their local plans.

## Backups

`tritonplan-backup.timer` runs `/usr/local/bin/tritonplan-backup` daily at
10:30 UTC (Pacific small hours; `Persistent=true` catches up after downtime).
It uses `sqlite3 .backup` (safe on a live WAL db), checks `integrity_check`,
writes `/srv/tritonplan/backups/tritonplan-<date>.db`, deletes files older than
14 days, and exits 0 with a note if the database does not exist yet.

Check: `systemctl list-timers | grep tritonplan-backup`,
`journalctl -u tritonplan-backup -n 20`, or run now:
`systemctl start tritonplan-backup`.

Off-site copy is deferred: it runs only if `/etc/tritonplan/rclone.conf` exists
and `rclone` is installed (destination `cos:tritonplan-backups`; override with
`TP_RCLONE_DEST=...` in `/etc/tritonplan/backup.env`, which the backup unit
reads if present). Set it up once the Tencent COS bucket exists; cutover does
not wait for it.

### Restore from a backup

```sh
systemctl stop tritonplan
cp /srv/tritonplan/backups/tritonplan-<date>.db /srv/tritonplan/data/tritonplan.db
rm -f /srv/tritonplan/data/tritonplan.db-wal /srv/tritonplan/data/tritonplan.db-shm
chown tritonplan:tritonplan /srv/tritonplan/data/tritonplan.db
chmod 640 /srv/tritonplan/data/tritonplan.db
systemctl start tritonplan
curl -fsS http://127.0.0.1:8787/api/health
```

Stale `-wal`/`-shm` files must go, or SQLite would replay old journal pages
over the restored file.

### Restore drill (do it for real, then record the result in PROGRESS.md)

1. Register a test account and save a plan.
2. `systemctl start tritonplan-backup`
3. `cp /srv/tritonplan/backups/tritonplan-$(date -u +%F).db /tmp/restore.db`
4. `sqlite3 -readonly /tmp/restore.db 'pragma integrity_check'` must print `ok`.
   Always open backup copies read-only (or as `tritonplan` via `runuser`), so
   root never leaves `-wal`/`-shm` files the app cannot open.
5. Start a second instance on the copy, as `tritonplan` (the env file is
   readable by that group; the later assignments override port and db, and the
   copy must be owned by `tritonplan`):
   `chown tritonplan /tmp/restore.db && sudo -u tritonplan bash -c 'set -a; . /etc/tritonplan/env; TP_PORT=8788 TP_DB_PATH=/tmp/restore.db exec node /srv/tritonplan/app/main.mjs'`
   (`sudo` is not installed on a minimal Debian: use `runuser -u tritonplan -- bash -c '...'`.)
6. `curl -fsS http://127.0.0.1:8788/api/health` is `{"ok":true}`, and
   `select count(*) from plan_docs` matches the live database.
7. Stop the second instance, `rm /tmp/restore.db*`.

## Logs

Caddy has no access log. The journal keeps error logs only;
`/etc/systemd/journald.conf.d/tritonplan.conf` sets `MaxRetentionSec=14day` and
`MaxFileSec=1day` (so the active file rotates daily), matching the privacy
policy's promise that error logs are deleted within 14 days. The host's rsyslog
would otherwise copy them into `/var/log/syslog` (about 4 weeks of retention), so
`/etc/rsyslog.d/10-tritonplan.conf` drops messages from `tritonplan`,
`tritonplan-backup` and `caddy`; rsyslog itself stays (the host security agent
reads auth logs). Do not add an access log without updating the policy.
