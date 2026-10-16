#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <production|staging> <sha-40hex-image-tag> <40hex-expected-sha>" >&2
}

if [ "$#" -ne 3 ]; then
  usage
  exit 64
fi

environment="$1"
image_tag="$2"
expected_sha="$3"

case "${environment}" in
  production)
    env_name="prod"
    project="cardhub-prod"
    base_dir="/opt/cardhub/production"
    ;;
  staging)
    env_name="staging"
    project="cardhub-staging"
    base_dir="/opt/cardhub/staging"
    ;;
  *)
    usage
    exit 64
    ;;
esac

if [[ ! "${image_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then
  echo "Invalid image tag: ${image_tag}" >&2
  exit 64
fi

if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid expected SHA: ${expected_sha}" >&2
  exit 64
fi

if [ "${image_tag#sha-}" != "${expected_sha}" ]; then
  echo "Image tag and expected SHA disagree" >&2
  exit 64
fi

app_dir="${base_dir}/deploy"
compose_file="${app_dir}/docker-compose.yml"
env_file="${base_dir}/${environment}.env"

if ! docker network inspect edge >/dev/null 2>&1; then
  echo "Docker network 'edge' does not exist. Start deploy/edge first." >&2
  exit 1
fi

if [ ! -f "${env_file}" ]; then
  echo "Missing env file: ${env_file}" >&2
  exit 1
fi

env_file_env_name="$(awk -F= '$1 == "ENV_NAME" { print $2 }' "${env_file}" | tail -n 1 | tr -d '\r' | sed 's/^"//; s/"$//')"
if [ "${env_file_env_name}" != "${env_name}" ]; then
  echo "ENV_NAME in ${env_file} must be '${env_name}', got '${env_file_env_name:-<missing>}'" >&2
  exit 1
fi

cd "${app_dir}"

tmp=""
cleanup() {
  [ -z "${tmp}" ] || rm -f "${tmp}"
}
trap cleanup EXIT

previous_api_image="$(ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" ps -q api \
  | xargs -r docker inspect -f '{{.Config.Image}}' 2>/dev/null || true)"
previous_web_image="$(ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" ps -q web \
  | xargs -r docker inspect -f '{{.Config.Image}}' 2>/dev/null || true)"
previous_tag=""
if [[ "${previous_api_image}" =~ :sha-[0-9a-f]{40}$ ]] && [[ "${previous_web_image}" =~ :sha-[0-9a-f]{40}$ ]]; then
  previous_api_tag="${previous_api_image##*:}"
  previous_web_tag="${previous_web_image##*:}"
  if [ "${previous_api_tag}" = "${previous_web_tag}" ]; then
    previous_tag="${previous_api_tag}"
  else
    echo "Previous api/web tags differ (${previous_api_tag} vs ${previous_web_tag}); automatic rollback requires matching immutable tags" >&2
  fi
elif [[ "${previous_api_image}" =~ :sha-[0-9a-f]{40}$ ]]; then
  previous_tag="${previous_api_image##*:}"
fi

rollback_armed=0
rollback_in_progress=0

rollback() {
  if [ "${rollback_armed}" -ne 1 ] || [ "${rollback_in_progress}" -eq 1 ]; then
    return 0
  fi
  rollback_in_progress=1
  trap - ERR
  if [[ "${previous_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_tag}" != "${image_tag}" ]; then
    echo "Rolling back ${environment} to ${previous_tag}" >&2
    ENV_NAME="${env_name}" IMAGE_TAG="${previous_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" pull api web || true
    ENV_NAME="${env_name}" IMAGE_TAG="${previous_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" up -d postgres redis api web || true
  else
    echo "No previous immutable sha tag available for automatic rollback" >&2
  fi
}

wait_for_web_health() {
  web_id="$(ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" ps -q web)"
  if [ -z "${web_id}" ]; then
    echo "web container is not running" >&2
    return 1
  fi

  local deadline previous_restart restart_count state health
  deadline=$((SECONDS + 180))
  previous_restart=""

  while [ "${SECONDS}" -lt "${deadline}" ]; do
    state="$(docker inspect -f '{{.State.Status}}' "${web_id}")"
    restart_count="$(docker inspect -f '{{.RestartCount}}' "${web_id}")"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${web_id}")"

    if [ -n "${previous_restart}" ] && [ "${restart_count}" -gt "${previous_restart}" ]; then
      echo "web container restart count increased (${previous_restart} -> ${restart_count})" >&2
      return 1
    fi
    previous_restart="${restart_count}"

    if [ "${state}" != "running" ]; then
      echo "web container state is ${state}" >&2
      return 1
    fi

    case "${health}" in
      healthy)
        ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" exec -T web wget -qO- http://127.0.0.1:8080/healthz >/dev/null
        echo "Verified web container health and /healthz"
        return 0
        ;;
      unhealthy)
        echo "web container is unhealthy" >&2
        return 1
        ;;
    esac

    sleep 5
  done

  echo "Timed out waiting for web container to become healthy" >&2
  return 1
}

on_error() {
  rc="$?"
  rollback
  exit "${rc}"
}
trap on_error ERR

rollback_armed=1
ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" pull api web
ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" up -d postgres redis api web

api_domain="$(awk -F= '$1 == "API_DOMAIN" { print $2 }' "${env_file}" | tail -n 1 | tr -d '\r' | sed 's/^"//; s/"$//')"
if [ -z "${api_domain}" ]; then
  echo "API_DOMAIN is missing from ${env_file}" >&2
  exit 1
fi

tmp="$(mktemp)"

deadline=$((SECONDS + 180))
last_body=""
last_sha=""

while [ "${SECONDS}" -lt "${deadline}" ]; do
  if curl -fsS "https://${api_domain}/health" -o "${tmp}"; then
    last_body="$(cat "${tmp}")"
    last_sha="$(sed -n 's/.*"gitSha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' "${tmp}" | head -n 1)"
    if [ "${last_sha}" = "${expected_sha}" ]; then
      echo "Verified ${api_domain} gitSha=${last_sha}"
      wait_for_web_health
      catalog_seed_cmd="$(awk -F= '$1 == "CATALOG_SEED_CMD" { print substr($0, index($0, "=") + 1) }' "${env_file}" | tail -n 1 | tr -d '\r')"
      if [ -n "${catalog_seed_cmd}" ]; then
        echo "Running catalog seed command"
        ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" exec -T api sh -c "${catalog_seed_cmd}"
      fi
      rollback_armed=0
      exit 0
    fi
  fi
  sleep 5
done

echo "Timed out waiting for https://${api_domain}/health gitSha=${expected_sha}. Last gitSha='${last_sha}', body='${last_body}'" >&2
false
