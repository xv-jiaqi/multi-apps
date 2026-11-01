#!/usr/bin/env bash
# recreate_edge force-recreates even when the container already sees the files.
# Default (no --recreate) still only reloads or leaves the container alone.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
apply="${root}/deploy/edge/apply-edge-config.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "${work}/bin" "${work}/edge/optional" "${work}/case"
printf 'caddy\n' > "${work}/edge/Caddyfile"
printf 'root\n' > "${work}/edge/optional/root-web.caddy"
printf 'services: {}\n' > "${work}/edge/docker-compose.yml"
cat > "${work}/edge.env" <<'EOF'
ENV_NAME=prod
ROOT_WEB_DOMAINS=card-hub.app
ROOT_WEB_REDIRECT_DOMAINS=www.card-hub.app
ROOT_WEB_REDIRECT_TARGET=card-hub.app
API_DOMAIN=api.card-hub.app
STAGING_WEB_DOMAIN=staging.card-hub.app
STAGING_API_DOMAIN=api-staging.card-hub.app
EOF

cat > "${work}/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${DOCKER_STUB_LOG:?}"

if [ "$1" = "compose" ]; then
  case " $* " in
    *" ps -q caddy ")
      if [ -n "${DOCKER_STUB_PS_EMPTY_FILE:-}" ]; then
        left="$(cat "${DOCKER_STUB_PS_EMPTY_FILE}")"
        if [ "${left}" -gt 0 ]; then
          printf '%s\n' "$((left - 1))" > "${DOCKER_STUB_PS_EMPTY_FILE}"
          exit 0
        fi
      fi
      printf '%s\n' 'cid-edge'
      exit 0
      ;;
    *" up -d --no-deps --force-recreate caddy ")
      exit 0
      ;;
  esac
  echo "unexpected compose: $*" >&2
  exit 1
fi

if [ "$1" = "exec" ]; then
  cmd="$3"
  if [ "${cmd}" = "sha256sum" ]; then
    path="$4"
    if [ -n "${DOCKER_STUB_STALE_FILE:-}" ]; then
      left="$(cat "${DOCKER_STUB_STALE_FILE}")"
      if [ "${left}" -gt 0 ]; then
        printf '%s\n' "$((left - 1))" > "${DOCKER_STUB_STALE_FILE}"
        printf '%s\n' 'deadbeef  stub'
        exit 0
      fi
    fi
    rel="${path#/etc/caddy/}"
    /usr/bin/sha256sum "${EDGE_DIR}/${rel}"
    exit 0
  fi
  if [ "${cmd}" = "stat" ]; then
    printf '%s\n' '42'
    exit 0
  fi
  if [ "${cmd}" = "mkdir" ] || [ "${cmd}" = "chmod" ] || [ "${cmd}" = "wget" ]; then
    exit 0
  fi
  if [ "${cmd}" = "caddy" ]; then
    exit 0
  fi
  echo "unexpected exec: $*" >&2
  exit 1
fi

if [ "$1" = "inspect" ]; then
  format="$3"
  case "${format}" in
    *Health.Status*)
      if [ "${DOCKER_STUB_UNHEALTHY:-}" = "1" ]; then
        printf '%s\n' 'starting'
      else
        printf '%s\n' 'healthy'
      fi
      ;;
    *State.Status*)
      printf '%s\n' 'running'
      ;;
    *Config.Image*)
      printf '%s\n' 'caddy:2-alpine'
      ;;
    *StartedAt*)
      printf '%s\n' '2026-01-01T00:00:00Z'
      ;;
    *Mounts*)
      printf '%s\n' '/etc/caddy'
      ;;
    *)
      echo "unexpected inspect: ${format}" >&2
      exit 1
      ;;
  esac
  exit 0
fi

if [ "$1" = "run" ]; then
  if [ "${DOCKER_STUB_VALIDATE_FAIL:-}" = "1" ]; then
    echo "caddy validate failed" >&2
    exit 1
  fi
  exit 0
fi

if [ "$1" = "logs" ]; then
  exit 0
fi

echo "unexpected docker: $*" >&2
exit 1
EOF

cat > "${work}/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "${CURL_STUB_LOG:?}"
if [ "${CURL_STUB_FAIL:-}" = "1" ]; then
  echo "curl failed" >&2
  exit 7
fi
url=""
for arg in "$@"; do
  case "$arg" in
    https://*) url="$arg" ;;
  esac
