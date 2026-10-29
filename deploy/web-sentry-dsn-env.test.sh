#!/usr/bin/env bash
# WEB_SENTRY_DSN is copied from the GitHub Environment secret into the
# server env file at deploy time. Unset or blank leaves the file alone.
# An http(s) URL replaces every assignment of that key, including an
# export prefix, or appends one. The value is never printed.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
workflow="${root}/.github/workflows/deploy.yml"
secret="db-password-should-not-appear"
rejected="rejected-dsn-should-not-appear"
old_dsn="https://old.example/1"
new_dsn="https://public@example.ingest.sentry.io/123"
sha="$(printf 'c%.0s' {1..40})"
tag="sha-${sha}"
failed=0

unset WEB_SENTRY_DSN || true
unset PASSWORD_PREHASH_WRITE || true

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

no_leak() {
  local file="$1"
  if [ -f "${file}" ] && grep -F -q -e "${secret}" -e "${rejected}" -e "${new_dsn}" -e "${old_dsn}" "${file}"; then
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
      unset WEB_SENTRY_DSN
      apply_web_sentry_dsn "${file}"
    ) >"${log}" 2>"${err}" || rc=$?
  else
    (
      WEB_SENTRY_DSN="${value}" apply_web_sentry_dsn "${file}"
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
  "# WEB_SENTRY_DSN=${old_dsn}" \
  "WEB_SENTRY_DSN=${old_dsn}" \
  "WEB_SENTRY_DSN_EXTRA=keep-me" \
  )"
golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "" \
  "# WEB_SENTRY_DSN=${old_dsn}" \
  "WEB_SENTRY_DSN=${new_dsn}" \
  "WEB_SENTRY_DSN_EXTRA=keep-me" \
  )"

file="${work}/staging.env"
new_file "${file}" "${base_body}" 600
chgrp "$(id -g)" "${file}"
extra_gid="$(id -G | tr ' ' '\n' | awk -v primary="$(id -g)" '$0 != primary { print; exit }')"
if [ -n "${extra_gid}" ]; then
  chgrp "${extra_gid}" "${file}"
fi
owner_before="$(stat -c '%u:%g' "${file}")"
before_inode="$(stat -c %i "${file}")"
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "replace exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "replace keeps every other line" "$(printf '%s\n' "${golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "replace stdout is empty" "$([ ! -s "${log}" ] && echo 0 || echo 1)"
assert "replace stderr is empty" "$([ ! -s "${err}" ] && echo 0 || echo 1)"
assert "replace does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
assert "replace keeps mode 600" "$([ "$(stat -c %a "${file}")" = "600" ] && echo 0 || echo 1)"
assert "replace keeps owner" "$([ "$(stat -c '%u:%g' "${file}")" = "${owner_before}" ] && echo 0 || echo 1)"
assert "replace leaves no temp file" "$([ -z "$(find "${work}" -name '*.tmp.*' -print)" ] && echo 0 || echo 1)"
assert "replace changes inode" "$([ "$(stat -c %i "${file}")" != "${before_inode}" ] && echo 0 || echo 1)"

same_inode="$(stat -c %i "${file}")"
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "second write exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "second write keeps bytes" "$(printf '%s\n' "${golden}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "second write is silent" "$([ ! -s "${log}" ] && [ ! -s "${err}" ] && echo 0 || echo 1)"
assert "second write keeps inode" "$([ "$(stat -c %i "${file}")" = "${same_inode}" ] && echo 0 || echo 1)"
assert "second write keeps mode 600" "$([ "$(stat -c %a "${file}")" = "600" ] && echo 0 || echo 1)"

new_file "${file}" "${base_body}" 640
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "replace keeps mode 640" "$([ "${rc}" -eq 0 ] && [ "$(stat -c %a "${file}")" = "640" ] && echo 0 || echo 1)"

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
  assert "${label} does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
}

leave_alone "unset" unset ""
leave_alone "empty" set ""
leave_alone "blank" set "   "
leave_alone "trailing newline only" set $'\n'

export_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "export WEB_SENTRY_DSN_EXTRA=keep-me" \
  "export WEB_SENTRY_DSN=${old_dsn}" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
export_golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "export WEB_SENTRY_DSN_EXTRA=keep-me" \
  "WEB_SENTRY_DSN=${new_dsn}" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
new_file "${file}" "${export_body}" 600
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "export prefix is replaced in place" "$(
  [ "${rc}" -eq 0 ] && printf '%s\n' "${export_golden}" | cmp -s - "${file}" && echo 0 || echo 1
)"
assert "export prefix does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
assert "export prefix keeps mode 600" "$([ "$(stat -c %a "${file}")" = "600" ] && echo 0 || echo 1)"

