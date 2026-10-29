#!/usr/bin/env bash
# CH-207: web domains proxy /sitemap.xml to the API. /robots.txt stays on the
# web container. www keeps redirecting every path, including the sitemap.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
caddyfile="${root}/deploy/edge/Caddyfile"
root_site="${root}/deploy/edge/optional/root-web.caddy"
failed=0

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

require_line() {
  local name="$1"
  local body="$2"
  local line="$3"
  if ! grep -qxF "${line}" <<< "${body}"; then
    echo "FAIL ${name}: missing ${line}" >&2
    failed=1
    return
  fi
  echo "OK ${name}"
}

if ! grep -q '^(cardhub_sitemap) {$' "${caddyfile}"; then
  echo "FAIL sitemap snippet missing" >&2
  failed=1
else
  echo "OK sitemap snippet"
fi

apex="$(site_block "${root_site}" '^[{][$]ROOT_WEB_DOMAINS')"
staging="$(site_block "${caddyfile}" '^[{][$]STAGING_WEB_DOMAIN[}]')"
redirect="$(site_block "${root_site}" '^[{][$]ROOT_WEB_REDIRECT_DOMAINS')"

require_line "apex headers" "${apex}" '	import cardhub_web_headers'
require_line "apex sitemap" "${apex}" '	import cardhub_sitemap {$ENV_NAME}-api:4000'
require_line "apex web" "${apex}" '		import cardhub_upstream {$ENV_NAME}-web:8080'
require_line "staging headers" "${staging}" '	import cardhub_web_headers'
require_line "staging sitemap" "${staging}" '	import cardhub_sitemap staging-api:4000'
require_line "staging web" "${staging}" '		import cardhub_upstream staging-web:8080'

if grep -q 'cardhub_sitemap\|reverse_proxy' <<< "${redirect}"; then
  echo "FAIL www redirect proxies the sitemap instead of redirecting" >&2
  failed=1
else
  echo "OK www redirect has no sitemap proxy"
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
  echo "SKIP caddy adapt; set CADDY_BIN to parse the edge file"
else
  adapted="$(
    cd "${root}/deploy/edge"
    ENV_NAME=prod \
      API_DOMAIN=api.example.test \
      STAGING_WEB_DOMAIN=staging.example.test \
      STAGING_API_DOMAIN=api-staging.example.test \
      ROOT_WEB_DOMAINS=card-hub.example.test \
      ROOT_WEB_REDIRECT_DOMAINS=www.card-hub.example.test \
      ROOT_WEB_REDIRECT_TARGET=card-hub.example.test \
      "${caddy_bin}" adapt --config Caddyfile --adapter caddyfile
  )"
  for needle in '/sitemap.xml' 'prod-api:4000' 'staging-api:4000' 'staging-web:8080' 'prod-web:8080'; do
    if ! grep -qF "${needle}" <<< "${adapted}"; then
      echo "FAIL adapted Caddyfile missing ${needle}" >&2
      failed=1
    else
      echo "OK adapt ${needle}"
    fi
  done
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
