#!/usr/bin/env bash
# PASSWORD_PREHASH_WRITE is copied from the GitHub Environment into the
# server env file at deploy time. Unset or blank leaves the file alone.
# true and false replace every assignment of that key in place. An
# `export ` prefix is kept. The key is appended only when it is absent.
# The rewrite must not print other env values.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
workflow="${root}/.github/workflows/deploy.yml"
secret="db-password-should-not-appear"
rejected="rejected-value-should-not-appear"
sha="$(printf 'c%.0s' {1..40})"
tag="sha-${sha}"
failed=0

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
  fi
}

# shellcheck disable=SC1090
source "${deploy_script}"

no_secret() {
  local file="$1"
  if [ -f "${file}" ] && grep -F -q "${secret}" "${file}"; then
    return 1
  fi
  if [ -f "${file}" ] && grep -F -q "${rejected}" "${file}"; then
    return 1
  fi
  return 0
}

capture_apply() {
  local mode="$1"
  local value="$2"
  local file="$3"
  local log="$4"
  local err="$5"
  local rc=0
  if [ "${mode}" = "unset" ]; then
    (
      unset PASSWORD_PREHASH_WRITE
      apply_password_prehash_write "${file}"
    ) >"${log}" 2>"${err}" || rc=$?
  else
    (
      PASSWORD_PREHASH_WRITE="${value}" apply_password_prehash_write "${file}"
    ) >"${log}" 2>"${err}" || rc=$?
  fi
  printf '%s\n' "${rc}"
}

new_file() {
  local file="$1"
  local body="$2"
  local mode="$3"
  mkdir -p "$(dirname "${file}")"
  printf '%s\n' "${body}" > "${file}"
  chmod "${mode}" "${file}"
}

work="$(mktemp -d)"
log="${work}/stdout"
err="${work}/stderr"

base_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "" \
  "# PASSWORD_PREHASH_WRITE=true" \
  "PASSWORD_PREHASH_WRITE=false" \
  "PASSWORD_PREHASH_WRITE_EXTRA=keep-me" \
  )"

file="${work}/staging.env"
new_file "${file}" "${base_body}" 640
before_inode="$(stat -c %i "${file}")"
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
assert "replace false with true exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "" \
  "# PASSWORD_PREHASH_WRITE=true" \
  "PASSWORD_PREHASH_WRITE=true" \
  "PASSWORD_PREHASH_WRITE_EXTRA=keep-me" \
  )"
assert "replace keeps every other line" "$(printf '%s\n' "${golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "replace logs only the flag" "$(cmp -s <(printf '%s\n' 'PASSWORD_PREHASH_WRITE=true') "${log}" && echo 0 || echo 1)"
assert "replace stderr is empty" "$([ ! -s "${err}" ] && echo 0 || echo 1)"
assert "replace does not print the secret" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"
assert "replace keeps mode 640" "$([ "$(stat -c %a "${file}")" = "640" ] && echo 0 || echo 1)"
assert "replace leaves no temp file" "$([ -z "$(find "${work}" -name '*.tmp.*' -print)" ] && echo 0 || echo 1)"
assert "replace changes inode" "$([ "$(stat -c %i "${file}")" != "${before_inode}" ] && echo 0 || echo 1)"

same_inode="$(stat -c %i "${file}")"
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
assert "second write exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "second write keeps bytes" "$(printf '%s\n' "${golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "second write is silent" "$([ ! -s "${log}" ] && [ ! -s "${err}" ] && echo 0 || echo 1)"
assert "second write keeps inode" "$([ "$(stat -c %i "${file}")" = "${same_inode}" ] && echo 0 || echo 1)"

leave_alone() {
  local label="$1"
  local mode="$2"
  local value="$3"
  new_file "${file}" "${base_body}" 600
  local inode
  inode="$(stat -c %i "${file}")"
  local rc
  rc="$(capture_apply "${mode}" "${value}" "${file}" "${log}" "${err}")"
  assert "${label} exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
  assert "${label} keeps bytes" "$(printf '%s\n' "${base_body}" | cmp -s - "${file}" && echo 0 || echo 1)"
  assert "${label} keeps inode" "$([ "$(stat -c %i "${file}")" = "${inode}" ] && echo 0 || echo 1)"
  assert "${label} is silent" "$([ ! -s "${log}" ] && [ ! -s "${err}" ] && echo 0 || echo 1)"
}

leave_alone "unset" unset ""
leave_alone "empty" set ""
leave_alone "blank" set "   "
leave_alone "tab" set "$(printf '\t')"

missing_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "# PASSWORD_PREHASH_WRITE=false" \
  "NOT_A_KEY" \
  )"
new_file "${file}" "${missing_body}" 600
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
appended="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "# PASSWORD_PREHASH_WRITE=false" \
  "NOT_A_KEY" \
  "PASSWORD_PREHASH_WRITE=true" \
  )"
