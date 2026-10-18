#!/usr/bin/env bash
set -euo pipefail

PROJECT="${PROJECT:-cardhub-prod}"
ENV_FILE="${ENV_FILE:-/opt/cardhub/production/production.env}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/cardhub/production/deploy/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/cardhub/backups/${PROJECT}}"
OFFSITE_ENV_FILE="${OFFSITE_ENV_FILE:-/opt/cardhub/backups/offsite.env}"
RCLONE_IMAGE="rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${PROJECT}-${TIMESTAMP}.sql.gz"
tmp_sql=""
tmp_gz=""
tmp_rclone_env=""
backup_fail_reason=""
rc=0

# shellcheck disable=SC2317
finish_backup() {
  # rc was captured by the EXIT trap before this function runs.
  set +e
  unset PGPASSWORD || true
  [ -z "${tmp_sql}" ] || rm -f "${tmp_sql}"
  [ -z "${tmp_gz}" ] || rm -f "${tmp_gz}"
  [ -z "${tmp_rclone_env}" ] || rm -f "${tmp_rclone_env}"
  local ts reason kind tail
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ "${rc}" -eq 0 ]; then
    kind=ok
    tail=" file=$(basename "${OUT}")"
  else
    reason="${backup_fail_reason:-command-failed}"
    kind=fail
    tail=" rc=${rc} reason=${reason}"
  fi
  # One printf, one write. Staging and prod append to the same backup.log;
  # a separate newline write and result write can interleave.
  printf '\nBACKUP_RESULT=%s project=%s ts=%s%s\n' \
    "${kind}" "${PROJECT}" "${ts}" "${tail}"
  if [ -n "${BACKUP_PING_URL:-}" ]; then
    if [ "${rc}" -eq 0 ]; then
      curl -fsS -m 10 -- "${BACKUP_PING_URL}" >/dev/null || true
    else
      curl -fsS -m 10 -- "${BACKUP_PING_URL%/}/fail" >/dev/null || true
    fi
  fi
  exit "${rc}"
}

# shellcheck disable=SC2317
on_term() {
  backup_fail_reason=sigterm
  exit 143
}

# shellcheck disable=SC2317
on_int() {
  backup_fail_reason=sigint
  exit 130
}

# The first statement has to be rc=$? . A command before it, including the
# function call itself, would see status 0 and could record a false success
# after set -e, pipefail, or a signal.
trap 'rc=$?; finish_backup' EXIT
trap on_term TERM
trap on_int INT

