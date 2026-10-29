#!/usr/bin/env bash
# Edge access log: one JSON file on the caddy_data volume, credential headers
# deleted, request body not logged, rolling capped at about 500 MiB / 14 days.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
caddyfile="${root}/deploy/edge/Caddyfile"
root_site="${root}/deploy/edge/optional/root-web.caddy"
compose="${root}/deploy/edge/docker-compose.yml"
apply="${root}/deploy/edge/apply-edge-config.sh"
failed=0

ok() {
  echo "OK $1"
}

bad() {
  echo "FAIL $1" >&2
  failed=1
}

site_block() {
  local file="$1"
  local start_re="$2"
  awk -v start="$start_re" '
    $0 ~ start && !capture {
      capture = 1
      depth = 0
    }
    capture {
      line = $0
      if (line !~ /^[[:space:]]*#/) {
        print line
      }
      opens = gsub(/\{/, "{", line)
      closes = gsub(/\}/, "}", line)
      depth += opens - closes
      if (depth <= 0) exit
    }
  ' "$file"
}

require_import() {
  local name="$1"
  local file="$2"
  local start_re="$3"
  local body
  body="$(site_block "${file}" "${start_re}")"
  if [ -z "${body}" ]; then
    bad "${name}: site block not found"
    return
  fi
  if ! grep -Eq '^[[:space:]]*import cardhub_access_log[[:space:]]*$' <<< "${body}"; then
    bad "${name}: site block does not import cardhub_access_log"
    return
  fi
  ok "${name}"
}

require_import "api" "${caddyfile}" '^[{][$]API_DOMAIN[}]'
require_import "staging web" "${caddyfile}" '^[{][$]STAGING_WEB_DOMAIN[}]'
require_import "staging api" "${caddyfile}" '^[{][$]STAGING_API_DOMAIN[}]'
require_import "apex" "${root_site}" '^[{][$]ROOT_WEB_DOMAINS'
require_import "www" "${root_site}" '^[{][$]ROOT_WEB_REDIRECT_DOMAINS'

negative="$(mktemp -d)"
cat > "${negative}/Caddyfile" <<'EOF'
{$API_DOMAIN} {
	# import cardhub_access_log
	import cardhub_api_headers
}
EOF
if grep -Eq '^[[:space:]]*import cardhub_access_log[[:space:]]*$' <<< "$(site_block "${negative}/Caddyfile" '^[{][$]API_DOMAIN[}]')"; then
  bad "comment-only import was accepted"
else
  ok "comment-only import is rejected"
fi
rm -rf "${negative}"

global="$(site_block "${caddyfile}" '^[{]$')"
for line in \
  $'		exclude http.log.access' \
  $'		include http.log.access' \
  $'		output file /data/logs/access.log {' \
  $'			mode 644' \
  $'			roll_size 50MiB' \
  $'			roll_keep 9' \
  $'			roll_keep_for 336h' \
  $'			request>headers>Authorization delete' \
  $'			request>headers>Proxy-Authorization delete' \
  $'			request>headers>Cookie delete' \
  $'			request>headers>Set-Cookie delete' \
  $'			request>headers>X-Api-Key delete' \
  $'			request>headers>Referer delete' \
  $'			resp_headers>Set-Cookie delete' \
  $'			request>uri query {' \
  $'				delete input' \
  $'				replace token REDACTED' \
  $'				replace code REDACTED' \
  $'				replace access_token REDACTED' \
  $'				replace refresh_token REDACTED' \
  $'				replace id_token REDACTED' \
  $'				replace reset_token REDACTED' \
  $'			wrap json'
do
  if ! grep -qxF "${line}" <<< "${global}"; then
    bad "global log block missing: ${line}"
  else
    ok "global ${line}"
  fi
done

if grep -q 'request>body\|request>headers>.*body' "${caddyfile}"; then
  bad "Caddyfile logs a request body field"
else
  ok "Caddyfile does not log request bodies"
fi

if ! grep -qxF '      - ./:/etc/caddy:ro' "${compose}"; then
  bad "edge compose no longer bind-mounts the Caddyfile directory"
else
  ok "Caddyfile directory mount is unchanged"
fi
if ! grep -qxF '      - caddy_data:/data' "${compose}"; then
  bad "caddy_data volume is not mounted at /data"