assert "append exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "append adds one key" "$(printf '%s\n' "${appended}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "append does not print the secret" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
assert "append twice stays one key" "$(printf '%s\n' "${appended}" | cmp -s - "${file}" && [ "${rc}" -eq 0 ] && echo 0 || echo 1)"

dup_body="$(printf '%s\n' \
  "PASSWORD_PREHASH_WRITE=false" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "PASSWORD_PREHASH_WRITE=true" \
  )"
new_file "${file}" "${dup_body}" 600
rc="$(capture_apply set false "${file}" "${log}" "${err}")"
dup_golden="$(printf '%s\n' \
  "PASSWORD_PREHASH_WRITE=false" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "PASSWORD_PREHASH_WRITE=false" \
  )"
assert "both assignments become false" "$([ "${rc}" -eq 0 ] && printf '%s\n' "${dup_golden}" | cmp -s - "${file}" && echo 0 || echo 1)"

spaced_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "  PASSWORD_PREHASH_WRITE = \"false\"" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
new_file "${file}" "${spaced_body}" 600
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
spaced_golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "PASSWORD_PREHASH_WRITE=true" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
assert "spaced or quoted key is replaced" "$([ "${rc}" -eq 0 ] && printf '%s\n' "${spaced_golden}" | cmp -s - "${file}" && echo 0 || echo 1)"

# Plain assignments are replaced in place, `export KEY=...` keeps its prefix
# and is not duplicated at the end, and a missing key is appended once.
plain_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "PASSWORD_PREHASH_WRITE=false" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
new_file "${file}" "${plain_body}" 600
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
plain_golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "PASSWORD_PREHASH_WRITE=true" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
assert "plain line is replaced in place" "$([ "${rc}" -eq 0 ] && printf '%s\n' "${plain_golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "plain line is not duplicated" "$([ "$(grep -c '^PASSWORD_PREHASH_WRITE=' "${file}")" -eq 1 ] && echo 0 || echo 1)"

export_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "# keep the comment" \
  "export PASSWORD_PREHASH_WRITE=false" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
new_file "${file}" "${export_body}" 600
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
export_golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "# keep the comment" \
  "export PASSWORD_PREHASH_WRITE=true" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
assert "export line is replaced in place" "$([ "${rc}" -eq 0 ] && printf '%s\n' "${export_golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "export prefix is kept" "$(grep -qx 'export PASSWORD_PREHASH_WRITE=true' "${file}" && echo 0 || echo 1)"
assert "export line is not appended" "$([ "$(grep -c 'PASSWORD_PREHASH_WRITE=' "${file}")" -eq 1 ] && echo 0 || echo 1)"
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
assert "export line stays one assignment" "$([ "${rc}" -eq 0 ] && printf '%s\n' "${export_golden}" | cmp -s - "${file}" && echo 0 || echo 1)"

absent_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
new_file "${file}" "${absent_body}" 600
rc="$(capture_apply set false "${file}" "${log}" "${err}")"
absent_golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "PASSWORD_PREHASH_WRITE=false" \
  )"
assert "missing key is appended" "$([ "${rc}" -eq 0 ] && printf '%s\n' "${absent_golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "missing key append has no export prefix" "$(
  grep -qx 'PASSWORD_PREHASH_WRITE=false' "${file}" \
    && ! grep -q '^export PASSWORD_PREHASH_WRITE=' "${file}" \
    && echo 0 || echo 1
)"

printf 'ENV_NAME=staging\r\nPASSWORD_PREHASH_WRITE=false\r\nDATABASE_URL=postgresql://cardhub:%s@postgres/db\r\n' "${secret}" > "${file}"
chmod 600 "${file}"
rc="$(capture_apply set true "${file}" "${log}" "${err}")"
assert "crlf replace exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "crlf keeps one assignment" "$([ "$(grep -c '^PASSWORD_PREHASH_WRITE=' "${file}")" -eq 1 ] && echo 0 || echo 1)"
assert "crlf assignment is true" "$(grep -qx 'PASSWORD_PREHASH_WRITE=true' "${file}" && echo 0 || echo 1)"
assert "crlf keeps the secret line" "$(grep -F -q "DATABASE_URL=postgresql://cardhub:${secret}@postgres/db" "${file}" && echo 0 || echo 1)"

new_file "${file}" "${base_body}" 600
inode="$(stat -c %i "${file}")"
rc="$(capture_apply set $'true\nINJECTED=1' "${file}" "${log}" "${err}")"
assert "injected value exits 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
assert "injected value does not write" "$(printf '%s\n' "${base_body}" | cmp -s - "${file}" && [ "$(stat -c %i "${file}")" = "${inode}" ] && echo 0 || echo 1)"
assert "injected value is not printed" "$(
  ! grep -F -q 'INJECTED' "${log}" && ! grep -F -q 'INJECTED' "${err}" && no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1
)"
assert "injected value explains the rule" "$(grep -F -q 'must be the exact string true or false' "${err}" && echo 0 || echo 1)"

new_file "${file}" "${base_body}" 600
rc="$(capture_apply set " ${rejected} " "${file}" "${log}" "${err}")"
assert "rejected value exits 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
assert "rejected value is not printed" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"
assert "rejected value does not write" "$(printf '%s\n' "${base_body}" | cmp -s - "${file}" && echo 0 || echo 1)"

rc="$(capture_apply set ' true ' "${file}" "${log}" "${err}")"
assert "padded true is written" "$([ "${rc}" -eq 0 ] && grep -qx 'PASSWORD_PREHASH_WRITE=true' "${file}" && echo 0 || echo 1)"
assert "padded true does not print the secret" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"

# Full script: the key is written after ENV_NAME matches, even when a later
# docker call fails, and the other env file is not touched.
run_main() {
  local environment="$1"
  local prehash_mode="$2"
  local prehash_value="$3"
  local rc=0
  local bin="${work}/bin"
  mkdir -p "${bin}" "${work}/root/staging/deploy" "${work}/root/production/deploy"
  cat > "${bin}/docker" << 'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "${DOCKER_LOG:?}"
if [ "${1:-}" = "network" ]; then
  exit 0
fi
echo "unexpected docker $*" >&2
exit 1
EOF
  chmod 755 "${bin}/docker"
  : > "${work}/docker.log"
  : > "${log}"
  : > "${err}"
  if [ "${prehash_mode}" = "unset" ]; then
    env -u PASSWORD_PREHASH_WRITE \
      PATH="${bin}:${PATH}" \
      CARDHUB_ROOT="${work}/root" \
      DOCKER_LOG="${work}/docker.log" \
      bash "${deploy_script}" "${environment}" "${tag}" "${sha}" >"${log}" 2>"${err}" || rc=$?
  else
    env \
      PATH="${bin}:${PATH}" \
      CARDHUB_ROOT="${work}/root" \
      DOCKER_LOG="${work}/docker.log" \
      PASSWORD_PREHASH_WRITE="${prehash_value}" \
      bash "${deploy_script}" "${environment}" "${tag}" "${sha}" >"${log}" 2>"${err}" || rc=$?
  fi
  printf '%s\n' "${rc}"
}

new_file "${work}/root/staging/staging.env" "${base_body}" 600
prod_body="$(printf '%s\n' "ENV_NAME=prod" "PASSWORD_PREHASH_WRITE=false" "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_prod")"
new_file "${work}/root/production/production.env" "${prod_body}" 600
prod_before="$(cat "${work}/root/production/production.env")"
rc="$(run_main staging set true)"
assert "main staging exits after the flag write" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "main staging writes true" "$(grep -qx 'PASSWORD_PREHASH_WRITE=true' "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main staging keeps the secret line" "$(grep -F -q "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main staging does not start containers" "$(grep -q 'Starting api' "${log}" && echo 1 || echo 0)"
assert "main staging does not print the secret" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"
assert "main staging logs the flag" "$(grep -qx 'PASSWORD_PREHASH_WRITE=true' "${log}" && echo 0 || echo 1)"
assert "main staging leaves production.env" "$(printf '%s\n' "${prod_before}" | cmp -s - "${work}/root/production/production.env" && echo 0 || echo 1)"

new_file "${work}/root/staging/staging.env" "${base_body}" 600
rc="$(run_main staging set "${rejected}")"
assert "main rejects a bad value with 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
assert "main bad value does not write" "$(printf '%s\n' "${base_body}" | cmp -s - "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main bad value is not printed" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"
assert "main bad value stops before compose" "$(
  [ "$(grep -c . "${work}/docker.log")" -eq 1 ] && grep -q '^network ' "${work}/docker.log" && echo 0 || echo 1
)"

new_file "${work}/root/staging/staging.env" "${base_body}" 600
rc="$(run_main staging unset "")"
assert "main unset does not rewrite" "$(printf '%s\n' "${base_body}" | cmp -s - "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main unset does not log a rewrite" "$(grep -q 'PASSWORD_PREHASH_WRITE=' "${log}" && echo 1 || echo 0)"
assert "main unset does not print the secret" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"

mismatch="$(printf '%s\n' "ENV_NAME=prod" "PASSWORD_PREHASH_WRITE=false" "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging")"
new_file "${work}/root/staging/staging.env" "${mismatch}" 600
rc="$(run_main staging set true)"
assert "main ENV_NAME mismatch exits 1" "$([ "${rc}" -eq 1 ] && echo 0 || echo 1)"
assert "main ENV_NAME mismatch does not write" "$(printf '%s\n' "${mismatch}" | cmp -s - "${work}/root/staging/staging.env" && echo 0 || echo 1)"

prod_true="$(printf '%s\n' "ENV_NAME=prod" "PASSWORD_PREHASH_WRITE=true" "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_prod")"
new_file "${work}/root/production/production.env" "${prod_true}" 600
rc="$(run_main production set false)"
assert "main production writes false" "$(
  [ "${rc}" -ne 0 ] \
    && grep -qx 'PASSWORD_PREHASH_WRITE=false' "${work}/root/production/production.env" \
    && ! grep -qx 'PASSWORD_PREHASH_WRITE=true' "${work}/root/production/production.env" \
    && echo 0 || echo 1
)"
assert "main production keeps its secret" "$(grep -F -q "${secret}" "${work}/root/production/production.env" && no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"

