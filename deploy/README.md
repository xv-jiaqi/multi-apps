# Cardhub VPS deployment

This directory runs Cardhub on one Linux VPS with Docker Compose. Use the same
compose file for staging and production by changing the project name and env
file:

- production: `docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env ...`
- staging: `docker compose -p cardhub-staging --env-file /opt/cardhub/staging/staging.env ...`

Run one shared Caddy proxy from `deploy/edge/`. App projects start only API,
web, Postgres, and Redis. Postgres and Redis stay on each compose project's
private default network; only API and web also join the external `edge` network
with aliases derived from `ENV_NAME` (`prod-api`, `staging-api`, etc.). Only
Caddy publishes host ports.

## One-time server bootstrap

1. Create a key-only `deploy` user and install Docker Engine + the Compose
   plugin. Add `deploy` to the `docker` group, noting that Docker group access
   is root-equivalent:
   ```bash
   sudo adduser --disabled-password --gecos '' deploy
   sudo usermod -aG docker deploy
   sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   # Install the deploy public key into /home/deploy/.ssh/authorized_keys.
   sudo chmod 600 /home/deploy/.ssh/authorized_keys
   sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
   ```
2. Create the deploy layout:
   ```bash
   sudo mkdir -p /opt/cardhub/production/deploy /opt/cardhub/staging/deploy /opt/cardhub/edge/deploy /opt/cardhub/backups
   sudo chown -R deploy:deploy /opt/cardhub
   sudo chmod 750 /opt/cardhub /opt/cardhub/production /opt/cardhub/staging /opt/cardhub/edge /opt/cardhub/backups
   ```
3. Copy `deploy/docker-compose.yml`, `deploy/remote-deploy.sh`,
   `deploy/backup.sh`, and `deploy/check-backup-log.sh` into each app env's
   `deploy/` directory. Copy `deploy/edge/` into `/opt/cardhub/edge/deploy/edge/`.
4. Create app env files from `.env.example`:
   ```bash
   cp deploy/.env.example /opt/cardhub/production/production.env
   cp deploy/.env.example /opt/cardhub/staging/staging.env
   chown deploy:deploy /opt/cardhub/production/production.env /opt/cardhub/staging/staging.env
   chmod 600 /opt/cardhub/production/production.env /opt/cardhub/staging/staging.env
   ```
   Fill different domains, secrets, database names/passwords, and `IMAGE_TAG`
   values in each app env file. Set `ENV_NAME=prod` in `production.env` and
   `ENV_NAME=staging` in `staging.env`. In `production.env`, also set
   `SENTRY_ENVIRONMENT=production` so Sentry events from both API and Web match
   production monitors while `ENV_NAME` remains `prod` for container and network
   names. Set `SENTRY_DSN` for API events and `WEB_SENTRY_DSN` for browser
   events. Leave either DSN empty to disable that side cleanly. `TRPC_URL`
   should point at that
   environment's API `/trpc` endpoint. Use separate database names:
   `POSTGRES_DB=cardhub_prod` for production and
   `POSTGRES_DB=cardhub_staging` for staging. Database passwords are lowercase
   hex from `openssl rand -hex 32`.
   `PASSWORD_PREHASH_WRITE` must be the exact string `true` to store the
   pre-hashed password format. Leave it `false` in `production.env`. Set it
   to `true` in `staging.env`. The API compose service lists the variable
   explicitly; putting it only in the env file does not inject it.
   `POSTGRES_USER` / `POSTGRES_PASSWORD` are the admin superuser (data-directory
   init, restore, emergency admin). `DATABASE_URL` is the runtime role and
   `MIGRATE_DATABASE_URL` is the schema owner. Leave `MIGRATE_DATABASE_URL`
   empty, and keep `DATABASE_URL` on the superuser, until the cutover in
   [db/README.md](db/README.md). Do not put database passwords in GitHub
   Environments.
