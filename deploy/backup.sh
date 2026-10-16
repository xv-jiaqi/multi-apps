#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-cardhub-prod}"
ENV_FILE="${ENV_FILE:-/opt/cardhub/production/production.env}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/cardhub/production/deploy/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/cardhub/backups/${PROJECT}}"
OFFSITE_ENV_FILE="${OFFSITE_ENV_FILE:-/opt/cardhub/backups/offsite.env}"
RCLONE_IMAGE="rclone/rclone:1.75.2"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${PROJECT}-${TIMESTAMP}.sql.gz"
tmp_sql=""
tmp_gz=""
tmp_rclone_env=""

on_exit() {
  rc="$?"
  [ -z "${tmp_sql}" ] || rm -f "${tmp_sql}"
  [ -z "${tmp_gz}" ] || rm -f "${tmp_gz}"
  [ -z "${tmp_rclone_env}" ] || rm -f "${tmp_rclone_env}"
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    if [ "${rc}" -eq 0 ]; then
      curl -fsS -m 10 "${BACKUP_PING_URL}" >/dev/null || true
    else
      curl -fsS -m 10 "${BACKUP_PING_URL%/}/fail" >/dev/null || true
    fi
  fi
  exit "${rc}"
}
trap on_exit EXIT

push_offsite() {
  if [ ! -f "${OFFSITE_ENV_FILE}" ]; then
    return 0
  fi

  # shellcheck source=/dev/null
  . "${OFFSITE_ENV_FILE}"

  local required_var
  for required_var in OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_BUCKET OSS_ENDPOINT; do
    if [ -z "${!required_var:-}" ]; then
      echo "Off-site backup env file is missing ${required_var}" >&2
      exit 1
    fi
  done

  tmp_rclone_env="$(mktemp)"
  chmod 600 "${tmp_rclone_env}"
  {
    printf 'RCLONE_CONFIG_OSS_TYPE=s3\n'
    printf 'RCLONE_CONFIG_OSS_PROVIDER=Alibaba\n'
    printf 'RCLONE_CONFIG_OSS_ENDPOINT=%s\n' "${OSS_ENDPOINT}"
    printf 'RCLONE_CONFIG_OSS_ACCESS_KEY_ID=%s\n' "${OSS_ACCESS_KEY_ID}"
    printf 'RCLONE_CONFIG_OSS_SECRET_ACCESS_KEY=%s\n' "${OSS_ACCESS_KEY_SECRET}"
    printf 'RCLONE_CONFIG_OSS_ACL=private\n'
  } > "${tmp_rclone_env}"

  local backup_name
  backup_name="$(basename "${OUT}")"
  local remote_path="oss:${OSS_BUCKET}/${PROJECT}/${backup_name}"
  local container_backup="/backup/${backup_name}"

  echo "Uploading ${backup_name} to off-site OSS bucket ${OSS_BUCKET}/${PROJECT}"
  if ! docker run --rm \
    --env-file "${tmp_rclone_env}" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "${RCLONE_IMAGE}" \
    copyto "${container_backup}" "${remote_path}" --s3-no-check-bucket; then
    echo "Off-site backup upload failed for ${backup_name}" >&2
    exit 1
  fi

  echo "Verifying off-site backup ${backup_name}"
  if ! docker run --rm \
    --env-file "${tmp_rclone_env}" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "${RCLONE_IMAGE}" \
    check --one-way "${container_backup}" "${remote_path}" --s3-no-check-bucket; then
    echo "Off-site backup verification failed for ${backup_name}" >&2
    exit 1
  fi
}

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

push_offsite

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
  if [ -n "${keep[${backup}]+x}" ]; then
    continue
  fi
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
