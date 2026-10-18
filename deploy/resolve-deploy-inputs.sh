#!/usr/bin/env bash
# Resolve the environment and container image for this deploy.
#
# Infra files (compose, remote-deploy.sh, deploy/edge) stay on the workflow
# ref in GITHUB_SHA. The image tag is only an ancestor of origin/main. This
# script must not check that commit out: doing so shipped pre-#103 edge
# config and the old remote-deploy.sh when production was rolled back to an
# older image.
#
# The workflow ref itself can still be stale. GitHub re-runs an old run on
# its original commit for 30 days, and a queued run keeps the commit it was
# created with. Both jobs call this script, and both refuse unless the
# checkout's deploy/ tree is the same object as origin/main:deploy.
set -euo pipefail

mode="resolve"
if [ "${1:-}" = "--assert" ]; then
  mode="assert"
elif [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--assert]" >&2
  exit 64
fi

if [ -z "${GITHUB_SHA:-}" ]; then
  echo "GITHUB_SHA is required" >&2
  exit 64
fi

head_before="$(git rev-parse HEAD)"
if [ "${head_before}" != "${GITHUB_SHA}" ]; then
  echo "Checkout ${head_before} is not the workflow ref ${GITHUB_SHA}" >&2
  exit 1
fi

if [ "${mode}" = "assert" ]; then
  deploy_environment="${DEPLOY_ENVIRONMENT:?DEPLOY_ENVIRONMENT is required}"
  image_tag="${DEPLOY_IMAGE_TAG:?DEPLOY_IMAGE_TAG is required}"
  expected_sha="${DEPLOY_EXPECTED_SHA:?DEPLOY_EXPECTED_SHA is required}"

  if [[ "${deploy_environment}" != "staging" && "${deploy_environment}" != "production" ]]; then
    echo "Invalid environment: ${deploy_environment}" >&2
    exit 1
  fi
  if [[ ! "${image_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then
    echo "Invalid image_tag '${image_tag}'" >&2
    exit 1
  fi
  if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid expected SHA '${expected_sha}'" >&2
    exit 1
  fi
  if [ "${image_tag#sha-}" != "${expected_sha}" ]; then
    echo "Image tag and expected SHA disagree" >&2
    exit 1
  fi
else
  if [[ "${EVENT_NAME:?EVENT_NAME is required}" == "workflow_run" ]]; then
    deploy_environment="staging"
    expected_sha="${WORKFLOW_RUN_HEAD_SHA:?WORKFLOW_RUN_HEAD_SHA is required}"
    image_tag="sha-${expected_sha}"
  else
    deploy_environment="${INPUT_ENVIRONMENT:?INPUT_ENVIRONMENT is required}"
    image_tag="${INPUT_IMAGE_TAG:?INPUT_IMAGE_TAG is required}"

    if [[ "${GITHUB_REF:?GITHUB_REF is required}" != "refs/heads/main" ]]; then
      echo "Manual deploys must be run from refs/heads/main, got ${GITHUB_REF}" >&2
      exit 1
    fi

    if [[ "${deploy_environment}" != "staging" && "${deploy_environment}" != "production" ]]; then
      echo "Invalid environment: ${deploy_environment}" >&2
      exit 1
    fi

    if [[ "${deploy_environment}" == "staging" && "${image_tag}" == "main" ]]; then
      expected_sha="$(git ls-remote origin refs/heads/main | awk '{ print $1 }')"
      image_tag="sha-${expected_sha}"
    elif [[ "${image_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then
      expected_sha="${image_tag#sha-}"
    else
      echo "Invalid image_tag '${image_tag}'. Production requires sha-<40 hex>; staging accepts sha-<40 hex> or main." >&2
      exit 1
    fi
  fi

  if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Could not resolve a full deployment SHA" >&2
    exit 1
  fi
fi

if [ "${mode}" = "assert" ] && [ "${EVENT_NAME:-}" != "workflow_run" ] && [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "Manual deploys must be run from refs/heads/main, got ${GITHUB_REF:-<unset>}" >&2
  exit 1
fi

git fetch --no-tags origin main:refs/remotes/origin/main
if ! git merge-base --is-ancestor "${expected_sha}" origin/main; then
  echo "Refusing to deploy ${expected_sha}: SHA is not reachable from origin/main" >&2
  exit 1
fi

# An ancestor check on the image SHA still returns success when this checkout's
# deploy/ tree is older than origin/main. Compare the whole tree (compose,
# remote-deploy.sh, edge, everything), not only deploy/edge.
if ! head_deploy="$(git rev-parse --verify --quiet HEAD:deploy)" || [ -z "${head_deploy}" ]; then
  echo "Refusing to sync deploy/: HEAD has no deploy tree. The checkout must contain deploy/ and be deep enough to resolve it (fetch-depth: 0)." >&2
  exit 1
fi
if ! main_deploy="$(git rev-parse --verify --quiet origin/main:deploy)" || [ -z "${main_deploy}" ]; then
  echo "Refusing to sync deploy/: origin/main has no deploy tree. Fetch origin/main with enough history (fetch-depth: 0)." >&2
  exit 1
fi
if [ "${head_deploy}" != "${main_deploy}" ]; then
  echo "Refusing to sync deploy/: HEAD:deploy ${head_deploy} != origin/main:deploy ${main_deploy}. A re-run of an old commit or a queued run would overwrite compose, remote-deploy.sh, and the shared edge with this older tree." >&2
  exit 1
fi

head_after="$(git rev-parse HEAD)"
if [ "${head_after}" != "${head_before}" ]; then
  echo "Refusing to continue: input resolution moved HEAD from ${head_before} to ${head_after}" >&2
  exit 1
fi

if [ "${mode}" = "resolve" ]; then
  if [ -z "${GITHUB_OUTPUT:-}" ]; then
    echo "GITHUB_OUTPUT is required" >&2
    exit 64
  fi
  {
    echo "environment=${deploy_environment}"
    echo "image_tag=${image_tag}"
    echo "expected_sha=${expected_sha}"
  } >> "${GITHUB_OUTPUT}"
fi

echo "Resolved environment=${deploy_environment} image_tag=${image_tag} infra_ref=${head_after}"
