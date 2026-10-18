#!/bin/sh
# One-shot Prisma migration. Exits when deploy finishes.
#
# Uses MIGRATE_DATABASE_URL when it is non-empty, otherwise DATABASE_URL.
# Existing single-URL deploys keep working until an operator switches the
# runtime URL. See deploy/db/README.md.
#
# prisma migrate deploy takes an advisory lock on _prisma_migrations.

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

echo "Running prisma migrate deploy"

log="$(mktemp)"
cleanup() {
  if [ -n "${log:-}" ]; then
    rm -f "${log}"
    log=""
  fi
}
trap cleanup EXIT

set +e
# Only this process sees the migrator URL. Do not export it into a server.
DATABASE_URL="${migrate_url}" npx --no-install prisma migrate deploy --schema=./prisma/schema.prisma >"${log}" 2>&1
status="$?"
set -e

# Prisma errors can include the connection string. Mask userinfo before logging.
sed -E \
  -e 's#://[^[:space:]/@]*:[^[:space:]/@]*@#://[REDACTED]@#g' \
  -e 's#://[^[:space:]/@]*@#://[REDACTED]@#g' \
  -e 's#([Pp]assword=)[^[:space:]&]+#\1[REDACTED]#g' \
  "${log}" >&2

# Remove the log before exiting. Do not rely on the EXIT trap alone.
cleanup
trap - EXIT

exit "${status}"