# Last assignment in the env file wins. Values are not printed.
read_env_var() {
  local file="$1"
  local key="$2"
  awk -v key="$key" '
    BEGIN { found = "" }
    /^[[:space:]]*#/ { next }
    /^[[:space:]]*$/ { next }
    {
      eq = index($0, "=")
      if (eq == 0) next
      name = substr($0, 1, eq - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      if (name != key) next
      value = substr($0, eq + 1)
      gsub(/\r$/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (length(value) >= 2 && substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") {
        value = substr(value, 2, length(value) - 2)
      }
      q = sprintf("%c", 39)
      if (length(value) >= 2 && substr(value, 1, 1) == q && substr(value, length(value), 1) == q) {
        value = substr(value, 2, length(value) - 2)
      }
      found = value
    }
    END { printf "%s", found }
  ' "${file}"
}

# Prints the value. Returns 1 when the file cannot be read or sourced.
# Callers run under if/||, which disables set -e, so a failing source must
# exit explicitly. An empty value is success: the caller reports a missing key.
read_offsite_var() {
  local var_name="$1"
  if [ ! -r "${OFFSITE_ENV_FILE}" ]; then
    return 1
  fi
  (
    set -u
    # shellcheck source=/dev/null
    . "${OFFSITE_ENV_FILE}" || exit 1
    printf '%s' "${!var_name:-}"
  )
}

load_offsite_var() {
  local dest="$1"
  local key="$2"
  local value rc
  rc=0
  value="$(read_offsite_var "${key}")" || rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "Off-site backup env file is unreadable: ${OFFSITE_ENV_FILE}" >&2
    backup_fail_reason=offsite-env-unreadable
    return 1
  fi
  printf -v "${dest}" '%s' "${value}"
}

push_offsite() {
  if [ ! -e "${OFFSITE_ENV_FILE}" ]; then
    echo "Off-site backup env file is missing: ${OFFSITE_ENV_FILE}" >&2
    backup_fail_reason=offsite-env-missing
    return 1
  fi
  if [ ! -f "${OFFSITE_ENV_FILE}" ] || [ ! -r "${OFFSITE_ENV_FILE}" ]; then
    echo "Off-site backup env file is unreadable: ${OFFSITE_ENV_FILE}" >&2
    backup_fail_reason=offsite-env-unreadable
    return 1
  fi

  local oss_access_key_id="" oss_access_key_secret="" oss_bucket="" oss_endpoint=""
  load_offsite_var oss_access_key_id OSS_ACCESS_KEY_ID || return 1
  load_offsite_var oss_access_key_secret OSS_ACCESS_KEY_SECRET || return 1
  load_offsite_var oss_bucket OSS_BUCKET || return 1
  load_offsite_var oss_endpoint OSS_ENDPOINT || return 1

  local required_var required_value
  for required_var in OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_BUCKET OSS_ENDPOINT; do
    case "${required_var}" in
      OSS_ACCESS_KEY_ID) required_value="${oss_access_key_id}" ;;
      OSS_ACCESS_KEY_SECRET) required_value="${oss_access_key_secret}" ;;
      OSS_BUCKET) required_value="${oss_bucket}" ;;
      OSS_ENDPOINT) required_value="${oss_endpoint}" ;;
    esac
    if [ -z "${required_value}" ]; then
      echo "Off-site backup env file is missing ${required_var}" >&2
      backup_fail_reason="missing-${required_var}"
      return 1
    fi
  done

  tmp_rclone_env="$(mktemp)"
  chmod 600 "${tmp_rclone_env}"
  {
    printf 'RCLONE_CONFIG_OSS_TYPE=s3\n'
    printf 'RCLONE_CONFIG_OSS_PROVIDER=Alibaba\n'
    printf 'RCLONE_CONFIG_OSS_ENDPOINT=%s\n' "${oss_endpoint}"
    printf 'RCLONE_CONFIG_OSS_ACCESS_KEY_ID=%s\n' "${oss_access_key_id}"
    printf 'RCLONE_CONFIG_OSS_SECRET_ACCESS_KEY=%s\n' "${oss_access_key_secret}"
    printf 'RCLONE_CONFIG_OSS_ACL=private\n'
  } > "${tmp_rclone_env}"

  local backup_name
  backup_name="$(basename "${OUT}")"
  local remote_path="oss:${oss_bucket}/${PROJECT}/${backup_name}"
  local remote_dir="oss:${oss_bucket}/${PROJECT}"
  local container_backup="/backup/${backup_name}"

  echo "Uploading ${backup_name} to off-site OSS bucket ${oss_bucket}/${PROJECT}"
  if ! docker run --rm \
    --env-file "${tmp_rclone_env}" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "${RCLONE_IMAGE}" \
    copyto "${container_backup}" "${remote_path}" --s3-no-check-bucket; then
    echo "Off-site backup upload failed for ${backup_name}" >&2
    backup_fail_reason=offsite-upload-failed
    return 1
  fi

  echo "Verifying off-site backup ${backup_name}"
  if ! docker run --rm \
    --env-file "${tmp_rclone_env}" \
    -v "${BACKUP_DIR}:/backup:ro" \
    "${RCLONE_IMAGE}" \
    check --one-way /backup "${remote_dir}" --include "/${backup_name}" --s3-no-check-bucket; then
    echo "Off-site backup verification failed for ${backup_name}" >&2
    backup_fail_reason=offsite-verify-failed
    return 1
  fi
}

mkdir -p "${BACKUP_DIR}"

tmp_sql="$(mktemp "${BACKUP_DIR}/.${PROJECT}.${TIMESTAMP}.sql.XXXXXX")"
tmp_gz="$(mktemp "${BACKUP_DIR}/.${PROJECT}.${TIMESTAMP}.sql.gz.XXXXXX")"

