#!/usr/bin/env bash
# Stub-docker coverage for read_previous_image in remote-deploy.sh.
# container exists, container truly absent (inspect: No such object),
# and inspect error. The compose-ps fallback must use project/service
# labels, so a same-named container from another project is ignored.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
sha="$(printf 'b%.0s' {1..40})"
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
    if [ "${CASE_DUMPED:-0}" -eq 0 ]; then
      CASE_DUMPED=1
      echo "--- script log ---" >&2
      cat "${CASE_LOG}" >&2 || true
      echo "--- docker log ---" >&2
      cat "${CASE_DOCKER}" >&2 || true
    fi
  fi
}

run_case() {
  local mode="$1"
  local work docker_log script_log script_rc
  work="$(mktemp -d)"
  docker_log="${work}/docker.log"
  script_log="${work}/script.log"
  mkdir -p "${work}/bin" "${work}/root/staging/deploy"

  cat > "${work}/bin/docker" << 'EOF'
#!/usr/bin/env bash
set -u
log="${PREV_STUB_LOG:?}"
mode="${PREV_STUB_MODE:?}"
{
  printf '%s' "$1"
  if [ "$#" -gt 1 ]; then
    printf ' %s' "${@:2}"
  fi
  printf '\n'
} >> "${log}"

cmd="$1"
shift || true

if [ "${cmd}" = "network" ]; then
  exit 0
fi

if [ "${cmd}" = "compose" ]; then
  sub=""
  for arg in "$@"; do
    case "${arg}" in
      ps|pull|up|run|exec) sub="${arg}" ;;
    esac
  done
  if [ "${sub}" != "ps" ]; then
    echo "stub docker: unexpected compose ${sub}" >&2
    exit 99
  fi
  svc="${*: -1}"
  case "${mode}" in
    exists|inspect-error|missing-object)
      case "${svc}" in
        api) echo oldapi ;;
        web) echo oldweb ;;
      esac
      ;;
    other-project|labeled-leftover)
      ;;
    *)
      echo "stub docker: unknown mode ${mode}" >&2
      exit 99
      ;;
  esac
  exit 0
fi

if [ "${cmd}" = "ps" ]; then
  project_value=""
  service_value=""
  name_filter=""
  prev=""
  for arg in "$@"; do
    case "${prev}" in
      --filter)
        case "${arg}" in
          label=com.docker.compose.project=*)
            project_value="${arg#label=com.docker.compose.project=}"
            ;;
          label=com.docker.compose.service=*)
            service_value="${arg#label=com.docker.compose.service=}"
            ;;
          name=*)
            name_filter="${arg#name=}"
            ;;
        esac
        ;;
    esac
    case "${arg}" in
      --filter=label=com.docker.compose.project=*)
        project_value="${arg#--filter=label=com.docker.compose.project=}"
        ;;
      --filter=label=com.docker.compose.service=*)
        service_value="${arg#--filter=label=com.docker.compose.service=}"
        ;;
      --filter=name=*)
        name_filter="${arg#--filter=name=}"
        ;;
    esac
    prev="${arg}"
  done

  case "${mode}" in
    other-project)
      if [ "${project_value}" = "cardhub-staging" ] && [ -n "${service_value}" ]; then
        exit 0
      fi
      if [ "${service_value}" = "web" ] || printf '%s' "${name_filter}" | grep -q 'web'; then
        echo otherweb
      else
        echo otherapi
      fi
      exit 0
      ;;
    labeled-leftover)
      if [ "${service_value}" = "web" ] || printf '%s' "${name_filter}" | grep -q 'web'; then
        echo leftoverweb
      else
        echo leftoverapi
      fi
      exit 0
      ;;
    *)
      echo "stub docker: unexpected ps in mode ${mode}" >&2
      exit 99
      ;;
  esac
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
  case "${mode}" in
    missing-object)
      echo "Error: No such object: ${id}" >&2
      exit 1
      ;;
    inspect-error)
      echo "Error response from daemon: Cannot connect to the Docker daemon" >&2
      exit 1
      ;;
    exists)
      case "${fmt}" in
        *Config.Image*)
          case "${id}" in
            oldapi) echo "ghcr.io/xv-jiaqi/cardhub-api:${PREV_STUB_TAG:?}" ;;
            oldweb) echo "ghcr.io/xv-jiaqi/cardhub-web:${PREV_STUB_TAG:?}" ;;
            *)
              echo "stub docker: unexpected id ${id}" >&2
              exit 99
              ;;
          esac
          ;;
        *)
          echo "stub docker: unexpected inspect format" >&2
          exit 99
          ;;
      esac
      exit 0
      ;;
    *)
      echo "stub docker: unexpected inspect in mode ${mode}" >&2
      exit 99
      ;;
  esac
