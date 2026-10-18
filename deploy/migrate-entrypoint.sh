#!/bin/sh
# One-shot Prisma migration. Exits when deploy finishes.
#
# Uses MIGRATE_DATABASE_URL when it is non-empty, otherwise DATABASE_URL.
# Existing single-URL deploys keep working until an operator switches the
# runtime URL. See deploy/db/README.md.
#
# prisma migrate deploy takes an advisory lock on _prisma_migrations.
#
# Before migrating, print the session role:
#   Migrating as current_user=<role> rolsuper=<true|false>
# Passwords, connection URLs, and hosts are not part of that line.

set -eu

runtime_url="${DATABASE_URL-}"
migrate_url="${MIGRATE_DATABASE_URL-}"

if [ -z "${migrate_url}" ]; then
  migrate_url="${runtime_url}"
fi

if [ -z "${migrate_url}" ]; then
  echo "prisma migrate deploy requires MIGRATE_DATABASE_URL or DATABASE_URL" >&2
  exit 1
fi

log=""
role_out=""
role_err=""
cleanup() {
  if [ -n "${log:-}" ]; then
    rm -f "${log}"
    log=""
  fi
  if [ -n "${role_out:-}" ]; then
    rm -f "${role_out}"
    role_out=""
  fi
  if [ -n "${role_err:-}" ]; then
    rm -f "${role_err}"
    role_err=""
  fi
}
trap cleanup EXIT

# Prisma errors can include the connection string. Mask userinfo before logging.
redact() {
  sed -E \
    -e 's#://[^[:space:]/@]*:[^[:space:]/@]*@#://[REDACTED]@#g' \
    -e 's#://[^[:space:]/@]*@#://[REDACTED]@#g' \
    -e 's#([Pp]assword=)[^[:space:]&]+#\1[REDACTED]#g'
}

role_out="$(mktemp)"
role_err="$(mktemp)"

set +e
# Only this process sees the migrator URL. The heredoc is quoted so the
# URL is not copied into the script text or the log.
DATABASE_URL="${migrate_url}" node <<'NODE' >"${role_out}" 2>"${role_err}"
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function done(status) {
  prisma
    .$disconnect()
    .catch(function () {})
    .then(function () {
      process.exit(status);
    });
}

function rolsuperFlag(value) {
  if (value === true || value === 't' || value === 'true') return 'true';
  if (value === false || value === 'f' || value === 'false') return 'false';
  return '';
}

prisma
  .$queryRawUnsafe(
    'select current_user as rolname, rolsuper from pg_roles where rolname = current_user',
  )
  .then(function (rows) {
    const row = Array.isArray(rows) ? rows[0] : null;
    const name = row && typeof row.rolname === 'string' ? row.rolname.trim() : '';
    const flag = rolsuperFlag(row ? row.rolsuper : undefined);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || (flag !== 'true' && flag !== 'false')) {
      process.stderr.write('current_user query returned an unexpected row\n');
      done(1);
      return;
    }
    process.stdout.write('current_user=' + name + ' rolsuper=' + flag + '\n');
    done(0);
  })
  .catch(function (error) {
    const message = error && error.message ? String(error.message) : String(error);
    process.stderr.write(message + '\n');
    done(1);
  });
NODE
role_status="$?"
set -e

if [ "${role_status}" -ne 0 ]; then
  redact < "${role_err}" >&2
  echo "Refusing to migrate: could not read current_user and rolsuper" >&2
  exit 1
fi

if ! role_line="$(awk '
  NF { lines[++n] = $0 }
  END {
    if (n != 1) exit 1
    printf "%s", lines[1]
  }
' "${role_out}")"; then
  echo "Refusing to migrate: current_user query returned an unexpected shape" >&2
  exit 1
fi

if ! printf '%s\n' "${role_line}" | grep -Eq '^current_user=[A-Za-z_][A-Za-z0-9_]* rolsuper=(true|false)$'; then
  echo "Refusing to migrate: current_user query returned an unexpected shape" >&2
  exit 1
fi

echo "Migrating as ${role_line}"
echo "Running prisma migrate deploy"

log="$(mktemp)"

set +e
# Only this process sees the migrator URL. Do not export it into a server.
DATABASE_URL="${migrate_url}" npx --no-install prisma migrate deploy --schema=./prisma/schema.prisma >"${log}" 2>&1
status="$?"
set -e

redact < "${log}" >&2

# Remove the logs before exiting. Do not rely on the EXIT trap alone.
cleanup
trap - EXIT

exit "${status}"
