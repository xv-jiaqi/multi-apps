-- Split the Cardhub database superuser into three LOGIN roles.
--
--   migrator  owns the database and schema, runs `prisma migrate deploy`
--   runtime   DML only (the API process)
--   backup    SELECT only (pg_dump)
--
-- The current superuser (POSTGRES_USER, typically `cardhub`) is not altered.
-- Rotate that password only after the checks in deploy/db/README.md.
--
-- Run as that superuser, with PostgreSQL 15+ psql (for \getenv). Passwords
-- come from the psql process environment, never from argv or this file:
--
--   MIGRATE_PASSWORD  RUNTIME_PASSWORD  BACKUP_PASSWORD
--
-- Role names are non-secret psql variables:
--
--   psql -v migrator_role=cardhub_migrator \
--        -v runtime_role=cardhub_runtime \
--        -v backup_role=cardhub_backup \
--        -f deploy/db/split-roles.sql
--
-- Re-running is safe. Each run sets the three role passwords from the
-- environment, then re-applies ownership, grants, and default privileges.
-- Pass the current passwords when you only want to refresh grants.
--
-- pg_trgm is a trusted extension on PostgreSQL 13+, so the database owner
-- can CREATE EXTENSION without being a superuser. The migrator becomes the
-- database owner for that reason.

\set ON_ERROR_STOP on
\pset pager off

-- Do this before any statement that interpolates a password. A failed
-- CREATE/ALTER ROLE is an ERROR, and the default log_min_error_statement
-- (error) writes that statement, password included, to the server log.
-- panic logs the statement only for a panic. log_statement none skips the
-- statement log. log_min_duration_statement -1 skips the duration log.
-- All three are superuser settings; the script refuses anyone else below.
SET log_min_error_statement = panic;
SET log_statement = 'none';
SET log_min_duration_statement = -1;

\if :{?migrator_role}
\else
\echo 'psql variable migrator_role is required (-v migrator_role=cardhub_migrator)'
\quit 1
\endif

\if :{?runtime_role}
\else
\echo 'psql variable runtime_role is required (-v runtime_role=cardhub_runtime)'
\quit 1
\endif

\if :{?backup_role}
\else
\echo 'psql variable backup_role is required (-v backup_role=cardhub_backup)'
\quit 1
\endif

\getenv migrator_password MIGRATE_PASSWORD
\getenv runtime_password RUNTIME_PASSWORD
\getenv backup_password BACKUP_PASSWORD

SELECT :'migrator_password' ~ '^[0-9a-f]+$' AS migrator_password_ok \gset
\if :migrator_password_ok
\else
\echo 'MIGRATE_PASSWORD must be lowercase hex from openssl rand -hex 32'
\quit 1
\endif

SELECT :'runtime_password' ~ '^[0-9a-f]+$' AS runtime_password_ok \gset
\if :runtime_password_ok
\else
\echo 'RUNTIME_PASSWORD must be lowercase hex from openssl rand -hex 32'
\quit 1
\endif

SELECT :'backup_password' ~ '^[0-9a-f]+$' AS backup_password_ok \gset
\if :backup_password_ok
\else
\echo 'BACKUP_PASSWORD must be lowercase hex from openssl rand -hex 32'
\quit 1
\endif

SELECT :'migrator_role' ~ '^[A-Za-z_][A-Za-z0-9_]*$' AS migrator_role_ok \gset
\if :migrator_role_ok
\else
\echo 'migrator_role must be a plain identifier'
\quit 1
\endif

SELECT :'runtime_role' ~ '^[A-Za-z_][A-Za-z0-9_]*$' AS runtime_role_ok \gset
\if :runtime_role_ok
\else
\echo 'runtime_role must be a plain identifier'
\quit 1
\endif

SELECT :'backup_role' ~ '^[A-Za-z_][A-Za-z0-9_]*$' AS backup_role_ok \gset
\if :backup_role_ok
\else
\echo 'backup_role must be a plain identifier'
\quit 1
\endif

SELECT current_user AS admin_role \gset
SELECT rolsuper AS admin_is_superuser FROM pg_roles WHERE rolname = current_user \gset
\if :admin_is_superuser
\else
\echo 'split-roles.sql must be run as a superuser'
\quit 1
\endif

SELECT
  :'migrator_role' = :'admin_role'
  OR :'runtime_role' = :'admin_role'
  OR :'backup_role' = :'admin_role'
  AS role_reuses_admin \gset
