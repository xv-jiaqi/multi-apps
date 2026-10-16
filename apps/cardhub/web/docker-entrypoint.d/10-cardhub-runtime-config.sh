#!/bin/sh
set -eu

CONFIG_FILE=${CARDHUB_CONFIG_FILE:-/usr/share/nginx/html/config.js}
TRPC_URL_VALUE=${TRPC_URL:-}

if ! printf '%s' "$TRPC_URL_VALUE" | grep -Eq '^https?://.+/trpc$'; then
  echo "ERROR: TRPC_URL must be set to a full http(s) URL ending in /trpc (for example: https://api.card-hub.app/trpc)." >&2
  exit 1
fi

escaped_trpc_url=$(printf '%s' "$TRPC_URL_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > "$CONFIG_FILE" <<EOF
window.__CARDHUB_CONFIG__ = {
  TRPC_URL: "$escaped_trpc_url"
};
EOF