spaced_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "  export WEB_SENTRY_DSN = \"${old_dsn}\"" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
spaced_golden="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "WEB_SENTRY_DSN=${new_dsn}" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  )"
new_file "${file}" "${spaced_body}" 600
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "spaced export prefix is replaced" "$(
  [ "${rc}" -eq 0 ] && printf '%s\n' "${spaced_golden}" | cmp -s - "${file}" && echo 0 || echo 1
)"

missing_body="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "# WEB_SENTRY_DSN=${old_dsn}" \
  "NOT_A_KEY" \
  )"
appended="$(printf '%s\n' \
  "ENV_NAME=staging" \
  "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" \
  "# WEB_SENTRY_DSN=${old_dsn}" \
  "NOT_A_KEY" \
  "WEB_SENTRY_DSN=${new_dsn}" \
  )"
new_file "${file}" "${missing_body}" 600
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "append exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "append adds one key" "$(printf '%s\n' "${appended}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "append does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
assert "append keeps mode 600" "$([ "$(stat -c %a "${file}")" = "600" ] && echo 0 || echo 1)"
rc="$(capture_apply set "${new_dsn}" "${file}" "${log}" "${err}")"
assert "append twice stays one key" "$(printf '%s\n' "${appended}" | cmp -s - "${file}" && [ "${rc}" -eq 0 ] && echo 0 || echo 1)"

http_dsn="http://127.0.0.1:9000/2"
new_file "${file}" "${missing_body}" 600
rc="$(capture_apply set "${http_dsn}" "${file}" "${log}" "${err}")"
assert "http URL is appended" "$(
  [ "${rc}" -eq 0 ] && grep -qx "WEB_SENTRY_DSN=${http_dsn}" "${file}" && echo 0 || echo 1
)"
assert "http URL is not printed" "$(
  ! grep -F -q "${http_dsn}" "${log}" && ! grep -F -q "${http_dsn}" "${err}" && echo 0 || echo 1
)"

reject_value() {
  local label="$1"
  local value="$2"
  new_file "${file}" "${base_body}" 600
  local inode
  inode="$(stat -c %i "${file}")"
  local rc
  rc="$(capture_apply set "${value}" "${file}" "${log}" "${err}")"
  assert "${label} exits 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
  assert "${label} does not write" "$(
    printf '%s\n' "${base_body}" | cmp -s - "${file}" && [ "$(stat -c %i "${file}")" = "${inode}" ] && echo 0 || echo 1
  )"
  assert "${label} is not printed" "$(
    ! grep -F -q "${rejected}" "${log}" && ! grep -F -q "${rejected}" "${err}" \
      && ! grep -F -q "${value}" "${log}" && ! grep -F -q "${value}" "${err}" \
      && echo 0 || echo 1
  )"
  assert "${label} explains the rule" "$(grep -F -q 'must be an http or https URL' "${err}" && echo 0 || echo 1)"
}

reject_value "invalid token" "${rejected}"
reject_value "javascript URL" "javascript:${rejected}"
reject_value "quote breakout" "https://example.com/${rejected}\""
reject_value "dollar substitution" "https://example.com/\$${rejected}"