else
  ok "access log volume is the existing caddy_data mount"
fi
if ! grep -qxF "    max-size: '10m'" "${compose}" || ! grep -qxF "    max-file: '5'" "${compose}"; then
  bad "edge json-file rotation is not 10m x 5"
else
  ok "edge json-file rotation is 10m x 5"
fi
if ! grep -q 'mkdir -p /data/logs' "${apply}"; then
  bad "apply-edge-config.sh does not create /data/logs"
else
  ok "edge apply creates /data/logs"
fi

if [ "${CI:-}" = "true" ] && [ -z "${CADDY_BIN:-}" ]; then
  echo "FAIL CADDY_BIN is required when CI=true; the live Caddy test must not be skipped" >&2
  exit 1
fi
caddy_bin="${CADDY_BIN:-}"
if [ -z "${caddy_bin}" ] && command -v caddy >/dev/null 2>&1; then
  caddy_bin="$(command -v caddy)"
fi

if [ -z "${caddy_bin}" ]; then
  echo "SKIP caddy adapt and live log; set CADDY_BIN"
else
  echo "Running live Caddy access-log test with CADDY_BIN=${caddy_bin}"
  "${caddy_bin}" version
  work="$(mktemp -d)"
  (
    cd "${root}/deploy/edge"
    ENV_NAME=prod \
      API_DOMAIN=api.card-hub.app \
      STAGING_WEB_DOMAIN=staging.card-hub.app \
      STAGING_API_DOMAIN=api-staging.card-hub.app \
      ROOT_WEB_DOMAINS=card-hub.app \
      ROOT_WEB_REDIRECT_DOMAINS=www.card-hub.app \
      ROOT_WEB_REDIRECT_TARGET=card-hub.app \
      "${caddy_bin}" adapt --config Caddyfile --adapter caddyfile > "${work}/adapted.json"
  )
  python3 - "${work}/adapted.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
logs = data["logging"]["logs"]
access = logs["cardhub_access"]
writer = access["writer"]
fields = access["encoder"]["fields"]
expected = {
    "request>headers>Authorization": {"filter": "delete"},
    "request>headers>Proxy-Authorization": {"filter": "delete"},
    "request>headers>Cookie": {"filter": "delete"},
    "request>headers>Set-Cookie": {"filter": "delete"},
    "request>headers>X-Api-Key": {"filter": "delete"},
    "request>headers>Referer": {"filter": "delete"},
    "resp_headers>Set-Cookie": {"filter": "delete"},
    "request>uri": {
        "filter": "query",
        "actions": [
            {"parameter": "input", "type": "delete"},
            {"parameter": "token", "type": "replace", "value": "REDACTED"},
            {"parameter": "code", "type": "replace", "value": "REDACTED"},
            {"parameter": "access_token", "type": "replace", "value": "REDACTED"},
            {"parameter": "refresh_token", "type": "replace", "value": "REDACTED"},
            {"parameter": "id_token", "type": "replace", "value": "REDACTED"},
            {"parameter": "reset_token", "type": "replace", "value": "REDACTED"},
        ],
    },
}
problems = []
if writer.get("filename") != "/data/logs/access.log":
    problems.append(f"filename {writer.get('filename')}")
if writer.get("roll_size_mb") != 50 or writer.get("roll_keep") != 9 or writer.get("roll_keep_days") != 14:
    problems.append(f"roll {writer.get('roll_size_mb')} {writer.get('roll_keep')} {writer.get('roll_keep_days')}")
if writer.get("mode") != "0644":
    problems.append(f"mode {writer.get('mode')}")
if access["encoder"].get("wrap", {}).get("format") != "json":
    problems.append("encoder is not json")
if fields != expected:
    problems.append(f"fields {fields}")
if "http.log.access" not in (access.get("include") or []):
    problems.append(f"include {access.get('include')}")
if "http.log.access" not in (logs["default"].get("exclude") or []):
    problems.append(f"default exclude {logs['default'].get('exclude')}")
names = data["apps"]["http"]["servers"]["srv0"]["logs"]["logger_names"]
for host in (
    "card-hub.app",
    "www.card-hub.app",
    "api.card-hub.app",
    "staging.card-hub.app",
    "api-staging.card-hub.app",
):
    if host not in names:
        problems.append(f"missing host {host}")
