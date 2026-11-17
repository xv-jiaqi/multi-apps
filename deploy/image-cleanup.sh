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
  - when production has no rollback stamp, the two newest local sha tags of each repo
  - images for the most recent N main commits (default 5)
    CARDHUB_CLEANUP_KEEP_MAIN_COMMITS or --keep-main sets N
    SHAs come from CARDHUB_MAIN_SHAS, <root>/.main-shas, or CARDHUB_GIT_DIR

Running the script again is safe: it only considers tags that are still present.
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
if ! [[ "${keep_main_count}" =~ ^[0-9]+$ ]]; then
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
prod_api_rollback_recorded=0
prod_web_rollback_recorded=0

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
    if [ "${env_dir}" = "${root}/production" ]; then
      prod_api_rollback_recorded=1
    fi
  fi
  if is_sha_tag "${web_tag}"; then
    add_keep_ref "ghcr.io/xv-jiaqi/cardhub-web:${web_tag}" "${env_dir} previous web"
    if [ "${env_dir}" = "${root}/production" ]; then
      prod_web_rollback_recorded=1
    fi
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
# var set one. Newest commits are first. Missing input warns and continues.
load_main_shas() {
  local line count_from_file git_out sha n repo source_desc
  collected_shas=()
  if [ "${keep_main_count}" -eq 0 ] && [ "${keep_main_explicit}" -eq 1 ]; then
    return 0
  fi
  count_from_file=""
  source_desc=""
  if [ -n "${CARDHUB_MAIN_SHAS:-}" ]; then
    source_desc="CARDHUB_MAIN_SHAS"
    for line in ${CARDHUB_MAIN_SHAS}; do
      remember_sha "${line}"
    done
  elif [ -f "${root}/.main-shas" ]; then
    source_desc="${root}/.main-shas"
    while IFS= read -r line || [ -n "${line}" ]; do
      case "${line}" in
        "# keep-count="*)
          count_from_file="${line#\# keep-count=}"
          count_from_file="${count_from_file#"${count_from_file%%[![:space:]]*}"}"
          count_from_file="${count_from_file%"${count_from_file##*[![:space:]]}"}"
          ;;
        "#"*)
          ;;
        *)
          remember_sha "${line}"
          ;;
      esac
    done < "${root}/.main-shas"
    if [ "${keep_main_explicit}" -eq 0 ] && [[ "${count_from_file}" =~ ^[0-9]+$ ]]; then
      keep_main_count="${count_from_file}"
    fi
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
      remember_sha "${line}"
    done <<< "${git_out}"
  fi
  if [ "${#collected_shas[@]}" -eq 0 ]; then
    echo "Warning: no recent main commits to protect. Set CARDHUB_MAIN_SHAS, ${root}/.main-shas, or CARDHUB_GIT_DIR." >&2
    return 0
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

# Production rollback stamp missing: keep the two newest local sha tags of
# this repo so the latest prod image and the one before it are not deleted.
keep_two_newest_without_prod_stamp() {
  local repo="$1"
  local ref created line count
  local -a ranked=()
  local -a newest=()
  if [ "${#candidate_refs[@]}" -eq 0 ]; then
    return 0
  fi
  for ref in "${!candidate_refs[@]}"; do
    case "${ref}" in
      "${repo}:sha-"*) ;;
      *) continue ;;
    esac
    created="$("${docker_bin}" image inspect -f '{{.Created}}' "${ref}" 2>/dev/null || true)"
    if [ -z "${created}" ]; then
      created="9999-99-99T99:99:99Z"
    fi
    created="${created//[[:space:]]/T}"
    ranked+=("${created}"$'\t'"${ref}")
  done
  if [ "${#ranked[@]}" -eq 0 ]; then
    return 0
  fi
  mapfile -t newest < <(printf '%s\n' "${ranked[@]}" | LC_ALL=C sort -r)
  count=0
  for line in "${newest[@]}"; do
    ref="${line#*$'\t'}"
    [ -n "${ref}" ] || continue
    add_keep_ref "${ref}" "two newest ${repo##*/} images; production rollback stamp is missing"
    count=$((count + 1))
    if [ "${count}" -ge 2 ]; then
      break
    fi
  done
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

if [ "${prod_api_rollback_recorded}" -eq 0 ]; then
  keep_two_newest_without_prod_stamp "${repos[0]}"
fi
if [ "${prod_web_rollback_recorded}" -eq 0 ]; then
  keep_two_newest_without_prod_stamp "${repos[1]}"
fi
load_main_shas

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