new_file "${file}" "${base_body}" 600
rc="$(capture_apply set $'https://example.com/1\n'"${rejected}" "${file}" "${log}" "${err}")"
assert "embedded newline exits 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
assert "embedded newline does not write" "$(printf '%s\n' "${base_body}" | cmp -s - "${file}" && echo 0 || echo 1)"
assert "embedded newline is not printed" "$(
  ! grep -F -q "${rejected}" "${log}" && ! grep -F -q "${rejected}" "${err}" && echo 0 || echo 1
)"

new_file "${file}" "${base_body}" 600
rc="$(capture_apply set "${new_dsn}"$'\n' "${file}" "${log}" "${err}")"
assert "trailing newline is trimmed" "$(
  [ "${rc}" -eq 0 ] && printf '%s\n' "${golden}" | cmp -s - "${file}" && echo 0 || echo 1
)"
assert "trailing newline is not printed" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"

# Full script: the key is written after ENV_NAME matches, even when a later
# docker call fails, and the other env file is not touched.
run_main() {
  local environment="$1"
  local dsn_mode="$2"
  local dsn_value="$3"
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
  if [ "${dsn_mode}" = "unset" ]; then
    env -u WEB_SENTRY_DSN -u PASSWORD_PREHASH_WRITE \
      PATH="${bin}:${PATH}" \
      CARDHUB_ROOT="${work}/root" \
      DOCKER_LOG="${work}/docker.log" \
      bash "${deploy_script}" "${environment}" "${tag}" "${sha}" >"${log}" 2>"${err}" || rc=$?
  else
    env -u PASSWORD_PREHASH_WRITE \
      PATH="${bin}:${PATH}" \
      CARDHUB_ROOT="${work}/root" \
      DOCKER_LOG="${work}/docker.log" \
      WEB_SENTRY_DSN="${dsn_value}" \
      bash "${deploy_script}" "${environment}" "${tag}" "${sha}" >"${log}" 2>"${err}" || rc=$?
  fi
  printf '%s\n' "${rc}"
}

new_file "${work}/root/staging/staging.env" "${base_body}" 600
prod_body="$(printf '%s\n' "ENV_NAME=prod" "WEB_SENTRY_DSN=${old_dsn}" "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_prod")"
new_file "${work}/root/production/production.env" "${prod_body}" 600
prod_before="$(cat "${work}/root/production/production.env")"
rc="$(run_main staging set "${new_dsn}")"
assert "main staging exits after the DSN write" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "main staging writes the DSN" "$(grep -qx "WEB_SENTRY_DSN=${new_dsn}" "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main staging keeps the secret line" "$(grep -F -q "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_staging" "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main staging does not start containers" "$(grep -q 'Starting api' "${log}" && echo 1 || echo 0)"
assert "main staging does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
assert "main staging leaves production.env" "$(printf '%s\n' "${prod_before}" | cmp -s - "${work}/root/production/production.env" && echo 0 || echo 1)"

new_file "${work}/root/staging/staging.env" "${base_body}" 600
rc="$(run_main staging set "${rejected}")"
assert "main rejects a bad URL with 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
assert "main bad URL does not write" "$(printf '%s\n' "${base_body}" | cmp -s - "${work}/root/staging/staging.env" && echo 0 || echo 1)"
assert "main bad URL is not printed" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
assert "main bad URL stops before compose" "$(
  [ "$(grep -c . "${work}/docker.log")" -eq 1 ] && grep -q '^network ' "${work}/docker.log" && echo 0 || echo 1
)"

new_file "${work}/root/staging/staging.env" "${base_body}" 600
rc="$(run_main staging unset "")"
assert "main unset does not rewrite the DSN line" "$(
  grep -qx "WEB_SENTRY_DSN=${old_dsn}" "${work}/root/staging/staging.env" \
    && grep -qx 'CATALOG_CACHE_HEADER=false' "${work}/root/staging/staging.env" \
    && echo 0 || echo 1
)"
assert "main unset does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"

