#!/usr/bin/env bash
# Infra-c AC2-5 plus the web container CSP. The three headers are emitted by
# the edge snippet. CI must actually run caddy and curl them.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
caddyfile="${root}/deploy/edge/Caddyfile"
root_site="${root}/deploy/edge/optional/root-web.caddy"
nginx="${root}/apps/cardhub/web/nginx-spa.conf"
failed=0

# Brace-balanced block starting at the first line that matches start_re.
# Comment lines are omitted so a commented import cannot satisfy the check.
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

require_site_import() {
  local name="$1"
  local file="$2"
  local start_re="$3"
  local body
  body="$(site_block "$file" "$start_re")"
  if [ -z "${body}" ]; then
    echo "FAIL ${name}: site block not found" >&2
    return 1
  fi
  if ! printf '%s\n' "${body}" | grep -Eq '^[[:space:]]*import cardhub_web_headers[[:space:]]*$'; then
    echo "FAIL ${name}: site block does not import cardhub_web_headers" >&2
    return 1
  fi
  echo "OK ${name}"
}

# Character classes, not backslash escapes: Ubuntu CI's mawk treats `\(` as `(`.
block="$(site_block "${caddyfile}" '^[(]cardhub_web_headers[)]')"

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
require_line "csp-fallback" '		?Content-Security-Policy "frame-ancestors '\''none'\''"'
require_line "defer" '		defer'

if ! require_site_import "staging web" "${caddyfile}" '^[{][$]STAGING_WEB_DOMAIN[}]'; then
  failed=1
fi
if ! require_site_import "apex web" "${root_site}" '^[{][$]ROOT_WEB_DOMAINS'; then
  failed=1
fi

negative_dir="$(mktemp -d)"
cat > "${negative_dir}/Caddyfile" <<'EOF'
# import cardhub_web_headers
{$STAGING_WEB_DOMAIN} {
	# import cardhub_web_headers
	import cardhub_api_headers
}
EOF
cat > "${negative_dir}/root-web.caddy" <<'EOF'
# import cardhub_web_headers
{$ROOT_WEB_DOMAINS:http://root-web-disabled.invalid} {
	# import cardhub_web_headers
	import cardhub_api_headers
}
EOF
if require_site_import "comment-only staging" "${negative_dir}/Caddyfile" '^[{][$]STAGING_WEB_DOMAIN[}]' >/dev/null 2>&1; then
  echo "FAIL comment-only import was accepted for staging" >&2
  failed=1
else
  echo "OK comment-only staging import is rejected"
fi
if require_site_import "comment-only apex" "${negative_dir}/root-web.caddy" '^[{][$]ROOT_WEB_DOMAINS' >/dev/null 2>&1; then
  echo "FAIL comment-only import was accepted for apex" >&2
  failed=1
else
  echo "OK comment-only apex import is rejected"
fi
rm -rf "${negative_dir}"

if ! grep -q 'include /etc/nginx/conf.d/security-headers.inc' "${nginx}"; then
  echo "FAIL nginx-spa.conf does not include the generated security headers" >&2
  failed=1
else
  echo "OK nginx include"
fi

caddy_bin="${CADDY_BIN:-}"
if [ -z "${caddy_bin}" ] && command -v caddy >/dev/null 2>&1; then
  caddy_bin="$(command -v caddy)"
fi

if [ -z "${caddy_bin}" ]; then
  if [ "${CI:-}" = "true" ]; then
    echo "FAIL caddy is required when CI=true" >&2
    exit 1
  fi
  echo "SKIP live caddy; set CADDY_BIN to also curl -I"
else
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
  echo "LIVE curl -sI"
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
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
