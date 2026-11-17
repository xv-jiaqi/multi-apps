#!/usr/bin/env bash
# Exercise scripts/check-api-health.sh against a local HTTP fixture.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
script="${root}/scripts/check-api-health.sh"
sha="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
work="$(mktemp -d)"
trap 'kill $(jobs -p) >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

start_server() {
  mode="$1"
  port_file="${work}/port"
  rm -f "$port_file"
  python3 - "$mode" "$port_file" "$sha" <<'PY' &
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

mode, port_file, sha = sys.argv[1:4]

class Handler(BaseHTTPRequestHandler):
    hits = 0

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        Handler.hits += 1
        if mode == "late" and Handler.hits < 3:
            self.send_response(503)
            self.end_headers()
            return
        if mode == "unavailable":
            self.send_response(503)
            self.end_headers()
            return
        body = {
            "status": "ok",
            "services": {"db": True, "redis": True},
            "gitSha": sha,
        }
        if mode == "db-false":
            body["services"]["db"] = False
        elif mode == "redis-false":
            body["services"]["redis"] = False
        elif mode == "status-bad":
            body["status"] = "down"
        elif mode == "wrong-sha":
            body["gitSha"] = "not-the-image"
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

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

expect_ok() {
  mode="$1"
  start_server "$mode"
  BOOT_TIMEOUT=8 \
    API_BASE_URL="http://127.0.0.1:${port}" \
    EXPECTED_GIT_SHA="$sha" \
    bash "$script" >"${work}/out" 2>"${work}/err"
  if ! grep -q "health ok gitSha=${sha} db=true redis=true" "${work}/out"; then
    echo "expected health ok for ${mode}" >&2
    cat "${work}/out" "${work}/err" >&2
    exit 1
  fi
  stop_server
  echo "OK api health ${mode}"
}

expect_fail() {
  mode="$1"
  needle="$2"
  timeout="$3"
  start_server "$mode"
  set +e
  BOOT_TIMEOUT="$timeout" \
    API_BASE_URL="http://127.0.0.1:${port}" \
    EXPECTED_GIT_SHA="$sha" \
    bash "$script" >"${work}/out" 2>"${work}/err"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    echo "expected ${mode} to fail" >&2
    exit 1
  fi
  if ! grep -q "$needle" "${work}/err"; then
    echo "expected ${mode} stderr to contain: ${needle}" >&2
    cat "${work}/err" >&2
    exit 1
  fi
  stop_server
  echo "OK api health rejects ${mode}"
}

expect_ok ok
expect_ok late
expect_fail db-false "services.db is not true" 5
expect_fail redis-false "services.redis is not true" 5
expect_fail status-bad "status down" 5
expect_fail wrong-sha "gitSha not-the-image" 5
expect_fail unavailable "did not return 200 within 2s" 2

set +e
BOOT_TIMEOUT=5 API_BASE_URL="http://127.0.0.1:1" EXPECTED_GIT_SHA="$sha" \
  bash "$script" >"${work}/out" 2>"${work}/err"
rc=$?
set -e
if [ "$rc" -eq 0 ] || ! grep -q "did not return 200 within 5s" "${work}/err"; then
  echo "expected a closed port to time out" >&2
  cat "${work}/err" >&2
  exit 1
fi
echo "OK api health closed port"

set +e
bash "$script" >"${work}/out" 2>"${work}/err"
rc=$?
set -e
if [ "$rc" -eq 0 ] || ! grep -q "EXPECTED_GIT_SHA is required" "${work}/err"; then
  echo "expected missing EXPECTED_GIT_SHA to fail" >&2
  exit 1
fi
echo "OK api health requires git sha"

set +e
BOOT_TIMEOUT=0 EXPECTED_GIT_SHA="$sha" bash "$script" >"${work}/out" 2>"${work}/err"
rc=$?
set -e
if [ "$rc" -eq 0 ] || ! grep -q "BOOT_TIMEOUT must be a positive integer" "${work}/err"; then
  echo "expected BOOT_TIMEOUT=0 to fail" >&2
  exit 1
fi
echo "OK api health timeout guard"
