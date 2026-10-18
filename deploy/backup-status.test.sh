#!/usr/bin/env bash
# BACKUP_RESULT must be fail (never ok) for set -e, pipefail, signals,
# a wrong password, and a missing off-site env. Off-site config is fail-closed:
# a missing, unreadable, or incomplete offsite.env must not send a success ping.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
backup_script="${root}/deploy/backup.sh"
failed=0
right_password='right-dump-password'
wrong_password='wrong-dump-password'
admin_password='admin-secret-value'
oss_secret='oss-secret-value'
ping_url='http://127.0.0.1:9/cardhub-backup-ping'

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
      echo "--- curl log ---" >&2
      cat "${CASE_CURL}" >&2 || true
      echo "--- rc file ---" >&2
      cat "${CASE_RC_FILE}" >&2 || true
    fi
  fi
}

assert_no_secret() {
  local name="$1"
  local file="$2"
  local secret
  local leaked=0
  if [ ! -f "${file}" ]; then
    assert "${name} has no secret" 0
    return
  fi
  for secret in "${right_password}" "${wrong_password}" "${admin_password}" "${oss_secret}"; do
    if grep -F -q -- "${secret}" "${file}"; then
      echo "LEAK ${name} contains a secret" >&2
      leaked=1
    fi
  done
  assert "${name} has no secret" "${leaked}"
}

assert_fail_line() {
  local name="$1"
  local reason="$2"
  local want_rc="$3"
  local count
  count="$(grep -c '^BACKUP_RESULT=' "${CASE_LOG}" || true)"
  assert "${name} writes one result line" "$([ "${count}" -eq 1 ] && echo 0 || echo 1)"
  assert "${name} is not ok" "$(grep -q '^BACKUP_RESULT=ok ' "${CASE_LOG}" && echo 1 || echo 0)"
  assert "${name} fail line" "$(
    grep -E -q \
      "^BACKUP_RESULT=fail project=${CASE_PROJECT} ts=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z rc=${want_rc} reason=${reason}$" \
      "${CASE_LOG}" && echo 0 || echo 1
  )"
}

assert_ok_line() {
  local name="$1"
  local count file_name
  count="$(grep -c '^BACKUP_RESULT=' "${CASE_LOG}" || true)"
  assert "${name} writes one result line" "$([ "${count}" -eq 1 ] && echo 0 || echo 1)"
  assert "${name} is not fail" "$(grep -q '^BACKUP_RESULT=fail ' "${CASE_LOG}" && echo 1 || echo 0)"
  assert "${name} ok line" "$(
    grep -E -q \
      "^BACKUP_RESULT=ok project=${CASE_PROJECT} ts=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z file=[^ ]+\\.sql\\.gz$" \
      "${CASE_LOG}" && echo 0 || echo 1
  )"
  file_name="$(sed -n 's/^BACKUP_RESULT=ok .* file=\([^ ]*\)$/\1/p' "${CASE_LOG}" | head -n 1)"
  assert "${name} file exists" "$([ -n "${file_name}" ] && [ -f "${CASE_BACKUP_DIR}/${file_name}" ] && echo 0 || echo 1)"
}

assert_curl() {
  local name="$1"
  local expected="$2"
  if [ -z "${expected}" ]; then
    assert "${name} sends no ping" "$([ ! -s "${CASE_CURL}" ] && echo 0 || echo 1)"
    return
  fi
  assert "${name} ping" "$(
    [ -f "${CASE_CURL}" ] && [ "$(cat "${CASE_CURL}")" = "${expected}" ] && echo 0 || echo 1
  )"
}

