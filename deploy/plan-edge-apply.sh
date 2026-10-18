#!/usr/bin/env bash
# Decide whether this edge sync must pass --changed to apply-edge-config.sh.
#
# Prints 1 or 0. A rerun after a crash converges: the pending marker is set
# before extract and replaced with the post-extract tree hash before apply.
# The applied stamp is written only after apply succeeds. Callers pass the
# marker values observed BEFORE this attempt mutates them.
set -euo pipefail

usage() {
  echo "Usage: $0 --before HASH --after HASH --pending VALUE --applied VALUE" >&2
}

before=""
after=""
pending=""
applied=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --before)
      before="${2:-}"
      shift 2
      ;;
    --after)
      after="${2:-}"
      shift 2
      ;;
    --pending)
      pending="${2:-}"
      shift 2
      ;;
    --applied)
      applied="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 64
      ;;
  esac
done

if [[ ! "${after}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "after hash must be 64 hex chars" >&2
  exit 64
fi
if [ -n "${before}" ] && [[ ! "${before}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "before hash must be empty or 64 hex chars" >&2
  exit 64
fi

changed=0
if [ "${before}" != "${after}" ]; then
  changed=1
fi
# An earlier attempt recorded a pending hash or "in-progress" and did not
# finish by copying that tree into the applied stamp.
if [ -n "${pending}" ] && [ "${pending}" != "${applied}" ]; then
  changed=1
fi
if [ -n "${applied}" ] && [ "${applied}" != "${after}" ]; then
  changed=1
fi

printf '%s\n' "${changed}"
