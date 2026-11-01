#!/usr/bin/env bash
# Digest pinning in remote-deploy.sh.
# No digest: exit non-zero and do not pull, start, stop, or remove containers.
# After compose up, a running digest that is not the expected one fails and
# the existing rollback runs. A second deploy of the same digests only verifies.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
tag="sha-${sha}"
prev_sha="$(printf 'a%.0s' {1..40})"
prev_tag="sha-${prev_sha}"
api_digest="sha256:$(printf '1%.0s' {1..64})"
web_digest="sha256:$(printf '2%.0s' {1..64})"
prev_api_digest="sha256:$(printf '3%.0s' {1..64})"
prev_web_digest="sha256:$(printf '4%.0s' {1..64})"
wrong_digest="sha256:$(printf '5%.0s' {1..64})"
failed=0

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
    if [ "${CASE_DUMPED:-0}" -eq 0 ] && [ -n "${CASE_LOG:-}" ]; then
      CASE_DUMPED=1
      echo "--- script log ---" >&2
      cat "${CASE_LOG}" >&2 || true
      echo "--- docker log ---" >&2
      cat "${CASE_DOCKER}" >&2 || true
    fi
  fi
}

count_sub() {
  local file="$1"
  local kind="$2"
  awk -v kind="${kind}" '$1 == "compose" && $2 == kind { n++ } END { print n + 0 }' "${file}"
}

run_case() {
  local mode="$1"
  local work docker_log script_log script_rc
  work="$(mktemp -d)"
  docker_log="${work}/docker.log"
  script_log="${work}/script.log"
  mkdir -p "${work}/bin" "${work}/root/staging/deploy" "${work}/state"

  cat > "${work}/bin/docker" << 'EOF'
#!/usr/bin/env bash
set -u
log="${DOCKER_STUB_LOG:?}"
state="${DOCKER_STUB_STATE:?}"
printf '%s' "$1" >> "${log}"
if [ "$#" -gt 1 ]; then
  printf ' %s' "${@:2}" >> "${log}"
fi
printf '\n' >> "${log}"
if [ -n "${API_IMAGE:-}" ] || [ -n "${WEB_IMAGE:-}" ]; then
  printf 'env API_IMAGE=%s WEB_IMAGE=%s\n' "${API_IMAGE:-}" "${WEB_IMAGE:-}" >> "${log}"
fi

cmd="$1"
shift || true

if [ "${cmd}" = "pull" ] || [ "${cmd}" = "network" ] || [ "${cmd}" = "ps" ] || [ "${cmd}" = "logs" ] || [ "${cmd}" = "rm" ] || [ "${cmd}" = "stop" ] || [ "${cmd}" = "tag" ] || [ "${cmd}" = "image" ]; then
  exit 0
fi

if [ "${cmd}" = "run" ]; then
  printf 'probe_rc %s\n' "${DOCKER_STUB_ENTRYPOINT_RC:?}" >> "${log}"
  exit "${DOCKER_STUB_ENTRYPOINT_RC}"
fi

if [ "${cmd}" = "inspect" ]; then
  fmt=""
  id=""
  prev=""
  for arg in "$@"; do
    if [ "${prev}" = "-f" ]; then
      fmt="${arg}"
    fi
    prev="${arg}"
    id="${arg}"
  done
  case "${fmt}" in
    *RestartCount*)
      echo 0
      ;;
    *Health*)
      echo healthy
      ;;
    *Config.Image*)
      if [ "${id}" = "oldapi" ] || [ "${id}" = "oldweb" ]; then
        echo "ghcr.io/xv-jiaqi/cardhub-api:${DOCKER_STUB_PREV_TAG:?}"
      elif [ "${id}" = "newweb" ] || [ "${id}" = "webcontainer" ]; then
        echo "ghcr.io/xv-jiaqi/cardhub-web:${DOCKER_STUB_TAG:?}"
      else
        echo "ghcr.io/xv-jiaqi/cardhub-api:${DOCKER_STUB_TAG:?}"
      fi
      ;;
    '{{.Image}}')
      case "${id}" in
        oldapi) echo "${DOCKER_STUB_OLD_API_DIGEST:?}" ;;
        oldweb) echo "${DOCKER_STUB_OLD_WEB_DIGEST:?}" ;;
        newweb|webcontainer) echo "${DOCKER_STUB_NEW_WEB_DIGEST:?}" ;;
        *) echo "${DOCKER_STUB_NEW_API_DIGEST:?}" ;;
      esac
      ;;
    *config-hash*)
      echo "${DOCKER_STUB_RUNNING_HASH:?}"
      ;;
    *)
      echo running
      ;;
  esac
  exit 0
fi

if [ "${cmd}" = "exec" ]; then
  printf '%s\n' "{\"status\":\"ok\",\"gitSha\":\"${DOCKER_STUB_SHA:?}\"}"
  exit 0
fi