prod_new="$(printf '%s\n' "ENV_NAME=prod" "WEB_SENTRY_DSN=${new_dsn}" "DATABASE_URL=postgresql://cardhub:${secret}@postgres:5432/cardhub_prod" "CATALOG_CACHE_HEADER=false")"
new_file "${work}/root/production/production.env" "${prod_body}" 600
rc="$(run_main production set "${new_dsn}")"
assert "main production writes the DSN" "$(
  [ "${rc}" -ne 0 ] && printf '%s\n' "${prod_new}" | cmp -s - "${work}/root/production/production.env" && echo 0 || echo 1
)"
assert "main production does not print the DSN" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"

# The workflow step forwards secrets.WEB_SENTRY_DSN for whichever environment
# the deploy job is running: manual staging, manual production, or the
# staging auto-deploy after CI.
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
assert "deploy job reads the environment secret" "$(
  printf '%s\n' "${deploy_job}" | grep -F -q 'WEB_SENTRY_DSN: ${{ secrets.WEB_SENTRY_DSN }}' && echo 0 || echo 1
)"
assert "deploy job uses the selected environment" "$(
  awk '
    /^  deploy:$/ { in_job = 1; next }
    in_job && /^    environment:/ { print; exit }
    in_job && /^  [^ ]/ { exit }
  ' "${workflow}" | grep -F -q 'environment: ${{ needs.edge.outputs.environment }}' && echo 0 || echo 1
)"
assert "auto-deploy selects the staging environment" "$(
  grep -F -q "environment: \${{ github.event_name == 'workflow_run' && 'staging' || inputs.environment }}" "${workflow}" && echo 0 || echo 1
)"
assert "edge job does not read the DSN" "$(printf '%s\n' "${edge_job}" | grep -F -q 'WEB_SENTRY_DSN' && echo 1 || echo 0)"
assert "deploy step does not echo the secret" "$(
  printf '%s\n' "${deploy_job}" | grep -E -q 'echo[[:space:]].*(\$\{?(WEB_SENTRY_DSN|dsn|dsn_quoted)\}?|secrets\.WEB_SENTRY_DSN)' && echo 1 || echo 0
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
assert "extracted deploy step calls normalize" "$(grep -F -q 'normalize_web_sentry_dsn' "${extracted}" && echo 0 || echo 1)"
assert "extracted deploy step masks the value" "$(grep -F -q '::add-mask::' "${extracted}" && echo 0 || echo 1)"
assert "extracted deploy step prefixes ssh" "$(grep -F -q '${cache_header_prefix}${dsn_prefix}${prehash_prefix}bash' "${extracted}" && echo 0 || echo 1)"

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
      env -u WEB_SENTRY_DSN -u PASSWORD_PREHASH_WRITE \
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
      env -u PASSWORD_PREHASH_WRITE \
        PATH="${work}/sshbin:${PATH}" \
        DEPLOY_USER=deploy \
        DEPLOY_HOST=example.test \
        DEPLOY_ENVIRONMENT=staging \
        DEPLOY_IMAGE_TAG="${tag}" \
        DEPLOY_EXPECTED_SHA="${sha}" \
        SSH_LOG="${work}/ssh.log" \
        WEB_SENTRY_DSN="${value}" \
        bash "${extracted}"
    ) >"${log}" 2>"${err}" || rc=$?
  fi
  printf '%s\n' "${rc}"
}

remote_cmd="bash /opt/cardhub/staging/deploy/remote-deploy.sh staging ${tag} ${sha}"
rc="$(run_workflow set "${new_dsn}")"
assert "workflow URL exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "workflow URL stdout is only the mask" "$(printf '%s\n' "::add-mask::${new_dsn}" | cmp -s - "${log}" && echo 0 || echo 1)"
assert "workflow URL stderr is empty" "$([ ! -s "${err}" ] && echo 0 || echo 1)"
assert "workflow URL forwards the secret" "$(grep -F -q "WEB_SENTRY_DSN=${new_dsn} ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1)"
assert "workflow URL keeps strict host checking" "$(grep -F -q 'StrictHostKeyChecking=yes' "${work}/ssh.log" && echo 0 || echo 1)"