prepare_case() {
  local password="$1"
  local project="$2"
  local dump_mode="$3"
  local offsite_mode="$4"
  local offsite_key="$5"
  local gzip_mode="$6"
  local ping="$7"

  local work
  work="$(mktemp -d)"
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
      echo pgcontainer
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
      echo "${PROJECT:?}_default"
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
    if ! printf '%s\n' "${joined}" | grep -q -- '-h postgres'; then
      echo "stub docker: pg_dump must use -h postgres" >&2
      exit 99
    fi
    if [ "${PGPASSWORD:-}" != "${BACKUP_STUB_PASSWORD:?}" ]; then
      echo 'pg_dump: error: connection to server at "postgres" (172.18.0.5), port 5432 failed: FATAL: password authentication failed for user "cardhub_backup"' >&2
      exit 1
    fi
    case "${BACKUP_STUB_DUMP:-ok}" in
      block)
        : > "${BACKUP_STUB_MARKER:?}"
        sleep 60
        exit 0
        ;;
      pipefail)
        payload="$(dump_sql)"
        printf '%s' "${payload}"
        bytes="$(printf '%s' "${payload}" | wc -c | awk '{ print $1 }')"
        if [ "${bytes}" -le 1024 ]; then
          echo "stub docker: pipefail dump must exceed 1KB, wrote ${bytes}" >&2
          exit 99
        fi
        echo "pg_dump: write error after partial dump" >&2
        exit 1
        ;;
      ok)
        dump_sql
        exit 0
        ;;
      *)
        echo "stub docker: unknown dump mode ${BACKUP_STUB_DUMP}" >&2
        exit 99
        ;;
    esac
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

  cat > "${work}/bin/curl" << 'EOF'
#!/usr/bin/env bash
set -u
url=""
for arg in "$@"; do
  case "${arg}" in
    -*) ;;
    *) url="${arg}" ;;
  esac
done
printf '%s\n' "${url}" >> "${BACKUP_STUB_CURL:?}"
exit 0
EOF
  chmod 755 "${work}/bin/curl"

  if [ "${gzip_mode}" = "fail" ]; then
    cat > "${work}/bin/gzip" << 'EOF'
#!/usr/bin/env bash
echo "gzip stub: refusing to compress" >&2
exit 1
EOF
    chmod 755 "${work}/bin/gzip"
  fi

  cat > "${work}/app.env" << EOF
ENV_NAME=prod
POSTGRES_USER=cardhub
POSTGRES_PASSWORD=${admin_password}
POSTGRES_DB=cardhub_prod
PGDUMP_USER=cardhub_backup
PGDUMP_PASSWORD=${password}
EOF

  local offsite="${work}/offsite.env"
  case "${offsite_mode}" in
    ok)
      cat > "${offsite}" << EOF
OSS_ACCESS_KEY_ID=oss-access-id
OSS_ACCESS_KEY_SECRET=${oss_secret}
OSS_BUCKET=cardhub-backups
OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com
EOF
      ;;
    missing)
      rm -f "${offsite}"
      ;;
    unreadable)
      cat > "${offsite}" << EOF
OSS_ACCESS_KEY_ID=oss-access-id
OSS_ACCESS_KEY_SECRET=${oss_secret}
OSS_BUCKET=cardhub-backups
OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com
EOF
      chmod 000 "${offsite}"
      ;;
    blank)
      : > "${offsite}"
      ;;
    omit)
      {
        [ "${offsite_key}" = "OSS_ACCESS_KEY_ID" ] || echo "OSS_ACCESS_KEY_ID=oss-access-id"
        [ "${offsite_key}" = "OSS_ACCESS_KEY_SECRET" ] || echo "OSS_ACCESS_KEY_SECRET=${oss_secret}"
        [ "${offsite_key}" = "OSS_BUCKET" ] || echo "OSS_BUCKET=cardhub-backups"
        [ "${offsite_key}" = "OSS_ENDPOINT" ] || echo "OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com"
      } > "${offsite}"
      ;;
    empty)
      {
        if [ "${offsite_key}" = "OSS_ACCESS_KEY_ID" ]; then echo "OSS_ACCESS_KEY_ID="; else echo "OSS_ACCESS_KEY_ID=oss-access-id"; fi
        if [ "${offsite_key}" = "OSS_ACCESS_KEY_SECRET" ]; then echo "OSS_ACCESS_KEY_SECRET="; else echo "OSS_ACCESS_KEY_SECRET=${oss_secret}"; fi
        if [ "${offsite_key}" = "OSS_BUCKET" ]; then echo "OSS_BUCKET="; else echo "OSS_BUCKET=cardhub-backups"; fi
        if [ "${offsite_key}" = "OSS_ENDPOINT" ]; then echo "OSS_ENDPOINT="; else echo "OSS_ENDPOINT=oss-cn-hongkong.aliyuncs.com"; fi
      } > "${offsite}"
      ;;
    *)
      echo "unknown offsite mode ${offsite_mode}" >&2
      exit 99
      ;;
  esac

  cp "${root}/deploy/docker-compose.yml" "${work}/deploy/docker-compose.yml"

  CASE_WORK="${work}"
  CASE_PROJECT="${project}"
  CASE_LOG="${work}/script.log"
  CASE_DOCKER="${work}/docker.log"
  CASE_CURL="${work}/curl.log"
  CASE_UPLOAD="${work}/uploaded"
  CASE_BACKUP_DIR="${work}/backups"
  CASE_MARKER="${work}/dump-started"
  CASE_RC_FILE="${work}/rc"
  CASE_PASSWORD="${password}"
  CASE_OFFSITE="${offsite}"
  CASE_DUMP_MODE="${dump_mode}"
  CASE_PING="${ping}"
  CASE_DUMPED=0
  : > "${CASE_DOCKER}"
  : > "${CASE_CURL}"
}