fi

echo "stub docker: unexpected ${cmd}" >&2
exit 99
EOF
  chmod 755 "${work}/bin/docker"

  cat > "${work}/root/staging/staging.env" << 'EOF'
ENV_NAME=staging
API_DOMAIN=api-staging.example.test
EOF
  cp "${root}/deploy/docker-compose.yml" "${work}/root/staging/deploy/docker-compose.yml"

  script_rc=0
  env \
    PATH="${work}/bin:${PATH}" \
    CARDHUB_ROOT="${work}/root" \
    CARDHUB_STOP_AFTER_PREVIOUS_IMAGE=1 \
    PREV_STUB_LOG="${docker_log}" \
    PREV_STUB_MODE="${mode}" \
    PREV_STUB_TAG="${tag}" \
    bash "${deploy_script}" staging "${tag}" "${sha}" > "${script_log}" 2>&1 || script_rc=$?

  CASE_RC="${script_rc}"
  CASE_LOG="${script_log}"
  CASE_DOCKER="${docker_log}"
  CASE_DUMPED=0
  echo "CASE mode=${mode} rc=${script_rc}"
}

run_case exists
assert "exists script stops after lookup" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "exists api image" "$(grep -qx "previous_api_image=ghcr.io/xv-jiaqi/cardhub-api:${tag}" "${CASE_LOG}" && echo 0 || echo 1)"
assert "exists web image" "$(grep -qx "previous_web_image=ghcr.io/xv-jiaqi/cardhub-web:${tag}" "${CASE_LOG}" && echo 0 || echo 1)"

run_case missing-object
assert "absent container script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "absent api image is empty" "$(grep -qx 'previous_api_image=' "${CASE_LOG}" && echo 0 || echo 1)"
assert "absent web image is empty" "$(grep -qx 'previous_web_image=' "${CASE_LOG}" && echo 0 || echo 1)"
assert "absent is not an inspect failure" "$(grep -q 'docker inspect of the previous' "${CASE_LOG}" && echo 1 || echo 0)"

run_case inspect-error
assert "inspect error exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "inspect error names the failure" "$(grep -q 'docker inspect of the previous api container exited 1' "${CASE_LOG}" && echo 0 || echo 1)"
assert "inspect error does not record images" "$(grep -q 'previous_api_image=' "${CASE_LOG}" && echo 1 || echo 0)"

run_case other-project
assert "other project script succeeds" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "other project api image is empty" "$(grep -qx 'previous_api_image=' "${CASE_LOG}" && echo 0 || echo 1)"
assert "other project web image is empty" "$(grep -qx 'previous_web_image=' "${CASE_LOG}" && echo 0 || echo 1)"
assert "other project is not treated as a leftover" "$(grep -q 'docker ps still shows one' "${CASE_LOG}" && echo 1 || echo 0)"
assert "fallback filters by project label" "$(grep -q 'label=com.docker.compose.project=cardhub-staging' "${CASE_DOCKER}" && echo 0 || echo 1)"
assert "fallback filters by service label" "$(grep -q 'label=com.docker.compose.service=api' "${CASE_DOCKER}" && grep -q 'label=com.docker.compose.service=web' "${CASE_DOCKER}" && echo 0 || echo 1)"

run_case labeled-leftover
assert "labeled leftover exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "labeled leftover is refused" "$(grep -q 'compose listed no api container, but docker ps still shows one' "${CASE_LOG}" && echo 0 || echo 1)"

if [ "${failed}" -ne 0 ]; then
  echo "previous image lookup tests failed" >&2
  exit 1
fi
echo "previous image lookup tests passed"
