#!/usr/bin/env bash
# Local decision tests for the shared-edge reload planner. Not copied to the VPS.
set -euo pipefail

plan="$(cd "$(dirname "$0")" && pwd)/plan-edge-apply.sh"
h1="$(printf 'a%.0s' {1..64})"
h2="$(printf 'b%.0s' {1..64})"
failed=0

expect() {
  local name="$1"
  local expected="$2"
  shift 2
  local got
  got="$(bash "${plan}" "$@")"
  if [ "${got}" != "${expected}" ]; then
    echo "FAIL ${name}: expected ${expected} got ${got}" >&2
    failed=1
    return
  fi
  echo "OK ${name}"
}

expect "first run, tree unchanged, no stamp" 0 \
  --before "${h1}" --after "${h1}" --pending "" --applied ""
expect "this extract changed bytes" 1 \
  --before "${h1}" --after "${h2}" --pending "" --applied "${h1}"
expect "crash after extract, before apply" 1 \
  --before "${h2}" --after "${h2}" --pending "${h2}" --applied "${h1}"
expect "crash during extract" 1 \
  --before "${h1}" --after "${h1}" --pending "in-progress" --applied "${h1}"
expect "rerun after success, tree unchanged" 0 \
  --before "${h1}" --after "${h1}" --pending "" --applied "${h1}"
expect "stamp disagrees with disk" 1 \
  --before "${h1}" --after "${h1}" --pending "" --applied "${h2}"
expect "pending left behind after stamp was written" 0 \
  --before "${h1}" --after "${h1}" --pending "${h1}" --applied "${h1}"

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