5. Create `/opt/cardhub/edge/edge.env` with only the edge routing vars:
   ```dotenv
   ENV_NAME=prod
   ROOT_WEB_DOMAINS=card-hub.app
   ROOT_WEB_REDIRECT_DOMAINS=www.card-hub.app
   ROOT_WEB_REDIRECT_TARGET=card-hub.app
   API_DOMAIN=api.card-hub.app
   STAGING_WEB_DOMAIN=staging.card-hub.app
   STAGING_API_DOMAIN=api-staging.card-hub.app
   ```
   Then lock it down:
   ```bash
   chown deploy:deploy /opt/cardhub/edge/edge.env
   chmod 600 /opt/cardhub/edge/edge.env
   ```
6. Log in to GHCR as the `deploy` user with a classic PAT scoped to
   `read:packages` only. Packages stay private; the server only needs pull
   access:
   ```bash
   sudo -iu deploy
   echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
   ```
7. Add DNS records:
   - Apex `card-hub.app` A -> VPS public IP with the Cloudflare proxy disabled
   - `www.card-hub.app` A -> VPS public IP as a DNS-only record; no AAAA record
     is needed because the VPS does not use IPv6. Caddy serves the HTTPS
     redirect and preserves the request path/query
   - `API_DOMAIN` A/AAAA -> VPS public IP
   - staging web/API domains -> VPS public IP

Create the shared proxy network idempotently and start Caddy once:

```bash
docker network inspect edge >/dev/null 2>&1 || docker network create edge
cd /opt/cardhub/edge/deploy/edge
docker compose -p cardhub-edge --env-file /opt/cardhub/edge/edge.env up -d
```

Caddy obtains and renews HTTPS certificates automatically.

The root domain route is enabled by `edge/optional/root-web.caddy`; keep
`ROOT_WEB_DOMAINS=card-hub.app` in `/opt/cardhub/edge/edge.env`. The Caddyfile
uses a disabled fallback hostname if `ROOT_WEB_DOMAINS` is unset so Caddy can
still start, but production should keep the apex value set. The same Caddyfile
redirects `ROOT_WEB_REDIRECT_DOMAINS=www.card-hub.app` to
`https://card-hub.app` with a permanent redirect; keep
`ROOT_WEB_REDIRECT_TARGET=card-hub.app` in `/opt/cardhub/edge/edge.env`.

