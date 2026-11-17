#!/usr/bin/env bash
# The deploy job must prove both digests are in GHCR before it syncs files
# or starts remote-deploy.sh. A missing manifest fails that step and does
# not touch the VPS.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="${root}/deploy/verify-image-digests.sh"
workflow="${root}/.github/workflows/deploy.yml"
api_digest="sha256:$(printf 'a%.0s' {1..64})"
web_digest="sha256:$(printf 'b%.0s' {1..64})"
api_ref="ghcr.io/xv-jiaqi/cardhub-api@${api_digest}"
web_ref="ghcr.io/xv-jiaqi/cardhub-web@${web_digest}"
failed=0

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
  fi
}

assert "verify script inspects image@digest with buildx imagetools" "$(
  grep -F -q 'docker buildx imagetools inspect' "${script}" && echo 0 || echo 1
)"
assert "verify script does not ssh" "$(grep -F -q 'ssh' "${script}" && echo 1 || echo 0)"

# Step order inside the deploy job. Names are the "- name:" lines.
deploy_steps="$(awk '
  /^  deploy:$/ { in_job = 1; next }
  in_job && /^  [^ ]/ { exit }
  in_job && /^      - name: / { print substr($0, 15) }
' "${workflow}")"

step_index() {
  local name="$1"
  local n=0
  local line
  while IFS= read -r line; do
    n=$((n + 1))
    if [ "${line}" = "${name}" ]; then
      printf '%s\n' "${n}"
      return 0
    fi
  done <<< "${deploy_steps}"
  return 1
}

login_at="$(step_index "Log in to GHCR for image availability checks")"
resolve_at="$(step_index "Resolve image digests")"
verify_at="$(step_index "Verify image digests exist in GHCR")"
recheck_at="$(step_index "Re-check deploy tree before sync")"
sync_at="$(step_index "Sync deploy files")"
vps_at="$(step_index "Deploy on VPS")"

assert "deploy job has a GHCR verify step" "$([ -n "${verify_at}" ] && echo 0 || echo 1)"
assert "GHCR login is before the verify step" "$(
  [ -n "${login_at}" ] && [ -n "${verify_at}" ] && [ "${login_at}" -lt "${verify_at}" ] && echo 0 || echo 1
)"
assert "digest resolve is before the verify step" "$(
  [ -n "${resolve_at}" ] && [ -n "${verify_at}" ] && [ "${resolve_at}" -lt "${verify_at}" ] && echo 0 || echo 1
)"
assert "verify step is before the re-check that precedes sync" "$(
  [ -n "${verify_at}" ] && [ -n "${recheck_at}" ] && [ "${verify_at}" -lt "${recheck_at}" ] && echo 0 || echo 1
)"
assert "verify step is before Sync deploy files" "$(
  [ -n "${verify_at}" ] && [ -n "${sync_at}" ] && [ "${verify_at}" -lt "${sync_at}" ] && echo 0 || echo 1
)"
assert "verify step is before Deploy on VPS" "$(
  [ -n "${verify_at}" ] && [ -n "${vps_at}" ] && [ "${verify_at}" -lt "${vps_at}" ] && echo 0 || echo 1
)"

verify_body="$(awk '
  /^  deploy:$/ { in_job = 1; next }
  in_job && /^  [^ ]/ { exit }
  in_job && /^      - name: Verify image digests exist in GHCR$/ { in_step = 1; next }
  in_step && /^      - name: / { exit }
  in_step { print }
' "${workflow}")"
assert "verify step runs verify-image-digests.sh" "$(
  grep -F -q 'bash deploy/verify-image-digests.sh' <<< "${verify_body}" && echo 0 || echo 1
)"
assert "verify step passes both digests" "$(
  grep -F -q 'steps.image-digests.outputs.api_digest' <<< "${verify_body}" \
    && grep -F -q 'steps.image-digests.outputs.web_digest' <<< "${verify_body}" \
    && echo 0 || echo 1
)"
assert "verify step does not ssh" "$(grep -F -q 'ssh' <<< "${verify_body}" && echo 1 || echo 0)"

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

