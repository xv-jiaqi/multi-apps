#!/usr/bin/env bash
# Apply deploy/db/split-roles.sql without putting passwords on argv.
#
# Required environment (exported; never passed as arguments):
#   MIGRATE_PASSWORD RUNTIME_PASSWORD BACKUP_PASSWORD
#
# Optional role names (default cardhub_migrator / cardhub_runtime / cardhub_backup):
#   MIGRATOR_ROLE RUNTIME_ROLE BACKUP_ROLE
#
# On the VPS, set COMPOSE_FILE, ENV_FILE, and PROJECT. The script execs into
# the postgres container and uses that container's POSTGRES_USER (the admin
# superuser). Example:
#
#   PROJECT=cardhub-staging \
#   ENV_FILE=/opt/cardhub/staging/staging.env \
#   COMPOSE_FILE=/opt/cardhub/staging/deploy/docker-compose.yml \
#   ./db/split-roles.sh
#
# From a machine with psql on the path, leave COMPOSE_FILE unset and export
# the usual libpq variables (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD).

set -euo pipefail

require_nonempty() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "${name} is required and must be non-empty" >&2
    exit 1
  fi
}

require_nonempty MIGRATE_PASSWORD
require_nonempty RUNTIME_PASSWORD
require_nonempty BACKUP_PASSWORD

# Only lowercase hex. That stays URL-safe, cannot close the SQL quotes in
# split-roles.sql, and cannot slip past the log mask as E'...'.
reject_unsafe_password() {
  local name="$1"
  local value="${!name}"
  if [[ ! "${value}" =~ ^[0-9a-f]+$ ]]; then
    echo "${name} must be lowercase hex from 'openssl rand -hex 32'" >&2
    exit 1
  fi
}

reject_unsafe_password MIGRATE_PASSWORD
reject_unsafe_password RUNTIME_PASSWORD
reject_unsafe_password BACKUP_PASSWORD

role_re='^[A-Za-z_][A-Za-z0-9_]*$'
MIGRATOR_ROLE="${MIGRATOR_ROLE:-cardhub_migrator}"
RUNTIME_ROLE="${RUNTIME_ROLE:-cardhub_runtime}"
BACKUP_ROLE="${BACKUP_ROLE:-cardhub_backup}"

for role_name in MIGRATOR_ROLE RUNTIME_ROLE BACKUP_ROLE; do
  if [[ ! "${!role_name}" =~ ${role_re} ]]; then
    echo "${role_name} must be a plain identifier" >&2
    exit 1
  fi
done

if [ "${MIGRATOR_ROLE}" = "${RUNTIME_ROLE}" ] || [ "${MIGRATOR_ROLE}" = "${BACKUP_ROLE}" ] || [ "${RUNTIME_ROLE}" = "${BACKUP_ROLE}" ]; then
  echo "MIGRATOR_ROLE, RUNTIME_ROLE, and BACKUP_ROLE must be distinct" >&2
  exit 1
fi

export MIGRATE_PASSWORD RUNTIME_PASSWORD BACKUP_PASSWORD
export MIGRATOR_ROLE RUNTIME_ROLE BACKUP_ROLE

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sql_file="${script_dir}/split-roles.sql"

mask() {
  sed -E \
    -e 's#://[^[:space:]/@]*:[^[:space:]/@]*@#://[REDACTED]@#g' \
    -e 's#://[^[:space:]/@]*@#://[REDACTED]@#g' \
    -e "s/(PASSWORD[[:space:]]*)'[^']*'/\1'[REDACTED]'/g" \
    -e 's/([Pp]assword=)[^[:space:]&]+/\1[REDACTED]/g'
}

run_psql() {
  if [ -n "${COMPOSE_FILE:-}" ]; then
    if [ -z "${PROJECT:-}" ] || [ -z "${ENV_FILE:-}" ]; then
      echo "PROJECT and ENV_FILE are required when COMPOSE_FILE is set" >&2
      exit 1
    fi
    docker compose -p "${PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T \
      -e MIGRATE_PASSWORD \
      -e RUNTIME_PASSWORD \
      -e BACKUP_PASSWORD \
      -e MIGRATOR_ROLE \
      -e RUNTIME_ROLE \
      -e BACKUP_ROLE \
      postgres \
      sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -w -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v migrator_role="$MIGRATOR_ROLE" -v runtime_role="$RUNTIME_ROLE" -v backup_role="$BACKUP_ROLE" -f -'
  else
    psql -w -v ON_ERROR_STOP=1 \
      -v migrator_role="${MIGRATOR_ROLE}" \
      -v runtime_role="${RUNTIME_ROLE}" \
      -v backup_role="${BACKUP_ROLE}" \
      -f "${sql_file}"
  fi
}

set -o pipefail
if [ -n "${COMPOSE_FILE:-}" ]; then
  run_psql < "${sql_file}" 2>&1 | mask
else
  run_psql 2>&1 | mask
fi
