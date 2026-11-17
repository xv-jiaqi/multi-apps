#!/usr/bin/env bash
# Exercise scripts/check-web-image.sh against a local HTTP fixture.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="${root}/scripts/check-web-image.sh"
work="$(mktemp -d)"
trap 'kill $(jobs -p) >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

start_server() {
  mode="$1"
  port_file="${work}/port"
  rm -f "$port_file"
  python3 - "$mode" "$port_file" <<'PY' &
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

mode, port_file = sys.argv[1:3]
index = (
    b"<!doctype html><script src=\"/src/main.tsx\"></script>"
    b"<script src=\"/assets/index-Ab12cd.js\"></script>"
)
asset = b"console.log('cardhub');"
INDEX_CSP = (
    "default-src 'self'; frame-ancestors 'none'; script-src 'self'; "
    "connect-src 'self' http://127.0.0.1:4000"
)
INDEX_LINK = "<http://127.0.0.1:4000>; rel=preconnect; crossorigin"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            if mode == "no-asset":
                body = b"<!doctype html><h1>empty</h1>"
            else:
                body = index
            headers = {
                "Link": INDEX_LINK,
                "Content-Security-Policy": INDEX_CSP,
                "Cache-Control": "no-cache",
            }
            if mode == "no-link":
                headers.pop("Link")
            elif mode == "bad-link":
                headers["Link"] = "</foo.css>; rel=stylesheet"
            elif mode == "no-csp":
                headers.pop("Content-Security-Policy")
            elif mode == "csp-no-connect":
                headers["Content-Security-Policy"] = (
                    "default-src 'self'; frame-ancestors 'none'; script-src 'self'"
                )
            elif mode == "link-csp-mismatch":
                headers["Link"] = "<https://api.card-hub.app>; rel=preconnect; crossorigin"
            elif mode == "index-cached":
                headers["Cache-Control"] = "public, max-age=3600"
            self._send(200, "text/html", body, headers)
            return
        if path == "/assets/index-Ab12cd.js":
            if mode == "asset-404":
                self._send(404, "text/plain", b"missing")
                return
            if mode == "asset-html":
                self._send(200, "text/html", index)
                return
            headers = {
                "Cache-Control": "public, max-age=31536000, immutable",
            }
            if mode == "asset-mutable":
                headers["Cache-Control"] = "public, max-age=3600"
            elif mode == "asset-link":
                headers["Link"] = INDEX_LINK
            self._send(200, "application/javascript", asset, headers)
            return
        self._send(404, "text/plain", b"no")

    def _send(self, status, content_type, body, extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for name, value in extra_headers.items():
                self.send_header(name, value)
        self.end_headers()
        self.wfile.write(body)

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(port_file, "w", encoding="utf-8") as handle:
    handle.write(str(server.server_address[1]))
server.serve_forever()
PY
  server_pid=$!
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if [ -s "$port_file" ]; then
      break
    fi
    sleep 0.05
  done
  if [ ! -s "$port_file" ]; then
    echo "fixture server did not start" >&2
    exit 1
  fi
  port="$(cat "$port_file")"
}

stop_server() {
  if [ -n "${server_pid:-}" ]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
    server_pid=""
  fi
}

expect_fail() {
  mode="$1"
  needle="$2"
  start_server "$mode"
  set +e
  BOOT_TIMEOUT=4 \
    WEB_BASE_URL="http://127.0.0.1:${port}" \
    bash "$script" >"${work}/out" 2>"${work}/err"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "expected ${mode} to fail" >&2
    cat "${work}/out" >&2
    exit 1
  fi
  if ! grep -q "$needle" "${work}/err"; then
    echo "expected ${mode} stderr to contain: ${needle}" >&2
    cat "${work}/err" >&2
    exit 1
  fi
  stop_server
  echo "OK web image rejects ${mode}"
}

start_server ok
BOOT_TIMEOUT=5 WEB_BASE_URL="http://127.0.0.1:${port}" \
  bash "$script" >"${work}/out"
if ! grep -q "web image checks passed / /assets/index-Ab12cd.js" "${work}/out"; then
  echo "expected a hashed asset to pass" >&2
  cat "${work}/out" >&2
  exit 1
fi
for needle in \
  "GET / Link: <http://127.0.0.1:4000>; rel=preconnect; crossorigin" \
  "GET / Content-Security-Policy:" \
  "GET / Cache-Control: no-cache" \
  "GET /assets/index-Ab12cd.js Cache-Control: public, max-age=31536000, immutable" \
  "GET /assets/index-Ab12cd.js has no Link header"
do
  if ! grep -qF "$needle" "${work}/out"; then
    echo "expected passing output to contain: ${needle}" >&2
    cat "${work}/out" >&2
    exit 1
  fi
done
stop_server
echo "OK web image serves / and /assets/ with headers"

expect_fail no-asset "no hashed /assets/ URL"
expect_fail asset-404 "GET /assets/index-Ab12cd.js failed"
expect_fail asset-html "returned the SPA document"
expect_fail no-link "missing the Link header"
expect_fail bad-link "Link header is not an API preconnect"
expect_fail no-csp "missing the Content-Security-Policy header"
expect_fail csp-no-connect "missing the connect-src directive"
expect_fail link-csp-mismatch "is not in Content-Security-Policy connect-src"
expect_fail index-cached "GET / Cache-Control is public, max-age=3600, expected no-cache"
expect_fail asset-mutable "GET /assets/index-Ab12cd.js Cache-Control is public, max-age=3600, expected immutable"
expect_fail asset-link "must not have a Link header"

set +e
BOOT_TIMEOUT=2 WEB_BASE_URL="http://127.0.0.1:1" bash "$script" >"${work}/out" 2>"${work}/err"
rc=$?
set -e
if [ "$rc" -eq 0 ] || ! grep -q "did not return 200 within 2s" "${work}/err"; then
  echo "expected a closed port to time out" >&2
  cat "${work}/err" >&2
  exit 1
fi
echo "OK web image closed port"

set +e
BOOT_TIMEOUT=nope bash "$script" >"${work}/out" 2>"${work}/err"
rc=$?
set -e
if [ "$rc" -eq 0 ] || ! grep -q "BOOT_TIMEOUT must be a positive integer" "${work}/err"; then
  echo "expected a bad BOOT_TIMEOUT to fail" >&2
  exit 1
fi
echo "OK web image timeout guard"