invoke_backup() {
  local script_rc=0
  local ping_value=""
  if [ "${CASE_PING}" = "1" ]; then
    ping_value="${ping_url}"
  fi
  env \
    PATH="${CASE_WORK}/bin:${PATH}" \
    PROJECT="${CASE_PROJECT}" \
    ENV_FILE="${CASE_WORK}/app.env" \
    COMPOSE_FILE="${CASE_WORK}/deploy/docker-compose.yml" \
    BACKUP_DIR="${CASE_BACKUP_DIR}" \
    OFFSITE_ENV_FILE="${CASE_OFFSITE}" \
    BACKUP_PING_URL="${ping_value}" \
    BACKUP_STUB_LOG="${CASE_DOCKER}" \
    BACKUP_STUB_PASSWORD="${right_password}" \
    BACKUP_STUB_UPLOAD="${CASE_UPLOAD}" \
    BACKUP_STUB_DUMP="${CASE_DUMP_MODE}" \
    BACKUP_STUB_CURL="${CASE_CURL}" \
    BACKUP_STUB_MARKER="${CASE_MARKER}" \
    bash "${backup_script}" > "${CASE_LOG}" 2>&1 || script_rc=$?
  CASE_RC="${script_rc}"
  printf '%s\n' "${script_rc}" > "${CASE_RC_FILE}"
}

