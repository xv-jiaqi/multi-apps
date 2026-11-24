#!/usr/bin/env bash
# 47-1 / 47-2: skip without a token; mock sentry-cli success and failure.
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
script="${script_dir}/upload-sentry-sourcemaps.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

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

# 47-1: unset token skips and exits 0, even if org/project/dist are missing.
rc=0
out="${work}/skip.out"
err="${work}/skip.err"
(
  unset SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT SENTRY_RELEASE GIT_SHA SENTRY_DIST_DIR SENTRY_CLI || true
  bash "${script}"
) >"${out}" 2>"${err}" || rc=$?
if [ "${rc}" -eq 0 ] && grep -q 'sentry sourcemaps: skip, SENTRY_AUTH_TOKEN unset' "${out}" && [ ! -s "${err}" ]; then
  assert "47-1 unset token skips with exit 0" 0
else
  echo "rc=${rc}" >&2
  cat "${out}" >&2
  cat "${err}" >&2
  assert "47-1 unset token skips with exit 0" 1
fi

# Blank / whitespace token is also a skip.
rc=0
(
  unset SENTRY_ORG SENTRY_PROJECT || true
  SENTRY_AUTH_TOKEN="   " bash "${script}"
) >"${out}" 2>"${err}" || rc=$?
if [ "${rc}" -eq 0 ] && grep -q 'sentry sourcemaps: skip, SENTRY_AUTH_TOKEN unset' "${out}"; then
  assert "47-1 blank token skips with exit 0" 0
else
  assert "47-1 blank token skips with exit 0" 1
fi

fake_token="fake-sentry-token-do-not-log"
dist="${work}/dist"
mkdir -p "${dist}/assets"
printf 'console.log(1);\n' > "${dist}/assets/app.js"
printf '{"version":3}\n' > "${dist}/assets/app.js.map"

mkdir -p "${work}/bin"
args_file="${work}/sentry-cli.args"
cat > "${work}/bin/sentry-cli" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
if [ "${SENTRY_CLI_FORCE_FAIL:-}" = "1" ]; then
  echo "mock sentry-cli failed" >&2
  exit 7
fi
# The token must stay in the environment, never on argv.
for arg in "$@"; do
  if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ "${arg}" = "${SENTRY_AUTH_TOKEN}" ]; then
    echo "token leaked to sentry-cli argv" >&2
    exit 1
  fi
done
printf '%s\n' "$@" > "${SENTRY_CLI_ARGS_FILE:?}"
echo "mock sentry-cli ok"
exit 0
MOCK
chmod +x "${work}/bin/sentry-cli"

run_upload() {
  local out_file="$1"
  local err_file="$2"
  local rc_file="$3"
  (
    export PATH="${work}/bin:${PATH}"
    export SENTRY_AUTH_TOKEN="${fake_token}"
    export SENTRY_ORG="cardhub-org"
    export SENTRY_PROJECT="cardhub-web"
    export SENTRY_RELEASE="abc123def456"
    export SENTRY_DIST_DIR="${dist}"
    export SENTRY_CLI_ARGS_FILE="${args_file}"
    unset GIT_SHA SENTRY_URL || true
    bash "${script}"
  ) >"${out_file}" 2>"${err_file}"
  echo "$?" >"${rc_file}"
}

# 47-2 success path.
rm -f "${args_file}"
run_upload "${work}/ok.out" "${work}/ok.err" "${work}/ok.rc" || true
ok_rc="$(cat "${work}/ok.rc")"
if [ "${ok_rc}" -eq 0 ] \
  && grep -q 'sentry sourcemaps: uploading from' "${work}/ok.out" \
  && grep -q 'org=cardhub-org project=cardhub-web release=abc123def456' "${work}/ok.out" \
  && grep -q 'sentry sourcemaps: upload ok' "${work}/ok.out" \
  && ! grep -q 'skip, SENTRY_AUTH_TOKEN unset' "${work}/ok.out" \
  && ! grep -F -q "${fake_token}" "${work}/ok.out" \
  && ! grep -F -q "${fake_token}" "${work}/ok.err" \
  && [ -s "${args_file}" ] \
  && grep -q 'sourcemaps' "${args_file}" \
  && grep -qx -- '--release' "${args_file}" \
  && grep -qx -- 'abc123def456' "${args_file}" \
  && grep -qx -- '--org' "${args_file}" \
  && grep -qx -- 'cardhub-org' "${args_file}" \
  && grep -qx -- '--project' "${args_file}" \
  && grep -qx -- 'cardhub-web' "${args_file}" \
  && grep -qx -- '--url-prefix' "${args_file}" \
  && grep -qx -- '~/' "${args_file}" \
  && grep -qx -- "${dist}" "${args_file}"
then
  assert "47-2 mock success exits 0 on the upload path" 0
else
  echo "rc=${ok_rc}" >&2
  cat "${work}/ok.out" >&2
  cat "${work}/ok.err" >&2
  echo "args:" >&2
  cat "${args_file}" >&2 || true
  assert "47-2 mock success exits 0 on the upload path" 1
fi

# 47-2 failure path: mock CLI non-zero -> script non-zero.
SENTRY_CLI_FORCE_FAIL=1 run_upload "${work}/fail.out" "${work}/fail.err" "${work}/fail.rc" || true
fail_rc="$(cat "${work}/fail.rc")"
if [ "${fail_rc}" -ne 0 ] \
  && grep -q 'mock sentry-cli failed' "${work}/fail.err" \
  && ! grep -q 'sentry sourcemaps: upload ok' "${work}/fail.out" \
  && ! grep -F -q "${fake_token}" "${work}/fail.out" \
  && ! grep -F -q "${fake_token}" "${work}/fail.err"
then
  assert "47-2 mock failure exits non-zero" 0
else
  echo "rc=${fail_rc}" >&2
  cat "${work}/fail.out" >&2
  cat "${work}/fail.err" >&2
  assert "47-2 mock failure exits non-zero" 1
fi

# Token set but org/project missing must fail, not skip.
rc=0
(
  unset SENTRY_ORG SENTRY_PROJECT || true
  export SENTRY_AUTH_TOKEN="${fake_token}"
  export SENTRY_DIST_DIR="${dist}"
  bash "${script}"
) >"${work}/no-org.out" 2>"${work}/no-org.err" || rc=$?
if [ "${rc}" -ne 0 ] \
  && grep -q 'SENTRY_ORG and SENTRY_PROJECT are required' "${work}/no-org.err" \
  && ! grep -F -q "${fake_token}" "${work}/no-org.out" \
  && ! grep -F -q "${fake_token}" "${work}/no-org.err"
then
  assert "token without org/project fails" 0
else
  assert "token without org/project fails" 1
fi

# Token set but dist has no maps must fail.
empty="${work}/empty-dist"
mkdir -p "${empty}"
printf 'console.log(1);\n' > "${empty}/app.js"
rc=0
(
  export PATH="${work}/bin:${PATH}"
  export SENTRY_AUTH_TOKEN="${fake_token}"
  export SENTRY_ORG="cardhub-org"
  export SENTRY_PROJECT="cardhub-web"
  export SENTRY_RELEASE="abc123def456"
  export SENTRY_DIST_DIR="${empty}"
  bash "${script}"
) >"${work}/no-maps.out" 2>"${work}/no-maps.err" || rc=$?
if [ "${rc}" -ne 0 ] && grep -q 'both are required' "${work}/no-maps.err"; then
  assert "token with JS but no maps fails" 0
else
  assert "token with JS but no maps fails" 1
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
echo "OK upload-sentry-sourcemaps.sh"
