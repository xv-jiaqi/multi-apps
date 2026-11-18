#!/usr/bin/env bash
# Install a pinned sentry-cli binary for source map uploads (CH-247).
# Usage: install-sentry-cli.sh <dest-dir>
#
# Only Linux x86_64 is pinned (GitHub Actions ubuntu-latest). Override
# SENTRY_CLI_VERSION and SENTRY_CLI_SHA256 together when bumping.
set -euo pipefail

VERSION="${SENTRY_CLI_VERSION:-3.8.2}"
CHECKSUM="${SENTRY_CLI_SHA256:-c958865f9d4000183509ea21b1f04925d5390de6d8d87386b9e69f2b305070c3}"

if [ "$#" -lt 1 ] || [ -z "${1:-}" ]; then
  echo "usage: install-sentry-cli.sh <dest-dir>" >&2
  exit 2
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "install-sentry-cli: refusing unpinned version ${VERSION}" >&2
  exit 1
fi

arch="$(uname -m)"
case "${arch}" in
  x86_64|amd64) asset="sentry-cli-Linux-x86_64" ;;
  *)
    echo "install-sentry-cli: unsupported arch ${arch} (pinned checksum is Linux x86_64)" >&2
    exit 1
    ;;
esac

dest="$1"
mkdir -p "${dest}"
tmp="$(mktemp)"
cleanup() { rm -f "${tmp}"; }
trap cleanup EXIT

url="https://github.com/getsentry/sentry-cli/releases/download/${VERSION}/${asset}"
curl -fsSL -o "${tmp}" "${url}"
actual="$(sha256sum "${tmp}" | awk '{print $1}')"
if [ "${actual}" != "${CHECKSUM}" ]; then
  echo "install-sentry-cli: checksum mismatch for ${asset} ${VERSION}" >&2
  echo "expected ${CHECKSUM}" >&2
  echo "actual   ${actual}" >&2
  exit 1
fi
chmod 755 "${tmp}"
mv "${tmp}" "${dest}/sentry-cli"
trap - EXIT
echo "installed sentry-cli ${VERSION} to ${dest}/sentry-cli"
