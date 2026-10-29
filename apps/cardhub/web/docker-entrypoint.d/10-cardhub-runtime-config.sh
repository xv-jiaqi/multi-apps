#!/bin/sh
set -eu

CONFIG_FILE=${CARDHUB_CONFIG_FILE:-/usr/share/nginx/html/config.js}
ROBOTS_FILE=${CARDHUB_ROBOTS_FILE:-/usr/share/nginx/html/robots.txt}
TRPC_URL_VALUE=${TRPC_URL:-}
SENTRY_DSN_VALUE=${SENTRY_DSN:-}
SENTRY_ENVIRONMENT_VALUE=${SENTRY_ENVIRONMENT:-}
GIT_SHA_VALUE=${GIT_SHA:-}
PUBLIC_WEB_ORIGIN_VALUE=${PUBLIC_WEB_ORIGIN:-}

reject_control_chars() {
  name=$1
  value=$2

  if [ "$(printf '%s' "$value" | LC_ALL=C tr -d '\000-\037\177')" != "$value" ]; then
    echo "ERROR: $name must not contain control characters, including newlines or carriage returns." >&2
    exit 1
  fi
}

reject_js_string_breakout() {
  name=$1
  value=$2

  reject_control_chars "$name" "$value"
  if printf '%s' "$value" | grep -Eq '[[:space:]"\\]'; then
    echo "ERROR: $name must not contain whitespace, quotes, or backslashes." >&2
    exit 1
  fi
}

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_config_pair() {
  key=$1
  value=$2

  if [ "$first_config_pair" = true ]; then
    first_config_pair=false
  else
    printf ',\n' >> "$CONFIG_FILE"
  fi

  printf '  %s: "%s"' "$key" "$(escape_js_string "$value")" >> "$CONFIG_FILE"
}

reject_control_chars "TRPC_URL" "$TRPC_URL_VALUE"

if ! printf '%s' "$TRPC_URL_VALUE" | grep -Eq '^https?://[^[:space:]"\\;'"'"']+/trpc$'; then
  echo "ERROR: TRPC_URL must be set to a full http(s) URL ending in /trpc without whitespace, quotes, backslashes, or semicolons (for example: https://api.card-hub.app/trpc)." >&2
  exit 1
fi

if [ -n "$SENTRY_DSN_VALUE" ]; then
  reject_js_string_breakout "SENTRY_DSN" "$SENTRY_DSN_VALUE"
  if ! printf '%s' "$SENTRY_DSN_VALUE" | grep -Eq '^https?://[^[:space:]"\\]+$'; then
    echo "ERROR: SENTRY_DSN must be a full http(s) URL without whitespace, quotes, or backslashes." >&2
    exit 1
  fi
fi

if [ -n "$SENTRY_ENVIRONMENT_VALUE" ]; then
  reject_js_string_breakout "SENTRY_ENVIRONMENT" "$SENTRY_ENVIRONMENT_VALUE"
fi

if [ -n "$GIT_SHA_VALUE" ] && [ "$GIT_SHA_VALUE" != unknown ]; then
  reject_js_string_breakout "GIT_SHA" "$GIT_SHA_VALUE"
fi

# Empty keeps the image's robots.txt (production sitemap). A set value rewrites
# the Sitemap line so staging and production share one image.
if [ -n "$PUBLIC_WEB_ORIGIN_VALUE" ]; then
  reject_control_chars "PUBLIC_WEB_ORIGIN" "$PUBLIC_WEB_ORIGIN_VALUE"
  if ! printf '%s' "$PUBLIC_WEB_ORIGIN_VALUE" | grep -Eq '^https?://[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(:[0-9]{1,5})?$'; then
    echo "ERROR: PUBLIC_WEB_ORIGIN must be an absolute http(s) origin without a path, query, or trailing slash." >&2
    exit 1
  fi
  origin_port=$(printf '%s' "$PUBLIC_WEB_ORIGIN_VALUE" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p')
  if [ -n "$origin_port" ]; then
    # dash has no 10# prefix. Strip leading zeros so 08 is not an octal error.
    origin_port_num=$(printf '%s' "$origin_port" | sed 's/^0*//')
    if [ -z "$origin_port_num" ]; then
      origin_port_num=0
    fi
    if [ "$origin_port_num" -lt 1 ] || [ "$origin_port_num" -gt 65535 ]; then
      echo "ERROR: PUBLIC_WEB_ORIGIN must be an absolute http(s) origin without a path, query, or trailing slash." >&2
      exit 1
    fi
  fi
fi

printf 'window.__CARDHUB_CONFIG__ = {\n' > "$CONFIG_FILE"
first_config_pair=true
write_config_pair "TRPC_URL" "$TRPC_URL_VALUE"

if [ -n "$SENTRY_DSN_VALUE" ]; then
  write_config_pair "SENTRY_DSN" "$SENTRY_DSN_VALUE"
fi

if [ -n "$SENTRY_ENVIRONMENT_VALUE" ]; then
  write_config_pair "SENTRY_ENVIRONMENT" "$SENTRY_ENVIRONMENT_VALUE"
fi

if [ -n "$GIT_SHA_VALUE" ] && [ "$GIT_SHA_VALUE" != unknown ]; then
  write_config_pair "GIT_SHA" "$GIT_SHA_VALUE"
fi

printf '\n};\n' >> "$CONFIG_FILE"

if [ -n "$PUBLIC_WEB_ORIGIN_VALUE" ]; then
  printf '%s\n' \
    'User-agent: *' \
    'Disallow: /reports' \
    'Disallow: /admin' \
    'Disallow: /me' \
    '' \
    "Sitemap: ${PUBLIC_WEB_ORIGIN_VALUE}/sitemap.xml" \
    > "$ROBOTS_FILE"
fi

# nginx add_header inside a location replaces every server-level add_header,
# so the same snippet is included from the server and from each location.
headers_file=${CARDHUB_SECURITY_HEADERS_FILE:-}
if [ -z "$headers_file" ]; then
  if [ -w /etc/nginx/conf.d ]; then
    headers_file=/etc/nginx/conf.d/security-headers.inc
  else
    echo "ERROR: cannot write /etc/nginx/conf.d/security-headers.inc and CARDHUB_SECURITY_HEADERS_FILE is unset." >&2
    exit 1
  fi
fi

if [ -n "$headers_file" ]; then
  api_origin=$(printf '%s' "$TRPC_URL_VALUE" | sed 's#/trpc$##')
  connect_src="'self' ${api_origin}"
  if [ -n "$SENTRY_DSN_VALUE" ]; then
    sentry_origin=$(printf '%s' "$SENTRY_DSN_VALUE" | sed -E 's#^(https?)://([^@/]+@)?([^/]+).*#\1://\3#')
    connect_src="${connect_src} ${sentry_origin}"
  fi
  csp="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src ${connect_src}; form-action 'self'"
  cat > "$headers_file" <<EOF
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Content-Security-Policy "${csp}" always;
EOF
fi
