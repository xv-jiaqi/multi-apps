#!/bin/sh
set -eu

CONFIG_FILE=${CARDHUB_CONFIG_FILE:-/usr/share/nginx/html/config.js}
TRPC_URL_VALUE=${TRPC_URL:-}

if [ "$(printf '%s' "$TRPC_URL_VALUE" | LC_ALL=C tr -d '\000-\037\177')" != "$TRPC_URL_VALUE" ]; then
  echo "ERROR: TRPC_URL must not contain control characters, including newlines or carriage returns." >&2
  exit 1
fi

if ! printf '%s' "$TRPC_URL_VALUE" | grep -Eq '^https?://[^[:space:]"\\]+/trpc$'; then
  echo "ERROR: TRPC_URL must be set to a full http(s) URL ending in /trpc without whitespace, quotes, or backslashes (for example: https://api.card-hub.app/trpc)." >&2
  exit 1
fi

escaped_trpc_url=$(printf '%s' "$TRPC_URL_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > "$CONFIG_FILE" <<EOF
window.__CARDHUB_CONFIG__ = {
  TRPC_URL: "$escaped_trpc_url"
};
EOF
