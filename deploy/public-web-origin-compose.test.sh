#!/usr/bin/env bash
# An empty PUBLIC_WEB_ORIGIN becomes https://WEB_DOMAIN. Compose must fail
# when WEB_DOMAIN is unset or empty instead of rendering "https://".
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="${root}/deploy/docker-compose.yml"
example="${root}/deploy/.env.example"
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

if docker info >/dev/null 2>&1; then
  run_compose() {
    env -u WEB_DOMAIN -u PUBLIC_WEB_ORIGIN docker compose "$@"
  }
elif sudo docker info >/dev/null 2>&1; then
  run_compose() {
    sudo docker compose "$@"
  }
else
  if [ "${CI:-}" = "true" ]; then
    echo "FAIL docker compose is required when CI=true" >&2
    exit 1
  fi
  echo "SKIP docker compose is not available"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

base_env() {
  local dest="$1"
  sed 's/^ENV_NAME=$/ENV_NAME=prod/' "${example}" > "${dest}"
}

render() {
  local env_file="$1"
  local out="$2"
  local err="$3"
  local rc=0
  run_compose --project-directory "${work}" -f "${compose_file}" --env-file "${env_file}" config \
    >"${out}" 2>"${err}" || rc=$?
  printf '%s\n' "${rc}"
}

base_env "${work}/set.env"
rc="$(render "${work}/set.env" "${work}/set.yml" "${work}/set.err")"
count="$(grep -cF 'PUBLIC_WEB_ORIGIN: https://card-hub.app' "${work}/set.yml" || true)"
assert "WEB_DOMAIN set renders both origins" "$( [ "${rc}" -eq 0 ] && [ "${count}" -eq 2 ] && echo 0 || echo 1 )"
if grep -Eq 'PUBLIC_WEB_ORIGIN: https://[[:space:]]*$' "${work}/set.yml"; then
  echo "FAIL rendered origin collapsed to https://" >&2
  failed=1
fi

sed -E '/^(WEB_DOMAIN|PUBLIC_WEB_ORIGIN)=/d' "${work}/set.env" > "${work}/missing.env"
rc="$(render "${work}/missing.env" "${work}/missing.yml" "${work}/missing.err")"
assert "missing WEB_DOMAIN fails" "$( [ "${rc}" -ne 0 ] && echo 0 || echo 1 )"
assert "missing WEB_DOMAIN names the variable" "$( grep -q 'WEB_DOMAIN is required' "${work}/missing.err" && echo 0 || echo 1 )"

sed 's/^WEB_DOMAIN=.*/WEB_DOMAIN=/' "${work}/set.env" > "${work}/empty.env"
rc="$(render "${work}/empty.env" "${work}/empty.yml" "${work}/empty.err")"
assert "empty WEB_DOMAIN fails" "$( [ "${rc}" -ne 0 ] && echo 0 || echo 1 )"
assert "empty WEB_DOMAIN names the variable" "$( grep -q 'WEB_DOMAIN is required' "${work}/empty.err" && echo 0 || echo 1 )"

# Compose evaluates the nested WEB_DOMAIN requirement even when
# PUBLIC_WEB_ORIGIN is set, so a lone override cannot skip the check.
sed -E '/^(WEB_DOMAIN|PUBLIC_WEB_ORIGIN)=/d' "${work}/set.env" > "${work}/explicit.env"
printf '\nPUBLIC_WEB_ORIGIN=https://staging.card-hub.app\n' >> "${work}/explicit.env"
rc="$(render "${work}/explicit.env" "${work}/explicit.yml" "${work}/explicit.err")"
assert "explicit origin still requires WEB_DOMAIN" "$( [ "${rc}" -ne 0 ] && echo 0 || echo 1 )"
assert "explicit origin names WEB_DOMAIN" "$( grep -q 'WEB_DOMAIN is required' "${work}/explicit.err" && echo 0 || echo 1 )"

sed 's/^WEB_DOMAIN=.*/WEB_DOMAIN=staging.card-hub.app/' "${work}/set.env" > "${work}/staging.env"
rc="$(render "${work}/staging.env" "${work}/staging.yml" "${work}/staging.err")"
count="$(grep -cF 'PUBLIC_WEB_ORIGIN: https://staging.card-hub.app' "${work}/staging.yml" || true)"
assert "staging WEB_DOMAIN renders both origins" "$( [ "${rc}" -eq 0 ] && [ "${count}" -eq 2 ] && echo 0 || echo 1 )"

if [ "${failed}" -ne 0 ]; then
  echo "--- missing WEB_DOMAIN stderr ---" >&2
  cat "${work}/missing.err" >&2 || true
  echo "--- empty WEB_DOMAIN stderr ---" >&2
  cat "${work}/empty.err" >&2 || true
  echo "--- explicit origin stderr ---" >&2
  cat "${work}/explicit.err" >&2 || true
  exit 1
fi