Security headers are set on the edge, not in the web image. nginx in
`Dockerfile.web` only sets cache headers. `card-hub.app`
(`optional/root-web.caddy`) and `staging.card-hub.app` send
`Strict-Transport-Security: max-age=31536000; includeSubDomains` (no
`preload`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and
`Content-Security-Policy: frame-ancestors 'none'`. Both API hostnames send
that same HSTS value and `nosniff`. The handlers use `defer`, so they replace
the same fields from upstream. `lb_try_duration` is unchanged.
`deploy/web-security-headers.test.sh` checks these three web headers and,
when `caddy` is installed, requests the handler with `curl -I`.

After changing any edge env vars manually, recreate the Caddy container so
Compose injects the new environment; `caddy reload` does not pick up env-file
changes:

```bash
cd /opt/cardhub/edge/deploy/edge
docker compose -p cardhub-edge --env-file /opt/cardhub/edge/edge.env up -d caddy
```

Compose bind-mounts this directory at `/etc/caddy`. A push to `main` syncs
those files and reloads Caddy only when the running container already sees
them. It does not recreate the container. A manual run with an older
`image_tag` still syncs this directory from the workflow ref, not from the
image commit. The container still running from
the old single-file `Caddyfile` mount cannot see a replaced file; the deploy
stops there, before the app rollout, and leaves that container running.
Switch it once, when a few seconds of downtime for every domain is acceptable:

Actions → Cardhub Deploy → Run workflow → environment `staging`, image tag
`sha-<full git sha>` (staging also accepts `main`), `recreate_edge` checked.

Until that run finishes, do not restart the current Caddy container. A
restart would read the stale `Caddyfile` inode and the proxy would not come
back.

For GitHub Actions deploys, configure environment-scoped secrets:

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

`DEPLOY_KNOWN_HOSTS` must contain the pinned host key line for the VPS (for
example from a trusted console or first-party host-key inventory). The workflow
uses `StrictHostKeyChecking=yes` and does not run `ssh-keyscan`.

The `production` GitHub Environment must also require reviewers and restrict
deployment branches to `main`. The `staging` GitHub Environment must also
restrict deployment branches to `main`; staging deploys only main SHAs.

Staging and production can share one VPS for cost/convenience, but a staging
deploy key on the same host is not a hard security boundary: Docker group access
is root-equivalent and can read files such as production env files. Full key and
secret isolation requires a separate staging host.

## Ubuntu 24.04 hardening notes

- For fail2ban SSH protection on Ubuntu 24.04, use an `sshd` jail with
  `backend = auto` and `logpath = /var/log/auth.log`. The systemd unit is
  `ssh.service` on Ubuntu, not `sshd.service`.
- Some Alibaba Cloud images set `vm.swappiness=0` in `/etc/sysctl.conf`. Keep
  that in mind when comparing memory behavior with stock Ubuntu images.

## Deploy

Production and staging deploys go through `remote-deploy.sh`. A plain
`docker compose up -d` on `api` or `web` stops the old container before the new
one is listening, and the shared edge Caddy then has nothing to dial.

```bash
/opt/cardhub/production/deploy/remote-deploy.sh production sha-<full-git-sha> <full-git-sha>
```

Use `staging` with `/opt/cardhub/staging/staging.env` for staging. If both run
on the same host, keep distinct `WEB_DOMAIN`, `API_DOMAIN`, Postgres DB names,
and passwords in each env file. Production deploys are manual; staging can be
redeployed automatically by GitHub Actions after CI and image builds succeed on
main. Production deploys require an explicit immutable `sha-<full-git-sha>` tag.
That tag selects the API and web images only. The workflow checks out
`github.sha` (the main commit this run is pinned to) and syncs
`deploy/docker-compose.yml`, `remote-deploy.sh`, and `deploy/edge/` from that
commit. It does not check out the image tag. Rolling an older image back
cannot replace the shared Caddyfile or the rolling deploy script with the
copies stored in that older commit.

Both the edge job and the deploy job run `deploy/resolve-deploy-inputs.sh`
after that checkout. The script fetches `origin/main` and exits 1 unless
`git rev-parse HEAD:deploy` equals `git rev-parse origin/main:deploy`. An
image SHA that is merely an ancestor of main is not enough. GitHub re-runs an
old run on its original commit for 30 days, and a run queued on an older
commit can start after main has already published a newer `deploy/` tree.
Either case would otherwise sync old compose files, `remote-deploy.sh`, and
the shared edge, then reload Caddy.

The first check is not the one that guards the upload. The deploy job then
waits up to about 10 minutes for the GHCR image. The edge job configures SSH
before it packs `deploy/edge`. Each job runs `git fetch origin main` and
`deploy/resolve-deploy-inputs.sh --assert` again as the step immediately
before the step that syncs those files. The deploy job's next command is
the tar. The edge job first reads three values over ssh (the pending marker,
the applied hash, and the tree hash); those reads take seconds, then it
tars. If `deploy/` changed on main during the wait, the second
assert exits 1 and the job does not upload the checkout's compose,
`remote-deploy.sh`, or edge.

### Re-running Cardhub Deploy

Runs created before this guard merged (#110) use the old workflow file baked
into that run. That file has no `deploy/` tree check, and GitHub will keep
offering Re-run for about 30 days. Until roughly 2026-11-17, do not re-run any
Cardhub Deploy run created before #110's merge. After #110, re-running is safe
only because the guard rejects a stale `deploy/` tree.

### Zero-downtime rollout

`remote-deploy.sh` pulls the new API and web images, starts Postgres and Redis
if needed, and waits until those two are healthy. It then runs the one-shot
`migrate` container (`prisma migrate deploy`) and, only if that exits 0,
rolls API and web one service at a time:

1. `docker compose up -d --no-deps --scale <service>=2 --no-recreate` starts
   the new container next to the old one. Both attach to the external `edge`
   network with the same alias (`prod-api`, `staging-web`, and so on), so
   Docker DNS answers that name with both addresses.
2. The script waits until the new container's Docker healthcheck is `healthy`.
   It then probes that container directly: web must serve `/healthz`, and API
   `/health` must report `gitSha` equal to the deployed SHA. The probe does
   not go through Caddy, because Caddy can still reach the old replica.
3. It stops the old container by ID (`docker stop` with a 30s grace) and
   removes it, then returns the service to one replica with
   `--scale <service>=1 --no-recreate` so Compose does not recreate the
   survivor.
4. After both services are on the new tag, it still checks
   `https://<API_DOMAIN>/health` through Caddy until `gitSha` matches.

API is cut over before web, and web is not scaled up until API is back to one
container. The script holds `/opt/cardhub/.rollout.lock` for the whole
operation, so production and staging cannot add a replica at the same time.
The VPS is 4GB RAM plus 2GB swap and runs both environments; the peak extra
is one API container or one web container, not one of each and not one per
environment.

If the new container fails its healthcheck or SHA probe, the script deletes
that container and exits non-zero. The old container is still running. The
existing rollback then runs `docker compose up -d` with the previous
immutable `sha-` tag. A replica that is already on that tag is left in place,
and a mismatched extra replica is removed. If the failure happens after the
cutover (the public health check or `CATALOG_SEED_CMD`), rollback recreates
API and web on the previous tag. `previous-images.env` is written only after
that switch succeeds, and it records the tags that were running before the
switch. A rollback does not rewrite the file, so the real previous image
stays protected for the next cleanup.

### Schema compatibility

The one-shot `migrate` container runs `prisma migrate deploy` before the new
API container starts, while the previous API process is still serving. Before
Prisma runs it logs `Migrating as current_user=<role> rolsuper=<true|false>`.
That line is the role name and a boolean, not a URL or a password. A failed
migration aborts the deploy and leaves that previous container in place. Migrations have to be additive. The old release reads and writes the
database after the new migration has committed, for the whole overlap. Do not
rename, retype, or drop columns, tables, or constraints that the running
version uses. Ship that kind of change in a later release, after no running
code depends on the old shape. Prisma does not roll a migration back
automatically; a failed deploy that rolls the containers back does not undo
the schema. Do not delete or edit a migration directory after it has landed
on `main`. Roll a schema change back with a new forward migration in its own
pull request, and only after every release that still depends on the old
shape has stopped. Authoring steps and examples are in
[docs/Cardhub/development-backlog.md](../docs/Cardhub/development-backlog.md)
§1.3.

### Stopping the old API container

The API entrypoint `exec`s node, so the server is not left under a shell.
Migrations run in a separate one-shot container and are not in this process.
`main.ts` installs its own SIGTERM/SIGINT handlers instead of Nest's
`enableShutdownHooks()`, which would re-send the signal and exit with 143.
The first signal logs `开始 drain` and closes the HTTP listener before Prisma
or Redis disconnect; repeated signals are ignored. Node >=22's
`server.close()` stops new connections, closes already idle keep-alive sockets,
and waits for in-flight responses. A response `finish` listener closes connections
that become idle during drain, without changing `keepAliveTimeout` or adding delays.
After logging `drain complete`, `app.close()` runs Nest's resource shutdown
hooks and the process exits with code 0. `SHUTDOWN_TIMEOUT_MS` bounds the
entire sequence, including resource cleanup (default 25000 milliseconds;
must be a positive integer no greater than 2147483647). On timeout or error,
the process logs an error, force-closes remaining HTTP connections, and exits
with code 1. Keep this deadline below the container's grace period. Compose sets
`init: true` on `api` so tini is PID 1 and forwards SIGTERM to node. Without
init, node is PID 1 and the same listener still runs. `stop_grace_period` and
the script's `docker stop -t` are 30 seconds. This leaves 5 seconds beyond the
default application deadline before the container would send SIGKILL.

`rollout_service` in `remote-deploy.sh` starts the new container beside the
old one (`docker compose up -d --no-deps --scale <service>=2 --no-recreate`),
waits until that container is healthy and the in-container probe passes, and
only then runs `docker stop -t 30` on the old container id. A new container
that fails health or the probe is deleted. The old container keeps serving.

tini is the same uid as node and keeps the container environment, which is why
`MIGRATE_DATABASE_URL` is not set on the `api` service.

### Edge retries

The shared Caddy retries only GET and HEAD, for up to 5 seconds
(`lb_try_duration 5s`, `lb_try_interval 250ms`, `lb_retry_match` limited to
those methods). Dial failures are retried for every method when
`lb_try_duration` is non-zero, and `lb_retry_match` does not apply to them, so
every other method uses a second `reverse_proxy` with `lb_try_duration 0s`.
tRPC mutations are POST and are not retried. Hostnames and redirects are
unchanged.

The deploy workflow syncs `deploy/` files from the workflow ref (`github.sha`
on main), not from the image tag, to the VPS before
running `/opt/cardhub/<environment>/deploy/remote-deploy.sh`. The script polls
`https://<API_DOMAIN>/health` through Caddy with `curl --resolve
<API_DOMAIN>:443:127.0.0.1` until `gitSha` equals the deployed SHA and fails on
missing or mismatched SHA. This keeps the check independent of the VPS resolver
cache while still exercising Caddy, TLS, and routing. If verification fails
after switching containers, the script attempts to roll back to the previously
running immutable `sha-` tag and still fails the job.

Image builds use Docker Buildx's GitHub Actions cache with separate scopes for
API and Web images. The cache is configured with `mode=max` so intermediate
layers such as the API production dependency tree can be reused across fresh
GitHub runners. GitHub's Actions cache has a 10GB repository limit; because the
scopes are per image, older cache entries are evicted by GitHub's LRU policy when
the repo exceeds that limit.

After a switch succeeds, `remote-deploy.sh` records the API and web `sha-`
tags that were running before that switch in
`/opt/cardhub/<environment>/.deploy-state/`. A rollback leaves the file
unchanged.
After a successful deploy, `image-cleanup.sh` removes only stale
`ghcr.io/xv-jiaqi/cardhub-api:sha-*` and
`ghcr.io/xv-jiaqi/cardhub-web:sha-*` images. Cleanup keeps, independently for
`cardhub-prod` and `cardhub-staging`:

- the images currently referenced by that compose project's containers;
- the previous API and web tags recorded in that environment's state file;
- any Cardhub image still referenced by any local Docker container, running or
  stopped, including both the old and new replica while a rollout overlaps; and
- any tag whose image ID is the image of such a container.

This is intentionally cross-environment: a staging deploy scans both production
and staging state before deleting anything, so staging cannot remove production's
current image or production's rollback target. Cleanup is best-effort and logs a
warning instead of failing the deployment if Docker cleanup fails. Cleanup takes
a non-blocking lock at `/opt/cardhub/.image-cleanup.lock`; if staging and
production deploy concurrently, whichever cleanup starts second skips its cleanup
attempt and the deploy still succeeds. The script is scoped to Cardhub API/Web
`sha-*` tags and does not run a machine-wide dangling image prune. Docker frees
layers that become unreferenced by the removed Cardhub tags, while unrelated
dangling images are left alone.

To inspect the decision without deleting images, run:

```bash
/opt/cardhub/staging/deploy/image-cleanup.sh --dry-run --root /opt/cardhub
```

Keep `CATALOG_SEED_CMD` empty for normal deploys so later catalog edits are not
overwritten. On the first deploy of an empty database, run the catalog-only seed
once after the API is healthy. The seed script only inserts missing series and
cards by slug; existing rows are left untouched.

```bash
docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env exec -T api node dist/scripts/seed-catalog.js
```

Staging should use the same one-time catalog seed. Test accounts are created
manually by ops with random passwords. Do not run `seed-demo` on staging. The
optional `CATALOG_SEED_CMD` hook remains available for controlled one-off use;
if set and it fails, it triggers the same rollback path and exits non-zero.

The web container receives runtime `TRPC_URL` and optional browser Sentry
settings (`WEB_SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and the image `GIT_SHA`) via
the nginx entrypoint. The generated `/config.js` is uncached and validated at
container startup; a missing or malformed `TRPC_URL` makes the web container
exit instead of silently falling back to another API URL.

## Rollback

Set `IMAGE_TAG` to an older immutable `sha-<full-git-sha>` tag in the target
env file, then redeploy:

```bash
cd /opt/cardhub/production/deploy
IMAGE_TAG=sha-<older-full-git-sha> ENV_NAME=prod docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env pull api web
IMAGE_TAG=sha-<older-full-git-sha> ENV_NAME=prod docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env up -d postgres redis api web
```

Prisma migrations are not automatically rolled back. Handle schema reversions
manually if a rollback crosses a database migration. Password hashes have no
schema change. While `PASSWORD_PREHASH_WRITE` is not the exact string `true`,
new hashes stay legacy bcrypt and a rolled-back API can still verify them.
After the flag has been `true`, hashes written as `sha256$...` do not verify
on the previous release until that release is restored or the password is
reset. Legacy passwords longer than 72 UTF-8 bytes are not upgraded on login.
During a normal rollout
the previous API keeps serving after `prisma migrate deploy` has committed, so
the migration itself has to stay compatible with that previous release. See
"Schema compatibility" above.

## Database roles

The API must not connect as the Postgres superuser. The cutover, grants, and
rollback are in [db/README.md](db/README.md). Short version: `cardhub` stays a
superuser for admin only; `cardhub_migrator` owns the schema and runs
`prisma migrate deploy` in the one-shot `migrate` container;
`cardhub_runtime` is the API (DML only); `cardhub_backup` is the read-only
`pg_dump` role. `pg_trgm` created before the split stays owned by `cardhub`
(PostgreSQL 16 has no `ALTER EXTENSION ... OWNER TO`);
`ALTER EXTENSION pg_trgm UPDATE` on that extension uses the admin account.

## Backups

Run a daily compressed `pg_dump`. The script writes to temporary files, verifies
the dump and gzip, then atomically renames the backup on success. It keeps the
latest 7 daily backups plus 4 weekly backups and never deletes the newest
successful backup.

Staging and production append to the same log. These cron times are
Asia/Shanghai (UTC+8): staging at 02:15, production at 02:20. No
`BACKUP_PING_URL` is configured in cron, in the env files, or in GitHub
Actions, so a missed run does not call healthchecks.io. Patrol the log
instead.

```cron
CRON_TZ=Asia/Shanghai
15 2 * * * PROJECT=cardhub-staging ENV_FILE=/opt/cardhub/staging/staging.env COMPOSE_FILE=/opt/cardhub/staging/deploy/docker-compose.yml /opt/cardhub/staging/deploy/backup.sh >> /opt/cardhub/backups/backup.log 2>&1
20 2 * * * PROJECT=cardhub-prod ENV_FILE=/opt/cardhub/production/production.env COMPOSE_FILE=/opt/cardhub/production/deploy/docker-compose.yml /opt/cardhub/production/deploy/backup.sh >> /opt/cardhub/backups/backup.log 2>&1
```

Every exit appends exactly one status line. Success:

```text
BACKUP_RESULT=ok project=cardhub-prod ts=2026-10-18T18:20:01Z file=cardhub-prod-20261018T182001Z.sql.gz
```

Failure:

```text
BACKUP_RESULT=fail project=cardhub-prod ts=2026-10-18T18:20:01Z rc=1 reason=offsite-env-missing
```

`ts` is UTC (`YYYY-MM-DDTHH:MM:SSZ`). `file` is the local dump name and appears
only on success. `reason` is one token, for example `offsite-env-missing`,
`offsite-env-unreadable`, `missing-OSS_BUCKET`, `pipefail`, `sigterm`,
`sigint`, or `command-failed`. `rc` is the script exit status.

Patrol over SSH once per project. A staging success does not cover production:
both jobs share `/opt/cardhub/backups/backup.log`, and the checker matches
`project=<name>` as a whole token (`cardhub-prod` does not match
`cardhub-prod-old`). A line counts only when it starts with exactly
`BACKUP_RESULT=ok` or `BACKUP_RESULT=fail`, and it contains one
`BACKUP_RESULT=` token, one `project=` token, and one `ts=` token. The
checker reads that line-start result and the first `ts=`. A duplicate
`BACKUP_RESULT=`, `project=`, or `ts=` token is malformed. So is a prefixed
line, an empty `BACKUP_RESULT=`, or any other status such as
`BACKUP_RESULT=FAILED`. Those lines fail the check instead of falling back
to an older ok.
`backup.log` lines must not be prefixed: no timestamps or other log prefixes
before `BACKUP_RESULT`. A line that contains `BACKUP_RESULT=` and that exact
`project=` token but does not start with `BACKUP_RESULT=` fails the check.
It exits 0 only when that project's latest well-formed line is `ok`, `ts` is
within the max age, and `ts` is not more than five minutes in the future. Use
26 hours so a missed night fails the next morning patrol, while a backup from
02:20 still passes a same-day check.

```bash
ssh deploy@<host> /opt/cardhub/production/deploy/check-backup-log.sh /opt/cardhub/backups/backup.log cardhub-staging 26
ssh deploy@<host> /opt/cardhub/production/deploy/check-backup-log.sh /opt/cardhub/backups/backup.log cardhub-prod 26
```

The checker exits non-zero, with a reason, when the log is missing or
unreadable, the project has no `BACKUP_RESULT` line, `ts` cannot be parsed,
the latest line is `fail`, that `ok` is older than the max age, `ts` is
more than five minutes in the future, or a line for that project is malformed
(unanchored, an unknown status, or a duplicate `BACKUP_RESULT=`, `project=`,
or `ts=` token).

A malformed-line failure is handled by the ops on-call (守夜人). Patrol
alerts, then inspect `backup.log` and run a fresh backup so a new anchored
ok is written. Never hand-edit or delete log lines to clear it. A later
anchored `BACKUP_RESULT=ok` for that project is what clears the alert.

The backup script can ping `BACKUP_PING_URL` on success and `<url>/fail` on
failure if that variable is set. This host does not set it. Do not treat a
missing ping as a healthy backup. A missing or unreadable off-site env, or a
missing OSS key, must not send the success ping. The ping is HTTP only.
Nothing else in this repo opens a monitoring session to Postgres. The
container healthcheck is `pg_isready` as `POSTGRES_USER` and does not
authenticate.

`backup.sh` dumps as `PGDUMP_USER` / `PGDUMP_PASSWORD` from the env file when
both are set (the read-only `cardhub_backup` role after the split). When both
are empty it uses `POSTGRES_USER` / `POSTGRES_PASSWORD`, which is the historical
superuser path. It does not print either password. `pg_dump` runs in a separate
container and connects to the compose service host `postgres`, so the password
is checked. A dump exec'd inside the postgres container would use the local
socket, which this image trusts, and a wrong password would still succeed. A
failed password check exits before the backup file is kept and before any OSS
upload. A dump taken as `cardhub_backup` includes table data, sequences,
`pg_trgm`, and `_prisma_migrations`. Restore still runs as the admin superuser,
because the backup role cannot replay DDL.

On a fresh cluster the migrator, runtime, and backup roles do not exist. A
dump taken after the split contains `OWNER TO` and `GRANT` for those roles.
Run `db/split-roles.sh` first so those statements succeed, then restore with
`ON_ERROR_STOP`, then run `db/split-roles.sh` again so grants match the
restored objects. The full order is in [db/README.md](db/README.md#backups-and-monitoring).

Restore example (admin superuser inside the postgres container, after the
roles exist):

```bash
gzip -dc /opt/cardhub/backups/cardhub-prod/cardhub-prod-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env -f /opt/cardhub/production/deploy/docker-compose.yml exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -w -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### Off-site OSS copy (required)

After a local dump is finalized and before local retention pruning, the backup
script uploads that single `.sql.gz` file to Alibaba Cloud OSS using the
official `rclone/rclone:1.75.2` Docker image pinned by digest in the script.
The upload is mandatory. There is no switch to skip it. If `OFFSITE_ENV_FILE`
is missing or unreadable, or if any of `OSS_ACCESS_KEY_ID`,
`OSS_ACCESS_KEY_SECRET`, `OSS_BUCKET`, or `OSS_ENDPOINT` is empty, the script
exits non-zero, writes `BACKUP_RESULT=fail`, and does not send a success ping.
The local dump stays. Upload and `rclone check` failures fail the same way.
The script never deletes or syncs remote objects; remote retention must be
handled by an OSS lifecycle rule.

The default path is `/opt/cardhub/backups/offsite.env`. Override
`OFFSITE_ENV_FILE` only when that file lives somewhere else. Both cron jobs
use this one file.

Create the off-site env file with placeholders replaced by real OSS values:

```bash
cat > /opt/cardhub/backups/offsite.env <<'EOF'
OSS_ACCESS_KEY_ID=replace-with-access-key-id
OSS_ACCESS_KEY_SECRET=replace-with-access-key-secret
OSS_BUCKET=replace-with-bucket-name
OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com
EOF
chown deploy:deploy /opt/cardhub/backups/offsite.env
chmod 600 /opt/cardhub/backups/offsite.env
```

Keep this file limited to the four `OSS_*` keys above. The backup script reads
only those values for the rclone env-file.

The OSS key needs object upload/read permissions for the backup prefix, plus
bucket-level `oss:ListObjects` restricted to that prefix because `rclone check`
lists the remote project directory before applying the single-file include. It
does not need `oss:DeleteObject` by design. It also does not need ListBuckets or
CreateBucket permissions; the script passes `--s3-no-check-bucket` because
ListBuckets is not granted. `oss:GetBucketInfo` is optional if an operator's
tooling needs bucket metadata outside this backup script.

Minimal RAM policy template, with placeholders only:

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:PutObject", "oss:GetObject"],
      "Resource": ["acs:oss:*:*:<bucket>/<project>/*"]
    },
    {
      "Effect": "Allow",
      "Action": ["oss:ListObjects"],
      "Resource": ["acs:oss:*:*:<bucket>"],
      "Condition": {
        "StringLike": {
          "oss:Prefix": ["<project>/*"]
        }
      }
    }
  ]
}
```

Use `acs:oss:*:*:<bucket>/*` for the object resource only if the same key must
write/read multiple project prefixes in that bucket. Do not grant
`oss:DeleteObject`; remote cleanup is intentionally handled by OSS lifecycle
rules.

TODO(owner): configure an OSS lifecycle rule for remote backup retention, and
remove any temporary `_probe/` objects created while validating the bucket.

Restore from OSS by copying one object back to the VPS, then using the normal
local restore command:

```bash
HISTCONTROL=ignorespace
 cat > /tmp/cardhub-oss-rclone.env <<'EOF'
RCLONE_CONFIG_OSS_TYPE=s3
RCLONE_CONFIG_OSS_PROVIDER=Alibaba
RCLONE_CONFIG_OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com
RCLONE_CONFIG_OSS_ACCESS_KEY_ID=replace-with-access-key-id
RCLONE_CONFIG_OSS_SECRET_ACCESS_KEY=replace-with-access-key-secret
RCLONE_CONFIG_OSS_ACL=private
EOF
chmod 600 /tmp/cardhub-oss-rclone.env
docker run --rm --env-file /tmp/cardhub-oss-rclone.env \
  -v /opt/cardhub/backups/cardhub-prod:/restore \
  rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5 \
  copyto oss:replace-with-bucket-name/cardhub-prod/cardhub-prod-YYYYMMDDTHHMMSSZ.sql.gz \
  /restore/cardhub-prod-YYYYMMDDTHHMMSSZ.sql.gz --s3-no-check-bucket
rm -f /tmp/cardhub-oss-rclone.env
```

## Logs and health

```bash
docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env logs -f api
docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env ps
curl https://api.cardhub.example.com/health
```
