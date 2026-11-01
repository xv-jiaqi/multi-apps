#!/usr/bin/env bash
# Resolve the cardhub-api and cardhub-web digests for DEPLOY_EXPECTED_SHA.
#
# The digest is the one the successful Cardhub Images run for that exact
# head SHA recorded from docker/build-push-action (artifacts
# image-digest-api and image-digest-web). A registry tag is consulted only
# when that successful run has no digest artifact: a build from before
# artifacts existed, or one whose artifact retention expired. The tag is
# never read while the newest Images run for the SHA is still in progress,
# failed, or missing. This script prints no digest and exits non-zero in
# those cases.
#
# Fixture mode (tests, no network):
#   CARDHUB_IMAGES_FIXTURE=/path
#     runs.tsv
#       created_at <TAB> id <TAB> status <TAB> conclusion <TAB> head_sha
#     artifacts/<id>/image-digest-api
#     artifacts/<id>/image-digest-web
#   CARDHUB_IMAGE_DIGEST_CMD receives "<image>" "<tag>" and prints a digest,
#   or exits non-zero when the manifest is missing. Used only for the
#   tag fallback.
set -euo pipefail

expected_sha="${DEPLOY_EXPECTED_SHA:-}"
if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DEPLOY_EXPECTED_SHA must be 40 hex characters" >&2
  exit 64
fi

repository="${GITHUB_REPOSITORY:-}"
workflow_file="${CARDHUB_IMAGES_WORKFLOW:-images.yml}"
attempts="${CARDHUB_DIGEST_WAIT_ATTEMPTS:-60}"
sleep_seconds="${CARDHUB_DIGEST_WAIT_SECONDS:-10}"
fixture="${CARDHUB_IMAGES_FIXTURE:-}"
api_repo="${CARDHUB_API_REPO:-ghcr.io/xv-jiaqi/cardhub-api}"
web_repo="${CARDHUB_WEB_REPO:-ghcr.io/xv-jiaqi/cardhub-web}"

if ! [[ "${attempts}" =~ ^[0-9]+$ ]] || [ "${attempts}" -lt 1 ]; then
  echo "Invalid CARDHUB_DIGEST_WAIT_ATTEMPTS: ${attempts}" >&2
  exit 64
fi
if ! [[ "${sleep_seconds}" =~ ^[0-9]+$ ]]; then
  echo "Invalid CARDHUB_DIGEST_WAIT_SECONDS: ${sleep_seconds}" >&2
  exit 64
fi
if [ -z "${fixture}" ] && [ -z "${repository}" ]; then
  echo "GITHUB_REPOSITORY is required" >&2
  exit 64
fi

valid_image_digest() {
  [[ "$1" =~ ^sha256:[0-9a-f]{64}$ ]]
}

# created_at, id, status, conclusion, head_sha. Newest first.
list_image_runs() {
  if [ -n "${fixture}" ]; then
    if [ ! -f "${fixture}/runs.tsv" ]; then
      return 0
    fi
    awk -F '\t' -v OFS='\t' -v sha="${expected_sha}" '
      /^[[:space:]]*#/ { next }
      /^[[:space:]]*$/ { next }
      NF >= 5 && $5 == sha { print }
    ' "${fixture}/runs.tsv" | sort -r
    return 0
  fi
  gh api --paginate \
    "/repos/${repository}/actions/workflows/${workflow_file}/runs?head_sha=${expected_sha}&per_page=100" \
    --jq '.workflow_runs[] | [.created_at, (.id|tostring), .status, (.conclusion // ""), .head_sha] | @tsv' \
    | awk -F '\t' -v OFS='\t' -v sha="${expected_sha}" 'NF >= 5 && $5 == sha { print }' \
    | sort -r
}

