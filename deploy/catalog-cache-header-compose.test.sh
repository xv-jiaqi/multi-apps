#!/usr/bin/env bash
# The API container only receives variables listed under services.api.environment.
# ENV_NAME and CATALOG_CACHE_HEADER must be in that list or X-Cache stays off.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
compose_file="${root}/deploy/docker-compose.yml"
example="${root}/deploy/.env.example"
failed=0

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
  fi
}

if docker info >/dev/null 2>&1; then
  run_compose() {
    docker compose "$@"
  }
elif sudo docker info >/dev/null 2>&1; then
  run_compose() {
    sudo docker compose "$@"
  }
else
  if [ "${CI:-}" = "true" ]; then
    echo "FAIL docker compose is required when CI=true" >&2
    exit 1
  fi
  echo "SKIP docker compose is not available"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

render() {
  local env_file="$1"
  local out="$2"
  local err="$3"
  shift 3
  local rc=0
  run_compose --project-directory "${work}" -f "${compose_file}" --env-file "${env_file}" \
    --profile migrate config --format json \
    >"${out}" 2>"${err}" || rc=$?
  printf '%s\n' "${rc}"
}

cp "${example}" "${work}/base.env"
rc="$(render "${work}/base.env" "${work}/base.yml" "${work}/base.err")"
assert "example env renders" "$( [ "${rc}" -eq 0 ] && echo 0 || echo 1 )"

python3 - "${work}/base.yml" <<'PY'
import json
import sys
from pathlib import Path

doc = json.loads(Path(sys.argv[1]).read_text())
api = doc["services"]["api"]["environment"]
migrate = doc["services"]["migrate"]["environment"]
web = doc["services"]["web"]["environment"]
missing = [key for key in ("ENV_NAME", "CATALOG_CACHE_HEADER") if key not in api]
if missing:
    sys.exit(f"api environment missing {missing}")
if api.get("CATALOG_CACHE_HEADER") not in ("", None):
    sys.exit(f"empty example must not enable the header, got {api.get('CATALOG_CACHE_HEADER')!r}")
if "CATALOG_CACHE_HEADER" in migrate or "CATALOG_CACHE_HEADER" in web:
    sys.exit("only the api service should receive CATALOG_CACHE_HEADER")
print("OK api environment lists ENV_NAME and CATALOG_CACHE_HEADER")
PY

sed 's/^ENV_NAME=$/ENV_NAME=staging/' "${work}/base.env" > "${work}/staging.env"
sed -i 's/^CATALOG_CACHE_HEADER=$/CATALOG_CACHE_HEADER=true/' "${work}/staging.env"
rc="$(render "${work}/staging.env" "${work}/staging.yml" "${work}/staging.err")"
assert "staging env renders" "$( [ "${rc}" -eq 0 ] && echo 0 || echo 1 )"
staging_ok=0
python3 - "${work}/staging.yml" <<'PY' || staging_ok=1
import json
import sys
from pathlib import Path

api = json.loads(Path(sys.argv[1]).read_text())["services"]["api"]["environment"]
ok = api.get("ENV_NAME") == "staging" and api.get("CATALOG_CACHE_HEADER") == "true"
if not ok:
    sys.stderr.write(repr(api.get("ENV_NAME")) + " " + repr(api.get("CATALOG_CACHE_HEADER")) + "\n")
sys.exit(0 if ok else 1)
PY
assert "staging passes both values to api" "${staging_ok}"

if [ "${failed}" -ne 0 ]; then
  echo "---- base stderr ----" >&2
  cat "${work}/base.err" >&2 || true
  echo "---- staging stderr ----" >&2
  cat "${work}/staging.err" >&2 || true
  exit 1
fi
