#!/usr/bin/env bash
# Upload Vite web source maps to Sentry when SENTRY_AUTH_TOKEN is set (CH-247).
# No token: print a skip reason and exit 0 so PR / fork CI stays green.
# Token present: a failed upload must exit non-zero so it is not mistaken
# for success.
#
# Environment:
#   SENTRY_AUTH_TOKEN   required to upload; unset or blank skips
#   SENTRY_ORG          required when uploading
#   SENTRY_PROJECT      required when uploading
#   SENTRY_URL          optional; self-hosted Sentry (sentry-cli reads it)
#   SENTRY_RELEASE      release name; default GIT_SHA, then git HEAD
#   GIT_SHA             used when SENTRY_RELEASE is unset (must match
#                       the web runtime /config.js GIT_SHA that the SDK
#                       sends as Sentry release)
#   SENTRY_DIST_DIR     directory of JS + maps; or pass as $1
#   SENTRY_CLI          sentry-cli binary (default: sentry-cli on PATH)
#   SENTRY_URL_PREFIX   artifact URL prefix (default: ~/)
set -euo pipefail

token="${SENTRY_AUTH_TOKEN:-}"
if [ -z "${token// }" ]; then
  echo "sentry sourcemaps: skip, SENTRY_AUTH_TOKEN unset"
  exit 0
fi
# Do not print the token. Drop the local copy; sentry-cli reads the env var.
unset token

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "${script_dir}/../../../.." && pwd)"

dist="${1:-${SENTRY_DIST_DIR:-${repo_root}/apps/cardhub/web/dist}}"

org="${SENTRY_ORG:-}"
project="${SENTRY_PROJECT:-}"
if [ -z "${org// }" ] || [ -z "${project// }" ]; then
  echo "sentry sourcemaps: SENTRY_ORG and SENTRY_PROJECT are required when SENTRY_AUTH_TOKEN is set" >&2
  exit 1
fi

release="${SENTRY_RELEASE:-}"
if [ -z "${release// }" ]; then
  if [ -n "${GIT_SHA:-}" ] && [ "${GIT_SHA}" != "unknown" ]; then
    release="${GIT_SHA}"
  elif git -C "${repo_root}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    release="$(git -C "${repo_root}" rev-parse HEAD)"
  else
    release=""
  fi
fi
if [ -z "${release// }" ]; then
  echo "sentry sourcemaps: set SENTRY_RELEASE or GIT_SHA (must match web /config.js GIT_SHA)" >&2
  exit 1
fi

if [ ! -d "${dist}" ]; then
  echo "sentry sourcemaps: dist directory not found: ${dist}" >&2
  exit 1
fi

js_count="$(find "${dist}" -type f \( -name '*.js' -o -name '*.mjs' \) | wc -l)"
map_count="$(find "${dist}" -type f -name '*.map' | wc -l)"
js_count=$((js_count + 0))
map_count=$((map_count + 0))
if [ "${js_count}" -eq 0 ] || [ "${map_count}" -eq 0 ]; then
  echo "sentry sourcemaps: ${dist} has ${js_count} JS file(s) and ${map_count} map(s); both are required" >&2
  exit 1
fi

cli="${SENTRY_CLI:-sentry-cli}"
if [ ! -x "${cli}" ] && ! command -v "${cli}" >/dev/null 2>&1; then
  echo "sentry sourcemaps: sentry-cli not found (set SENTRY_CLI or install sentry-cli)" >&2
  exit 1
fi

url_prefix="${SENTRY_URL_PREFIX:-~/}"

echo "sentry sourcemaps: uploading from ${dist}"
echo "sentry sourcemaps: org=${org} project=${project} release=${release} url-prefix=${url_prefix}"

# sentry-cli reads SENTRY_AUTH_TOKEN and optional SENTRY_URL from the
# environment. Never pass the token as a flag or positional argument.
"${cli}" sourcemaps upload \
  --org "${org}" \
  --project "${project}" \
  --release "${release}" \
  --url-prefix "${url_prefix}" \
  "${dist}"

echo "sentry sourcemaps: upload ok"
