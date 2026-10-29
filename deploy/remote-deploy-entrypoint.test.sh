#!/usr/bin/env bash
# Stub-docker cases for the entrypoint probe in remote-deploy.sh.
# Not copied to the VPS. CI runs this; it does not need a Docker daemon.
#
# Image layouts are real files. `docker run -c` executes the probe script
# from remote-deploy.sh with the system `sh`, after rewriting
# /usr/local/bin onto that layout. Exit 10 is the only old-image signal
# (both files absent, including not even a dangling symlink). Exit 0 migrates.
# Exit 3 is an incomplete pair. Any other status, including docker's own 1,
# aborts. A forced docker status is used only when the container shell never
# runs. DOCKER_STUB_PREVIOUS selects the previous container.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
sha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
tag="sha-${sha}"
prev_sha="$(printf 'a%.0s' {1..40})"
prev_tag="sha-${prev_sha}"
failed=0

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
      cat "${CASE_LOG}" >&2
      echo "--- docker log ---" >&2
      cat "${CASE_DOCKER}" >&2
    fi
  fi
}

count_sub() {
  local file="$1"
  local kind="$2"
  awk -v kind="${kind}" '$1 == "compose" && $2 == kind { n++ } END { print n + 0 }' "${file}"
}

prepare_layout() {
  local image_root="$1"
  local layout="$2"
  local bin="${image_root}/usr/local/bin"
  mkdir -p "${bin}"
  case "${layout}" in
    complete)
      printf '#!/bin/sh\n' > "${bin}/api-entrypoint.sh"
      printf '#!/bin/sh\n' > "${bin}/migrate-entrypoint.sh"
      chmod 755 "${bin}/api-entrypoint.sh" "${bin}/migrate-entrypoint.sh"
      ;;
    absent)
      ;;
    api-only)
      printf '#!/bin/sh\n' > "${bin}/api-entrypoint.sh"
      chmod 755 "${bin}/api-entrypoint.sh"
      ;;
    migrate-not-exec)
      printf '#!/bin/sh\n' > "${bin}/api-entrypoint.sh"
      printf '#!/bin/sh\n' > "${bin}/migrate-entrypoint.sh"
      chmod 755 "${bin}/api-entrypoint.sh"
      chmod 644 "${bin}/migrate-entrypoint.sh"
      ;;
    dangling)
      ln -s /no/such/api-entrypoint.sh "${bin}/api-entrypoint.sh"
      ln -s /no/such/migrate-entrypoint.sh "${bin}/migrate-entrypoint.sh"
      ;;
    *)
      echo "unknown layout ${layout}" >&2
      exit 99
      ;;
  esac
}

run_case() {
  local layout="$1"
  local migrate_url="$2"
  local forced_rc="${3:-}"
  local previous="${4:-absent}"
  local pull_rc="${5:-}"
  local work docker_log script_log script_rc
  work="$(mktemp -d)"
  docker_log="${work}/docker.log"
  script_log="${work}/script.log"
  mkdir -p "${work}/bin" "${work}/root/staging/deploy" "${work}/state"
  prepare_layout "${work}/image" "${layout}"

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

cmd="$1"
shift || true

if [ "${cmd}" = "pull" ] && [ -n "${DOCKER_STUB_PULL_RC:-}" ]; then
  exit "${DOCKER_STUB_PULL_RC}"
fi
if [ "${cmd}" = "network" ] || [ "${cmd}" = "pull" ] || [ "${cmd}" = "ps" ] || [ "${cmd}" = "logs" ] || [ "${cmd}" = "rm" ] || [ "${cmd}" = "stop" ]; then
  exit 0
fi

if [ "${cmd}" = "run" ]; then
  if [ -n "${DOCKER_STUB_ENTRYPOINT_RC:-}" ]; then
    printf 'probe_rc %s\n' "${DOCKER_STUB_ENTRYPOINT_RC}" >> "${log}"
    exit "${DOCKER_STUB_ENTRYPOINT_RC}"
  fi
  script=""
  prev=""
  for arg in "$@"; do
    if [ "${prev}" = "-c" ]; then
      script="${arg}"
    fi
    prev="${arg}"
  done
  if [ -z "${script}" ]; then
    echo "stub docker: run without -c" >&2
    exit 99
  fi
  root="${DOCKER_STUB_ROOT:?}"
  script="${script//\/usr\/local\/bin/${root}/usr/local/bin}"
  sh -c "${script}"
  rc=$?
  printf 'probe_rc %s\n' "${rc}" >> "${log}"
  exit "${rc}"
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
  if [ "${DOCKER_STUB_PREVIOUS:-}" = "inspect-error" ]; then
    echo "Error response from daemon: Cannot connect to the Docker daemon" >&2
    exit 1
  fi
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
      ps|pull|up|run|exec)
        sub="${arg}"
        ;;
    esac
  done
  printf 'compose %s %s\n' "${sub}" "$*" >> "${log}"
  case "${sub}" in
    ps)
      svc="${*: -1}"
      case "${svc}" in
        postgres) echo pgcontainer ;;
        redis) echo rdcontainer ;;
        api)
          if [ "${DOCKER_STUB_PREVIOUS:-}" = "present" ] || [ "${DOCKER_STUB_PREVIOUS:-}" = "inspect-error" ]; then
            [ -f "${state}/api-down" ] || echo oldapi
          fi
          [ -f "${state}/api" ] && echo newapi
          ;;
        web)
          if [ "${DOCKER_STUB_PREVIOUS:-}" = "present" ] || [ "${DOCKER_STUB_PREVIOUS:-}" = "inspect-error" ]; then
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

  cat > "${work}/root/staging/staging.env" << EOF