cat > "${work}/imagetools" << EOF
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "\$1" >> "${work}/called"
if [ -n "\${FAIL_REF:-}" ] && [ "\$1" = "\${FAIL_REF}" ]; then
  echo "failed to resolve reference \\"\$1\\": not found" >&2
  exit 1
fi
exit 0
EOF
chmod 755 "${work}/imagetools"

run_verify() {
  local fail_ref="$1"
  local out="$2"
  local err="$3"
  local rc=0
  env \
    API_IMAGE_DIGEST="${api_digest}" \
    WEB_IMAGE_DIGEST="${web_digest}" \
    CARDHUB_IMAGETOOLS_CMD="${work}/imagetools" \
    FAIL_REF="${fail_ref}" \
    bash "${script}" >"${out}" 2>"${err}" || rc=$?
  printf '%s\n' "${rc}"
}

# Same order as the deploy job: verify, and only then the VPS steps.
vps="${work}/vps"
: > "${work}/called"
rc="$(run_verify "${api_ref}" "${work}/missing.out" "${work}/missing.err")"
if [ "${rc}" -eq 0 ]; then
  mkdir -p "${vps}"
  : > "${vps}/synced"
fi
assert "missing api digest exits non-zero" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "missing api digest names the ref and says the VPS was not contacted" "$(
  grep -F -q "Refusing deploy: ${api_ref} is not in GHCR" "${work}/missing.err" \
    && grep -F -q 'The VPS was not contacted and running containers were not changed.' "${work}/missing.err" \
    && echo 0 || echo 1
)"
assert "missing api digest does not touch the VPS" "$([ ! -e "${vps}/synced" ] && echo 0 || echo 1)"
assert "missing api digest inspected the digest ref" "$(
  grep -F -x -q "${api_ref}" "${work}/called" && echo 0 || echo 1
)"
if [ "${rc}" -eq 0 ]; then
  echo "--- missing stdout ---" >&2
  cat "${work}/missing.out" >&2
  echo "--- missing stderr ---" >&2
  cat "${work}/missing.err" >&2
fi

: > "${work}/called"
rc="$(run_verify "" "${work}/ok.out" "${work}/ok.err")"
if [ "${rc}" -eq 0 ]; then
  mkdir -p "${vps}"
  : > "${vps}/synced"
fi
assert "both digests present exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "both digests present names GHCR" "$(
  grep -F -q "GHCR has ${api_ref} and ${web_ref}" "${work}/ok.out" && echo 0 || echo 1
)"
assert "both digests present inspected api and web" "$(
  grep -F -x -q "${api_ref}" "${work}/called" \
    && grep -F -x -q "${web_ref}" "${work}/called" \
    && echo 0 || echo 1
)"
assert "both digests present is when the VPS step would run" "$([ -f "${vps}/synced" ] && echo 0 || echo 1)"

: > "${work}/called"
rc=0
env \
  API_IMAGE_DIGEST="sha256:abcd" \
  WEB_IMAGE_DIGEST="${web_digest}" \
  CARDHUB_IMAGETOOLS_CMD="${work}/imagetools" \
  bash "${script}" >"${work}/bad.out" 2>"${work}/bad.err" || rc=$?
assert "invalid digest exits non-zero before imagetools" "$(
  [ "${rc}" -ne 0 ] && [ ! -s "${work}/called" ] && echo 0 || echo 1
)"
assert "invalid digest says the VPS was not contacted" "$(
  grep -F -q 'before the VPS is contacted' "${work}/bad.err" && echo 0 || echo 1
)"

if [ "${failed}" -ne 0 ]; then
  echo "verify-image-digests tests failed" >&2
  exit 1
fi
echo "verify-image-digests tests passed"