\if :role_reuses_admin
\echo 'refusing to reuse the current superuser as migrator, runtime, or backup'
\quit 1
\endif

SELECT
  :'migrator_role' = :'runtime_role'
  OR :'migrator_role' = :'backup_role'
  OR :'runtime_role' = :'backup_role'
  AS roles_overlap \gset
\if :roles_overlap
\echo 'migrator, runtime, and backup role names must be distinct'
\quit 1
\endif

SELECT set_config('cardhub.migrator_role', :'migrator_role', false);
SELECT set_config('cardhub.runtime_role', :'runtime_role', false);
SELECT set_config('cardhub.backup_role', :'backup_role', false);
SELECT set_config('cardhub.admin_role', :'admin_role', false);

-- Create or realign each LOGIN role. The statement text contains the
-- password; keep log_statement off the default (none) while this runs.
SELECT format($fmt$
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
    CREATE ROLE %I
      LOGIN
      PASSWORD %L
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT;
  ELSE
    ALTER ROLE %I WITH
      LOGIN
      PASSWORD %L
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT;
  END IF;
END
$body$;
$fmt$, :'migrator_role', :'migrator_role', :'migrator_password', :'migrator_role', :'migrator_password')
\gexec

SELECT format($fmt$
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
    CREATE ROLE %I
      LOGIN
      PASSWORD %L
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT;
  ELSE
    ALTER ROLE %I WITH
      LOGIN
      PASSWORD %L
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT;
  END IF;
END
$body$;
$fmt$, :'runtime_role', :'runtime_role', :'runtime_password', :'runtime_role', :'runtime_password')
\gexec

SELECT format($fmt$
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %L) THEN
    CREATE ROLE %I
      LOGIN
      PASSWORD %L
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT;
  ELSE
    ALTER ROLE %I WITH
      LOGIN
      PASSWORD %L
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      INHERIT;
  END IF;
END
$body$;
$fmt$, :'backup_role', :'backup_role', :'backup_password', :'backup_role', :'backup_password')
\gexec

-- CREATE ROLE and ALTER ROLE are transactional. The three roles above run
-- before this BEGIN on purpose, so a rollback of the block below does not
-- drop them. Re-running the script realigns them. Ownership and GRANTs are
-- one transaction: a failure disconnects with the transaction open, and
-- PostgreSQL rolls it back instead of leaving owners half-applied.
BEGIN;

-- Database owner can CREATE trusted extensions (pg_trgm on PostgreSQL 13+).
SELECT format('ALTER DATABASE %I OWNER TO %I', current_database(), :'migrator_role') \gexec

-- Schema owner can create objects. PUBLIC must not be able to CREATE TABLE.
SELECT format('ALTER SCHEMA public OWNER TO %I', :'migrator_role') \gexec
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SELECT format('GRANT USAGE, CREATE ON SCHEMA public TO %I', :'migrator_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'runtime_role') \gexec
SELECT format('GRANT USAGE ON SCHEMA public TO %I', :'backup_role') \gexec
SELECT format(
  'GRANT CONNECT, TEMPORARY ON DATABASE %I TO %I, %I, %I',
  current_database(),
  :'migrator_role',
  :'runtime_role',
  :'backup_role'
) \gexec

-- Tables, views, and sequences created by the historical superuser.
DO $body$
DECLARE
  migrator text := current_setting('cardhub.migrator_role');
  obj record;
BEGIN
  FOR obj IN
    SELECT n.nspname, c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      -- SERIAL (deptype 'a') and identity (deptype 'i') sequences are owned
      -- by a table column. ALTER SEQUENCE OWNER TO fails with
      -- "cannot change owner of sequence ... linked to table column" when
      -- the sequence is visited on its own. ALTER TABLE moves them.
      AND NOT (
        c.relkind = 'S'
        AND EXISTS (
          SELECT 1
          FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype IN ('a', 'i')
        )
      )
  LOOP
    IF obj.relkind = 'S' THEN
      EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO %I', obj.nspname, obj.relname, migrator);
    ELSIF obj.relkind = 'v' THEN
      EXECUTE format('ALTER VIEW %I.%I OWNER TO %I', obj.nspname, obj.relname, migrator);
    ELSIF obj.relkind = 'm' THEN
      EXECUTE format('ALTER MATERIALIZED VIEW %I.%I OWNER TO %I', obj.nspname, obj.relname, migrator);
    ELSE
      EXECUTE format('ALTER TABLE %I.%I OWNER TO %I', obj.nspname, obj.relname, migrator);
    END IF;
  END LOOP;
END
$body$;

-- Enums and domains only. Every table has a composite row type; ALTER TYPE on
-- those fails and asks for ALTER TABLE, which the relation loop already did.
-- Skip objects that belong to an extension.
DO $body$
DECLARE
  migrator text := current_setting('cardhub.migrator_role');
  obj record;
BEGIN
  FOR obj IN
    SELECT n.nspname, t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e', 'd')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.objid = t.oid
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO %I', obj.nspname, obj.typname, migrator);
  END LOOP;
END
$body$;

-- PostgreSQL 16 has no ALTER EXTENSION ... OWNER TO. An extension that already
-- exists (pg_trgm, created by the historical superuser) stays owned by that
-- superuser. CREATE EXTENSION IF NOT EXISTS still succeeds for the migrator,
-- and on a database where the extension is absent the migrator can create it
-- because pg_trgm is trusted and the migrator owns the database.

-- DML for the API, read for pg_dump. Includes _prisma_migrations; the next
-- block removes write access to that table from the runtime role.
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I',
  :'runtime_role'
) \gexec
SELECT format(
  'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'runtime_role'
) \gexec
SELECT format(
  'GRANT SELECT ON ALL TABLES IN SCHEMA public TO %I',
  :'backup_role'
) \gexec
SELECT format(
  'GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO %I',
  :'backup_role'
) \gexec

