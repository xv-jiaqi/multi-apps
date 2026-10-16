#!/bin/sh
set -eu

CONFIG_FILE=/usr/share/nginx/html/config.js
TRPC_URL_VALUE=${TRPC_URL:-}

escaped_trpc_url=$(printf '%s' "$TRPC_URL_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > "$CONFIG_FILE" <<EOF
window.__CARDHUB_CONFIG__ = {
  TRPC_URL: "$escaped_trpc_url"
};
EOF
