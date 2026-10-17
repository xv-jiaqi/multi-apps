#!/bin/sh
set -eu

CONFIG_FILE=${CARDHUB_CONFIG_FILE:-/usr/share/nginx/html/config.js}
TRPC_URL_VALUE=${TRPC_URL:-}
SENTRY_DSN_VALUE=${SENTRY_DSN:-}
SENTRY_ENVIRONMENT_VALUE=${SENTRY_ENVIRONMENT:-}
GIT_SHA_VALUE=${GIT_SHA:-}

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

if ! printf '%s' "$TRPC_URL_VALUE" | grep -Eq '^https?://[^[:space:]"\\]+/trpc$'; then
  echo "ERROR: TRPC_URL must be set to a full http(s) URL ending in /trpc without whitespace, quotes, or backslashes (for example: https://api.card-hub.app/trpc)." >&2
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