# The workflow step is what forwards vars.PASSWORD_PREHASH_WRITE.
deploy_job="$(awk '
  /^  deploy:$/ { in_job = 1; next }
  in_job && /^  [^ ]/ { exit }
  in_job { print }
' "${workflow}")"
edge_job="$(awk '
  /^  edge:$/ { in_job = 1; next }
  in_job && /^  [^ ]/ { exit }
  in_job { print }
' "${workflow}")"
assert "deploy job reads the GitHub variable" "$(printf '%s\n' "${deploy_job}" | grep -F -q 'PASSWORD_PREHASH_WRITE: ${{ vars.PASSWORD_PREHASH_WRITE }}' && echo 0 || echo 1)"
assert "edge job does not read the variable" "$(printf '%s\n' "${edge_job}" | grep -F -q 'PASSWORD_PREHASH_WRITE' && echo 1 || echo 0)"
assert "deploy step does not echo the variable" "$(
  printf '%s\n' "${deploy_job}" | grep -E -q 'echo[[:space:]].*(\$\{?(PASSWORD_PREHASH_WRITE|prehash)\}?|vars\.PASSWORD_PREHASH_WRITE)' && echo 1 || echo 0
)"

extracted="${work}/deploy-on-vps.sh"
awk '
  /^      - name: Deploy on VPS$/ { in_step = 1; next }
  in_step && /^      - name: / { exit }
  in_step && /^  [^ ]/ { exit }
  in_step && /^        run: \|/ { in_run = 1; next }
  in_run && /^          / { print substr($0, 11); next }
  in_run && /^[[:space:]]*$/ { print ""; next }
  in_run { exit }
