#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-cardhub-prod}"
ENV_FILE="${ENV_FILE:-/opt/cardhub/production.env}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/cardhub/deploy/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/cardhub/backups/${PROJECT}}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${PROJECT}-${TIMESTAMP}.sql.gz"
tmp_sql=""
tmp_gz=""

cleanup() {
  [ -z "${tmp_sql}" ] || rm -f "${tmp_sql}"
  [ -z "${tmp_gz}" ] || rm -f "${tmp_gz}"
}
trap cleanup EXIT

mkdir -p "${BACKUP_DIR}"

tmp_sql="$(mktemp "${BACKUP_DIR}/.${PROJECT}.${TIMESTAMP}.sql.XXXXXX")"
tmp_gz="$(mktemp "${BACKUP_DIR}/.${PROJECT}.${TIMESTAMP}.sql.gz.XXXXXX")"

docker compose -p "${PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres sh -c \
  'PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"' > "${tmp_sql}"

sql_size="$(wc -c < "${tmp_sql}")"
if [ "${sql_size}" -lt 1024 ]; then
  echo "Backup dump is unexpectedly small (${sql_size} bytes)" >&2
  exit 1
fi

gzip -9 < "${tmp_sql}" > "${tmp_gz}"
gzip -t "${tmp_gz}"

gz_size="$(wc -c < "${tmp_gz}")"
if [ "${gz_size}" -lt 128 ]; then
  echo "Compressed backup is unexpectedly small (${gz_size} bytes)" >&2
  exit 1
fi

mv "${tmp_gz}" "${OUT}"
tmp_gz=""

mapfile -t backups < <(ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null || true)
declare -A keep=()

if [ "${#backups[@]}" -gt 0 ]; then
  keep["${backups[0]}"]=1
fi

daily_count=0
for backup in "${backups[@]}"; do
  if [ "${daily_count}" -lt 7 ]; then
    keep["${backup}"]=1
    daily_count=$((daily_count + 1))
  fi
done

declare -A seen_weeks=()
weekly_count=0
for backup in "${backups[@]}"; do
  week="$(date -u -r "${backup}" +%G-%V)"
  if [ -z "${seen_weeks[${week}]+x}" ] && [ "${weekly_count}" -lt 4 ]; then
    keep["${backup}"]=1
    seen_weeks["${week}"]=1
    weekly_count=$((weekly_count + 1))
  fi
done

for backup in "${backups[@]}"; do
  if [ -z "${keep[${backup}]+x}" ]; then
    rm -f "${backup}"
  fi
done

echo "Wrote ${OUT}"
