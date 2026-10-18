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
   and `deploy/backup.sh` into each app env's `deploy/` directory. Copy
   `deploy/edge/` into `/opt/cardhub/edge/deploy/edge/`.
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
   `POSTGRES_DB=cardhub_staging` for staging. `POSTGRES_PASSWORD` must match
   the password embedded in `DATABASE_URL` and be URL-safe; hex from
   `openssl rand -hex 32` is recommended.
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

After changing any edge env vars manually, recreate the Caddy container so
Compose injects the new environment; `caddy reload` does not pick up env-file
changes:

```bash
cd /opt/cardhub/edge/deploy/edge
docker compose -p cardhub-edge --env-file /opt/cardhub/edge/edge.env up -d caddy
```

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

### Zero-downtime rollout

`remote-deploy.sh` pulls the new API and web images, starts Postgres and Redis
if needed, and waits until those two are healthy. It then rolls API and web
one service at a time:

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
API and web on the previous tag. `previous-images.env` is still written
before the switch and still records the tags that were running.

### Schema compatibility

The new API container runs `prisma migrate deploy` before it becomes healthy,
while the previous API process is still serving. Migrations have to be
additive. The old release reads and writes the database after the new
migration has committed, for the whole overlap. Do not rename, retype, or drop
columns, tables, or constraints that the running version uses. Ship that kind
of change in a later release, after no running code depends on the old shape.
Prisma does not roll a migration back automatically; a failed deploy that
rolls the containers back does not undo the schema.

### Stopping the old API container

The API image runs `prisma migrate deploy` and then `exec node`, so the server
is not left under a shell. That is not enough on its own: Node has no SIGTERM
listener unless the app installs one (`enableShutdownHooks` is intentionally
unchanged here), and PID 1 ignores a signal it does not handle. `docker stop`
then waits out the grace period and sends SIGKILL. Compose sets `init: true`
on `api` so tini is PID 1 and forwards SIGTERM to node, which is not PID 1 and
therefore exits. `stop_grace_period` and the script's `docker stop -t` are
30 seconds. That is the ceiling for in-flight requests once shutdown hooks
drain them. Today the process exits as soon as SIGTERM arrives, so the 30
seconds are not spent sleeping, and in-flight requests on that container are
not drained.

Containers that were started before `init: true` still have node as PID 1.
The first stop of those containers still ends in SIGKILL after the grace
period. Later deploys stop a container that was created with tini.

### Edge retries

The shared Caddy retries only GET and HEAD, for up to 5 seconds
(`lb_try_duration 5s`, `lb_try_interval 250ms`, `lb_retry_match` limited to
those methods). Dial failures are retried for every method when
`lb_try_duration` is non-zero, and `lb_retry_match` does not apply to them, so
every other method uses a second `reverse_proxy` with `lb_try_duration 0s`.
tRPC mutations are POST and are not retried. Hostnames and redirects are
unchanged.

The deploy workflow syncs `deploy/` files for the deployed SHA to the VPS before
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

Before switching images, `remote-deploy.sh` records the environment's previous
API and web `sha-` tags in `/opt/cardhub/<environment>/.deploy-state/`.
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
manually if a rollback crosses a database migration. During a normal rollout
the previous API keeps serving after `prisma migrate deploy` has committed, so
the migration itself has to stay compatible with that previous release. See
"Schema compatibility" above.

## Backups

Run a daily compressed `pg_dump`. The script writes to temporary files, verifies
the dump and gzip, then atomically renames the backup on success. It keeps the
latest 7 daily backups plus 4 weekly backups and never deletes the newest
successful backup.

```cron
15 2 * * * PROJECT=cardhub-prod ENV_FILE=/opt/cardhub/production/production.env COMPOSE_FILE=/opt/cardhub/production/deploy/docker-compose.yml BACKUP_PING_URL=https://hc-ping.com/<uuid> /opt/cardhub/production/deploy/backup.sh >> /opt/cardhub/backups/backup.log 2>&1
```

`BACKUP_PING_URL` is optional; when set, success pings the URL and failure pings
`<url>/fail` for healthchecks.io-style alerting.

### Optional off-site OSS copy

After a local dump is finalized and before local retention pruning, the backup
script optionally uploads that single `.sql.gz` file to Alibaba Cloud OSS using
the official `rclone/rclone:1.75.2` Docker image pinned by digest in the script.
It never deletes or syncs remote objects; remote retention must be handled by an
OSS lifecycle rule.

The off-site copy is disabled unless `OFFSITE_ENV_FILE` exists. The default path
is `/opt/cardhub/backups/offsite.env`; override it in the cron environment only
if the file lives elsewhere.

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

Restore example:

```bash
gzip -dc /opt/cardhub/backups/cardhub-prod/cardhub-prod-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env -f /opt/cardhub/production/deploy/docker-compose.yml exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Logs and health

```bash
docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env logs -f api
docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env ps
curl https://api.cardhub.example.com/health
```