invoke_signal() {
  local sig_name="$1"
  (
    export PATH="${CASE_WORK}/bin:${PATH}"
    export PROJECT="${CASE_PROJECT}"
    export ENV_FILE="${CASE_WORK}/app.env"
    export COMPOSE_FILE="${CASE_WORK}/deploy/docker-compose.yml"
    export BACKUP_DIR="${CASE_BACKUP_DIR}"
    export OFFSITE_ENV_FILE="${CASE_OFFSITE}"
    export BACKUP_PING_URL=""
    export BACKUP_STUB_LOG="${CASE_DOCKER}"
    export BACKUP_STUB_PASSWORD="${right_password}"
    export BACKUP_STUB_UPLOAD="${CASE_UPLOAD}"
    export BACKUP_STUB_DUMP="${CASE_DUMP_MODE}"
    export BACKUP_STUB_CURL="${CASE_CURL}"
    export BACKUP_STUB_MARKER="${CASE_MARKER}"
    python3 - "${sig_name}" "${backup_script}" "${CASE_LOG}" "${CASE_MARKER}" "${CASE_RC_FILE}" << 'PY'
import os, signal, subprocess, sys, time

sig_name, script, log_path, marker, rc_path = sys.argv[1:]
sig = signal.SIGTERM if sig_name == "TERM" else signal.SIGINT
log = open(log_path, "w")
proc = subprocess.Popen(
    ["bash", script],
    stdout=log,
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
deadline = time.time() + 15
ready = False
while time.time() < deadline:
    if os.path.exists(marker):
        ready = True
        break
    if proc.poll() is not None:
        break
    time.sleep(0.05)
if not ready:
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait(timeout=5)
    with open(rc_path, "w", encoding="utf-8") as fh:
        fh.write("timeout-before-dump\n")
    raise SystemExit(0)
os.killpg(proc.pid, sig)
try:
    rc = proc.wait(timeout=10)
except subprocess.TimeoutExpired:
    os.killpg(proc.pid, signal.SIGKILL)
    proc.wait(timeout=5)
    with open(rc_path, "w", encoding="utf-8") as fh:
        fh.write("timeout-after-signal\n")
    raise SystemExit(0)
with open(rc_path, "w", encoding="utf-8") as fh:
    fh.write(str(rc) + "\n")
PY
  )
  CASE_RC="$(tr -d '[:space:]' < "${CASE_RC_FILE}")"
}

backup_count() {
  find "${CASE_BACKUP_DIR}" -type f -name '*.sql.gz' | wc -l | awk '{ print $1 }'
}

echo "CASE set -e"
prepare_case "${right_password}" cardhub-prod ok ok "" fail 0
invoke_backup
assert "set -e exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert_fail_line "set -e" command-failed 1
assert "set -e reached gzip" "$(grep -F -q 'gzip stub: refusing to compress' "${CASE_LOG}" && echo 0 || echo 1)"
assert "set -e ran pg_dump" "$(grep -F -q 'pg_dump' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert "set -e writes no backup" "$([ "$(backup_count)" -eq 0 ] && echo 0 || echo 1)"
assert "set -e does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "set -e" ""
assert_no_secret "set -e output" "${CASE_LOG}"

echo "CASE pipefail"
prepare_case "${right_password}" cardhub-prod pipefail ok "" ok 0
invoke_backup
assert "pipefail exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert_fail_line "pipefail" pipefail 1
assert "pipefail saw pg_dump error" "$(grep -F -q 'pg_dump: write error after partial dump' "${CASE_LOG}" && echo 0 || echo 1)"
assert "pipefail is not a size rejection" "$(grep -F -q 'unexpectedly small' "${CASE_LOG}" && echo 1 || echo 0)"
assert "pipefail writes no backup" "$([ "$(backup_count)" -eq 0 ] && echo 0 || echo 1)"
assert "pipefail does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "pipefail" ""
assert_no_secret "pipefail output" "${CASE_LOG}"

echo "CASE TERM"
prepare_case "${right_password}" cardhub-prod block ok "" ok 0
invoke_signal TERM
assert "TERM exits 143" "$([ "${CASE_RC}" = "143" ] && echo 0 || echo 1)"
assert_fail_line "TERM" sigterm 143
assert "TERM writes no backup" "$([ "$(backup_count)" -eq 0 ] && echo 0 || echo 1)"
assert "TERM does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "TERM" ""
assert_no_secret "TERM output" "${CASE_LOG}"

echo "CASE INT"
prepare_case "${right_password}" cardhub-prod block ok "" ok 0
invoke_signal INT
assert "INT exits 130" "$([ "${CASE_RC}" = "130" ] && echo 0 || echo 1)"
assert_fail_line "INT" sigint 130
assert "INT writes no backup" "$([ "$(backup_count)" -eq 0 ] && echo 0 || echo 1)"
assert "INT does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "INT" ""
assert_no_secret "INT output" "${CASE_LOG}"

echo "CASE wrong password"
prepare_case "${wrong_password}" cardhub-prod ok ok "" ok 1
invoke_backup
assert "wrong password exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert_fail_line "wrong password" pipefail 1
assert "wrong password is an auth failure" "$(grep -F -q 'password authentication failed' "${CASE_LOG}" && echo 0 || echo 1)"
assert "wrong password writes no backup" "$([ "$(backup_count)" -eq 0 ] && echo 0 || echo 1)"
assert "wrong password does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "wrong password" "${ping_url}/fail"
assert_no_secret "wrong password output" "${CASE_LOG}"
assert_no_secret "wrong password docker argv" "${CASE_DOCKER}"

echo "CASE missing offsite.env"
prepare_case "${right_password}" cardhub-prod ok missing "" ok 1
invoke_backup
assert "missing offsite.env exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert_fail_line "missing offsite.env" offsite-env-missing 1
assert "missing offsite.env explains why" "$(grep -F -q "Off-site backup env file is missing: ${CASE_OFFSITE}" "${CASE_LOG}" && echo 0 || echo 1)"
assert "missing offsite.env keeps the local dump" "$([ "$(backup_count)" -eq 1 ] && echo 0 || echo 1)"
assert "missing offsite.env dump is gzip" "$(gzip -t "${CASE_BACKUP_DIR}"/*.sql.gz && echo 0 || echo 1)"
assert "missing offsite.env does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "missing offsite.env" "${ping_url}/fail"
assert_no_secret "missing offsite.env output" "${CASE_LOG}"

echo "CASE unreadable offsite.env"
if [ "$(id -u)" -eq 0 ]; then
  echo "FAIL unreadable offsite.env skipped because root can read mode 000" >&2
  failed=1
else
  prepare_case "${right_password}" cardhub-prod ok unreadable "" ok 1
  if [ -r "${CASE_OFFSITE}" ]; then
    echo "FAIL unreadable offsite.env fixture is still readable" >&2
    failed=1
  else
    invoke_backup
    chmod 600 "${CASE_OFFSITE}" || true
    assert "unreadable offsite.env exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
    assert_fail_line "unreadable offsite.env" offsite-env-unreadable 1
    assert "unreadable offsite.env explains why" "$(grep -F -q "Off-site backup env file is unreadable: ${CASE_OFFSITE}" "${CASE_LOG}" && echo 0 || echo 1)"
    assert "unreadable offsite.env keeps the local dump" "$([ "$(backup_count)" -eq 1 ] && echo 0 || echo 1)"
    assert "unreadable offsite.env does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
    assert_curl "unreadable offsite.env" "${ping_url}/fail"
    assert_no_secret "unreadable offsite.env output" "${CASE_LOG}"
    assert_no_secret "unreadable offsite.env docker argv" "${CASE_DOCKER}"
  fi
fi

echo "CASE blank offsite.env"
prepare_case "${right_password}" cardhub-prod ok blank "" ok 1
invoke_backup
assert "blank offsite.env exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert_fail_line "blank offsite.env" missing-OSS_ACCESS_KEY_ID 1
assert "blank offsite.env names the key" "$(grep -F -q 'Off-site backup env file is missing OSS_ACCESS_KEY_ID' "${CASE_LOG}" && echo 0 || echo 1)"
assert "blank offsite.env keeps the local dump" "$([ "$(backup_count)" -eq 1 ] && echo 0 || echo 1)"
assert "blank offsite.env does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert_curl "blank offsite.env" "${ping_url}/fail"
assert_no_secret "blank offsite.env output" "${CASE_LOG}"

for key in OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_BUCKET OSS_ENDPOINT; do
  echo "CASE omit ${key}"
  prepare_case "${right_password}" cardhub-prod ok omit "${key}" ok 1
  invoke_backup
  assert "omit ${key} exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
  assert_fail_line "omit ${key}" "missing-${key}" 1
  assert "omit ${key} names the key" "$(grep -F -q "Off-site backup env file is missing ${key}" "${CASE_LOG}" && echo 0 || echo 1)"
  assert "omit ${key} keeps the local dump" "$([ "$(backup_count)" -eq 1 ] && echo 0 || echo 1)"
  assert "omit ${key} does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
  assert_curl "omit ${key}" "${ping_url}/fail"
  assert_no_secret "omit ${key} output" "${CASE_LOG}"

  echo "CASE empty ${key}"
  prepare_case "${right_password}" cardhub-prod ok empty "${key}" ok 1
  invoke_backup
  assert "empty ${key} exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
  assert_fail_line "empty ${key}" "missing-${key}" 1
  assert "empty ${key} names the key" "$(grep -F -q "Off-site backup env file is missing ${key}" "${CASE_LOG}" && echo 0 || echo 1)"
  assert "empty ${key} keeps the local dump" "$([ "$(backup_count)" -eq 1 ] && echo 0 || echo 1)"
  assert "empty ${key} does not upload" "$([ ! -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
  assert_curl "empty ${key}" "${ping_url}/fail"
  assert_no_secret "empty ${key} output" "${CASE_LOG}"
done

echo "CASE success"
prepare_case "${right_password}" cardhub-prod ok ok "" ok 1
invoke_backup
assert "success exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert_ok_line "success"
assert "success uploads" "$([ -e "${CASE_UPLOAD}" ] && echo 0 || echo 1)"
assert "success keeps one backup" "$([ "$(backup_count)" -eq 1 ] && echo 0 || echo 1)"
assert_curl "success" "${ping_url}"
assert_no_secret "success output" "${CASE_LOG}"
assert_no_secret "success docker argv" "${CASE_DOCKER}"

if [ "${failed}" -ne 0 ]; then
  echo "backup status tests failed" >&2
  exit 1
fi
echo "backup status tests passed"
