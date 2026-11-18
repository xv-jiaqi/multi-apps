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
# GET / must carry the API preconnect Link, a Content-Security-Policy,
# and Cache-Control: no-cache. The hashed asset must be immutable and
# must not have a Link header (only location / includes the preconnect).

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

if ! code=$(curl -fsS -D "${tmpdir}/index.headers" -o "${tmpdir}/index.html" -w '%{http_code}' \
  --max-time 10 "${base}/" 2>"${tmpdir}/index.err"); then
  echo "GET / failed while reading response headers (last HTTP status: ${code:-none})" >&2
  if [ -s "${tmpdir}/index.err" ]; then
    cat "${tmpdir}/index.err" >&2
  fi
  exit 1
fi
if [ "$code" != "200" ]; then
  echo "GET / returned ${code} while reading response headers, expected 200" >&2
  exit 1
fi

python3 - "${tmpdir}/index.html" "${tmpdir}/asset.path" <<'PY'
import re
import sys

html = open(sys.argv[1], encoding="utf-8", errors="replace").read()
pattern = re.compile(
    # .map is not a published asset. nginx returns 404 for /assets/*.map,
    # so it must not be selected as the immutable hashed asset.
    r"/assets/[A-Za-z0-9._~-]+-[A-Za-z0-9_-]+\.(?:js|css|woff2|woff|ttf|eot|svg|png|jpg|jpeg|webp|gif)"
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

python3 - "${tmpdir}/index.html" "${tmpdir}/asset.body" "${tmpdir}/index.headers" \
  "${tmpdir}/asset.headers" "$asset" <<'PY'
import pathlib
import re
import sys

index_path, asset_body_path, index_header_path, asset_header_path, asset_url = sys.argv[1:6]
index = pathlib.Path(index_path).read_bytes()
body = pathlib.Path(asset_body_path).read_bytes()
index_header_text = pathlib.Path(index_header_path).read_text(encoding="utf-8", errors="replace")
asset_header_text = pathlib.Path(asset_header_path).read_text(encoding="utf-8", errors="replace")

errors = []


def parse_headers(text):
    headers = {}
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if line.upper().startswith("HTTP/"):
            headers.clear()
            continue
        if not line:
            continue
        name, sep, value = line.partition(":")
        if not sep:
            continue
        headers.setdefault(name.strip().lower(), []).append(value.strip())
    return headers


def first(headers, name):
    values = headers.get(name.lower(), [])
    return values[0] if values else ""


def joined(headers, name):
    return ", ".join(headers.get(name.lower(), []))


def has_cache_token(value, token):
    if not value:
        return False
    needle = token.lower()
    for part in value.split(","):
        name = part.split("=", 1)[0].strip().lower()
        if name == needle:
            return True
    return False


def content_type(headers):
    value = first(headers, "content-type")
    return value.split(";", 1)[0].strip().lower()


PRECONNECT_RE = re.compile(
    r"<(https?://[^>\s]+)>\s*;\s*rel\s*=\s*[\"']?preconnect[\"']?\s*;\s*crossorigin\b",
    re.I,
)
ORIGIN_RE = re.compile(r"^https?://[A-Za-z0-9.-]+(?::[0-9]{1,5})?$", re.I)
CSP_DIRECTIVE_RE = re.compile(r"(?:^|;)\s*([A-Za-z0-9-]+)\s+([^;]+)", re.I)


def csp_sources(csp, directive):
    sources = []
    for name, value in CSP_DIRECTIVE_RE.findall(csp):
        if name.lower() == directive.lower():
            sources.extend(value.split())
    return sources


index_headers = parse_headers(index_header_text)
asset_headers = parse_headers(asset_header_text)

if not body:
    errors.append(f"GET {asset_url} returned an empty body")
if body == index or body.lstrip().lower().startswith((b"<!doctype html", b"<html")):
    errors.append(f"GET {asset_url} returned the SPA document, not a static asset")
asset_ct = content_type(asset_headers)
if asset_ct in {"text/html", "application/xhtml+xml"}:
    errors.append(f"GET {asset_url} Content-Type is {asset_ct}")

link_values = index_headers.get("link", [])
link_origin = None
for value in link_values:
    match = PRECONNECT_RE.search(value)
    if match is None:
        continue
    origin = match.group(1)
    if ORIGIN_RE.fullmatch(origin):
        link_origin = origin
        break
if not link_values:
    errors.append(
        "GET / is missing the Link header "
        "(expected an API preconnect, e.g. Link: <https://api.example>; rel=preconnect; crossorigin)"
    )
elif link_origin is None:
    errors.append(
        "GET / Link header is not an API preconnect "
        f"(expected <scheme://host[:port]>; rel=preconnect; crossorigin), got: {joined(index_headers, 'link')}"
    )

csp = first(index_headers, "content-security-policy")
if not csp:
    errors.append("GET / is missing the Content-Security-Policy header")
else:
    for directive in ("default-src", "frame-ancestors", "script-src", "connect-src"):
        if not csp_sources(csp, directive):
            errors.append(
                f"GET / Content-Security-Policy is missing the {directive} directive: {csp}"
            )
    if link_origin and link_origin not in csp_sources(csp, "connect-src"):
        connect = " ".join(csp_sources(csp, "connect-src")) or "(none)"
        errors.append(
            f"GET / Link preconnect origin {link_origin} is not in "
            f"Content-Security-Policy connect-src ({connect})"
        )

index_cc = first(index_headers, "cache-control")
if not has_cache_token(index_cc, "no-cache"):
    shown = index_cc or "(missing)"
    errors.append(f"GET / Cache-Control is {shown}, expected no-cache")

asset_cc = first(asset_headers, "cache-control")
if not has_cache_token(asset_cc, "immutable"):
    shown = asset_cc or "(missing)"
    errors.append(f"GET {asset_url} Cache-Control is {shown}, expected immutable")

if asset_headers.get("link"):
    errors.append(
        f"GET {asset_url} must not have a Link header, got: {joined(asset_headers, 'link')}"
    )

if errors:
    print("\n".join(errors), file=sys.stderr)
    sys.exit(1)

link_shown = next(
    (value for value in link_values if PRECONNECT_RE.search(value) and ORIGIN_RE.fullmatch(PRECONNECT_RE.search(value).group(1))),
    joined(index_headers, "link"),
)
print(f"web image checks passed / {asset_url}")
print(f"  GET / Link: {link_shown}")
print(f"  GET / Content-Security-Policy: {csp}")
print(f"  GET / Cache-Control: {index_cc}")
print(f"  GET {asset_url} Cache-Control: {asset_cc}")
print(f"  GET {asset_url} has no Link header")
PY