if [ "${cmd}" = "compose" ]; then
  sub=""
  for arg in "$@"; do
    case "${arg}" in
      ps|pull|up|run|exec|config) sub="${arg}" ;;
    esac
  done
  printf 'compose %s %s\n' "${sub}" "$*" >> "${log}"
  if [ "${sub}" = "config" ]; then
    hash_svc=""
    prev_arg=""
    for arg in "$@"; do
      if [ "${prev_arg}" = "--hash" ]; then
        hash_svc="${arg}"
      fi
      prev_arg="${arg}"
    done
    printf '%s %s\n' "${hash_svc}" "${DOCKER_STUB_CONFIG_HASH:?}"
    exit 0
  fi
  case "${sub}" in
    ps)
      svc="${*: -1}"
      case "${svc}" in
        postgres) echo pgcontainer ;;
        redis) echo rdcontainer ;;
        api)
          if [ "${DOCKER_STUB_PREVIOUS:-}" = "present" ]; then
            [ -f "${state}/api-down" ] || echo oldapi
          fi
          [ -f "${state}/api" ] && echo newapi
          ;;
        web)
          if [ "${DOCKER_STUB_PREVIOUS:-}" = "present" ]; then
            [ -f "${state}/web-down" ] || echo oldweb
          fi
          [ -f "${state}/web" ] && echo newweb
          ;;
      esac
      ;;
    up)
      for arg in "$@"; do
        case "${arg}" in
          api=1) : > "${state}/api"; : > "${state}/api-down" ;;
          web=1) : > "${state}/web"; : > "${state}/web-down" ;;
          api|api=2) : > "${state}/api" ;;
          web|web=2) : > "${state}/web" ;;
        esac
      done
      ;;
    pull|run|exec)
      ;;
    *)
      echo "stub docker: unexpected compose ${sub}" >&2
      exit 99
      ;;
  esac
  exit 0
fi

echo "stub docker: unexpected ${cmd}" >&2
exit 99
EOF
  chmod 755 "${work}/bin/docker"

  cat > "${work}/bin/curl" << 'EOF'
#!/usr/bin/env bash
set -u
out=""
prev=""
for arg in "$@"; do
  if [ "${prev}" = "-o" ]; then
    out="${arg}"
  fi
  prev="${arg}"
done
printf '%s\n' "{\"status\":\"ok\",\"gitSha\":\"${DOCKER_STUB_SHA:?}\"}" > "${out}"
EOF
  chmod 755 "${work}/bin/curl"

  cat > "${work}/root/staging/staging.env" << 'EOF'
ENV_NAME=staging
API_DOMAIN=api-staging.example.test
EOF
  cp "${root}/deploy/docker-compose.yml" "${work}/root/staging/deploy/docker-compose.yml"

  local api_value="${api_digest}"
  local web_value="${web_digest}"
  local old_api="${prev_api_digest}"
  local old_web="${prev_web_digest}"
  local new_api="${api_digest}"
  local new_web="${web_digest}"
  local previous="present"
  local force=""
  local prehash=""
  local config_hash="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  local running_hash="${config_hash}"
  case "${mode}" in
    unset)
      api_value=""
      web_value=""
      ;;
    invalid)
      api_value="sha256:abcd"
      web_value="${web_digest}"
      ;;
    idempotent)
      old_api="${api_digest}"
      old_web="${web_digest}"
      ;;
    force)
      old_api="${api_digest}"
      old_web="${web_digest}"
      force=1
      ;;
    mismatch)
      new_api="${wrong_digest}"
      new_web="${wrong_digest}"
      ;;
    envchange)
      old_api="${api_digest}"
      old_web="${web_digest}"
      prehash=true
      running_hash="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      ;;
    halfprev)
      old_web="sha256:abc"
      ;;
    fresh)
      previous="absent"
      ;;
    *)
      echo "unknown mode ${mode}" >&2
      exit 99
      ;;
  esac

  script_rc=0
  env \
    -u PASSWORD_PREHASH_WRITE \
    -u WEB_SENTRY_DSN \
    ${force:+CARDHUB_FORCE_ROLLOUT=1} \
    ${prehash:+PASSWORD_PREHASH_WRITE=true} \
    PATH="${work}/bin:${PATH}" \
    CARDHUB_ROOT="${work}/root" \
    CARDHUB_HEALTH_TIMEOUT_SECONDS=5 \
    CURL_BIN="${work}/bin/curl" \
    DOCKER_STUB_LOG="${docker_log}" \
    DOCKER_STUB_STATE="${work}/state" \
    DOCKER_STUB_TAG="${tag}" \
    DOCKER_STUB_SHA="${sha}" \
    DOCKER_STUB_PREVIOUS="${previous}" \
    DOCKER_STUB_PREV_TAG="${prev_tag}" \
    DOCKER_STUB_OLD_API_DIGEST="${old_api}" \
    DOCKER_STUB_OLD_WEB_DIGEST="${old_web}" \
    DOCKER_STUB_NEW_API_DIGEST="${new_api}" \
    DOCKER_STUB_NEW_WEB_DIGEST="${new_web}" \
    DOCKER_STUB_CONFIG_HASH="${config_hash}" \
    DOCKER_STUB_RUNNING_HASH="${running_hash}" \
    DOCKER_STUB_ENTRYPOINT_RC=10 \
    API_IMAGE_DIGEST="${api_value}" \
    WEB_IMAGE_DIGEST="${web_value}" \
    bash "${deploy_script}" staging "${tag}" "${sha}" > "${script_log}" 2>&1 || script_rc=$?

  CASE_RC="${script_rc}"
  CASE_LOG="${script_log}"
  CASE_DOCKER="${docker_log}"
  CASE_DUMPED=0
  echo "CASE mode=${mode} rc=${script_rc}"
}

