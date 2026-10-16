# Cardhub VPS deployment

This directory runs Cardhub on one Linux VPS with Docker Compose. Use the same
compose file for staging and production by changing the project name and env
file:

- production: `docker compose -p cardhub-production --env-file /opt/cardhub/production.env ...`
- staging: `docker compose -p cardhub-staging --env-file /opt/cardhub/staging.env ...`

Run one shared Caddy proxy with the `proxy` profile. App projects start only
API, web, Postgres, and Redis; only Caddy publishes host ports.

## One-time server bootstrap

1. Install Docker Engine and the Compose plugin on the VPS.
2. Create the deploy layout:
   ```bash
   sudo mkdir -p /opt/cardhub/deploy /opt/cardhub/backups
   sudo chown -R "$USER":"$USER" /opt/cardhub
   ```
3. Copy `deploy/docker-compose.yml`, `deploy/Caddyfile`, and `deploy/backup.sh`
   into `/opt/cardhub/deploy/`.
4. Create env files from `.env.example`:
   ```bash
   cp deploy/.env.example /opt/cardhub/production.env
   cp deploy/.env.example /opt/cardhub/staging.env
   cp deploy/.env.example /opt/cardhub/proxy.env
   chmod 600 /opt/cardhub/*.env
   ```
   Fill different domains, secrets, database names/passwords, and `IMAGE_TAG`
   values in each app env file. Set `DEPLOY_ENV=production` or
   `DEPLOY_ENV=staging` to match the compose project suffix. `TRPC_URL` should
   point at that environment's API `/trpc` endpoint. In `proxy.env`, set
   production `WEB_DOMAIN` / `API_DOMAIN` plus `STAGING_WEB_DOMAIN` /
   `STAGING_API_DOMAIN`, and keep `DEPLOY_ENV=production`.
5. Log in to GHCR with a read-only package token:
   ```bash
   echo "$GHCR_READ_TOKEN" | docker login ghcr.io -u <github-user> --password-stdin
   ```
6. Add DNS records:
   - `WEB_DOMAIN` A/AAAA -> VPS public IP
   - `API_DOMAIN` A/AAAA -> VPS public IP
   - staging web/API domains -> VPS public IP

Start the shared Caddy proxy once:

```bash
cd /opt/cardhub/deploy
docker compose -p cardhub-proxy --env-file /opt/cardhub/proxy.env --profile proxy up -d caddy
```

Caddy obtains and renews HTTPS certificates automatically.

## Deploy

```bash
cd /opt/cardhub/deploy
docker compose -p cardhub-production --env-file /opt/cardhub/production.env pull api web
docker compose -p cardhub-production --env-file /opt/cardhub/production.env up -d postgres redis api web
```

Use `cardhub-staging` with `/opt/cardhub/staging.env` for staging. If both run
on the same host, keep distinct `WEB_DOMAIN`, `API_DOMAIN`, Postgres DB names,
and passwords in each env file. Production deploys are manual; staging can be
redeployed automatically by GitHub Actions after a main-branch image build.

## Rollback

Set `IMAGE_TAG` to an older immutable `sha-<full-git-sha>` tag in the target
env file, then redeploy:

```bash
cd /opt/cardhub/deploy
docker compose -p cardhub-production --env-file /opt/cardhub/production.env pull api web
docker compose -p cardhub-production --env-file /opt/cardhub/production.env up -d postgres redis api web
```

Prisma migrations are not automatically rolled back. Handle schema reversions
manually if a rollback crosses a database migration.

## Backups

Run a daily compressed `pg_dump` and keep the last 7 backups:

```cron
15 2 * * * PROJECT=cardhub-production ENV_FILE=/opt/cardhub/production.env /opt/cardhub/deploy/backup.sh >> /opt/cardhub/backups/backup.log 2>&1
```

Restore example:

```bash
gzip -dc /opt/cardhub/backups/cardhub-production/cardhub-production-YYYYMMDDTHHMMSSZ.sql.gz \
  | docker compose -p cardhub-production --env-file /opt/cardhub/production.env -f /opt/cardhub/deploy/docker-compose.yml exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Logs and health

```bash
docker compose -p cardhub-production --env-file /opt/cardhub/production.env logs -f api
docker compose -p cardhub-production --env-file /opt/cardhub/production.env ps
curl https://api.cardhub.example.com/health
```