# One line: success <id> | failed <conclusion> <id> | in_progress <id> | missing
# Skipped runs are not builds. The newest remaining run decides.
classify_runs() {
  local created run_id status conclusion head
  local saw=0
  while IFS=$'\t' read -r created run_id status conclusion head; do
    [ -n "${run_id}" ] || continue
    if [ "${conclusion}" = "skipped" ]; then
      continue
    fi
    saw=1
    if [ "${status}" != "completed" ]; then
      printf 'in_progress\t%s\n' "${run_id}"
      return 0
    fi
    if [ "${conclusion}" = "success" ]; then
      printf 'success\t%s\n' "${run_id}"
      return 0
    fi
    printf 'failed\t%s\t%s\n' "${conclusion:-unknown}" "${run_id}"
    return 0
  done
  printf 'missing\n'
}

# Status 0 prints a valid digest. Status 1: artifact present but not a
# digest. Status 2: this successful run has no such artifact (or it
# expired). Status 3: the artifact is there but downloading it failed.
# Only status 2 may fall back to the tag.
read_run_digest() {
  local run_id="$1"
  local name="$2"
  local raw=""
  if [ -n "${fixture}" ]; then
    if [ -f "${fixture}/artifacts/${run_id}/${name}.download-fail" ]; then
      echo "Refusing deploy: could not download digest artifact ${name} from Images run ${run_id}. Running containers were not changed." >&2
      return 3
    fi
    local f="${fixture}/artifacts/${run_id}/${name}"
    if [ ! -f "${f}" ]; then
      return 2
    fi
    raw="$(tr -d '[:space:]' < "${f}")"
  else
    local list dir aname aid aexpired found
    list="$(mktemp)"
    if ! gh api --paginate \
      "/repos/${repository}/actions/runs/${run_id}/artifacts?per_page=100" \
      --jq '.artifacts[] | [.name, (.id|tostring), (.expired|tostring)] | @tsv' > "${list}"; then
      rm -f "${list}"
      echo "Refusing deploy: could not list digest artifacts for Images run ${run_id}. Running containers were not changed." >&2
      return 3
    fi
    found=0
    while IFS=$'\t' read -r aname aid aexpired; do
      [ "${aname}" = "${name}" ] || continue
      found=1
      if [ "${aexpired}" = "true" ]; then
        rm -f "${list}"
        return 2
      fi
    done < "${list}"
    rm -f "${list}"
    if [ "${found}" -eq 0 ]; then
      return 2
    fi
    dir="$(mktemp -d)"
    if ! gh run download "${run_id}" -R "${repository}" -n "${name}" -D "${dir}" >/dev/null 2>&1; then
      rm -rf "${dir}"
      echo "Refusing deploy: could not download digest artifact ${name} from Images run ${run_id}. Running containers were not changed." >&2
      return 3
    fi
    if [ ! -f "${dir}/digest" ]; then
      rm -rf "${dir}"
      echo "Refusing deploy: digest artifact ${name} from Images run ${run_id} has no digest file. Running containers were not changed." >&2
      return 3
    fi
    raw="$(tr -d '[:space:]' < "${dir}/digest")"
    rm -rf "${dir}"
  fi
  if ! valid_image_digest "${raw}"; then
    echo "Digest artifact ${name} from Images run ${run_id} is not sha256:<64 hex>" >&2
    return 1
  fi
  printf '%s\n' "${raw}"
}

resolve_tag_digest() {
  local image="$1"
  local tag="$2"
  local out=""
  if [ -n "${CARDHUB_IMAGE_DIGEST_CMD:-}" ]; then
    out="$("${CARDHUB_IMAGE_DIGEST_CMD}" "${image}" "${tag}")" || return 1
  else
    out="$(docker buildx imagetools inspect --format '{{.Digest}}' "${image}:${tag}")" || return 1
  fi
  out="$(printf '%s' "${out}" | tr -d '[:space:]')"
  if ! valid_image_digest "${out}"; then
    return 1
  fi
  printf '%s\n' "${out}"
}

