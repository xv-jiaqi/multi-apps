#!/usr/bin/env bash
# A wrong PGDUMP_PASSWORD must fail the backup before any OSS upload.
# Local-socket pg_dump (compose exec, or docker run without -h postgres)
# is trust and ignores the password. TCP to the compose service checks it.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
backup_script="${root}/deploy/backup.sh"
failed=0
right_password='right-dump-password'
wrong_password='wrong-dump-password'
admin_password='admin-secret-value'
oss_secret='oss-secret-value'

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
    if [ "${CASE_DUMPED:-0}" -eq 0 ]; then
      CASE_DUMPED=1
      echo "--- script log ---" >&2
      cat "${CASE_LOG}" >&2 || true
      echo "--- docker log ---" >&2
      cat "${CASE_DOCKER}" >&2 || true
    fi
  fi
}

assert_no_secret() {
  local name="$1"
  local file="$2"
  local secret
  local leaked=0
  for secret in "${right_password}" "${wrong_password}" "${admin_password}" "${oss_secret}"; do
    if grep -F -q -- "${secret}" "${file}"; then
      echo "LEAK ${name} contains a secret" >&2
      leaked=1
    fi
  done
  assert "${name} has no secret" "${leaked}"
}

run_case() {
  local password="$1"
  local ps_mode="${2:-one}"
  local dump_mode="${3:-ok}"
  local work docker_log script_log script_rc upload_flag
  work="$(mktemp -d)"
  docker_log="${work}/docker.log"
  script_log="${work}/script.log"
  upload_flag="${work}/uploaded"
  mkdir -p "${work}/bin" "${work}/backups" "${work}/deploy"

  cat > "${work}/bin/docker" << 'EOF'
#!/usr/bin/env bash
set -u
log="${BACKUP_STUB_LOG:?}"
{
  printf '%s' "$1"
  if [ "$#" -gt 1 ]; then
    printf ' %s' "${@:2}"
  fi
  printf '\n'
} >> "${log}"

cmd="$1"
shift || true

dump_sql() {
  awk 'BEGIN { for (i = 0; i < 200; i++) printf "insert into backup_stub(id) values (%d);\n", i }'
}

if [ "${cmd}" = "compose" ]; then
  sub=""
  for arg in "$@"; do
    case "${arg}" in
      ps|exec|run|up) sub="${arg}" ;;
    esac
  done
  case "${sub}" in
    ps)
      case "${BACKUP_STUB_PS:-one}" in
        zero)
          exit 0
          ;;
        two)
          printf 'pg-a\npg-b\n'
          exit 0
          ;;
        one)
          echo pgcontainer
          exit 0
          ;;
        *)
          echo "stub docker: unknown ps mode ${BACKUP_STUB_PS}" >&2
          exit 99
          ;;
      esac
      ;;
    exec|run)
      # Inside the postgres container the socket is trust. Password ignored.
      dump_sql
      exit 0
      ;;
    *)
      echo "stub docker: unexpected compose ${sub}" >&2
      exit 99
      ;;
  esac
fi

if [ "${cmd}" = "inspect" ]; then
  fmt=""
  prev=""
  for arg in "$@"; do
    if [ "${prev}" = "-f" ]; then
      fmt="${arg}"
    fi
    prev="${arg}"
  done
  case "${fmt}" in
    *Config.Image*)
      echo 'postgres:16-alpine'
      ;;
    *Aliases*|*Networks*)
      echo 'cardhub-prod_default'
      ;;
    *)
      echo "stub docker: unexpected inspect" >&2
      exit 99
      ;;
  esac
  exit 0
fi

if [ "${cmd}" = "run" ]; then
  joined="$*"
  if printf '%s\n' "${joined}" | grep -q 'pg_dump'; then
    if ! printf '%s\n' "${joined}" | grep -F -q -- "--network ${PROJECT:?}_default"; then
      echo "stub docker: pg_dump must use --network ${PROJECT}_default" >&2
      exit 99
    fi
    if printf '%s\n' "${joined}" | grep -q -- '-h postgres'; then
      if [ "${PGPASSWORD:-}" != "${BACKUP_STUB_PASSWORD:?}" ]; then
        echo 'pg_dump: error: connection to server at "postgres" (172.18.0.5), port 5432 failed: FATAL: password authentication failed for user "cardhub_backup"' >&2
        exit 1
      fi
      if [ "${BACKUP_STUB_DUMP:-ok}" = "partial-fail" ]; then
        payload="$(dump_sql)"
        printf '%s' "${payload}"
        bytes="$(printf '%s' "${payload}" | wc -c | awk '{ print $1 }')"
        if [ "${bytes}" -le 1024 ]; then
          echo "stub docker: partial dump must exceed 1KB, wrote ${bytes}" >&2
          exit 99
        fi
        echo "pg_dump: write error after partial dump" >&2
        exit 1
      fi
      dump_sql
      exit 0
    fi
    dump_sql
    exit 0
  fi
  if printf '%s\n' "${joined}" | grep -q 'copyto'; then
    : > "${BACKUP_STUB_UPLOAD:?}"
    exit 0
  fi
  if printf '%s\n' "${joined}" | grep -q ' check '; then
    exit 0
  fi
  echo "stub docker: unexpected run" >&2
  exit 99
fi

echo "stub docker: unexpected ${cmd}" >&2
exit 99
EOF
  chmod 755 "${work}/bin/docker"

  cat > "${work}/app.env" << EOF