' "${workflow}" > "${extracted}"
assert "extracted deploy step calls normalize" "$(grep -F -q 'normalize_password_prehash_write' "${extracted}" && echo 0 || echo 1)"
assert "extracted deploy step prefixes ssh" "$(grep -F -q '${prehash_prefix}bash' "${extracted}" && echo 0 || echo 1)"

mkdir -p "${work}/sshbin"
cat > "${work}/sshbin/ssh" << 'EOF'
#!/bin/sh
printf '%s\n' "$*" > "${SSH_LOG:?}"
exit 0
EOF
chmod 755 "${work}/sshbin/ssh"

run_workflow() {
  local mode="$1"
  local value="$2"
  local rc=0
  : > "${log}"
  : > "${err}"
  rm -f "${work}/ssh.log"
  if [ "${mode}" = "unset" ]; then
    (
      cd "${root}"
      env -u PASSWORD_PREHASH_WRITE \
        PATH="${work}/sshbin:${PATH}" \
        DEPLOY_USER=deploy \
        DEPLOY_HOST=example.test \
        DEPLOY_ENVIRONMENT=staging \
        DEPLOY_IMAGE_TAG="${tag}" \
        DEPLOY_EXPECTED_SHA="${sha}" \
        SSH_LOG="${work}/ssh.log" \
        bash "${extracted}"
    ) >"${log}" 2>"${err}" || rc=$?
  else
    (
      cd "${root}"
      env \
        PATH="${work}/sshbin:${PATH}" \
        DEPLOY_USER=deploy \
        DEPLOY_HOST=example.test \
        DEPLOY_ENVIRONMENT=staging \
        DEPLOY_IMAGE_TAG="${tag}" \
        DEPLOY_EXPECTED_SHA="${sha}" \
        SSH_LOG="${work}/ssh.log" \
        PASSWORD_PREHASH_WRITE="${value}" \
        bash "${extracted}"
    ) >"${log}" 2>"${err}" || rc=$?
  fi
  printf '%s\n' "${rc}"
}

