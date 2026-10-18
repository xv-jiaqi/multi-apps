#!/usr/bin/env bash
# Dry-run of a production dispatch with an older image tag.
# Shows that resolve-deploy-inputs.sh keeps HEAD on the workflow ref and that
# the files the workflow tars are that ref's blobs, not the image commit's.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "${root}"

image_sha="${1:-b1747a590ac2e140decf932b2a603c7ae9f1c28b}"
if [[ ! "${image_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Usage: $0 <40-hex image sha>" >&2
  exit 64
fi

workflow="${root}/.github/workflows/deploy.yml"
if grep -n 'checkout --detach' "${workflow}"; then
  echo "deploy.yml still detaches HEAD to the image SHA" >&2
  exit 1
fi
if ! grep -q 'ref: \${{ github.sha }}' "${workflow}"; then
  echo "deploy.yml does not pin actions/checkout to github.sha" >&2
  exit 1
fi

head_sha="$(git rev-parse HEAD)"
output_file="$(mktemp)"
trap 'rm -f "${output_file}"' EXIT

EVENT_NAME=workflow_dispatch \
  INPUT_ENVIRONMENT=production \
  INPUT_IMAGE_TAG="sha-${image_sha}" \
  GITHUB_REF=refs/heads/main \
  GITHUB_SHA="${head_sha}" \
  GITHUB_OUTPUT="${output_file}" \
  bash deploy/resolve-deploy-inputs.sh

if [ "$(git rev-parse HEAD)" != "${head_sha}" ]; then
  echo "resolve-deploy-inputs.sh moved HEAD" >&2
  exit 1
fi

environment="$(awk -F= '$1 == "environment" { print $2 }' "${output_file}")"
image_tag="$(awk -F= '$1 == "image_tag" { print $2 }' "${output_file}")"
expected_sha="$(awk -F= '$1 == "expected_sha" { print $2 }' "${output_file}")"
if [ "${environment}" != "production" ] || [ "${image_tag}" != "sha-${image_sha}" ] || [ "${expected_sha}" != "${image_sha}" ]; then
  echo "Unexpected resolve output:" >&2
  cat "${output_file}" >&2
  exit 1
fi

echo "workflow_ref=${head_sha}"
echo "dispatch_environment=${environment}"
echo "image_tag=${image_tag}"
echo "HEAD_after_resolve=$(git rev-parse HEAD)"

EVENT_NAME=workflow_dispatch \
  DEPLOY_ENVIRONMENT=production \
  DEPLOY_IMAGE_TAG="sha-${image_sha}" \
  DEPLOY_EXPECTED_SHA="${image_sha}" \
  GITHUB_REF=refs/heads/main \
  GITHUB_SHA="${head_sha}" \
  bash deploy/resolve-deploy-inputs.sh --assert >/tmp/prove-assert.txt
if [ "$(git rev-parse HEAD)" != "${head_sha}" ]; then
  echo "--assert moved HEAD" >&2
  exit 1
fi
echo "assert_mode=$(cat /tmp/prove-assert.txt)"

compare_file() {
  local path="$1"
  local worktree_blob image_blob
  worktree_blob="$(git hash-object "${path}")"
  image_blob="$(git rev-parse "${image_sha}:${path}")"
  if [ "${worktree_blob}" != "$(git rev-parse "HEAD:${path}")" ]; then
    echo "${path} worktree does not match HEAD" >&2
    exit 1
  fi
  echo "${path} worktree=${worktree_blob} image_commit=${image_blob} identical=$([ "${worktree_blob}" = "${image_blob}" ] && echo yes || echo no)"
}

compare_file deploy/edge/docker-compose.yml
compare_file deploy/edge/Caddyfile
compare_file deploy/docker-compose.yml
compare_file deploy/remote-deploy.sh

echo "--- edge volume lines that would be synced (workflow ref) ---"
grep -n '/etc/caddy' deploy/edge/docker-compose.yml
echo "--- edge volume lines at image commit (not synced) ---"
git show "${image_sha}:deploy/edge/docker-compose.yml" | grep -n '/etc/caddy'
echo "--- remote-deploy.sh line counts ---"
echo "workflow_ref $(wc -l < deploy/remote-deploy.sh)"
echo "image_commit $(git show "${image_sha}:deploy/remote-deploy.sh" | wc -l)"
