#!/usr/bin/env bash
# Cardhub Deploy must take digests from the successful Images run for the
# target SHA. An in-progress, failed, or missing run exits non-zero and
# prints no digest. A bad artifact does not fall through to the tag.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="${root}/deploy/resolve-image-digests.sh"
sha="$(printf 'a%.0s' {1..40})"
other="$(printf 'b%.0s' {1..40})"
api_digest="sha256:$(printf '1%.0s' {1..64})"
web_digest="sha256:$(printf '2%.0s' {1..64})"
tag_api_digest="sha256:$(printf '3%.0s' {1..64})"
tag_web_digest="sha256:$(printf '4%.0s' {1..64})"
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

run_resolve() {
  local fixture="$1"
  local out="$2"
  local err="$3"
  local rc=0
  env \
    -u GITHUB_OUTPUT \
    DEPLOY_EXPECTED_SHA="${sha}" \
    CARDHUB_IMAGES_FIXTURE="${fixture}" \
    CARDHUB_DIGEST_WAIT_ATTEMPTS=1 \
    CARDHUB_DIGEST_WAIT_SECONDS=0 \
    CARDHUB_IMAGE_DIGEST_CMD="${fixture}/tag-digest" \
    GITHUB_OUTPUT="${fixture}/github-output" \
    bash "${script}" >"${out}" 2>"${err}" || rc=$?
  printf '%s\n' "${rc}"
}

write_runs() {
  local fixture="$1"
  shift
  mkdir -p "${fixture}/artifacts"
  : > "${fixture}/runs.tsv"
  local line
  for line in "$@"; do
    printf '%s\n' "${line}" >> "${fixture}/runs.tsv"
  done
}

write_artifact() {
  local fixture="$1"
  local run_id="$2"
  local name="$3"
  local value="$4"
  mkdir -p "${fixture}/artifacts/${run_id}"
  printf '%s\n' "${value}" > "${fixture}/artifacts/${run_id}/${name}"
}

# Prints the api digest for cardhub-api and the web digest for cardhub-web.
# Touches called so a test can see whether the tag path ran.
write_tag_cmd() {
  local fixture="$1"
  local mode="$2"
  cat > "${fixture}/tag-digest" << EOF
#!/usr/bin/env bash
set -euo pipefail
printf 'called %s %s\n' "\$1" "\$2" >> "${fixture}/tag-called"
if [ "${mode}" = "fail" ]; then
  exit 1
fi
case "\$1" in
  *cardhub-api) printf '%s\n' "${tag_api_digest}" ;;
  *cardhub-web) printf '%s\n' "${tag_web_digest}" ;;
  *) exit 1 ;;
esac
EOF
  chmod 755 "${fixture}/tag-digest"
}

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# Workflow wiring: the deploy job consumes this script's outputs, and the
# Images workflow records build-push-action's digest output.
images="${root}/.github/workflows/images.yml"
deploy="${root}/.github/workflows/deploy.yml"
assert "images workflow records the build digest" "$(
  grep -F -q 'steps.build.outputs.digest' "${images}" && echo 0 || echo 1
)"
assert "images workflow uploads api and web digest artifacts" "$(
  grep -F -q 'image-digest-${{ matrix.name }}' "${images}" && echo 0 || echo 1
)"
assert "deploy resolves digests before sync" "$(
  grep -F -q 'bash deploy/resolve-image-digests.sh' "${deploy}" && echo 0 || echo 1
)"
assert "deploy passes both digests to the VPS" "$(
  grep -F -q 'API_IMAGE_DIGEST: ${{ steps.image-digests.outputs.api_digest }}' "${deploy}" \
    && grep -F -q 'WEB_IMAGE_DIGEST: ${{ steps.image-digests.outputs.web_digest }}' "${deploy}" \
    && echo 0 || echo 1
)"
assert "deploy job can read Actions artifacts" "$(
  deploy_job="$(awk '
    /^  deploy:$/ { in_job = 1; next }
    in_job && /^  [^ ]/ { exit }
    in_job { print }
  ' "${deploy}")"
  grep -F -q 'actions: read' <<< "${deploy_job}" && echo 0 || echo 1
)"

fx="${work}/success"
write_runs "${fx}" \
  "$(printf '2026-11-02T04:00:00Z\t10\tcompleted\tskipped\t%s' "${sha}")" \
  "$(printf '2026-11-02T04:21:00Z\t20\tcompleted\tsuccess\t%s' "${sha}")" \
  "$(printf '2026-11-02T05:00:00Z\t30\tcompleted\tsuccess\t%s' "${other}")"
write_artifact "${fx}" 20 image-digest-api "${api_digest}"
write_artifact "${fx}" 20 image-digest-web "  ${web_digest}  "
write_tag_cmd "${fx}" fail
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/success.out" "${work}/success.err")"
assert "success with artifacts exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "success uses the artifact digests" "$(
  grep -F -q "Resolved api_digest=${api_digest} web_digest=${web_digest} source=artifact images_run=20" "${work}/success.out" && echo 0 || echo 1
)"
assert "success writes GitHub outputs" "$(
  grep -qx "api_digest=${api_digest}" "${fx}/github-output" \
    && grep -qx "web_digest=${web_digest}" "${fx}/github-output" \
    && echo 0 || echo 1
)"
assert "success does not resolve the tag" "$([ ! -s "${fx}/tag-called" ] && echo 0 || echo 1)"
if [ "${rc}" -ne 0 ]; then
  echo "--- success stdout ---" >&2
  cat "${work}/success.out" >&2
  echo "--- success stderr ---" >&2
  cat "${work}/success.err" >&2