attempt=1
decision=""
while [ "${attempt}" -le "${attempts}" ]; do
  runs="$(list_image_runs)" || {
    echo "Refusing deploy: could not list Cardhub Images runs for ${expected_sha}" >&2
    exit 1
  }
  decision="$(printf '%s\n' "${runs}" | classify_runs)"
  kind="${decision%%$'\t'*}"
  case "${kind}" in
    success|failed)
      break
      ;;
    in_progress|missing)
      if [ "${attempt}" -ge "${attempts}" ]; then
        break
      fi
      echo "Waiting for Cardhub Images run for ${expected_sha} (${kind}, attempt ${attempt}/${attempts})" >&2
      if [ "${sleep_seconds}" -gt 0 ]; then
        sleep "${sleep_seconds}"
      fi
      attempt=$((attempt + 1))
      ;;
    *)
      echo "Refusing deploy: unexpected Images run state '${kind}' for ${expected_sha}" >&2
      exit 1
      ;;
  esac
done

kind="${decision%%$'\t'*}"
rest="${decision#*$'\t'}"
case "${kind}" in
  success)
    run_id="${rest%%$'\t'*}"
    ;;
  failed)
    conclusion="${rest%%$'\t'*}"
    run_id="${rest#*$'\t'}"
    echo "Refusing deploy: Cardhub Images run ${run_id} for ${expected_sha} concluded ${conclusion}. Running containers were not changed." >&2
    exit 1
    ;;
  in_progress)
    run_id="${rest%%$'\t'*}"
    echo "Refusing deploy: Cardhub Images run ${run_id} for ${expected_sha} is still in progress. Running containers were not changed." >&2
    exit 1
    ;;
  missing)
    echo "Refusing deploy: no Cardhub Images run for ${expected_sha}. Running containers were not changed." >&2
    exit 1
    ;;
  *)
    echo "Refusing deploy: could not classify Cardhub Images runs for ${expected_sha}. Running containers were not changed." >&2
    exit 1
    ;;
esac

api_rc=0
web_rc=0
api_digest="$(read_run_digest "${run_id}" image-digest-api)" || api_rc=$?
web_digest="$(read_run_digest "${run_id}" image-digest-web)" || web_rc=$?

if [ "${api_rc}" -eq 1 ] || [ "${web_rc}" -eq 1 ]; then
  echo "Refusing deploy: Images run ${run_id} published an unusable digest artifact. Running containers were not changed." >&2
  exit 1
fi
if [ "${api_rc}" -eq 3 ] || [ "${web_rc}" -eq 3 ]; then
  exit 1
fi
if [ "${api_rc}" -ne "${web_rc}" ]; then
  echo "Refusing deploy: Images run ${run_id} is missing one digest artifact. Running containers were not changed." >&2
  exit 1
fi

source="artifact"
if [ "${api_rc}" -ne 0 ] || [ "${web_rc}" -ne 0 ]; then
  echo "::warning::Images run ${run_id} has no digest artifact; resolving sha-${expected_sha} because that run succeeded" >&2
  source="tag"
  api_digest="$(resolve_tag_digest "${api_repo}" "sha-${expected_sha}")" || {
    echo "Refusing deploy: manifest for ${api_repo}:sha-${expected_sha} is missing. Running containers were not changed." >&2
    exit 1
  }
  web_digest="$(resolve_tag_digest "${web_repo}" "sha-${expected_sha}")" || {
    echo "Refusing deploy: manifest for ${web_repo}:sha-${expected_sha} is missing. Running containers were not changed." >&2
    exit 1
  }
fi

if ! valid_image_digest "${api_digest}" || ! valid_image_digest "${web_digest}"; then
  echo "Refusing deploy: resolved digests for ${expected_sha} are not sha256:<64 hex>. Running containers were not changed." >&2
  exit 1
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    printf 'api_digest=%s\n' "${api_digest}"
    printf 'web_digest=%s\n' "${web_digest}"
  } >> "${GITHUB_OUTPUT}"
fi

echo "Resolved api_digest=${api_digest} web_digest=${web_digest} source=${source} images_run=${run_id}"
