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

1. Install Docker Engine and the Compose plugin on the VPS.
2. Create the deploy layout:
   ```bash
   sudo mkdir -p /opt/cardhub/production/deploy /opt/cardhub/staging/deploy /opt/cardhub/edge/deploy /opt/cardhub/backups
   sudo chown -R "$USER":"$USER" /opt/cardhub
   ```
3. Copy `deploy/docker-compose.yml`, `deploy/remote-deploy.sh`,
   and `deploy/backup.sh` into each app env's `deploy/` directory. Copy
   `deploy/edge/` into `/opt/cardhub/edge/deploy/edge/`.
4. Create env files from `.env.example`:
   ```bash
   cp deploy/.env.example /opt/cardhub/production/production.env
   cp deploy/.env.example /opt/cardhub/staging/staging.env
   cp deploy/.env.example /opt/cardhub/edge/edge.env
   chown "$USER":"$USER" /opt/cardhub/production/production.env /opt/cardhub/staging/staging.env /opt/cardhub/edge/edge.env
   chmod 600 /opt/cardhub/production/*.env /opt/cardhub/staging/*.env /opt/cardhub/edge/*.env
   ```
   Fill different domains, secrets, database names/passwords, and `IMAGE_TAG`
   values in each app env file. Set `ENV_NAME=prod` in `production.env` and
   `ENV_NAME=staging` in `staging.env`. `TRPC_URL` should point at that
   environment's API `/trpc` endpoint. In `edge.env`, set production
   `WEB_DOMAIN` / `API_DOMAIN` plus `STAGING_WEB_DOMAIN` /
   `STAGING_API_DOMAIN`, and keep `ENV_NAME=prod`.
5. Log in to GHCR with a read-only package token:
   ```bash
   echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
   ```
6. Add DNS records:
   - `WEB_DOMAIN` A/AAAA -> VPS public IP
   - `API_DOMAIN` A/AAAA -> VPS public IP
   - staging web/API domains -> VPS public IP

Create the shared proxy network idempotently and start Caddy once:

```bash
docker network inspect edge >/dev/null 2>&1 || docker network create edge
cd /opt/cardhub/edge/deploy/edge
docker compose -p cardhub-edge --env-file /opt/cardhub/edge/edge.env up -d
```

Caddy obtains and renews HTTPS certificates automatically.

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

## Deploy

```bash
cd /opt/cardhub/production/deploy
IMAGE_TAG=sha-<full-git-sha> ENV_NAME=prod docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env pull api web
IMAGE_TAG=sha-<full-git-sha> ENV_NAME=prod docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env up -d postgres redis api web
```

Use `cardhub-staging` with `/opt/cardhub/staging/staging.env` for staging. If both run
on the same host, keep distinct `WEB_DOMAIN`, `API_DOMAIN`, Postgres DB names,
and passwords in each env file. Production deploys are manual; staging can be
redeployed automatically by GitHub Actions after CI and image builds succeed on
main. Production deploys require an explicit immutable `sha-<full-git-sha>` tag.

The deploy workflow syncs `deploy/` files for the deployed SHA to the VPS before
running `/opt/cardhub/<environment>/deploy/remote-deploy.sh`. The script polls
`https://<API_DOMAIN>/health` until `gitSha` equals the deployed SHA and fails on
missing or mismatched SHA. If verification fails after switching containers, the
script attempts to roll back to the previously running immutable `sha-` tag and
still fails the job.

After the API is healthy, `remote-deploy.sh` runs `CATALOG_SEED_CMD` from the env
file when it is set. This is intended for the production first deploy's
catalog-only seed after the app team's seed PR lands. Leave it empty for
staging, which uses its separate demo seed flow. Seed failure triggers the same
rollback path and exits non-zero.

The web container receives runtime `TRPC_URL`, but consuming it depends on the
companion app PR. The app PR also changes `/health` to include `gitSha` and to
return 503 when dependencies are unhealthy; this infra PR expects to merge with
that app PR. Merge order should be app PR #38 first, then this infra PR; when
resolving any Dockerfile/nginx conflicts, keep #38's nginx entrypoint that writes
an uncached `/config.js` from runtime `TRPC_URL`.

## Rollback

Set `IMAGE_TAG` to an older immutable `sha-<full-git-sha>` tag in the target
env file, then redeploy:

```bash
cd /opt/cardhub/production/deploy
IMAGE_TAG=sha-<older-full-git-sha> ENV_NAME=prod docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env pull api web
IMAGE_TAG=sha-<older-full-git-sha> ENV_NAME=prod docker compose -p cardhub-prod --env-file /opt/cardhub/production/production.env up -d postgres redis api web
```

Prisma migrations are not automatically rolled back. Handle schema reversions
manually if a rollback crosses a database migration.

## Backups

Run a daily compressed `pg_dump`. The script writes to temporary files, verifies
the dump and gzip, then atomically renames the backup on success. It keeps the
latest 7 daily backups plus 4 weekly backups and never deletes the newest
successful backup.

```cron
15 2 * * * PROJECT=cardhub-prod ENV_FILE=/opt/cardhub/production/production.env COMPOSE_FILE=/opt/cardhub/production/deploy/docker-compose.yml BACKUP_PING_URL=https://hc-ping.com/<uuid> /opt/cardhub/production/deploy/backup.sh >> /opt/cardhub/backups/backup.log 2>&1
```

Off-site backup copy is a required follow-up; this script only creates local VPS
backups. `BACKUP_PING_URL` is optional; when set, success pings the URL and
failure pings `<url>/fail` for healthchecks.io-style alerting.

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