fi

fx="${work}/progress"
write_runs "${fx}" \
  "$(printf '2026-11-02T04:00:00Z\t20\tcompleted\tsuccess\t%s' "${sha}")" \
  "$(printf '2026-11-02T04:30:00Z\t21\tin_progress\t\t%s' "${sha}")"
write_artifact "${fx}" 20 image-digest-api "${api_digest}"
write_artifact "${fx}" 20 image-digest-web "${web_digest}"
write_tag_cmd "${fx}" fail
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/progress.out" "${work}/progress.err")"
assert "in-progress run exits non-zero" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "in-progress run prints no digest" "$(grep -F -q 'api_digest=' "${work}/progress.out" && echo 1 || echo 0)"
assert "in-progress run does not write outputs" "$([ ! -s "${fx}/github-output" ] && echo 0 || echo 1)"
assert "in-progress run names the state" "$(grep -F -q 'still in progress' "${work}/progress.err" && echo 0 || echo 1)"
assert "in-progress run ignores the older success" "$([ ! -s "${fx}/tag-called" ] && echo 0 || echo 1)"

fx="${work}/failed"
write_runs "${fx}" \
  "$(printf '2026-11-02T04:00:00Z\t20\tcompleted\tsuccess\t%s' "${sha}")" \
  "$(printf '2026-11-02T04:30:00Z\t22\tcompleted\tfailure\t%s' "${sha}")"
write_artifact "${fx}" 20 image-digest-api "${api_digest}"
write_artifact "${fx}" 20 image-digest-web "${web_digest}"
write_tag_cmd "${fx}" ok
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/failed.out" "${work}/failed.err")"
assert "failed run exits non-zero" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "failed run prints no digest" "$(grep -F -q 'Resolved api_digest=' "${work}/failed.out" && echo 1 || echo 0)"
assert "failed run does not fall back to an older success" "$([ ! -s "${fx}/tag-called" ] && echo 0 || echo 1)"
assert "failed run names the conclusion" "$(grep -F -q 'concluded failure' "${work}/failed.err" && echo 0 || echo 1)"

fx="${work}/missing"
write_runs "${fx}" \
  "$(printf '2026-11-02T04:00:00Z\t20\tcompleted\tskipped\t%s' "${sha}")"
write_tag_cmd "${fx}" ok
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/missing.out" "${work}/missing.err")"
assert "missing run exits non-zero" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "missing run prints no digest" "$(grep -F -q 'api_digest=' "${work}/missing.out" && echo 1 || echo 0)"
assert "missing run does not resolve a tag" "$([ ! -s "${fx}/tag-called" ] && echo 0 || echo 1)"
assert "missing run names the gap" "$(grep -F -q "no Cardhub Images run for ${sha}" "${work}/missing.err" && echo 0 || echo 1)"

fx="${work}/bad-artifact"
write_runs "${fx}" \
  "$(printf '2026-11-02T04:21:00Z\t20\tcompleted\tsuccess\t%s' "${sha}")"
write_artifact "${fx}" 20 image-digest-api "not-a-digest"
write_artifact "${fx}" 20 image-digest-web "${web_digest}"
write_tag_cmd "${fx}" ok
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/bad.out" "${work}/bad.err")"
assert "bad artifact exits non-zero" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "bad artifact does not resolve the tag" "$([ ! -s "${fx}/tag-called" ] && echo 0 || echo 1)"
assert "bad artifact prints no resolved digest" "$(grep -F -q 'Resolved api_digest=' "${work}/bad.out" && echo 1 || echo 0)"

fx="${work}/historical"
write_runs "${fx}" \
  "$(printf '2026-10-01T00:00:00Z\t20\tcompleted\tsuccess\t%s' "${sha}")"
write_tag_cmd "${fx}" ok
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/hist.out" "${work}/hist.err")"
assert "historical success without artifacts exits 0" "$([ "${rc}" -eq 0 ] && echo 0 || echo 1)"
assert "historical success resolves the tag" "$(
  grep -F -q "Resolved api_digest=${tag_api_digest} web_digest=${tag_web_digest} source=tag images_run=20" "${work}/hist.out" && echo 0 || echo 1
)"
assert "historical success called the tag resolver" "$([ -s "${fx}/tag-called" ] && echo 0 || echo 1)"

fx="${work}/no-manifest"
write_runs "${fx}" \
  "$(printf '2026-10-01T00:00:00Z\t20\tcompleted\tsuccess\t%s' "${sha}")"
write_tag_cmd "${fx}" fail
: > "${fx}/github-output"
rc="$(run_resolve "${fx}" "${work}/noman.out" "${work}/noman.err")"
assert "missing manifest exits non-zero" "$([ "${rc}" -ne 0 ] && echo 0 || echo 1)"
assert "missing manifest prints no digest" "$(grep -F -q 'Resolved api_digest=' "${work}/noman.out" && echo 1 || echo 0)"
assert "missing manifest names the image" "$(grep -F -q 'manifest for' "${work}/noman.err" && echo 0 || echo 1)"

if [ "${failed}" -ne 0 ]; then
  echo "resolve-image-digests tests failed" >&2
  exit 1
fi
echo "resolve-image-digests tests passed"