-- _prisma_migrations is migration history. The migrator owns it and keeps
-- full rights. The runtime role may read it and must not rewrite it. The
-- backup role keeps SELECT via the grant above so pg_dump includes history.
DO $body$
DECLARE
  runtime text := current_setting('cardhub.runtime_role');
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public._prisma_migrations FROM %I',
      runtime
    );
    EXECUTE format(
      'GRANT SELECT ON TABLE public._prisma_migrations TO %I',
      runtime
    );
  END IF;
END
$body$;

-- Future objects created by the migrator (prisma migrate deploy) must be
-- usable without another grant pass. Also cover the admin role so a migration
-- that still runs as the historical superuser during the cutover window
-- grants the same DML to the runtime role.
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'migrator_role',
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  :'migrator_role',
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
  :'migrator_role',
  :'backup_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO %I',
  :'migrator_role',
  :'backup_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I',
  :'admin_role',
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO %I',
  :'admin_role',
  :'runtime_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON TABLES TO %I',
  :'admin_role',
  :'backup_role'
) \gexec
SELECT format(
  'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT ON SEQUENCES TO %I',
  :'admin_role',
  :'backup_role'
) \gexec

DO $body$
DECLARE
  migrator text := current_setting('cardhub.migrator_role');
  runtime text := current_setting('cardhub.runtime_role');
  backup text := current_setting('cardhub.backup_role');
  bad int;
  owner name;
BEGIN
  SELECT count(*) INTO bad
  FROM pg_roles
  WHERE rolname IN (migrator, runtime, backup)
    AND (
      rolsuper
      OR rolcreatedb
      OR rolcreaterole
      OR rolreplication
      OR rolbypassrls
      OR NOT rolcanlogin
    );
  IF bad <> 0 THEN
    RAISE EXCEPTION 'least-privilege role has unexpected attributes';
  END IF;

  SELECT pg_get_userbyid(datdba) INTO owner
  FROM pg_database
  WHERE datname = current_database();
  IF owner IS DISTINCT FROM migrator THEN
    RAISE EXCEPTION 'database owner is %, expected %', owner, migrator;
  END IF;
END
$body$;

COMMIT;

\echo '--- role attributes (no passwords) ---'
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN (:'migrator_role', :'runtime_role', :'backup_role', :'admin_role')
ORDER BY rolname;

\echo '--- database owner ---'
SELECT datname, pg_get_userbyid(datdba) AS owner
FROM pg_database
WHERE datname = current_database();

\echo '--- pg_trgm trust (superuser column is the pre-PG13 installer flag) ---'
SELECT name, version, trusted, superuser
FROM pg_available_extension_versions
WHERE name = 'pg_trgm'
ORDER BY version;
