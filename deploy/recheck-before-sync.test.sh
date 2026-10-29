#!/usr/bin/env bash
# The deploy job's first --assert is followed by a GHCR wait of up to ~10
# minutes. A commit that changes deploy/ can land on main during that wait.
# The job must fetch origin/main and run resolve-deploy-inputs.sh --assert
# again as the step immediately before it syncs, and that second assert must
# exit 1 before any file is uploaded. The edge job has the same adjacent
# re-check before its sync.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="${root}/.github/workflows/deploy.yml"
script="${root}/deploy/resolve-deploy-inputs.sh"

# Print the run text of the step immediately before sync_name in job.
# Exit 1 when that step is missing or is not a fresh --assert.
step_before() {
  local job="$1"
  local sync_name="$2"
  awk -v job="${job}" -v sync_name="${sync_name}" '
    BEGIN { header = "  " job ":" }
    $0 == header { in_job = 1; next }
    in_job && /^  [^ ]/ { exit }
    in_job { print }
  ' "${workflow}" | awk -v sync_name="${sync_name}" -v job="${job}" '
    /^      - name: / {
      if (name != "") {
        names[++n] = name
        runs[n] = run
      }
      name = substr($0, 15)
      gsub(/^"|"$/, "", name)
      run = ""
      next
    }
    name != "" { run = run $0 "\n" }
    END {
      if (name != "") {
        names[++n] = name
        runs[n] = run
      }
      sync_at = 0
      for (i = 1; i <= n; i++) {
        if (names[i] == sync_name) sync_at = i
      }
      if (sync_at == 0) {
        printf "FAIL %s: no step named %s\n", job, sync_name > "/dev/stderr"
        exit 1
      }
      if (sync_at == 1) {
        printf "FAIL %s: %s is the first named step\n", job, sync_name > "/dev/stderr"
        exit 1
      }
      prev = runs[sync_at - 1]
      prev_name = names[sync_at - 1]
      if (prev ~ /resolve-deploy-inputs\.sh --assert/ && prev ~ /git fetch/ && prev ~ /origin/ && prev ~ /main/) {
        printf "OK %s: step %s is immediately before %s\n", job, prev_name, sync_name
        exit 0
      }
      printf "FAIL %s: step immediately before \"%s\" is \"%s\", which does not fetch origin/main and run resolve-deploy-inputs.sh --assert\n", job, sync_name, prev_name > "/dev/stderr"
      exit 1
    }
  '
}

deploy_rechecks=0
edge_rechecks=0
if step_before deploy "Sync deploy files"; then
  deploy_rechecks=1
fi
if step_before edge "Sync edge files"; then
  edge_rechecks=1
fi

# The image wait must stay before the deploy re-check, never between the
# re-check and the upload.
if [ "${deploy_rechecks}" -eq 1 ]; then
  if ! awk '
    /^  deploy:$/ { in_job = 1; next }
    in_job && /^  [^ ]/ { exit }
    in_job { print }
  ' "${workflow}" | awk '
    /^      - name: / { name = substr($0, 15); names[++n] = name }
    END {
      wait_at = 0
      sync_at = 0
      for (i = 1; i <= n; i++) {
        if (names[i] == "Wait for GHCR images") wait_at = i
        if (names[i] == "Sync deploy files") sync_at = i
      }
      if (wait_at == 0 || sync_at == 0 || wait_at >= sync_at - 1) exit 1
    }
  '; then
    echo "FAIL deploy: Wait for GHCR images is not strictly before the re-check that precedes sync" >&2
    deploy_rechecks=0
  fi
fi

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

git init --bare -b main "${tmp}/origin.git" >/dev/null
git init -b main "${tmp}/work" >/dev/null
git -C "${tmp}/work" remote add origin "${tmp}/origin.git"
git -C "${tmp}/work" config user.email "recheck-before-sync@example.com"
git -C "${tmp}/work" config user.name "recheck-before-sync"

mkdir -p "${tmp}/work/deploy"
printf 'compose-a\n' > "${tmp}/work/deploy/docker-compose.yml"
printf 'edge-a\n' > "${tmp}/work/deploy/Caddyfile"
git -C "${tmp}/work" add deploy
git -C "${tmp}/work" commit -m "A" >/dev/null
A="$(git -C "${tmp}/work" rev-parse HEAD)"
git -C "${tmp}/work" push -u origin main >/dev/null

output_file="${tmp}/github-output"
: > "${output_file}"
sync_marker="${tmp}/synced"

run_assert() {
  (
    cd "${tmp}/work"
    EVENT_NAME=workflow_dispatch \
      GITHUB_REF=refs/heads/main \
      GITHUB_SHA="${A}" \
      DEPLOY_ENVIRONMENT=production \
      DEPLOY_IMAGE_TAG="sha-${A}" \
      DEPLOY_EXPECTED_SHA="${A}" \
      bash "${script}" --assert
  )
}

if ! run_assert >"${tmp}/first-assert.log" 2>&1; then
  echo "FAIL first assert should pass while HEAD:deploy matches origin/main" >&2
  cat "${tmp}/first-assert.log" >&2
  exit 1
fi
echo "OK first assert passed while HEAD:deploy matched origin/main"