rc="$(run_workflow set "${new_dsn}"$'\n')"
assert "workflow trims a trailing newline" "$(
  [ "${rc}" -eq 0 ] \
    && printf '%s\n' "::add-mask::${new_dsn}" | cmp -s - "${log}" \
    && grep -F -q "WEB_SENTRY_DSN=${new_dsn} ${remote_cmd}" "${work}/ssh.log" \
    && echo 0 || echo 1
)"

amp_dsn="https://example.com/a&b=1"
printf -v amp_quoted '%q' "${amp_dsn}"
rc="$(run_workflow set "${amp_dsn}")"
assert "workflow quotes shell metacharacters" "$(
  [ "${rc}" -eq 0 ] \
    && printf '%s\n' "::add-mask::${amp_dsn}" "::add-mask::${amp_quoted}" | cmp -s - "${log}" \
    && grep -F -q "WEB_SENTRY_DSN=${amp_quoted} ${remote_cmd}" "${work}/ssh.log" \
    && [ ! -s "${err}" ] \
    && echo 0 || echo 1
)"
assert "workflow quoted assignment round-trips" "$(
  env -u WEB_SENTRY_DSN bash -c "eval \"WEB_SENTRY_DSN=${amp_quoted}\"; printf '%s' \"\$WEB_SENTRY_DSN\"" | cmp -s - <(printf '%s' "${amp_dsn}") && echo 0 || echo 1
)"

rc="$(run_workflow unset "")"
assert "workflow unset exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "workflow unset omits the secret" "$(
  grep -F -q "${remote_cmd}" "${work}/ssh.log" && ! grep -F -q 'WEB_SENTRY_DSN=' "${work}/ssh.log" && echo 0 || echo 1
)"
assert "workflow unset does not print the DSN" "$([ ! -s "${log}" ] && no_leak "${err}" && echo 0 || echo 1)"

rc="$(run_workflow set '   ')"
assert "workflow blank omits the secret" "$(
  [ "${rc}" -eq 0 ] && grep -F -q "${remote_cmd}" "${work}/ssh.log" && ! grep -F -q 'WEB_SENTRY_DSN=' "${work}/ssh.log" && echo 0 || echo 1
)"

rc="$(run_workflow set "${rejected}")"
assert "workflow rejects a bad URL" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"
assert "workflow bad URL does not ssh" "$([ ! -e "${work}/ssh.log" ] && echo 0 || echo 1)"
assert "workflow bad URL is not printed" "$(no_leak "${log}" && no_leak "${err}" && echo 0 || echo 1)"
assert "workflow bad URL explains the rule" "$(grep -F -q 'must be an http or https URL' "${err}" && echo 0 || echo 1)"

apply_line="$(grep -n 'apply_web_sentry_dsn "${env_file}"' "${deploy_script}" | head -n 1 | cut -d: -f1)"
armed_line="$(grep -n 'rollback_armed=1' "${deploy_script}" | head -n 1 | cut -d: -f1)"
up_line="$(grep -n 'compose up -d postgres redis' "${deploy_script}" | head -n 1 | cut -d: -f1)"
assert "DSN write is before containers change" "$(
  [ -n "${apply_line}" ] && [ -n "${armed_line}" ] && [ -n "${up_line}" ] \
    && [ "${apply_line}" -lt "${armed_line}" ] && [ "${apply_line}" -lt "${up_line}" ] \
    && echo 0 || echo 1
)"

if [ "${failed}" -ne 0 ]; then
  echo "web sentry dsn env tests failed" >&2
  exit 1
fi
echo "web sentry dsn env tests passed"