ENV_NAME=staging
API_DOMAIN=api-staging.example.test
MIGRATE_DATABASE_URL=${migrate_url}
EOF
  cp "${root}/deploy/docker-compose.yml" "${work}/root/staging/deploy/docker-compose.yml"

  script_rc=0
  env \
    -u PASSWORD_PREHASH_WRITE \
    PATH="${work}/bin:${PATH}" \
    CARDHUB_ROOT="${work}/root" \
    CARDHUB_HEALTH_TIMEOUT_SECONDS=5 \
    CURL_BIN="${work}/bin/curl" \
    DOCKER_STUB_LOG="${docker_log}" \
    DOCKER_STUB_STATE="${work}/state" \
    DOCKER_STUB_ROOT="${work}/image" \
    DOCKER_STUB_TAG="${tag}" \
    DOCKER_STUB_SHA="${sha}" \
    DOCKER_STUB_PREVIOUS="${previous}" \
    DOCKER_STUB_PREV_TAG="${prev_tag}" \
    ${forced_rc:+DOCKER_STUB_ENTRYPOINT_RC="${forced_rc}"} \
    ${pull_rc:+DOCKER_STUB_PULL_RC="${pull_rc}"} \
    bash "${deploy_script}" staging "${tag}" "${sha}" > "${script_log}" 2>&1 || script_rc=$?

  CASE_RC="${script_rc}"
  CASE_LOG="${script_log}"
  CASE_DOCKER="${docker_log}"
  CASE_ROOT="${work}/root"
  CASE_DUMPED=0
  if [ -n "${migrate_url}" ]; then
    echo "CASE layout=${layout} previous=${previous} migrate=set forced=${forced_rc:-run} rc=${script_rc}"
  else
    echo "CASE layout=${layout} previous=${previous} migrate=empty forced=${forced_rc:-run} rc=${script_rc}"
  fi
}

assert_stopped() {
  local label="$1"
  assert "${label} aborts" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
  assert "${label} does not compose up" "$([ "$(count_sub "${CASE_DOCKER}" up)" -eq 0 ] && echo 0 || echo 1)"
  assert "${label} does not compose run" "$([ "$(count_sub "${CASE_DOCKER}" run)" -eq 0 ] && echo 0 || echo 1)"
  assert "${label} does not compose pull" "$([ "$(count_sub "${CASE_DOCKER}" pull)" -eq 0 ] && echo 0 || echo 1)"
  assert "${label} does not start api" "$(grep -q 'Starting api' "${CASE_LOG}" && echo 1 || echo 0)"
  assert "${label} does not migrate" "$(grep -q 'Running database migrations' "${CASE_LOG}" && echo 1 || echo 0)"
  assert "${label} is not called an old image" "$(grep -q 'Target image has no migrate entrypoint' "${CASE_LOG}" && echo 1 || echo 0)"
}

# New image: both entrypoints executable. Migrate runs, then the API rolls.
run_case complete ""
assert "complete script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "complete runs migrate" "$(grep -q 'Running database migrations before the API rollout' "${CASE_LOG}" && echo 0 || echo 1)"
assert "complete compose run once" "$([ "$(count_sub "${CASE_DOCKER}" run)" -eq 1 ] && echo 0 || echo 1)"
assert "unset PASSWORD_PREHASH_WRITE leaves staging.env unchanged" "$(
  cat > "${CASE_ROOT}/expected-staging.env" << 'EOF'
