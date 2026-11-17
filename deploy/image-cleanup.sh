#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: image-cleanup.sh [--dry-run] [--root /opt/cardhub] [--keep-main N]

Deletes old ghcr.io/xv-jiaqi/cardhub-api and cardhub-web sha-* images that are
not protected and are not used by any local container. A rollout's old and new
replicas are both containers, so both of their image tags and image IDs are
kept.

Protected, and never removed:
  - the image running in cardhub-prod and cardhub-staging
  - the previous prod and staging tags in <root>/<env>/.deploy-state/previous-images.env
  - images for the most recent N main commits (default 5, at least 1)
    CARDHUB_CLEANUP_KEEP_MAIN_COMMITS or --keep-main sets N
    SHAs come from CARDHUB_MAIN_SHAS, <root>/.main-shas, or CARDHUB_GIT_DIR

If the production rollback stamp or the main commit list is missing or
unusable, or a docker query fails, the script exits non-zero and deletes
nothing. Running it again is safe: it only considers tags that are still present.
EOF
}

dry_run=0
root="/opt/cardhub"
keep_main_count=""
keep_main_explicit=0

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
    --keep-main)
      if [ "$#" -lt 2 ]; then
        usage
        exit 64
      fi
      keep_main_count="$2"
      keep_main_explicit=1
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

if [ "${keep_main_explicit}" -eq 0 ] && [ -n "${CARDHUB_CLEANUP_KEEP_MAIN_COMMITS:-}" ]; then
  keep_main_count="${CARDHUB_CLEANUP_KEEP_MAIN_COMMITS}"
  keep_main_explicit=1
fi
if [ -z "${keep_main_count}" ]; then
  keep_main_count=5