git clone --quiet "${tmp}/origin.git" "${tmp}/side"
git -C "${tmp}/side" config user.email "recheck-before-sync@example.com"
git -C "${tmp}/side" config user.name "recheck-before-sync"
printf 'compose-b\n' > "${tmp}/side/deploy/docker-compose.yml"
git -C "${tmp}/side" add deploy/docker-compose.yml
git -C "${tmp}/side" commit -m "B changes deploy during the image wait" >/dev/null
git -C "${tmp}/side" push origin main >/dev/null
if [ "$(git -C "${tmp}/work" rev-parse HEAD)" != "${A}" ]; then
  echo "FAIL fixture moved the checked-out workflow ref" >&2
  exit 1
fi
echo "OK origin/main deploy/ changed after the first assert; checkout stayed on ${A}"

set +e
run_assert >"${tmp}/second-assert.log" 2>&1
second_rc=$?
set -e
if [ "${second_rc}" -eq 0 ]; then
  echo "FAIL second assert exited 0 after deploy/ changed on main" >&2
  cat "${tmp}/second-assert.log" >&2
  exit 1
fi
if ! grep -q 'Refusing to sync deploy/' "${tmp}/second-assert.log"; then
  echo "FAIL second assert did not refuse the stale deploy tree" >&2
  cat "${tmp}/second-assert.log" >&2
  exit 1
fi
echo "OK second assert exited ${second_rc} before sync"
sed -n 's/^/  /p' "${tmp}/second-assert.log" | grep 'Refusing to sync deploy/'

if [ "${deploy_rechecks}" -ne 1 ] || [ "${edge_rechecks}" -ne 1 ]; then
  # Old workflow: the image wait sits directly against the sync step, so this
  # run uploads the checkout it already asserted.
  printf 'synced stale deploy tree from %s\n' "${A}" > "${sync_marker}"
  echo "FAIL fix reverted: the job would sync after the image wait. Marker: $(cat "${sync_marker}")" >&2
  echo "FAIL second assert was not wired immediately before sync (deploy_rechecks=${deploy_rechecks} edge_rechecks=${edge_rechecks})" >&2
  exit 1
fi

if [ -e "${sync_marker}" ]; then
  echo "FAIL sync marker exists after the second assert refused" >&2
  exit 1
fi
echo "OK sync marker absent; nothing was uploaded"

# Re-check and Sync must not grow an if: or continue-on-error. Either one
# would let a failed assert fall through into the upload.
step_keys() {
  local job="$1"
  local step="$2"
  # The second awk used to exit at the next step. That closes the pipe while
  # the first awk is still writing the rest of the job, so pipefail turns a
  # passing check into SIGPIPE (exit 141). Keep reading until EOF.
  awk -v job="${job}" -v step="${step}" '
    BEGIN { header = "  " job ":" }
    $0 == header { in_job = 1; next }
    in_job && /^  [^ ]/ { exit }
    in_job { print }
  ' "${workflow}" | awk -v step="${step}" '
    done { next }
    /^      - name: / {
      if (capturing) {
        capturing = 0
        done = 1
        next
      }
      name = substr($0, 15)
      gsub(/^"|"$/, "", name)
      if (name == step) capturing = 1
      next
    }
    capturing { print }
  '
}

for pair in \
  "deploy|Re-check deploy tree before sync" \
  "deploy|Sync deploy files" \
  "edge|Re-check deploy tree before sync" \
  "edge|Sync edge files"
do
  job="${pair%%|*}"
  step="${pair#*|}"
  block="$(step_keys "${job}" "${step}")"
  if [ -z "${block}" ]; then
    echo "FAIL ${job}: missing step ${step}" >&2
    exit 1
  fi
  if grep -Eq '^        (if:|continue-on-error:)' <<< "${block}"; then
    echo "FAIL ${job}: ${step} has if: or continue-on-error" >&2
    printf '%s\n' "${block}" >&2
    exit 1
  fi
  echo "OK ${job}: ${step} has no if: or continue-on-error"
done

# The real deploy job is smaller than a pipe buffer, so the old early exit
# only shows up when the writer is still going. Pad past that buffer. Before
# step_keys read through EOF, this call exited 141.
saved_workflow="${workflow}"
workflow="${tmp}/sigpipe-padded.yml"
awk '
  {
    print
  }
  inserted == 0 && $0 == "      - name: Sync deploy files" {
    inserted = 1
    pad = "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"
    for (i = 0; i < 4000; i++) {
      printf "        echo sigpipe-pad-%04d %s\n", i, pad
    }
  }
' "${saved_workflow}" > "${workflow}"
padded_block="$(step_keys deploy "Re-check deploy tree before sync")"
workflow="${saved_workflow}"
if ! grep -F -q 'resolve-deploy-inputs.sh --assert' <<< "${padded_block}"; then
  echo "FAIL padded deploy job: re-check step text missing after step_keys" >&2
  exit 1
fi
if grep -Eq '^        (if:|continue-on-error:)' <<< "${padded_block}"; then
  echo "FAIL padded deploy job: re-check step has if: or continue-on-error" >&2
  exit 1
fi
echo "OK padded deploy job: step_keys finished without SIGPIPE"

bash "${root}/deploy/no-early-pipe-exit.test.sh"

echo "recheck-before-sync tests passed"