remote_cmd="bash /opt/cardhub/staging/deploy/remote-deploy.sh staging ${tag} ${sha}"
rc="$(run_workflow set true)"
assert "workflow true exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "workflow true forwards the flag" "$(grep -F -q "PASSWORD_PREHASH_WRITE=true ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1)"
assert "workflow true keeps strict host checking" "$(grep -F -q 'StrictHostKeyChecking=yes' "${work}/ssh.log" && echo 0 || echo 1)"

rc="$(run_workflow set false)"
assert "workflow false forwards false" "$([ "${rc}" -eq 0 ] && grep -F -q "PASSWORD_PREHASH_WRITE=false ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1)"

rc="$(run_workflow set ' true ')"
assert "workflow trims true" "$([ "${rc}" -eq 0 ] && grep -F -q "PASSWORD_PREHASH_WRITE=true ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1)"

rc="$(run_workflow unset "")"
assert "workflow unset exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "workflow unset omits the flag" "$(grep -F -q "${remote_cmd}" "${work}/ssh.log" && ! grep -F -q 'PASSWORD_PREHASH_WRITE=' "${work}/ssh.log" && echo 0 || echo 1)"

rc="$(run_workflow set '   ')"
assert "workflow blank omits the flag" "$([ "${rc}" -eq 0 ] && grep -F -q "${remote_cmd}" "${work}/ssh.log" && ! grep -F -q 'PASSWORD_PREHASH_WRITE=' "${work}/ssh.log" && echo 0 || echo 1)"

rc="$(run_workflow set "${rejected}")"
assert "workflow rejects a bad value" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "workflow bad value does not ssh" "$([ ! -e "${work}/ssh.log" ] && echo 0 || echo 1)"
assert "workflow bad value is not printed" "$(no_secret "${log}" && no_secret "${err}" && echo 0 || echo 1)"

apply_line="$(grep -n 'apply_password_prehash_write "${env_file}"' "${deploy_script}" | head -n 1 | cut -d: -f1)"
armed_line="$(grep -n 'rollback_armed=1' "${deploy_script}" | head -n 1 | cut -d: -f1)"
up_line="$(grep -n 'compose up -d postgres redis' "${deploy_script}" | head -n 1 | cut -d: -f1)"
assert "flag write is before containers change" "$(
  [ -n "${apply_line}" ] && [ -n "${armed_line}" ] && [ -n "${up_line}" ] \
    && [ "${apply_line}" -lt "${armed_line}" ] && [ "${apply_line}" -lt "${up_line}" ] \
    && echo 0 || echo 1
)"

if [ "${failed}" -ne 0 ]; then
  echo "password prehash env tests failed" >&2
  exit 1
fi
echo "password prehash env tests passed"