fi
if ! [[ "${keep_main_count}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Invalid keep-main count: ${keep_main_count}" >&2
  exit 64
fi

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
collected_shas=()

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

remember_sha() {
  local raw="$1"
  local sha existing
  raw="${raw%%#*}"
  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  [ -n "${raw}" ] || return 0
  sha="${raw#sha-}"
  [[ "${sha}" =~ ^[0-9a-f]{40}$ ]] || return 0
  if [ "${#collected_shas[@]}" -gt 0 ]; then
    for existing in "${collected_shas[@]}"; do
      if [ "${existing}" = "${sha}" ]; then
        return 0
      fi
    done
  fi
  collected_shas+=("${sha}")
}

# CARDHUB_MAIN_SHAS wins, then <root>/.main-shas, then git in CARDHUB_GIT_DIR.
# The file's "# keep-count=N" is the cap when neither the flag nor the env
# var set one. Newest commits are first. No usable list means no deletes.
refuse_delete() {
  echo "Refusing to delete images: $1 No images were removed." >&2
  exit 1
}

valid_commit_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

load_main_shas() {
  local line count_from_file git_out sha n repo source_desc raw
  collected_shas=()
  count_from_file=""
  source_desc=""
  if [ -n "${CARDHUB_MAIN_SHAS:-}" ]; then
    source_desc="CARDHUB_MAIN_SHAS"
    for line in ${CARDHUB_MAIN_SHAS}; do
      sha="${line#sha-}"
      if ! valid_commit_sha "${sha}"; then
        refuse_delete "CARDHUB_MAIN_SHAS contains '${line}', which is not a 40-hex commit."
      fi
      remember_sha "${sha}"
    done
  elif [ -f "${root}/.main-shas" ]; then
    source_desc="${root}/.main-shas"
    while IFS= read -r line || [ -n "${line}" ]; do
      case "${line}" in
        "# keep-count="*)
          count_from_file="${line#\# keep-count=}"
          count_from_file="${count_from_file#"${count_from_file%%[![:space:]]*}"}"
          count_from_file="${count_from_file%"${count_from_file##*[![:space:]]}"}"
          if ! [[ "${count_from_file}" =~ ^[1-9][0-9]*$ ]]; then
            refuse_delete "${root}/.main-shas keep-count '${count_from_file}' is not a positive integer."
          fi
          if [ "${keep_main_explicit}" -eq 0 ]; then
            keep_main_count="${count_from_file}"
          fi
          ;;
        ""|"#"*)
          ;;
        *)
          raw="${line%%#*}"
          raw="${raw#"${raw%%[![:space:]]*}"}"
          raw="${raw%"${raw##*[![:space:]]}"}"
          sha="${raw#sha-}"
          if ! valid_commit_sha "${sha}"; then
            refuse_delete "${root}/.main-shas contains '${line}', which is not a 40-hex commit."
          fi
          remember_sha "${sha}"
          ;;
      esac
    done < "${root}/.main-shas"
  elif [ -n "${CARDHUB_GIT_DIR:-}" ]; then
    source_desc="git ${CARDHUB_GIT_DIR}"
    git_out=""
    if git_out="$(git -C "${CARDHUB_GIT_DIR}" rev-list --max-count "${keep_main_count}" origin/main 2>/dev/null)" && [ -n "${git_out}" ]; then
      :
    elif git_out="$(git -C "${CARDHUB_GIT_DIR}" rev-list --max-count "${keep_main_count}" main 2>/dev/null)" && [ -n "${git_out}" ]; then
      :
    else
      git_out=""
    fi
    while IFS= read -r line || [ -n "${line}" ]; do
      [ -n "${line}" ] || continue
      sha="${line#sha-}"
      if ! valid_commit_sha "${sha}"; then
        refuse_delete "git ${CARDHUB_GIT_DIR} produced '${line}', which is not a 40-hex commit."
      fi
      remember_sha "${sha}"
    done <<< "${git_out}"
  fi
  if [ "${#collected_shas[@]}" -eq 0 ]; then
    refuse_delete "no usable main commits in CARDHUB_MAIN_SHAS, ${root}/.main-shas, or CARDHUB_GIT_DIR."
  fi
  n=0
  for sha in "${collected_shas[@]}"; do
    if [ "${n}" -ge "${keep_main_count}" ]; then
      break
    fi
    for repo in "${repos[@]}"; do
      add_keep_ref "${repo}:sha-${sha}" "recent main commit"
    done
    n=$((n + 1))
  done
  echo "Protecting ${n} recent main commits from ${source_desc}"
}

# Both tags must be sha-<40 hex>. A missing or garbage file is not a reason
# to guess "the two newest images"; rollback uses --pull never.
require_prod_rollback_stamp() {
  local state_file api_tag web_tag
  state_file="${root}/production/.deploy-state/previous-images.env"
  if [ ! -f "${state_file}" ]; then
    refuse_delete "${state_file} is missing."
  fi
  api_tag="$(awk -F= '$1 == "PREVIOUS_API_TAG" { print $2 }' "${state_file}" | tail -n 1 | tr -d '\r' || true)"
  web_tag="$(awk -F= '$1 == "PREVIOUS_WEB_TAG" { print $2 }' "${state_file}" | tail -n 1 | tr -d '\r' || true)"
  if ! is_sha_tag "${api_tag}" || ! is_sha_tag "${web_tag}"; then
    refuse_delete "${state_file} has no valid PREVIOUS_API_TAG and PREVIOUS_WEB_TAG."
  fi
  add_keep_ref "ghcr.io/xv-jiaqi/cardhub-api:${api_tag}" "${root}/production previous api"
  add_keep_ref "ghcr.io/xv-jiaqi/cardhub-web:${web_tag}" "${root}/production previous web"
}

# docker's status is the script's status. A failed query exits before any
# image rm. Process substitutions do not surface that status, so capture it.
capture_docker() {
  local __name="$1"
  shift
  local rc=0
  local out=""
  out="$("${docker_bin}" "$@")" || rc=$?
  if [ "${rc}" -ne 0 ]; then
    echo "Refusing to delete images: ${docker_bin} $* failed (${rc}). No images were removed." >&2
    exit 1
  fi
  printf -v "${__name}" '%s' "${out}"
}

add_current_refs_for_project() {
  local project image listed
  project="$1"
  capture_docker listed ps -a --filter "label=com.docker.compose.project=${project}" --format '{{.Image}}'
  while IFS= read -r image; do
    [ -n "${image}" ] || continue
    add_keep_ref "${image}" "${project} current"
  done <<< "${listed}"
}

# Stamp and main commits are checked before docker, so a bad keep-set never
# reaches image rm. Docker failures after that also exit before image rm.
require_prod_rollback_stamp
add_previous_refs_from_state "${root}/staging"
load_main_shas

for project in cardhub-prod cardhub-staging; do
  add_current_refs_for_project "${project}"
done

capture_docker listed_images ps -a --format '{{.Image}}'
while IFS= read -r image; do
  [ -n "${image}" ] || continue
  used_refs["${image}"]=1
done <<< "${listed_images}"

# Image IDs catch a replica whose Config.Image string does not match the tag
# we would otherwise delete (old and new containers during a rollout).
capture_docker listed_cids ps -aq
while IFS= read -r cid; do
  [ -n "${cid}" ] || continue
  capture_docker image_id inspect -f '{{.Image}}' "${cid}"
  capture_docker config_image inspect -f '{{.Config.Image}}' "${cid}"
  if [ -n "${image_id}" ]; then
    keep_ids["${image_id}"]=1
  fi
  if [ -n "${config_image}" ]; then
    add_keep_ref "${config_image}" "container ${cid:0:12}"
    used_refs["${config_image}"]=1
  fi
done <<< "${listed_cids}"

for repo in "${repos[@]}"; do
  capture_docker listed_refs image ls "${repo}" --format '{{.Repository}}:{{.Tag}}'
  while IFS= read -r ref; do
    [ -n "${ref}" ] || continue
    tag="${ref##*:}"
    if is_sha_tag "${tag}"; then
      candidate_refs["${ref}"]=1
    fi
  done <<< "${listed_refs}"
done

if [ "${#candidate_refs[@]}" -gt 0 ]; then
  for ref in "${!candidate_refs[@]}"; do
    if [ -n "${used_refs[${ref}]:-}" ]; then
      keep_refs["${ref}"]="${keep_refs[${ref}]:-container in use}"
    fi
    capture_docker image_id image inspect -f '{{.Id}}' "${ref}"
    if [ -n "${image_id}" ] && [ -n "${keep_ids[${image_id}]:-}" ]; then
      keep_refs["${ref}"]="${keep_refs[${ref}]:-image id in use by a container}"
    fi
  done
fi

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
  done < <(printf '%s\n' "${!candidate_refs[@]}" | LC_ALL=C sort)
fi

echo "Cleanup is scoped to cardhub-api/cardhub-web sha-* image tags; skipping machine-wide dangling image prune"
