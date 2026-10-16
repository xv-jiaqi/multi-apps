#!/usr/bin/env bash
set -euo pipefail

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

previous_image="$(docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" ps -q api \
  | xargs -r docker inspect -f '{{.Config.Image}}' 2>/dev/null || true)"
previous_tag=""
if [[ "${previous_image}" =~ :sha-[0-9a-f]{40}$ ]]; then
  previous_tag="${previous_image##*:}"
fi

rollback() {
  if [[ "${previous_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_tag}" != "${image_tag}" ]; then
    echo "Rolling back ${environment} to ${previous_tag}" >&2
    ENV_NAME="${env_name}" IMAGE_TAG="${previous_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" pull api web || true
    ENV_NAME="${env_name}" IMAGE_TAG="${previous_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" up -d postgres redis api web || true
  else
    echo "No previous immutable sha tag available for automatic rollback" >&2
  fi
}

ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" pull api web
ENV_NAME="${env_name}" IMAGE_TAG="${image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" up -d postgres redis api web

api_domain="$(awk -F= '$1 == "API_DOMAIN" { print $2 }' "${env_file}" | tail -n 1 | tr -d '\r' | sed 's/^"//; s/"$//')"
if [ -z "${api_domain}" ]; then
  echo "API_DOMAIN is missing from ${env_file}" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

deadline=$((SECONDS + 180))
last_body=""
last_sha=""

while [ "${SECONDS}" -lt "${deadline}" ]; do
  if curl -fsS "https://${api_domain}/health" -o "${tmp}"; then
    last_body="$(cat "${tmp}")"
    last_sha="$(sed -n 's/.*"gitSha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' "${tmp}" | head -n 1)"
    if [ "${last_sha}" = "${expected_sha}" ]; then
      echo "Verified ${api_domain} gitSha=${last_sha}"
      exit 0
    fi
  fi
  sleep 5
done

echo "Timed out waiting for https://${api_domain}/health gitSha=${expected_sha}. Last gitSha='${last_sha}', body='${last_body}'" >&2
rollback
exit 1