mutating() {
  local file="$1"
  awk '
    $1 == "compose" && ($2 == "up" || $2 == "pull" || $2 == "run") { found = 1 }
    $1 == "pull" || $1 == "rm" || $1 == "stop" || $1 == "tag" || $1 == "run" { found = 1 }
    END { exit found ? 0 : 1 }
  ' "${file}"
}

run_case unset
assert "unset digest exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "unset digest says containers were not changed" "$(grep -F -q 'image digest for '"${sha}"' is unavailable' "${CASE_LOG}" && echo 0 || echo 1)"
assert "unset digest does not change containers" "$(mutating "${CASE_DOCKER}" && echo 1 || echo 0)"

run_case invalid
assert "invalid digest exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "invalid digest does not change containers" "$(mutating "${CASE_DOCKER}" && echo 1 || echo 0)"

run_case idempotent
assert "same digest exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "same digest only verifies" "$(grep -F -q 'verifying without recreating' "${CASE_LOG}" && echo 0 || echo 1)"
assert "same digest does not compose up" "$([ "$(count_sub "${CASE_DOCKER}" up)" -eq 0 ] && echo 0 || echo 1)"
assert "same digest does not pull" "$(awk '$1 == "pull" || ($1 == "compose" && $2 == "pull") { found = 1 } END { exit found ? 0 : 1 }' "${CASE_DOCKER}" && echo 1 || echo 0)"
assert "same digest does not stop a container" "$(awk '$1 == "stop" { found = 1 } END { exit found ? 0 : 1 }' "${CASE_DOCKER}" && echo 1 || echo 0)"
assert "same digest still checks public health" "$(grep -F -q "Verified api-staging.example.test gitSha=${sha}" "${CASE_LOG}" && echo 0 || echo 1)"

run_case envchange
assert "same digest with changed env exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "same digest with changed env recreates" "$([ "$(count_sub "${CASE_DOCKER}" up)" -gt 0 ] && echo 0 || echo 1)"
assert "same digest with changed env is not a verify-only run" "$(grep -F -q 'verifying without recreating' "${CASE_LOG}" && echo 1 || echo 0)"
assert "same digest with changed env writes the flag" "$(grep -qx 'PASSWORD_PREHASH_WRITE=true' "$(dirname "${CASE_LOG}")/root/staging/staging.env" && echo 0 || echo 1)"

run_case halfprev
assert "missing previous digest exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "missing previous digest names both digests" "$(grep -F -q 'both previous image digests are required' "${CASE_LOG}" && echo 0 || echo 1)"
assert "missing previous digest does not change containers" "$(mutating "${CASE_DOCKER}" && echo 1 || echo 0)"

run_case fresh
assert "first deploy with no old containers exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "first deploy with no old containers starts api" "$(grep -F -q 'Starting api' "${CASE_LOG}" && echo 0 || echo 1)"
assert "first deploy with no old containers composes up" "$([ "$(count_sub "${CASE_DOCKER}" up)" -gt 0 ] && echo 0 || echo 1)"

run_case force
assert "force rollout of the same digest exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "force rollout composes up" "$([ "$(count_sub "${CASE_DOCKER}" up)" -gt 0 ] && echo 0 || echo 1)"
assert "force rollout does not take the no-op path" "$(grep -F -q 'verifying without recreating' "${CASE_LOG}" && echo 1 || echo 0)"

run_case mismatch
assert "digest mismatch exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "digest mismatch names the expected digest" "$(grep -F -q "image digest does not match ${api_digest}" "${CASE_LOG}" && echo 0 || echo 1)"
assert "digest mismatch rolls back" "$(grep -F -q "Rolling back staging to ${prev_tag}" "${CASE_LOG}" && echo 0 || echo 1)"
assert "digest mismatch rollback pulls the previous digest" "$(
  grep -F -q "env API_IMAGE=ghcr.io/xv-jiaqi/cardhub-api@${prev_api_digest} WEB_IMAGE=ghcr.io/xv-jiaqi/cardhub-web@${prev_web_digest}" "${CASE_DOCKER}" && echo 0 || echo 1
)"
assert "digest mismatch does not stop the previous container" "$(awk '$1 == "stop" { found = 1 } END { exit found ? 0 : 1 }' "${CASE_DOCKER}" && echo 1 || echo 0)"

if [ "${failed}" -ne 0 ]; then
  echo "image digest deploy tests failed" >&2
  exit 1
fi
echo "image digest deploy tests passed"
