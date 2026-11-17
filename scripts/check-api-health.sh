#!/usr/bin/env bash
# Poll a running Cardhub API until /health is ok.
#
# Required:
#   EXPECTED_GIT_SHA   full commit SHA baked into the image
# Optional:
#   API_BASE_URL       default http://127.0.0.1:4000
#   API_CONTAINER      container name; its logs are printed when a check fails
#   BOOT_TIMEOUT       seconds to wait for HTTP 200 (default 60)
#
# curl -fsS is the request. A refused connection or a non-2xx is retried
# until the timeout. The body must say status ok, with services.db and
# services.redis both true.

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
EXPECTED_GIT_SHA="${EXPECTED_GIT_SHA:-}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-60}"

if [ -z "$EXPECTED_GIT_SHA" ]; then
  echo "EXPECTED_GIT_SHA is required" >&2
  exit 2
fi
if ! [[ "$BOOT_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "BOOT_TIMEOUT must be a positive integer" >&2
  exit 2
fi

tmpdir=$(mktemp -d)

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ -n "${API_CONTAINER:-}" ]; then
    echo "--- ${API_CONTAINER} logs ---"
    if ! docker logs "$API_CONTAINER" >"${tmpdir}/container-logs.txt" 2>&1; then
      sudo docker logs "$API_CONTAINER" >"${tmpdir}/container-logs.txt" 2>&1 || true
    fi
    if [ -s "${tmpdir}/container-logs.txt" ]; then
      cat "${tmpdir}/container-logs.txt"
    fi
  fi
  rm -rf "$tmpdir"
  exit "$status"
}
trap cleanup EXIT

base="${API_BASE_URL%/}"
url="${base}/health"
deadline=$((SECONDS + BOOT_TIMEOUT))
code=""

while true; do
  if code=$(curl -fsS -o "${tmpdir}/health.body" -w '%{http_code}' --max-time 2 \
    "$url" 2>"${tmpdir}/health.err"); then
    if [ "$code" = "200" ] && [ -s "${tmpdir}/health.body" ]; then
      break
    fi
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "API /health did not return 200 within ${BOOT_TIMEOUT}s (last HTTP status: ${code:-none})" >&2
    if [ -s "${tmpdir}/health.err" ]; then
      cat "${tmpdir}/health.err" >&2
    fi
    if [ -s "${tmpdir}/health.body" ]; then
      echo "Last /health body:" >&2
      cat "${tmpdir}/health.body" >&2
    fi
    exit 1
  fi
  sleep 1
done

export EXPECTED_GIT_SHA
python3 - "${tmpdir}/health.body" <<'PY'
import json
import os
import sys

expected = os.environ["EXPECTED_GIT_SHA"]
with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)

failures = []
if not isinstance(body, dict):
    failures.append("health body is not an object")
else:
    if body.get("status") != "ok":
        failures.append(f"status {body.get('status')}")
    services = body.get("services")
    if not isinstance(services, dict):
        failures.append("services missing")
    else:
        if services.get("db") is not True:
            failures.append("services.db is not true")
        if services.get("redis") is not True:
            failures.append("services.redis is not true")
    if body.get("gitSha") != expected:
        failures.append(f"gitSha {body.get('gitSha')} != {expected}")

if failures:
    print("\n".join(failures), file=sys.stderr)
    print(json.dumps(body), file=sys.stderr)
    sys.exit(1)

print(f"health ok gitSha={body['gitSha']} db=true redis=true")
PY
