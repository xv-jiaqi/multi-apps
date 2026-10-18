#!/usr/bin/env bash
# Fixture-repo tests for the stale deploy/ tree guard.
#
# (a) A GitHub re-run checks out the original commit for up to 30 days. If
#     origin/main has a newer deploy/ tree, syncing that checkout would reload
#     old compose, remote-deploy.sh, and edge.
# (b) A staging run queued on commit A starts after main (and a production
#     edge apply) moved to commit B, and would write A's deploy/ tree back.
#
# Both the edge job (resolve mode) and the deploy job (--assert) go through
# resolve-deploy-inputs.sh. An image SHA that is only an ancestor of main
# must not be treated as success when the trees differ.
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/resolve-deploy-inputs.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

git init --bare -b main "${tmp}/origin.git" >/dev/null
git init -b main "${tmp}/work" >/dev/null
cd "${tmp}/work"
git remote add origin "${tmp}/origin.git"
git config user.email "deploy-tree-guard@example.com"
git config user.name "deploy-tree-guard"

commit_file() {
  local path="$1"
  local body="$2"
  local message="$3"
  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "${body}" > "${path}"
  git add "${path}"
  git commit -m "${message}" >/dev/null
}

commit_file deploy/edge/Caddyfile "old edge" "commit A old deploy tree"
commit_file deploy/remote-deploy.sh "old remote" "commit A remote-deploy"
A="$(git rev-parse HEAD)"
git push -u origin main >/dev/null

commit_file deploy/edge/Caddyfile "new edge" "commit B new edge"
commit_file deploy/docker-compose.yml "services: {}" "commit B new compose"
B="$(git rev-parse HEAD)"
git push origin main >/dev/null

fail_case() {
  local name="$1"
  shift
  local err rc
  err="$(mktemp)"
  set +e
  "$@" >"${err}" 2>&1
  rc=$?
  set -e
  if [ "${rc}" -eq 0 ]; then
    echo "FAIL ${name}: expected non-zero, got 0" >&2
    cat "${err}" >&2
    exit 1
  fi
  if ! grep -q 'Refusing to sync deploy/' "${err}"; then
    echo "FAIL ${name}: stderr did not refuse the deploy tree" >&2
    cat "${err}" >&2
    exit 1
  fi
  if ! grep -q 'HEAD:deploy' "${err}" || ! grep -q 'origin/main:deploy' "${err}"; then
    echo "FAIL ${name}: refusal did not name both trees" >&2
    cat "${err}" >&2
    exit 1
  fi
  echo "OK ${name}"
  rm -f "${err}"
}

pass_case() {
  local name="$1"
  shift
  local out rc
  out="$(mktemp)"
  set +e
  "$@" >"${out}" 2>&1
  rc=$?
  set -e
  if [ "${rc}" -ne 0 ]; then
    echo "FAIL ${name}: expected 0, got ${rc}" >&2
    cat "${out}" >&2
    exit 1
  fi
  if ! grep -q '^Resolved environment=' "${out}"; then
    echo "FAIL ${name}: missing resolution line" >&2
    cat "${out}" >&2
    exit 1
  fi
  echo "OK ${name}"
  rm -f "${out}"
}

output_file="${tmp}/github-output"
: > "${output_file}"

checkout_at() {
  git checkout --detach "$1" >/dev/null
  if [ "$(git rev-parse HEAD)" != "$1" ]; then
    echo "checkout did not land on $1" >&2
    exit 1
  fi
}

# (a) Re-run of the old workflow_dispatch, edge job and deploy job.
checkout_at "${A}"
head_before="$(git rev-parse HEAD)"
fail_case "re-run old commit, edge job resolve mode" \
  env \
    EVENT_NAME=workflow_dispatch \
    INPUT_ENVIRONMENT=production \
    INPUT_IMAGE_TAG="sha-${A}" \
    GITHUB_REF=refs/heads/main \
    GITHUB_SHA="${A}" \
    GITHUB_OUTPUT="${output_file}" \
    bash "${script}"
fail_case "re-run old commit, deploy job assert mode" \
  env \
    EVENT_NAME=workflow_dispatch \
    GITHUB_REF=refs/heads/main \
    GITHUB_SHA="${A}" \
    DEPLOY_ENVIRONMENT=production \
    DEPLOY_IMAGE_TAG="sha-${A}" \
    DEPLOY_EXPECTED_SHA="${A}" \
    bash "${script}" --assert
if [ "$(git rev-parse HEAD)" != "${head_before}" ]; then
  echo "FAIL re-run: guard moved HEAD" >&2
  exit 1
fi
echo "OK re-run left HEAD on the old commit"

# (b) Queued staging run still checked out A after origin/main became B.
fail_case "queued staging run on A after main moved to B, edge job" \
  env \
    EVENT_NAME=workflow_run \
    WORKFLOW_RUN_HEAD_SHA="${A}" \
    GITHUB_SHA="${A}" \
    GITHUB_OUTPUT="${output_file}" \
    bash "${script}"
fail_case "queued staging run on A after main moved to B, deploy job" \
  env \
    EVENT_NAME=workflow_run \
    GITHUB_SHA="${A}" \
    DEPLOY_ENVIRONMENT=staging \
    DEPLOY_IMAGE_TAG="sha-${A}" \
    DEPLOY_EXPECTED_SHA="${A}" \
    bash "${script}" --assert

# Same commit as origin/main: image SHA may be an older ancestor.
git checkout main >/dev/null
if [ "$(git rev-parse HEAD)" != "${B}" ]; then
  echo "main is not B" >&2
  exit 1
fi
pass_case "HEAD deploy tree matches origin/main, older image SHA" \
  env \
    EVENT_NAME=workflow_dispatch \
    INPUT_ENVIRONMENT=production \
    INPUT_IMAGE_TAG="sha-${A}" \
    GITHUB_REF=refs/heads/main \
    GITHUB_SHA="${B}" \
    GITHUB_OUTPUT="${output_file}" \
    bash "${script}"
pass_case "HEAD deploy tree matches origin/main, deploy job assert" \
  env \
    EVENT_NAME=workflow_dispatch \
    GITHUB_REF=refs/heads/main \
    GITHUB_SHA="${B}" \
    DEPLOY_ENVIRONMENT=production \
    DEPLOY_IMAGE_TAG="sha-${B}" \
    DEPLOY_EXPECTED_SHA="${B}" \
    bash "${script}" --assert

# Main moved, but only outside deploy/. The older checkout's deploy tree is
# still safe to sync.
commit_file README-app.txt "app only" "commit C outside deploy"
C="$(git rev-parse HEAD)"
git push origin main >/dev/null
if [ "$(git rev-parse HEAD:deploy)" != "$(git rev-parse "${B}:deploy")" ]; then
  echo "non-deploy commit changed the deploy tree" >&2
  exit 1
fi
checkout_at "${B}"
pass_case "commits differ but deploy trees match, edge job" \
  env \
    EVENT_NAME=workflow_run \
    WORKFLOW_RUN_HEAD_SHA="${B}" \
    GITHUB_SHA="${B}" \
    GITHUB_OUTPUT="${output_file}" \
    bash "${script}"
pass_case "commits differ but deploy trees match, deploy job" \
  env \
    EVENT_NAME=workflow_run \
    GITHUB_SHA="${B}" \
    DEPLOY_ENVIRONMENT=staging \
    DEPLOY_IMAGE_TAG="sha-${B}" \
    DEPLOY_EXPECTED_SHA="${B}" \
    bash "${script}" --assert

echo "deploy tree guard tests passed (A=${A} B=${B} C=${C})"
