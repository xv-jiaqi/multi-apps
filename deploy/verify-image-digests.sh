#!/usr/bin/env bash
# Confirm the resolved cardhub-api and cardhub-web digests exist in GHCR.
#
# deploy.yml runs this on the runner after resolve-image-digests.sh and
# after GHCR login, and before Sync deploy files or Deploy on VPS. A missing
# manifest exits non-zero. This script does not SSH.
#
# Tests set CARDHUB_IMAGETOOLS_CMD to a program that receives the
# image@sha256 ref. The real command is docker buildx imagetools inspect.
set -euo pipefail

api_repo="${CARDHUB_API_REPO:-ghcr.io/xv-jiaqi/cardhub-api}"
web_repo="${CARDHUB_WEB_REPO:-ghcr.io/xv-jiaqi/cardhub-web}"
api_digest="${API_IMAGE_DIGEST:-}"
web_digest="${WEB_IMAGE_DIGEST:-}"

if [[ ! "${api_digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || [[ ! "${web_digest}" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "Refusing deploy: API_IMAGE_DIGEST and WEB_IMAGE_DIGEST must be sha256:<64 hex> before the VPS is contacted. Running containers were not changed." >&2
  exit 1
fi

inspect_manifest() {
  local ref="$1"
  if [ -n "${CARDHUB_IMAGETOOLS_CMD:-}" ]; then
    "${CARDHUB_IMAGETOOLS_CMD}" "${ref}"
    return $?
  fi
  docker buildx imagetools inspect "${ref}"
}

missing=0
for ref in "${api_repo}@${api_digest}" "${web_repo}@${web_digest}"; do
  if ! inspect_manifest "${ref}"; then
    echo "Refusing deploy: ${ref} is not in GHCR (docker buildx imagetools inspect failed). The VPS was not contacted and running containers were not changed." >&2
    missing=1
  fi
done

if [ "${missing}" -ne 0 ]; then
  exit 1
fi

echo "GHCR has ${api_repo}@${api_digest} and ${web_repo}@${web_digest}"