done
if [[ "$url" == https://www.card-hub.app/* ]]; then
  printf '%s %s' "${CURL_STUB_WWW_CODE:-308}" "${CURL_STUB_WWW_LOCATION:-https://card-hub.app/}"
  exit 0
fi
printf '%s' "${CURL_STUB_CODE:-200}"
EOF
chmod 755 "${work}/bin/docker" "${work}/bin/curl"

failed=0
ok() { echo "OK $1"; }
bad() { echo "FAIL $1" >&2; failed=1; }

run_case() {
  local name="$1"
  local expect_rc="$2"
  shift 2
  local -a env_extra=()
  local -a script_args=()
  while [ $# -gt 0 ]; do
    if [ "$1" = "--" ]; then
      shift
      script_args=("$@")
      break
    fi
    env_extra+=("$1")
    shift
  done
  local case_dir="${work}/case/${name}"
  rm -rf "${case_dir}"
  mkdir -p "${case_dir}"
  local docker_log="${case_dir}/docker.log"
  local curl_log="${case_dir}/curl.log"
  local out="${case_dir}/out"
  local err="${case_dir}/err"
  : > "${docker_log}"
  : > "${curl_log}"
  set +e
  env \
    EDGE_DIR="${work}/edge" \
    EDGE_ENV_FILE="${work}/edge.env" \
    EDGE_HEALTH_ATTEMPTS=2 \
    EDGE_HEALTH_SLEEP_SECONDS=0 \
    EDGE_PROBE_ATTEMPTS=1 \
    EDGE_PROBE_SLEEP_SECONDS=0 \
    DOCKER_STUB_LOG="${docker_log}" \
    CURL_STUB_LOG="${curl_log}" \
    PATH="${work}/bin:${PATH}" \
    "${env_extra[@]}" \
    bash "${apply}" "${script_args[@]}" >"${out}" 2>"${err}"
  local rc=$?
  set -e
  if [ "${rc}" -ne "${expect_rc}" ]; then
    bad "${name}: exit ${rc}, expected ${expect_rc}"
    cat "${out}" >&2 || true
    cat "${err}" >&2 || true
    return
  fi
  CASE_OUT="${out}"
  CASE_ERR="${err}"
  CASE_DOCKER="${docker_log}"
  CASE_CURL="${curl_log}"
  ok "${name}"
}

assert_grep() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if grep -q "${pattern}" "${file}"; then
    ok "${name}"
  else
    bad "${name}: missing ${pattern}"
  fi
}

assert_absent() {
  local name="$1"
  local file="$2"
  local pattern="$3"
  if grep -q "${pattern}" "${file}"; then
    bad "${name}: found ${pattern}"
  else
    ok "${name}"
  fi
}

run_case "default leaves a visible container" 0
assert_grep "default says not reloading" "${CASE_OUT}" "Not reloading"
assert_absent "default does not force-recreate" "${CASE_DOCKER}" "force-recreate"
assert_absent "default does not probe" "${CASE_CURL}" "card-hub.app"

run_case "changed files reload" 0 -- --changed
assert_grep "reload message" "${CASE_OUT}" "Reloaded edge Caddy"
assert_grep "reload exec" "${CASE_DOCKER}" "caddy reload"
assert_absent "reload is not a recreate" "${CASE_DOCKER}" "force-recreate"

run_case "recreate visible container" 0 -- --recreate
assert_grep "explains the force" "${CASE_OUT}" "force-recreating anyway"
assert_grep "validate before recreate" "${CASE_OUT}" "before recreate"
assert_grep "compose force-recreate" "${CASE_DOCKER}" "up -d --no-deps --force-recreate caddy"
assert_grep "healthy result" "${CASE_OUT}" "four domains responded"
assert_grep "apex probed" "${CASE_CURL}" "card-hub.app"
assert_grep "api probed" "${CASE_CURL}" "api.card-hub.app"
assert_grep "staging web probed" "${CASE_CURL}" "staging.card-hub.app"
assert_grep "staging api probed" "${CASE_CURL}" "api-staging.card-hub.app"
assert_grep "www 308" "${CASE_OUT}" "www.card-hub.app redirected 308 to https://card-hub.app/"
assert_absent "old skip message is gone" "${CASE_OUT}" "Not recreating"

shared="${work}/case/twice"
rm -rf "${shared}"
mkdir -p "${shared}"
: > "${shared}/docker.log"
: > "${shared}/curl.log"
env \
  EDGE_DIR="${work}/edge" \
  EDGE_ENV_FILE="${work}/edge.env" \
  EDGE_HEALTH_ATTEMPTS=2 \
  EDGE_HEALTH_SLEEP_SECONDS=0 \
  EDGE_PROBE_ATTEMPTS=1 \
  EDGE_PROBE_SLEEP_SECONDS=0 \
  DOCKER_STUB_LOG="${shared}/docker.log" \
  CURL_STUB_LOG="${shared}/curl.log" \
  PATH="${work}/bin:${PATH}" \
  bash "${apply}" --recreate >"${shared}/out1" 2>"${shared}/err1"
env \
  EDGE_DIR="${work}/edge" \
  EDGE_ENV_FILE="${work}/edge.env" \
  EDGE_HEALTH_ATTEMPTS=2 \
  EDGE_HEALTH_SLEEP_SECONDS=0 \
  EDGE_PROBE_ATTEMPTS=1 \
  EDGE_PROBE_SLEEP_SECONDS=0 \
  DOCKER_STUB_LOG="${shared}/docker.log" \
  CURL_STUB_LOG="${shared}/curl.log" \
  PATH="${work}/bin:${PATH}" \
  bash "${apply}" --recreate >"${shared}/out2" 2>"${shared}/err2"
count="$(grep -c 'up -d --no-deps --force-recreate caddy' "${shared}/docker.log")"
if [ "${count}" -eq 2 ]; then
  ok "two recreates both ran"
else
  bad "two recreates: compose up count ${count}"
fi

printf '%s\n' '2' > "${work}/stale-left"
run_case "stale mount without the flag refuses" 1 \
  DOCKER_STUB_STALE_FILE="${work}/stale-left"
assert_grep "refuse message" "${CASE_ERR}" "recreate_edge is not set"
assert_absent "refuse does not recreate" "${CASE_DOCKER}" "force-recreate"

printf '%s\n' '2' > "${work}/stale-left"
run_case "stale mount with the flag force-recreates" 0 \
  DOCKER_STUB_STALE_FILE="${work}/stale-left" -- --recreate
assert_grep "stale path recreates" "${CASE_DOCKER}" "force-recreate"
assert_grep "stale path probes" "${CASE_OUT}" "four domains responded"

run_case "bad caddyfile does not recreate" 1 \
  DOCKER_STUB_VALIDATE_FAIL=1 -- --recreate
assert_grep "validate failure" "${CASE_ERR}" "was not recreated"
assert_absent "validate failure skips compose up" "${CASE_DOCKER}" "force-recreate"

run_case "unhealthy container fails the run" 1 \
  DOCKER_STUB_UNHEALTHY=1 -- --recreate
assert_grep "health failure" "${CASE_ERR}" "did not become healthy"
assert_grep "unhealthy still issued recreate" "${CASE_DOCKER}" "force-recreate"
assert_absent "unhealthy does not probe" "${CASE_CURL}" "card-hub.app"

run_case "domain probe failure fails the run" 1 \
  CURL_STUB_FAIL=1 -- --recreate
assert_grep "probe failure" "${CASE_ERR}" "failed probe"
assert_grep "probe failure is after recreate" "${CASE_DOCKER}" "force-recreate"

run_case "502 is not a successful probe" 1 \
  CURL_STUB_CODE=502 -- --recreate
assert_grep "502 is a failed status" "${CASE_ERR}" "last status 502"
assert_grep "502 still recreated" "${CASE_DOCKER}" "force-recreate"
assert_absent "502 does not count as responded" "${CASE_OUT}" "four domains responded"
proof_status="$(grep 'card-hub.app failed probe' "${CASE_ERR}")"
echo "PROOF 502: exit 1; ${proof_status}; force-recreate=yes; success_line=no"

sed 's/^ROOT_WEB_DOMAINS=.*/ROOT_WEB_DOMAINS=/' "${work}/edge.env" > "${work}/edge-empty.env"
run_case "empty apex fails before recreate" 1 \
  EDGE_ENV_FILE="${work}/edge-empty.env" -- --recreate
assert_grep "empty apex names the key" "${CASE_ERR}" "ROOT_WEB_DOMAINS"
assert_grep "empty apex refuses recreate" "${CASE_ERR}" "Not recreating"
assert_absent "empty apex does not compose up" "${CASE_DOCKER}" "force-recreate"

printf '%s\n' '1' > "${work}/ps-empty"
run_case "no container with the flag starts one" 0 \
  DOCKER_STUB_PS_EMPTY_FILE="${work}/ps-empty" -- --recreate
assert_grep "start message" "${CASE_OUT}" "No edge Caddy container is running"
assert_grep "start still force-recreates" "${CASE_DOCKER}" "force-recreate"
assert_grep "start probes" "${CASE_OUT}" "four domains responded"

if [ "${failed}" -ne 0 ]; then
  echo "edge force-recreate tests failed" >&2
  exit 1
fi
echo "edge force-recreate tests passed"
