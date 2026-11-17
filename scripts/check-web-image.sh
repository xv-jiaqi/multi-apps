#!/usr/bin/env bash
# Confirm a running Cardhub web container serves the SPA.
#
# Optional:
#   WEB_BASE_URL    default http://127.0.0.1:8080
#   WEB_CONTAINER   container name; its logs are printed when a check fails
#   BOOT_TIMEOUT    seconds to wait for GET / to return 200 (default 60)
#
# GET / and the first hashed /assets/ URL in that HTML must return 200
# via curl -fsS. The asset response must not be the SPA HTML fallback.

set -euo pipefail

WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:8080}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-60}"

if ! [[ "$BOOT_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "BOOT_TIMEOUT must be a positive integer" >&2
  exit 2
fi

tmpdir=$(mktemp -d)

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ -n "${WEB_CONTAINER:-}" ]; then
    echo "--- ${WEB_CONTAINER} logs ---"
    if ! docker logs "$WEB_CONTAINER" >"${tmpdir}/container-logs.txt" 2>&1; then
      sudo docker logs "$WEB_CONTAINER" >"${tmpdir}/container-logs.txt" 2>&1 || true
    fi
    if [ -s "${tmpdir}/container-logs.txt" ]; then
      cat "${tmpdir}/container-logs.txt"
    fi
  fi
  rm -rf "$tmpdir"
  exit "$status"
}
trap cleanup EXIT

base="${WEB_BASE_URL%/}"
deadline=$((SECONDS + BOOT_TIMEOUT))
code=""

while true; do
  if code=$(curl -fsS -o "${tmpdir}/index.html" -w '%{http_code}' --max-time 2 \
    "${base}/" 2>"${tmpdir}/index.err"); then
    if [ "$code" = "200" ] && [ -s "${tmpdir}/index.html" ]; then
      break
    fi
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "Web / did not return 200 within ${BOOT_TIMEOUT}s (last HTTP status: ${code:-none})" >&2
    if [ -s "${tmpdir}/index.err" ]; then
      cat "${tmpdir}/index.err" >&2
    fi
    exit 1
  fi
  sleep 1
done

python3 - "${tmpdir}/index.html" "${tmpdir}/asset.path" <<'PY'
import re
import sys

html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
pattern = re.compile(
    r"/assets/[A-Za-z0-9._~-]+-[A-Za-z0-9_-]+\.(?:js|css|woff2|woff|ttf|eot|svg|png|jpg|jpeg|webp|gif|map)"
)
match = pattern.search(html)
if match is None:
    print("GET / returned 200 but the HTML has no hashed /assets/ URL", file=sys.stderr)
    sys.exit(1)
path = match.group(0)
if path.startswith("/assets/") and ".." not in path:
    open(sys.argv[2], "w", encoding="utf-8").write(path)
    print(path)
else:
    print(f"refusing asset path {path}", file=sys.stderr)
    sys.exit(1)
PY

asset=$(cat "${tmpdir}/asset.path")

if ! code=$(curl -fsS -D "${tmpdir}/asset.headers" -o "${tmpdir}/asset.body" -w '%{http_code}' \
  --max-time 10 "${base}${asset}" 2>"${tmpdir}/asset.err"); then
  echo "GET ${asset} failed (last HTTP status: ${code:-none})" >&2
  if [ -s "${tmpdir}/asset.err" ]; then
    cat "${tmpdir}/asset.err" >&2
  fi
  exit 1
fi
if [ "$code" != "200" ]; then
  echo "GET ${asset} returned ${code}, expected 200" >&2
  exit 1
fi

python3 - "${tmpdir}/index.html" "${tmpdir}/asset.body" "${tmpdir}/asset.headers" "$asset" <<'PY'
import pathlib
import sys

index_path, asset_path, header_path, asset_url = sys.argv[1:5]
index = pathlib.Path(index_path).read_bytes()
body = pathlib.Path(asset_path).read_bytes()
headers = pathlib.Path(header_path).read_text(encoding="utf-8", errors="replace")
content_type = ""
for line in headers.splitlines():
    name, sep, value = line.partition(":")
    if sep and name.strip().lower() == "content-type":
        content_type = value.split(";", 1)[0].strip().lower()
        break

if not body:
    print(f"GET {asset_url} returned an empty body", file=sys.stderr)
    sys.exit(1)
if body == index or body.lstrip().lower().startswith((b"<!doctype html", b"<html")):
    print(f"GET {asset_url} returned the SPA document, not a static asset", file=sys.stderr)
    sys.exit(1)
if content_type in {"text/html", "application/xhtml+xml"}:
    print(f"GET {asset_url} Content-Type is {content_type}", file=sys.stderr)
    sys.exit(1)
print(f"web image checks passed / {asset_url}")
PY