if problems:
    print("FAIL adapt: " + "; ".join(problems), file=sys.stderr)
    sys.exit(1)
print("OK caddy adapt access log")
PY

  py_port=18095
  caddy_port=18094
  cat > "${work}/upstream.py" <<PY
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def _ok(self):
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Set-Cookie", "session=super-secret")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._ok()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0"))
        self.rfile.read(n)
        self._ok()

    def log_message(self, fmt, *args):
        return

HTTPServer(("127.0.0.1", ${py_port}), Handler).serve_forever()
PY
  python3 "${work}/upstream.py" &
  py_pid=$!
  awk '
    BEGIN { inserted = 0 }
    /^\{$/ && !inserted {
      print
      print "\tadmin off"
      print "\tauto_https off"
      inserted = 1
      next
    }
    { print }
  ' "${caddyfile}" > "${work}/global.caddy"
  # Keep the global options and the access-log snippet. Drop the real sites,
  # which bind 443. Rewrite only the log path so this test can read the file.
  awk '
    $0 ~ /^\(cardhub_access_log\) \{/ && !capture {
      capture = 1
      depth = 0
    }
    capture {
      print
      opens = gsub(/\{/, "{", $0)
      closes = gsub(/\}/, "}", $0)
      depth += opens - closes
      if (depth <= 0) exit
    }
  ' "${caddyfile}" > "${work}/snippet.caddy"
  awk '
    BEGIN { capture = 0; depth = 0; done = 0 }
    /^\{\$/ { exit }
    done { next }
    /^\{$/ && !capture { capture = 1; depth = 0 }
    capture {
      print
      opens = gsub(/\{/, "{", $0)
      closes = gsub(/\}/, "}", $0)
      depth += opens - closes
      if (capture && depth <= 0) { done = 1; capture = 0 }
    }
  ' "${work}/global.caddy" \
    | sed "s#/data/logs/access.log#${work}/access.log#" > "${work}/Caddyfile"
  cat "${work}/snippet.caddy" >> "${work}/Caddyfile"
  cat >> "${work}/Caddyfile" <<EOF

:${caddy_port} {
	import cardhub_access_log
	reverse_proxy 127.0.0.1:${py_port}
}
EOF
  if ! "${caddy_bin}" validate --config "${work}/Caddyfile" --adapter caddyfile >"${work}/validate.out" 2>&1; then
    cat "${work}/validate.out" >&2
    exit 1
  fi
  "${caddy_bin}" run --config "${work}/Caddyfile" --adapter caddyfile >"${work}/caddy.err" 2>&1 &
  caddy_pid=$!
  cleanup() {
    if [ -n "${caddy_pid:-}" ]; then
      kill "${caddy_pid}" >/dev/null 2>&1 || true
      wait "${caddy_pid}" >/dev/null 2>&1 || true
    fi
    if [ -n "${py_pid:-}" ]; then
      kill "${py_pid}" >/dev/null 2>&1 || true
      wait "${py_pid}" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup EXIT
  ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if curl -sf -o /dev/null -H 'Content-Type: text/plain' --data 'x' "http://127.0.0.1:${caddy_port}/" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [ "${ready}" -ne 1 ]; then
    echo "FAIL caddy did not start" >&2
    cat "${work}/caddy.err" >&2 || true
    exit 1
  fi
  curl -sS -D "${work}/headers" -o "${work}/body" \
    -H 'Authorization: Bearer super-secret-token' \
    -H 'Cookie: session=super-secret-cookie' \
    -H 'Set-Cookie: inbound=nope' \
    -H 'X-Request-Id: trace-me' \
    --data 'password=hunter2-secret-body' \
    "http://127.0.0.1:${caddy_port}/trpc/auth.login,auth.login" >/dev/null
  curl -g -sS -o /dev/null \
    "http://127.0.0.1:${caddy_port}/trpc/x?batch=1&input={\"email\":\"a@b.c\"}"
  jwt='eyJhbGciOiJub25lIn0.payload.sig'
  curl -g -sS -o /dev/null \
    -H "Referer: http://127.0.0.1:${caddy_port}/trpc/auth.me?input={\"token\":\"${jwt}\"}" \
    -H 'X-Api-Key: super-api-key-value' \
    -H 'Proxy-Authorization: Basic c2VjcmV0' \
    "http://127.0.0.1:${caddy_port}/trpc/auth.me?input={\"token\":\"${jwt}\"}&token=${jwt}&access_token=${jwt}"
  sleep 0.3
  if [ ! -s "${work}/access.log" ]; then
    bad "live access log was not written"
    cat "${work}/caddy.err" >&2 || true
  else
    python3 - "${work}/access.log" "${work}/headers" "${work}/caddy.err" <<'PY'
import json, sys
from pathlib import Path
log_path, headers_path, err_path = sys.argv[1:]
lines = [json.loads(line) for line in Path(log_path).read_text().splitlines() if line.strip()]
blob = Path(log_path).read_text()
err = Path(err_path).read_text()
response_headers = Path(headers_path).read_text()
problems = []
needles = [
    "super-secret-token",
    "super-secret-cookie",
    "hunter2-secret-body",
    "inbound=nope",
    "session=super-secret",
    "Bearer",
    "a@b.c",
    "a%40b.c",
    "eyJhbGciOiJub25lIn0.payload.sig",
    "eyJ",
    "super-api-key-value",
    "c2VjcmV0",
]
for needle in needles:
    if needle in blob:
        problems.append(f"log contains {needle}")
    if needle in err:
        problems.append(f"stderr contains {needle}")
for line in lines:
    uri = ((line.get("request") or {}).get("uri") or "")
    if "/trpc/" in uri:
        print(f"PROOF uri={uri}")
email = [line for line in lines if "/trpc/x" in json.dumps(line)]
if not email:
    problems.append("GET /trpc/x was not logged")
else:
    uri = (email[-1].get("request") or {}).get("uri") or ""
    if not uri.startswith("/trpc/x"):
        problems.append(f"path lost on /trpc/x: {uri}")
    if "batch=1" not in uri:
        problems.append(f"batch param lost: {uri}")
    if "input" in uri:
        problems.append(f"input query remained: {uri}")
    else:
        print("PROOF line=" + json.dumps(email[-1], separators=(",", ":")))
auth = [line for line in lines if "/trpc/auth.me" in json.dumps(line)]
if not auth:
    problems.append("GET /trpc/auth.me was not logged")
else:
    raw = json.dumps(auth[-1])
    req_headers = (auth[-1].get("request") or {}).get("headers") or {}
    if "Referer" in req_headers or "referer" in req_headers:
        problems.append(f"Referer kept: {req_headers}")
    if "X-Api-Key" in req_headers or "Proxy-Authorization" in req_headers:
        problems.append(f"credential header kept: {req_headers}")
    uri = (auth[-1].get("request") or {}).get("uri") or ""
    if not uri.startswith("/trpc/auth.me"):
        problems.append(f"path lost on /trpc/auth.me: {uri}")
    if "token=REDACTED" not in uri or "access_token=REDACTED" not in uri:
        problems.append(f"token query was not redacted: {uri}")
    if "input" in uri or "eyJ" in raw:
        problems.append(f"jwt still in auth.me line: {raw}")
    else:
        print("PROOF line=" + json.dumps(auth[-1], separators=(",", ":")))
hit = [line for line in lines if "/trpc/auth.login,auth.login" in json.dumps(line)]
if not hit:
    problems.append("uri was not logged")
else:
    line = hit[-1]
    req = line.get("request") or {}
    if req.get("headers", {}).get("X-Request-Id") != ["trace-me"]:
        problems.append(f"X-Request-Id {req.get('headers')}")
    if "body" in line or "body" in req:
        problems.append("request body field is present")
    if int(line.get("bytes_read") or 0) <= 0:
        problems.append(f"bytes_read {line.get('bytes_read')}")
if "Set-Cookie:" not in response_headers or "session=super-secret" not in response_headers:
    problems.append("response dropped Set-Cookie")
if problems:
    print("FAIL live access log: " + "; ".join(problems), file=sys.stderr)
    sys.exit(1)
print("OK live access log deletes credential headers and omits the body")
PY
  fi
  cleanup
  trap - EXIT
  caddy_pid=""
  py_pid=""
  rm -rf "${work}"
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
