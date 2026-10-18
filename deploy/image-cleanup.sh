#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: image-cleanup.sh [--dry-run] [--root /opt/cardhub]

Deletes old ghcr.io/xv-jiaqi/cardhub-api and cardhub-web sha-* images that are
not the current or previous image for production or staging and are not used by
any local container. A rollout's old and new replicas are both containers, so
both of their image tags and image IDs are kept.
EOF
}

dry_run=0
root="/opt/cardhub"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      dry_run=1
      ;;
    --root)
      if [ "$#" -lt 2 ]; then
        usage
        exit 64
      fi
      root="$2"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 64
      ;;
  esac
  shift
done

docker_bin="${CARDHUB_DOCKER_BIN:-docker}"
repos=(
  "ghcr.io/xv-jiaqi/cardhub-api"
  "ghcr.io/xv-jiaqi/cardhub-web"
)

mkdir -p "${root}"
lock_file="${root}/.image-cleanup.lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"${lock_file}"
  if ! flock -n 9; then
    echo "Image cleanup already running; skipping"
    exit 0
  fi
else
  echo "Warning: flock not found; running image cleanup without concurrency lock" >&2
fi

declare -A keep_refs=()
declare -A used_refs=()
declare -A candidate_refs=()
declare -A keep_ids=()

is_sha_tag() {
  [[ "$1" =~ ^sha-[0-9a-f]{40}$ ]]
}

add_keep_ref() {
  local ref reason
  ref="$1"
  reason="$2"

  for repo in "${repos[@]}"; do
    if [[ "${ref}" == "${repo}:sha-"* ]]; then
      keep_refs["${ref}"]="${keep_refs[${ref}]:-${reason}}"
      return 0
    fi
  done
}

add_previous_refs_from_state() {
  local env_dir state_file api_tag web_tag
  env_dir="$1"
  state_file="${env_dir}/.deploy-state/previous-images.env"

  [ -f "${state_file}" ] || return 0

  api_tag="$(awk -F= '$1 == "PREVIOUS_API_TAG" { print $2 }' "${state_file}" | tail -n 1 | tr -d '\r' || true)"
  web_tag="$(awk -F= '$1 == "PREVIOUS_WEB_TAG" { print $2 }' "${state_file}" | tail -n 1 | tr -d '\r' || true)"

  if is_sha_tag "${api_tag}"; then
    add_keep_ref "ghcr.io/xv-jiaqi/cardhub-api:${api_tag}" "${env_dir} previous api"
  fi
  if is_sha_tag "${web_tag}"; then
    add_keep_ref "ghcr.io/xv-jiaqi/cardhub-web:${web_tag}" "${env_dir} previous web"
  fi
}

add_current_refs_for_project() {
  local project image
  project="$1"

  while IFS= read -r image; do
    [ -n "${image}" ] || continue
    add_keep_ref "${image}" "${project} current"
  done < <("${docker_bin}" ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.Image}}' 2>/dev/null || true)
}

for project in cardhub-prod cardhub-staging; do
  add_current_refs_for_project "${project}"
done

add_previous_refs_from_state "${root}/production"
add_previous_refs_from_state "${root}/staging"

while IFS= read -r image; do
  [ -n "${image}" ] || continue
  used_refs["${image}"]=1
done < <("${docker_bin}" ps -a --format '{{.Image}}' 2>/dev/null || true)

# Image IDs catch a replica whose Config.Image string does not match the tag
# we would otherwise delete (old and new containers during a rollout).
while IFS= read -r cid; do
  [ -n "${cid}" ] || continue
  image_id="$("${docker_bin}" inspect -f '{{.Image}}' "${cid}" 2>/dev/null || true)"
  config_image="$("${docker_bin}" inspect -f '{{.Config.Image}}' "${cid}" 2>/dev/null || true)"
  if [ -n "${image_id}" ]; then
    keep_ids["${image_id}"]=1
  fi
  if [ -n "${config_image}" ]; then
    add_keep_ref "${config_image}" "container ${cid:0:12}"
    used_refs["${config_image}"]=1
  fi
done < <("${docker_bin}" ps -aq 2>/dev/null || true)

for repo in "${repos[@]}"; do
  while IFS= read -r ref; do
    [ -n "${ref}" ] || continue
    tag="${ref##*:}"
    if is_sha_tag "${tag}"; then
      candidate_refs["${ref}"]=1
    fi
  done < <("${docker_bin}" image ls "${repo}" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || true)
done

for ref in "${!candidate_refs[@]}"; do
  if [ -n "${used_refs[${ref}]:-}" ]; then
    keep_refs["${ref}"]="${keep_refs[${ref}]:-container in use}"
  fi
  image_id="$("${docker_bin}" image inspect -f '{{.Id}}' "${ref}" 2>/dev/null || true)"
  if [ -n "${image_id}" ] && [ -n "${keep_ids[${image_id}]:-}" ]; then
    keep_refs["${ref}"]="${keep_refs[${ref}]:-image id in use by a container}"
  fi
done

if [ "${#candidate_refs[@]}" -eq 0 ]; then
  echo "No cardhub sha-* images found for cleanup"
else
  while IFS= read -r ref; do
    [ -n "${ref}" ] || continue
    if [ -n "${keep_refs[${ref}]:-}" ]; then
      echo "KEEP ${ref} (${keep_refs[${ref}]})"
      continue
    fi

    if [ "${dry_run}" -eq 1 ]; then
      echo "DRY-RUN DELETE ${ref}"
    else
      echo "DELETE ${ref}"
      "${docker_bin}" image rm "${ref}"
    fi
  done < <(printf '%s\n' "${!candidate_refs[@]}" | sort)
fi

echo "Cleanup is scoped to cardhub-api/cardhub-web sha-* image tags; skipping machine-wide dangling image prune"
