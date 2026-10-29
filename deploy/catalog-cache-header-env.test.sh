#!/usr/bin/env bash
# CATALOG_CACHE_HEADER is copied from the GitHub Environment into the server
# env file at deploy time. Only the exact string true stays true. Empty and
# every other value are written as false. An existing assignment is replaced
# in place, including a line with an export prefix. The key is appended only
# when it is absent.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
workflow="${root}/.github/workflows/deploy.yml"
header_src="${root}/apps/cardhub/api/src/modules/redis/cache-header.ts"
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

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

new_file() {
  local path="$1"
  local body="$2"
  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "${body}" > "${path}"
}

apply_header() {
  local value="$1"
  local file="$2"
  if [ "${value}" = "<unset>" ]; then
    (
      unset CATALOG_CACHE_HEADER
      apply_catalog_cache_header "${file}"
    )
  else
    CATALOG_CACHE_HEADER="${value}" apply_catalog_cache_header "${file}"
  fi
}

normalized() {
  local value="$1"
  if [ "${value}" = "<unset>" ]; then
    (
      unset CATALOG_CACHE_HEADER
      normalize_catalog_cache_header
    )
  else
    CATALOG_CACHE_HEADER="${value}" normalize_catalog_cache_header
  fi
}

file="${work}/staging.env"
new_file "${file}" "$(printf '%s\n' "ENV_NAME=staging" "DATABASE_URL=postgresql://cardhub:secret@postgres/db")"
apply_header "true" "${file}" >/dev/null
echo "staging.env after add:"
grep -E '^(ENV_NAME|CATALOG_CACHE_HEADER)=' "${file}"
assert "add keeps ENV_NAME=staging" "$(grep -qx 'ENV_NAME=staging' "${file}" && echo 0 || echo 1)"
assert "add writes true" "$(grep -qx 'CATALOG_CACHE_HEADER=true' "${file}" && echo 0 || echo 1)"
assert "add writes one assignment" "$([ "$(grep -c '^CATALOG_CACHE_HEADER=' "${file}")" -eq 1 ] && echo 0 || echo 1)"

apply_header "false" "${file}" >/dev/null
echo "staging.env after replace:"
grep -E '^(ENV_NAME|CATALOG_CACHE_HEADER)=' "${file}"
assert "replace keeps ENV_NAME=staging" "$(grep -qx 'ENV_NAME=staging' "${file}" && echo 0 || echo 1)"
assert "replace writes false" "$(grep -qx 'CATALOG_CACHE_HEADER=false' "${file}" && echo 0 || echo 1)"
assert "replace does not append" "$([ "$(grep -c 'CATALOG_CACHE_HEADER=' "${file}")" -eq 1 ] && echo 0 || echo 1)"

new_file "${file}" "$(printf '%s\n' "ENV_NAME=staging" "export CATALOG_CACHE_HEADER=true" "DATABASE_URL=postgresql://cardhub:secret@postgres/db")"
apply_header "<unset>" "${file}" >/dev/null
echo "staging.env after export replace:"
grep -E '^(ENV_NAME|export CATALOG_CACHE_HEADER|CATALOG_CACHE_HEADER)=' "${file}"
assert "export replace keeps ENV_NAME=staging" "$(grep -qx 'ENV_NAME=staging' "${file}" && echo 0 || echo 1)"
assert "export prefix is kept" "$(grep -qx 'export CATALOG_CACHE_HEADER=false' "${file}" && echo 0 || echo 1)"
assert "export line is not appended" "$([ "$(grep -c 'CATALOG_CACHE_HEADER=' "${file}")" -eq 1 ] && echo 0 || echo 1)"

for value in "<unset>" "" "   " "TRUE" "1" "yes" "false"; do
  got="$(normalized "${value}")"
  assert "normalize '${value}' is false" "$([ "${got}" = "false" ] && echo 0 || echo 1)"
done
assert "normalize true is true" "$([ "$(normalized "true")" = "true" ] && echo 0 || echo 1)"
assert "normalize padded true is true" "$([ "$(normalized " true ")" = "true" ] && echo 0 || echo 1)"

