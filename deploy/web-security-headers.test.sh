#!/usr/bin/env bash
# Infra-c AC2-5: the three web security headers are emitted by the edge,
# which overwrites the same fields from the web container.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
caddyfile="${root}/deploy/edge/Caddyfile"
root_site="${root}/deploy/edge/optional/root-web.caddy"
nginx="${root}/apps/cardhub/web/nginx-spa.conf"
failed=0

block="$(awk '
  $0 ~ /^\(cardhub_web_headers\)/ { capture = 1 }
  capture { print }
  capture && /^}/ { exit }
' "${caddyfile}")"

require_line() {
  local name="$1"
  local line="$2"
  if ! printf '%s\n' "${block}" | grep -qxF "${line}"; then
    echo "FAIL ${name}: missing ${line}" >&2
    failed=1
    return
  fi
  echo "OK ${name}"
}

require_line "hsts" '		Strict-Transport-Security "max-age=31536000; includeSubDomains"'
require_line "nosniff" '		X-Content-Type-Options nosniff'
require_line "frame" '		X-Frame-Options DENY'

if ! grep -q 'import cardhub_web_headers' "${caddyfile}"; then
  echo "FAIL staging web does not import cardhub_web_headers" >&2
  failed=1
else
  echo "OK staging web imports cardhub_web_headers"
fi

if ! grep -q 'import cardhub_web_headers' "${root_site}"; then
  echo "FAIL apex web does not import cardhub_web_headers" >&2
  failed=1
else
  echo "OK apex web imports cardhub_web_headers"
fi

if grep -Eq 'Strict-Transport-Security|X-Content-Type-Options|X-Frame-Options' "${nginx}"; then
  echo "FAIL nginx-spa.conf sets a security header; the edge defer handler is what clients see" >&2
  failed=1
else
  echo "OK nginx-spa.conf leaves the three headers to the edge"
fi

caddy_bin="${CADDY_BIN:-}"
if [ -z "${caddy_bin}" ] && command -v caddy >/dev/null 2>&1; then
  caddy_bin="$(command -v caddy)"
fi

if [ -n "${caddy_bin}" ]; then
  work="$(mktemp -d)"
  port="${CADDY_TEST_PORT:-18080}"
  cat > "${work}/Caddyfile" <<EOF
{
	admin off
	auto_https off
}
:${port} {
	import cardhub_web_headers
	respond "ok" 200
}
EOF
  # The snippet lives in the repo Caddyfile. Prepend it so this site uses the
  # same handler production imports.
  {
    printf '%s\n' "${block}"
    cat "${work}/Caddyfile"
  } > "${work}/full.Caddyfile"
  mv "${work}/full.Caddyfile" "${work}/Caddyfile"
  "${caddy_bin}" run --config "${work}/Caddyfile" --adapter caddyfile >"${work}/caddy.log" 2>&1 &
  caddy_pid=$!
  trap 'kill "${caddy_pid}" >/dev/null 2>&1 || true; rm -rf "${work}"' EXIT
  ready=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf -o /dev/null "http://127.0.0.1:${port}/"; then
      ready=1
      break
    fi
    sleep 0.2
  done
  if [ "${ready}" -ne 1 ]; then
    echo "FAIL caddy did not start" >&2
    cat "${work}/caddy.log" >&2 || true
    exit 1
  fi
  headers="$(curl -sI "http://127.0.0.1:${port}/")"
  printf '%s\n' "${headers}"
  for expected in \
    'Strict-Transport-Security: max-age=31536000; includeSubDomains' \
    'X-Content-Type-Options: nosniff' \
    'X-Frame-Options: DENY'
  do
    if ! printf '%s\n' "${headers}" | grep -qi "^${expected}"; then
      echo "FAIL curl missing ${expected}" >&2
      failed=1
    else
      echo "OK curl ${expected}"
    fi
  done
  kill "${caddy_pid}" >/dev/null 2>&1 || true
  trap - EXIT
  rm -rf "${work}"
else
  echo "SKIP live caddy; set CADDY_BIN to also curl -I"
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
