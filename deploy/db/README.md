# Cardhub database roles

The API container must not run as a Postgres superuser. One database per
environment (`cardhub_staging`, `cardhub_prod`) keeps four LOGIN roles:

| Role               | Attribute                                                             | Used by                                                                                                                             |
| ------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `cardhub`          | superuser, the historical `POSTGRES_USER`                             | Admin only: volume init, restore, emergency `psql`                                                                                  |
| `cardhub_migrator` | `NOSUPERUSER NOCREATEDB NOCREATEROLE`, owns the database and `public` | `prisma migrate deploy` via `MIGRATE_DATABASE_URL`                                                                                  |
| `cardhub_runtime`  | `NOSUPERUSER NOCREATEDB NOCREATEROLE`                                 | The API process via `DATABASE_URL`. `SELECT` / `INSERT` / `UPDATE` / `DELETE` on tables, `USAGE` / `SELECT` / `UPDATE` on sequences |
| `cardhub_backup`   | `NOSUPERUSER NOCREATEDB NOCREATEROLE`                                 | `deploy/backup.sh` via `PGDUMP_USER` / `PGDUMP_PASSWORD`. `SELECT` on tables and sequences                                          |

`pg_trgm` is a trusted extension on PostgreSQL 13 and newer (this fleet is
Postgres 16). The database owner can `CREATE EXTENSION pg_trgm` without being
a superuser. `split-roles.sql` makes `cardhub_migrator` the database owner so
migrations can keep creating it. Confirm on the server with the query in
[Verification](#verification).

An extension that was created before the split stays owned by `cardhub`.
PostgreSQL 16 has no `ALTER EXTENSION ... OWNER TO`. A later
`ALTER EXTENSION pg_trgm UPDATE` on that extension has to run as the admin
superuser. When the migrator creates the extension itself (fresh database, or
`CREATE EXTENSION` after it owns the database), the migrator owns it and can
update it.

Passwords never go in the repo, in GitHub Environments, or on a command line.
Generate each one with `openssl rand -hex 32`. The bootstrap script accepts
only that lowercase hex. Store them only in the mode-0600 env file on the VPS.

No new GitHub Actions secrets. The `staging` and `production` environments
keep only `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and
`DEPLOY_KNOWN_HOSTS`. Database URLs stay in:

- `/opt/cardhub/staging/staging.env`
- `/opt/cardhub/production/production.env`

## What the bootstrap does

`split-roles.sql` is idempotent and does **not** change the `cardhub` login or
password. Each run:

1. Creates `cardhub_migrator`, `cardhub_runtime`, and `cardhub_backup`, or
   realigns them to `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
NOBYPASSRLS`.
2. Sets those three passwords from the environment. Re-running with different
   passwords rotates them. Re-running to refresh grants must reuse the current
   passwords.
3. `ALTER DATABASE ... OWNER TO` the migrator and `ALTER SCHEMA public OWNER TO`
   the migrator. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.
4. In one transaction, transfers ownership of existing tables (including
   `_prisma_migrations`), views, standalone sequences, enums, and domains in
   `public` to the migrator, then applies the grants below. Sequences owned
   by a table column (`SERIAL`, `deptype 'a'`, and identity, `deptype 'i'`)
   are skipped: `ALTER SEQUENCE ... OWNER TO` fails with `cannot change owner
of sequence ... linked to table column`, and `ALTER TABLE` moves them.
   If anything in the transaction fails, PostgreSQL rolls the ownership and
   grants back. The three roles themselves stay, because `CREATE ROLE` cannot
   run inside a transaction; the next run realigns them and retries the
   transfer.
   PostgreSQL 16 cannot `ALTER EXTENSION ... OWNER TO`, so an already
   installed `pg_trgm` stays owned by the admin superuser. `CREATE EXTENSION
IF NOT EXISTS pg_trgm` still succeeds for the migrator. On a database
   where `pg_trgm` is not installed yet, the migrator creates it, because the
   extension is trusted and the migrator owns the database.
   `ALTER EXTENSION pg_trgm UPDATE` on a superuser-owned extension still
   needs the admin account.
5. Grants the runtime role DML on every current table and `USAGE` / `SELECT` /
   `UPDATE` on every current sequence. Grants the backup role `SELECT`.
6. On `_prisma_migrations`, revokes `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE`
   from the runtime role and leaves `SELECT`. The migrator owns the table, so
   `prisma migrate deploy` can still write it. The backup role keeps `SELECT`,
   so `pg_dump` includes migration history.
7. Sets `ALTER DEFAULT PRIVILEGES FOR ROLE cardhub_migrator IN SCHEMA public`
   so tables and sequences created later by the migrator get the same grants.
   The same default privileges are set for the admin role, so a migration that
   still runs as `cardhub` during the cutover window does not strand the
   runtime role.

Apply it with `split-roles.sh`. The script reads passwords from the
environment and forwards them with `docker compose exec -e` (not argv). It
masks connection strings and `PASSWORD '...'` fragments in the output.

```bash
cd /opt/cardhub/staging/deploy
umask 077
export MIGRATE_PASSWORD="$(openssl rand -hex 32)"
export RUNTIME_PASSWORD="$(openssl rand -hex 32)"
export BACKUP_PASSWORD="$(openssl rand -hex 32)"
# Write the three values into the password manager and the env file.
# Do not echo them and do not commit them.

PROJECT=cardhub-staging \
ENV_FILE=/opt/cardhub/staging/staging.env \
COMPOSE_FILE=/opt/cardhub/staging/deploy/docker-compose.yml \
  ./db/split-roles.sh
```

`POSTGRES_USER` inside the postgres container must still be the superuser.
`split-roles.sh` refuses to run as anyone else.

## Cutover order

Do staging first. Do not start production until staging has passed every check
in [Verification](#verification).

Running containers keep working through steps 1 and 2 because the `cardhub`
login is unchanged and `DATABASE_URL` is still that superuser. The one-shot
migrate container uses `MIGRATE_DATABASE_URL` only when it is non-empty, and
otherwise migrates with `DATABASE_URL`. The long-running API container never
receives `MIGRATE_DATABASE_URL`.

Images built before this change run `prisma migrate deploy` with `DATABASE_URL`
inside the API process. After `DATABASE_URL` is the runtime role, do not start
one of those older images until you have switched `DATABASE_URL` back. See
[Rollback past this change](#rollback-past-this-change). `remote-deploy.sh`
refuses the deploy when `MIGRATE_DATABASE_URL` is non-empty and the target
image has no `/usr/local/bin/api-entrypoint.sh`, and it does that before it
arms rollback, so the container that is serving stays up.

### 1. Ship this image while the superuser URL is still in place

1. Merge the change and let the staging deploy finish, **or** deploy the
   immutable `sha-<40 hex>` tag by hand.
2. Leave `DATABASE_URL` on `cardhub` and leave `MIGRATE_DATABASE_URL` empty or
   unset. `POSTGRES_PASSWORD` stays the current superuser password. The
   migrate container then falls back to `DATABASE_URL`.
3. Confirm `https://<STAGING_API_DOMAIN>/health` returns the new `gitSha`.

An automatic rollback at this step still uses the superuser URL, so an older
image can boot.

### 2. Create the roles while `cardhub` still logs in

Run `split-roles.sh` against `cardhub_staging` as in the block above. The API
container that is already running keeps its existing environment and keeps
connecting as `cardhub`. Do not recreate it in this step.

Expect `pg_stat_activity` to still show `cardhub` sessions from that container.
That is the safe state.

### 3. Point the new image at the split URLs

Confirm the **running** api image has both entrypoints executable
(`docker run --rm --entrypoint sh <image> -c 'api=/usr/local/bin/api-entrypoint.sh; mig=/usr/local/bin/migrate-entrypoint.sh; if [ ! -e "$api" ] && [ ! -L "$api" ] && [ ! -e "$mig" ] && [ ! -L "$mig" ]; then echo old; exit 10; fi; test -x "$api" && test -x "$mig" && echo split || { echo incomplete; exit 3; }'`).
Exit 0 and `split` is the image this step wants. Exit 10 and `old` is from
before the split. `incomplete` is a broken image; do not switch the URLs.
Any other exit code, including 1, is a docker failure.
Then edit `/opt/cardhub/staging/staging.env` in place (mode stays `0600`):

```dotenv
DATABASE_URL=postgresql://cardhub_runtime:<RUNTIME_PASSWORD>@postgres:5432/cardhub_staging?schema=public
MIGRATE_DATABASE_URL=postgresql://cardhub_migrator:<MIGRATE_PASSWORD>@postgres:5432/cardhub_staging?schema=public
PGDUMP_USER=cardhub_backup
PGDUMP_PASSWORD=<BACKUP_PASSWORD>
```

Do not change `POSTGRES_USER` or `POSTGRES_PASSWORD` yet. Hex passwords need no
URL encoding.

#### FREEZE

Record this before the redeploy, and do not start another deploy until it
exits:

- Pause other Cardhub deploys. Do not push a staging deploy and do not start
  a second Cardhub Deploy workflow.
- One operator. `remote-deploy.sh` holds `/opt/cardhub/.rollout.lock` for the
  whole rollout.
- The old API container keeps serving if the migrator URL fails or the new
  API container fails its health check. Say that ahead of time.

Do **not** `docker compose up -d --force-recreate api`. That stops the old
container first. A bad password then leaves the API down, and the gap is a
502 while the new process starts.

Redeploy the **same** immutable tag through the rolling path. Migrations run
in the one-shot `migrate` container before the API swap. That container is
the only one with `MIGRATE_DATABASE_URL`. The new API container receives
`DATABASE_URL` only. If migrate fails, the script exits and the old container
keeps serving. If the new API fails its health check, `rollout_service`
deletes it and leaves the old one.

```bash
# sha and the 40-hex git SHA are the image that is already running.
/opt/cardhub/staging/deploy/remote-deploy.sh staging sha-<40hex> <40hex>
```

The same rollout from GitHub: Actions → Cardhub Deploy → Run workflow →
environment `staging`, image tag `sha-<40hex>` (that same tag).

`prisma migrate deploy` runs as `cardhub_migrator` (advisory lock included)
and the container exits. The API process is `exec node` under tini
(`init: true`) with the runtime URL.

Wait until the new container is healthy and the public `/health` body reports
`"services":{"db":true,...}`.

### 4. Verify, including that `cardhub` is idle

Run every query in [Verification](#verification). Among client backends,
`pg_stat_activity` must show no `cardhub` session except the admin `psql` you
are using. Ignore internal backends such as the logical replication launcher;
they are not application connections. Application sessions must be
`cardhub_runtime`. If any api or one-off job is still on `cardhub`, stop here
and fix that client. Do not rotate the superuser password.

### 5. Rotate the superuser password

Only after step 4. This disables the old superuser password. The role stays a
superuser so an operator can still administer the database.

```bash
export NEW_ADMIN_PASSWORD="$(openssl rand -hex 32)"
# Store it. Do not echo it.
docker compose -p cardhub-staging \
  --env-file /opt/cardhub/staging/staging.env \
  -f /opt/cardhub/staging/deploy/docker-compose.yml \
  exec -T -e NEW_ADMIN_PASSWORD postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -w -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -' <<'SQL'
\getenv new_password NEW_ADMIN_PASSWORD
SELECT length(:'new_password') > 0
  AND position('$' in :'new_password') = 0
  AS ok \gset
\if :ok
\else
\echo 'NEW_ADMIN_PASSWORD is empty or unsafe'
\quit 1
\endif
SELECT format('ALTER ROLE %I PASSWORD %L', current_user, :'new_password') \gexec
SQL
```

Write the same value into `POSTGRES_PASSWORD` in `staging.env` without printing
it. The official Postgres image applies `POSTGRES_PASSWORD` only when the data
directory is first created, so changing the env file does not change the role
by itself. `ALTER ROLE` above is what rotates it.

#### FREEZE — postgres recreate

The next `remote-deploy.sh` runs `docker compose up -d postgres redis`. If
`POSTGRES_PASSWORD` in the env file changed, that command recreates the
postgres container even when the image tag did not. Do the recreate here, in
this freeze, after telling people it will drop connections for a few seconds.
Do not leave it for the next routine deploy.

The official Postgres image applies `POSTGRES_PASSWORD` only when the data
directory is first created. `ALTER ROLE` above is the rotation. Recreating
the container only reloads its environment. The API reconnects as
`cardhub_runtime` and does not need the superuser password.

```bash
cd /opt/cardhub/staging/deploy
IMAGE_TAG=sha-<40hex> ENV_NAME=staging \
  docker compose -p cardhub-staging \
  --env-file /opt/cardhub/staging/staging.env \
  up -d postgres
```

### 6. Repeat on production

Repeat steps 1–5 for `/opt/cardhub/production/production.env`, project
`cardhub-prod`, database `cardhub_prod`, and `ENV_NAME=prod`. Production
deploys are the manual `workflow_dispatch` on `main`. Use a new set of
passwords. Do not reuse the staging passwords.

Generate the three least-privilege passwords and run `split-roles.sh` before
changing production URLs. Deploy this image once with the existing superuser
`DATABASE_URL` if production is not already on it, confirm `/health`, then
switch the URLs.

## Verification

Run these from the VPS. They print role names and booleans, not passwords.

Runtime session, from inside the api container (this is the app's
`DATABASE_URL`):

```bash
docker compose -p cardhub-staging \
  --env-file /opt/cardhub/staging/staging.env \
  -f /opt/cardhub/staging/deploy/docker-compose.yml \
  exec -T api \
  node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
function redact(value) {
  return String(value).replace(/:\/\/[^/\s]+@/g, '://[REDACTED]@');
}
prisma
  .$queryRawUnsafe(
    'select current_user as rolname, rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname = current_user',
  )
  .then((rows) => {
    console.log(JSON.stringify(rows));
    return prisma.$disconnect();
  })
  .catch((error) => {
    console.error(redact(error && error.message ? error.message : error));
    process.exit(1);
  });
NODE
```

Expect `rolsuper`, `rolcreatedb`, and `rolcreaterole` to be `false`, and
`rolname` to be `cardhub_runtime`.

DDL must fail as that same session:

```bash
docker compose -p cardhub-staging \
  --env-file /opt/cardhub/staging/staging.env \
  -f /opt/cardhub/staging/deploy/docker-compose.yml \
  exec -T api \
  node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
function redact(value) {
  return String(value).replace(/:\/\/[^/\s]+@/g, '://[REDACTED]@');
}
prisma
  .$executeRawUnsafe('create table runtime_ddl_denied (id integer)')
  .then(() => {
    console.error('UNEXPECTED: runtime created a table');
    process.exit(1);
  })
  .catch((error) => {
    const meta = error && error.meta ? error.meta : {};
    console.log(JSON.stringify({ rejected: true, code: error.code || null, sqlstate: meta.code || null }));
    return prisma.$disconnect();
  });
NODE
```

Expect `{"rejected":true,"code":"P2010","sqlstate":"42501"}` (insufficient
privilege). If this command unexpectedly succeeds, `DROP TABLE
runtime_ddl_denied` as the migrator and stop the cutover.

Admin checks, as the superuser inside postgres. `pg_trgm.trusted` must be `t`.
The `superuser` column on that view can also be `t`; `trusted` is what lets
the database owner install the extension. The database owner must be
`cardhub_migrator`.

```bash
docker compose -p cardhub-staging \
  --env-file /opt/cardhub/staging/staging.env \
  -f /opt/cardhub/staging/deploy/docker-compose.yml \
  exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -w -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' <<'SQL'
SELECT usename, application_name, state, count(*)
FROM pg_stat_activity
WHERE usename IS NOT NULL
  AND backend_type = 'client backend'
GROUP BY usename, application_name, state
ORDER BY usename, application_name;

SELECT name, version, trusted
FROM pg_available_extension_versions
WHERE name = 'pg_trgm';

SELECT d.datname, pg_get_userbyid(d.datdba) AS owner
FROM pg_database d
WHERE d.datname = current_database();
SQL
```

Migrator can still install the trusted extension (no-op when it already exists).
Export `MIGRATE_PASSWORD` in the shell first; do not inline it. The postgres
container already has `POSTGRES_DB`.

```bash
docker compose -p cardhub-staging \
  --env-file /opt/cardhub/staging/staging.env \
  -f /opt/cardhub/staging/deploy/docker-compose.yml \
  exec -T -e MIGRATE_PASSWORD postgres \
  sh -c 'PGPASSWORD="$MIGRATE_PASSWORD" psql -w -U cardhub_migrator -d "$POSTGRES_DB" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"'
```

Public health:

```bash
curl -fsS https://api-staging.card-hub.app/health
```

`"services.db"` must be `true`. A 503 here means the runtime role cannot
`SELECT 1`.

## Backups and monitoring

`deploy/backup.sh` is the only repo script that connects to Postgres besides
the API. After step 3 it uses `cardhub_backup`. `SELECT` on every table,
including `_prisma_migrations`, plus default privileges for tables the
migrator creates later, is enough for `pg_dump` to capture schema and data.
The script logs the role name and not the password.

The postgres healthcheck (`pg_isready -U "$POSTGRES_USER"`) does not
authenticate. Sentry and the optional healthchecks.io backup ping do not open
a database connection. There is no separate SQL exporter in this repo.

On a fresh cluster the three roles do not exist yet. A dump taken after the
split contains `OWNER TO cardhub_migrator` and `GRANT`s to the runtime and
backup roles. Those statements fail until the roles exist, and a restore
without `ON_ERROR_STOP` keeps going after that failure.

1. Start Postgres with the admin superuser (`POSTGRES_USER` /
   `POSTGRES_PASSWORD`).
2. Run `split-roles.sh` so the three roles exist.
3. Restore as that superuser with `ON_ERROR_STOP` (the command is in
   [deploy/README.md](../README.md#backups)). Do not restore as
   `cardhub_backup`; that role cannot replay DDL.
4. Run `split-roles.sh` again so ownership, grants, and default privileges
   match the restored objects.

## Rollback past this change

Once `DATABASE_URL` is `cardhub_runtime`, an image built before this change
runs `prisma migrate deploy` as `DATABASE_URL`. With no migration pending,
that command only reads `_prisma_migrations` and the old image can boot.
With a migration pending, the runtime role cannot apply it and the container
fails. Switch the server env back and redeploy the **same** SHA first. Only
then roll back to an older image.

Do not rotate the superuser password until a rollback past this change is no
longer needed. If you already rotated it, the superuser URL below uses the
**new** password. The pre-rotation password will not boot anything.

### 1. Write the superuser URL back into the server env

Edit `/opt/cardhub/staging/staging.env` (mode stays `0600`). Clear the
migrator URL so an older image is not refused and so the API process is not
handed owner credentials:

```dotenv
DATABASE_URL=postgresql://cardhub:<current-POSTGRES_PASSWORD>@postgres:5432/cardhub_staging?schema=public
MIGRATE_DATABASE_URL=
```

Remove `PGDUMP_USER` and `PGDUMP_PASSWORD`, or leave them. Dumps may use the
backup role while the API is back on the superuser. Ownership can stay with
`cardhub_migrator`. A superuser does not need to own the tables to serve
traffic or to migrate.

### 2. Redeploy the same SHA on the rolling path

Write the [FREEZE](#freeze) note. Then run the same command as step 3, with
the SHA that is running now (or dispatch Cardhub Deploy with that same
`sha-<40hex>` image tag):

```bash
/opt/cardhub/staging/deploy/remote-deploy.sh staging sha-<40hex> <40hex>
```

Do not `up -d --no-deps --force-recreate api`. A bad URL fails the migrate
container or the new API container's health check, and the old container
keeps serving.

Verify both of these before going on:

- `https://<STAGING_API_DOMAIN>/health` returns 200 and `"services":{"db":true,...}`.
- Client backends in `pg_stat_activity` (`backend_type = 'client backend'`)
  show `cardhub`, not `cardhub_runtime`. The logical replication launcher is
  not a client backend.

### 3. Only then deploy an image built before this change

`DATABASE_URL` is the superuser again and `MIGRATE_DATABASE_URL` is empty, so
`remote-deploy.sh` will not refuse the older image. That image migrates inside
its own process, as `cardhub`. Use the rolling command with the older tag.
Skipping step 2 and deploying the older image while `DATABASE_URL` is still
`cardhub_runtime` leaves the API unable to migrate.

**Before step 3 of the cutover (URLs not switched).** Nothing to undo for the
app. `cardhub` still works. To remove the new roles anyway, use the SQL at
the bottom of this section, then redeploy as usual.

**After step 5 (superuser password already rotated).** The old `cardhub`
password does not work. Use the new `POSTGRES_PASSWORD` in the URL in step 1
above. Do not look for the pre-rotation password. Re-run `split-roles.sh` if
grants need to be refreshed. The same order still applies: superuser URL
first, same-SHA rolling redeploy, verify `/health` and `pg_stat_activity`,
and only then an older image.

**Drop the new roles** only when no client still uses them (`pg_stat_activity`)
and `DATABASE_URL` is the superuser again. Run as `cardhub` against that
database. Replace the database name. This returns ownership to `cardhub` and
removes default privileges that would block `DROP ROLE`.

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub_migrator IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM cardhub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub_migrator IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM cardhub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub_migrator IN SCHEMA public
  REVOKE SELECT ON TABLES FROM cardhub_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub_migrator IN SCHEMA public
  REVOKE SELECT ON SEQUENCES FROM cardhub_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub IN SCHEMA public
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM cardhub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub IN SCHEMA public
  REVOKE USAGE, SELECT, UPDATE ON SEQUENCES FROM cardhub_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub IN SCHEMA public
  REVOKE SELECT ON TABLES FROM cardhub_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE cardhub IN SCHEMA public
  REVOKE SELECT ON SEQUENCES FROM cardhub_backup;

GRANT cardhub_migrator TO cardhub;
REASSIGN OWNED BY cardhub_migrator TO cardhub;
ALTER SCHEMA public OWNER TO cardhub;
ALTER DATABASE cardhub_staging OWNER TO cardhub;
REVOKE cardhub_migrator FROM cardhub;

DROP OWNED BY cardhub_runtime;
DROP OWNED BY cardhub_backup;
DROP OWNED BY cardhub_migrator;
DROP ROLE cardhub_runtime;
DROP ROLE cardhub_backup;
DROP ROLE cardhub_migrator;
```

On production the database name in `ALTER DATABASE` is `cardhub_prod`.

Image rollbacks do not undo migrations. Keep following the forward-only
migration rule in `deploy/README.md`.