prod="${work}/production.env"
new_file "${prod}" "$(printf '%s\n' "ENV_NAME=prod" "DATABASE_URL=postgresql://cardhub:secret@postgres/db")"
apply_header "<unset>" "${prod}" >/dev/null
echo "production.env after default:"
grep -E '^(ENV_NAME|CATALOG_CACHE_HEADER)=' "${prod}"
assert "prod keeps ENV_NAME=prod" "$(grep -qx 'ENV_NAME=prod' "${prod}" && echo 0 || echo 1)"
assert "prod default is false" "$(grep -qx 'CATALOG_CACHE_HEADER=false' "${prod}" && echo 0 || echo 1)"
assert "header source requires the exact string true" "$(
  grep -F -q "env.CATALOG_CACHE_HEADER === 'true'" "${header_src}" && echo 0 || echo 1
)"

deploy_job="$(awk '
  /^  deploy:$/ { in_job = 1; next }
  in_job && /^  [^ ]/ { exit }
  in_job { print }
' "${workflow}")"
assert "deploy job reads the GitHub variable" "$(
  printf '%s\n' "${deploy_job}" | grep -F -q 'CATALOG_CACHE_HEADER: ${{ vars.CATALOG_CACHE_HEADER }}' && echo 0 || echo 1
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

mkdir -p "${work}/sshbin"
cat > "${work}/sshbin/ssh" << 'EOF'
#!/bin/sh
printf '%s\n' "$*" > "${SSH_LOG:?}"
exit 0
EOF
chmod 755 "${work}/sshbin/ssh"

run_workflow() {
  local value="$1"
  local rc=0
  rm -f "${work}/ssh.log"
  (
    cd "${root}"
    if [ "${value}" = "<unset>" ]; then
      env -u CATALOG_CACHE_HEADER -u PASSWORD_PREHASH_WRITE -u WEB_SENTRY_DSN \
        PATH="${work}/sshbin:${PATH}" \
        DEPLOY_USER=deploy \
        DEPLOY_HOST=example.test \
        DEPLOY_ENVIRONMENT=staging \
        DEPLOY_IMAGE_TAG="${tag}" \
        DEPLOY_EXPECTED_SHA="${sha}" \
        SSH_LOG="${work}/ssh.log" \
        bash "${extracted}"
    else
      env -u PASSWORD_PREHASH_WRITE -u WEB_SENTRY_DSN \
        PATH="${work}/sshbin:${PATH}" \
        CATALOG_CACHE_HEADER="${value}" \
        DEPLOY_USER=deploy \
        DEPLOY_HOST=example.test \
        DEPLOY_ENVIRONMENT=staging \
        DEPLOY_IMAGE_TAG="${tag}" \
        DEPLOY_EXPECTED_SHA="${sha}" \
        SSH_LOG="${work}/ssh.log" \
        bash "${extracted}"
    fi
  ) >/dev/null 2>"${work}/workflow.err" || rc=$?
  printf '%s\n' "${rc}"
}

remote_cmd="bash /opt/cardhub/staging/deploy/remote-deploy.sh staging ${tag} ${sha}"
rc="$(run_workflow "<unset>")"
assert "workflow unset forwards false" "$(
  [ "${rc}" -eq 0 ] && grep -F -q "CATALOG_CACHE_HEADER=false ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1
)"
rc="$(run_workflow "true")"
assert "workflow true forwards true" "$(
  [ "${rc}" -eq 0 ] && grep -F -q "CATALOG_CACHE_HEADER=true ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1
)"
rc="$(run_workflow "yes")"
assert "workflow other value forwards false" "$(
  [ "${rc}" -eq 0 ] && grep -F -q "CATALOG_CACHE_HEADER=false ${remote_cmd}" "${work}/ssh.log" && echo 0 || echo 1
)"

env_check="$(grep -n 'ENV_NAME in ${env_file} must be' "${deploy_script}" | head -n 1)"
echo "ENV_NAME check: ${env_check}"
assert "deploy refuses a staging file whose ENV_NAME is not staging" "$(
  printf '%s\n' "${env_check}" | grep -F -q "must be" && echo 0 || echo 1
)"

if [ "${failed}" -ne 0 ]; then
  echo "---- workflow stderr ----" >&2
  cat "${work}/workflow.err" >&2 || true
  exit 1
fi