ENV_NAME=prod
POSTGRES_USER=cardhub
POSTGRES_PASSWORD=${admin_password}
POSTGRES_DB=cardhub_prod
PGDUMP_USER=cardhub_backup
PGDUMP_PASSWORD=${password}
EOF
  cat > "${work}/offsite.env" << EOF
OSS_ACCESS_KEY_ID=oss-access-id
OSS_ACCESS_KEY_SECRET=${oss_secret}
OSS_BUCKET=cardhub-backups
OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com
EOF
  cp "${root}/deploy/docker-compose.yml" "${work}/deploy/docker-compose.yml"

  script_rc=0
  env \
    PATH="${work}/bin:${PATH}" \
    PROJECT=cardhub-prod \
    ENV_FILE="${work}/app.env" \
    COMPOSE_FILE="${work}/deploy/docker-compose.yml" \
    BACKUP_DIR="${work}/backups" \
    OFFSITE_ENV_FILE="${work}/offsite.env" \
    BACKUP_STUB_LOG="${docker_log}" \
    BACKUP_STUB_PASSWORD="${right_password}" \
    BACKUP_STUB_UPLOAD="${upload_flag}" \
    BACKUP_STUB_PS="${ps_mode}" \
    BACKUP_STUB_DUMP="${dump_mode}" \
    bash "${backup_script}" > "${script_log}" 2>&1 || script_rc=$?

  CASE_RC="${script_rc}"
  CASE_LOG="${script_log}"
  CASE_DOCKER="${docker_log}"
  CASE_UPLOAD="${upload_flag}"
  CASE_BACKUP_DIR="${work}/backups"
  CASE_DUMPED=0
  echo "CASE password=$( [ "${password}" = "${right_password}" ] && echo right || echo wrong ) ps=${ps_mode} dump=${dump_mode} rc=${script_rc}"
}

run_case "${wrong_password}"
assert "wrong password exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "wrong password does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert "wrong password writes no backup" "$(compgen -G "${CASE_BACKUP_DIR}/*.sql.gz" > /dev/null && echo 1 || echo 0)"
assert "wrong password is an auth failure" "$(grep -q 'password authentication failed' "${CASE_LOG}" && echo 0 || echo 1)"
assert "wrong password uses the compose host" "$(grep -q -- '-h postgres' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert "wrong password uses project network" "$(grep -F -q -- '--network cardhub-prod_default' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert_no_secret "wrong password output" "${CASE_LOG}"
assert_no_secret "wrong password docker argv" "${CASE_DOCKER}"

run_case "${right_password}"
assert "right password script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "right password uploads" "$([ -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert "right password keeps a backup" "$(compgen -G "${CASE_BACKUP_DIR}/*.sql.gz" > /dev/null && echo 0 || echo 1)"
assert "right password uses project network" "$(grep -F -q -- '--network cardhub-prod_default' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert_no_secret "right password output" "${CASE_LOG}"
assert_no_secret "right password docker argv" "${CASE_DOCKER}"

run_case "${right_password}" zero
assert "zero postgres exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "zero postgres is refused" "$(grep -F -q 'expected exactly one postgres container, found 0' "${CASE_LOG}" && echo 0 || echo 1)"
assert "zero postgres does not dump" "$(grep -F -q 'pg_dump' "${CASE_DOCKER}" && echo 1 || echo 0)"
assert "zero postgres does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert "zero postgres writes no backup" "$(compgen -G "${CASE_BACKUP_DIR}/*.sql.gz" > /dev/null && echo 1 || echo 0)"
assert "zero postgres leaves no file" "$(find "${CASE_BACKUP_DIR}" -type f -print | grep -q . && echo 1 || echo 0)"

run_case "${right_password}" two
assert "two postgres exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "two postgres is refused" "$(grep -F -q 'expected exactly one postgres container, found 2' "${CASE_LOG}" && echo 0 || echo 1)"
assert "two postgres does not dump" "$(grep -F -q 'pg_dump' "${CASE_DOCKER}" && echo 1 || echo 0)"
assert "two postgres does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert "two postgres writes no backup" "$(compgen -G "${CASE_BACKUP_DIR}/*.sql.gz" > /dev/null && echo 1 || echo 0)"
assert "two postgres leaves no file" "$(find "${CASE_BACKUP_DIR}" -type f -print | grep -q . && echo 1 || echo 0)"

# More than 1KB then exit 1. The size check would pass this payload, so a
# green run means pg_dump's own status failed the script. `|| true` after
# pg_dump lets the script finish and upload.
run_case "${right_password}" one partial-fail
assert "partial dump exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "partial dump failed in pg_dump" "$(grep -F -q 'pg_dump: write error after partial dump' "${CASE_LOG}" && echo 0 || echo 1)"
assert "partial dump is not a size rejection" "$(grep -F -q 'unexpectedly small' "${CASE_LOG}" && echo 1 || echo 0)"
assert "partial dump ran pg_dump" "$(grep -F -q 'pg_dump' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert "partial dump does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert "partial dump writes no backup" "$(compgen -G "${CASE_BACKUP_DIR}/*.sql.gz" > /dev/null && echo 1 || echo 0)"
assert "partial dump leaves no file" "$(find "${CASE_BACKUP_DIR}" -type f -print | grep -q . && echo 1 || echo 0)"

if [ "${failed}" -ne 0 ]; then
  echo "backup password tests failed" >&2
  exit 1
fi
echo "backup password tests passed"