ENV_NAME=staging
API_DOMAIN=api-staging.example.test
MIGRATE_DATABASE_URL=
EOF
  cmp -s "${CASE_ROOT}/expected-staging.env" "${CASE_ROOT}/staging/staging.env" && echo 0 || echo 1
)"
assert "unset PASSWORD_PREHASH_WRITE does not log a rewrite" "$(grep -q 'PASSWORD_PREHASH_WRITE=' "${CASE_LOG}" && echo 1 || echo 0)"

# True old image: both files absent, migrator URL empty. The probe's own
# status is 10. Skip the one-shot migrate and still roll the API.
run_case absent ""
assert "both absent script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "both absent probe exits 10" "$(grep -qx 'probe_rc 10' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert "both absent is the old image" "$(grep -q 'Target image has no migrate entrypoint' "${CASE_LOG}" && echo 0 || echo 1)"
assert "both absent does not migrate" "$([ "$(count_sub "${CASE_DOCKER}" run)" -eq 0 ] && echo 0 || echo 1)"
assert "both absent still starts api" "$(grep -q 'Starting api' "${CASE_LOG}" && echo 0 || echo 1)"

# A complete image whose docker CLI returns 1 never ran the probe. That is
# not an old image.
run_case complete "" 1
assert "complete docker rc 1 names the status" "$(grep -q 'entrypoint probe exited 1' "${CASE_LOG}" && echo 0 || echo 1)"
assert_stopped "complete docker rc 1"

# Image pull fails before the probe.
run_case complete "" "" absent 1
assert "image pull failure aborts" "$(grep -q 'Failed to pull' "${CASE_LOG}" && echo 0 || echo 1)"
assert_stopped "image pull failure"

# Dangling symlinks exist. They are not an old image.
run_case dangling ""
assert "dangling names the incomplete pair" "$(grep -q 'incomplete split entrypoint' "${CASE_LOG}" && echo 0 || echo 1)"
assert "dangling probe exits 3" "$(grep -qx 'probe_rc 3' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert_stopped "dangling"

# Incomplete pair, migrator URL empty (the pre-split and pre-switchover
# case). Must abort before rollback is armed and before compose pull/up.
run_case api-only ""
assert "api-only names the incomplete pair" "$(grep -q 'incomplete split entrypoint' "${CASE_LOG}" && echo 0 || echo 1)"
assert_stopped "api-only"

run_case migrate-not-exec ""
assert "migrate-not-exec names the incomplete pair" "$(grep -q 'incomplete split entrypoint' "${CASE_LOG}" && echo 0 || echo 1)"
assert_stopped "migrate-not-exec"

# Both files absent, but the server env already has a migrator URL.
run_case absent "postgresql://cardhub_migrator:abc@postgres:5432/cardhub_staging?schema=public"
assert "old image with migrator URL is refused" "$(grep -q 'MIGRATE_DATABASE_URL is set, but' "${CASE_LOG}" && echo 0 || echo 1)"
assert_stopped "old image with migrator URL"

# Daemon and any other probe status abort before compose starts a container.
for probe_rc in 125 2 126 127; do
  run_case absent "" "${probe_rc}"
  assert "exit ${probe_rc} names the status" "$(grep -q "entrypoint probe exited ${probe_rc}" "${CASE_LOG}" && echo 0 || echo 1)"
  assert_stopped "exit ${probe_rc}"
done

# No previous container: an empty tag is allowed and the deploy proceeds.
run_case complete "" "" absent
assert "absent container script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "absent container records no previous tag" "$([ ! -f "${CASE_ROOT}/staging/.deploy-state/previous-images.env" ] && echo 0 || echo 1)"

# Previous containers exist and inspect returns their image. The tag is
# written only after the switch succeeds.
run_case complete "" "" present
assert "previous tag script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "previous tag is recorded" "$(grep -qx "PREVIOUS_API_TAG=${prev_tag}" "${CASE_ROOT}/staging/.deploy-state/previous-images.env" && grep -qx "PREVIOUS_WEB_TAG=${prev_tag}" "${CASE_ROOT}/staging/.deploy-state/previous-images.env" && echo 0 || echo 1)"

# Inspect fails for a reason other than a missing container.
run_case complete "" "" inspect-error
assert "inspect error names the failure" "$(grep -q 'docker inspect of the previous api container exited 1' "${CASE_LOG}" && echo 0 || echo 1)"
assert_stopped "inspect error"

if [ "${failed}" -ne 0 ]; then
  echo "entrypoint probe tests failed" >&2
  exit 1
fi
echo "entrypoint probe tests passed"