# Prefer the read-only backup role. Fall back to the admin superuser when
# PGDUMP_USER and PGDUMP_PASSWORD are both unset, so existing servers keep
# dumping until the role split is applied. Never print these values.
dump_user="$(read_env_var "${ENV_FILE}" PGDUMP_USER)"
dump_password="$(read_env_var "${ENV_FILE}" PGDUMP_PASSWORD)"
if [ -z "${dump_user}" ] && [ -z "${dump_password}" ]; then
  dump_user="$(read_env_var "${ENV_FILE}" POSTGRES_USER)"
  dump_password="$(read_env_var "${ENV_FILE}" POSTGRES_PASSWORD)"
elif [ -z "${dump_user}" ] || [ -z "${dump_password}" ]; then
  echo "Set both PGDUMP_USER and PGDUMP_PASSWORD, or leave both empty to use POSTGRES_USER" >&2
  exit 1
fi
if [ -z "${dump_user}" ] || [ -z "${dump_password}" ]; then
  echo "Backup credentials are missing from ${ENV_FILE}" >&2
  exit 1
fi

echo "Dumping ${PROJECT} as database role ${dump_user}"

# pg_dump inside the postgres container uses the local socket. This image's
# pg_hba trusts local and 127.0.0.1, so a wrong password would still succeed.
# A second container on the compose network connects to host "postgres" over
# TCP, which requires the password. Do not exec, and do not use --network host.
dump_db="$(read_env_var "${ENV_FILE}" POSTGRES_DB)"
if [ -z "${dump_db}" ]; then
  echo "POSTGRES_DB is missing from ${ENV_FILE}" >&2
  exit 1
fi
postgres_ids="$(
  docker compose -p "${PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q postgres \
    | awk 'NF'
)" || {
  echo "Could not list the postgres container; refusing to dump" >&2
  exit 1
}
postgres_count="$(printf '%s\n' "${postgres_ids}" | awk 'NF { n++ } END { print n + 0 }')"
if [ "${postgres_count}" -ne 1 ]; then
  echo "Refusing to dump: expected exactly one postgres container, found ${postgres_count}" >&2
  exit 1
fi
postgres_id="${postgres_ids}"
postgres_image="$(docker inspect -f '{{.Config.Image}}' "${postgres_id}")" || {
  echo "Could not read the postgres image; refusing to dump" >&2
  exit 1
}
pg_network="$(
  docker inspect -f '{{range $name, $conf := .NetworkSettings.Networks}}{{range $conf.Aliases}}{{if eq . "postgres"}}{{$name}}{{"\n"}}{{end}}{{end}}{{end}}' "${postgres_id}" \
    | awk 'NF' | head -n 1
)" || {
  echo "Could not read the postgres network; refusing to dump" >&2
  exit 1
}
if [ -z "${postgres_image}" ] || [ -z "${pg_network}" ]; then
  echo "Could not find the postgres image or compose network; refusing to dump" >&2
  exit 1
fi

export PGDUMP_USER="${dump_user}"
export PGDUMP_DB="${dump_db}"
export PGPASSWORD="${dump_password}"
# pg_dump is the left side of this pipe. With pipefail, its non-zero status
# fails the script even when tee exits 0 and keeps a partial copy. The copy
# is what the size check reads after a successful dump.
backup_fail_reason=pipefail
docker run --rm --network "${pg_network}" \
  -e PGPASSWORD \
  -e PGDUMP_USER \
  -e PGDUMP_DB \
  --entrypoint sh \
  "${postgres_image}" \
  -c 'pg_dump --no-password -h postgres -U "$PGDUMP_USER" -d "$PGDUMP_DB"' \
  | tee "${tmp_sql}" >/dev/null
backup_fail_reason=""
unset PGPASSWORD PGDUMP_USER PGDUMP_DB
dump_password=""

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

offsite_rc=0
push_offsite || offsite_rc="$?"

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
exit "${offsite_rc}"
