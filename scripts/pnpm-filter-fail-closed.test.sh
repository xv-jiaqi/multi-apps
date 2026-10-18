#!/bin/sh
# pnpm 10.18.2: --fail-if-no-match exits 1 when the filter matches no package,
# and still exits 0 when the package exists but has no such script.
# `exec pnpm run` is what makes a mistyped script name fail.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "${root}"

echo "pnpm $(pnpm --version)"

set +e
pnpm --filter @no-such-pkg --fail-if-no-match exec pnpm run db:generate >/tmp/pnpm-filter-missing-pkg.out 2>&1
missing_pkg=$?
pnpm --filter @cardhub/api --fail-if-no-match exec pnpm run not-a-real-script >/tmp/pnpm-filter-missing-script.out 2>&1
missing_script=$?
set -e

echo "missing package exit ${missing_pkg}"
echo "missing script exit ${missing_script}"

if [ "${missing_pkg}" -eq 0 ]; then
  echo "missing package must not exit 0" >&2
  exit 1
fi
if [ "${missing_script}" -eq 0 ]; then
  echo "missing script must not exit 0" >&2
  exit 1
fi

echo "pnpm filter fail-closed passed"
