#!/usr/bin/env bash
# The one-shot migrate entrypoint must log the DB role before Prisma runs,
# and must not print passwords, URLs, or credentialed hosts.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
entry="${root}/deploy/migrate-entrypoint.sh"
failed=0

migrator_password='s3cret-migrator'
runtime_password='s3cret-runtime'
migrate_url="postgresql://cardhub_migrator:${migrator_password}@db.internal.example:5432/cardhub_staging?schema=public"
runtime_url="postgresql://cardhub_runtime:${runtime_password}@db.internal.example:5432/cardhub_staging?schema=public"

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

assert_no_secret() {
  local name="$1"
  local file="$2"
  local secret
  local leaked=0
  for secret in \
    "${migrator_password}" \
    "${runtime_password}" \
    "${migrate_url}" \
    "${runtime_url}" \
    'cardhub_migrator:' \
    'cardhub_runtime:' \
    'postgresql://cardhub'; do
    if grep -F -q -- "${secret}" "${file}"; then
      echo "LEAK ${name} contains ${secret}" >&2
      leaked=1
    fi
  done
  assert "${name} has no secret or url" "${leaked}"
}

run_entry() {
  local mode="$1"
  local work trace stdin_file stdout_file stderr_file
  work="$(mktemp -d)"
  trace="${work}/trace"
  stdin_file="${work}/node-stdin"
  stdout_file="${work}/stdout"
  stderr_file="${work}/stderr"
  mkdir -p "${work}/bin"
  : > "${trace}"

  cat > "${work}/bin/node" << 'EOF'
#!/usr/bin/env bash
set -u
cat > "${NODE_STUB_STDIN:?}"
printf 'node\n' >> "${NODE_STUB_TRACE:?}"
case "${NODE_STUB_MODE:?}" in
  ok)
    printf 'current_user=cardhub_migrator rolsuper=false\n'
    exit 0
    ;;
  query-error)
    printf 'postgresql://cardhub_migrator:s3cret-migrator@db.internal.example:5432/cardhub_staging?schema=public\n' >&2
    exit 1
    ;;
  dirty-stdout)
    printf 'current_user=cardhub_migrator rolsuper=false postgresql://cardhub_migrator:s3cret-migrator@db.internal.example:5432/cardhub_staging?schema=public\n'
    exit 0
    ;;
  *)
    echo "node stub: unknown mode ${NODE_STUB_MODE}" >&2
    exit 99
    ;;
esac
EOF
  chmod 755 "${work}/bin/node"

  cat > "${work}/bin/npx" << 'EOF'
#!/usr/bin/env bash
set -u
printf 'npx\n' >> "${NODE_STUB_TRACE:?}"
printf 'prisma migrate %s\n' "postgresql://cardhub_migrator:s3cret-migrator@db.internal.example:5432/cardhub_staging?schema=public"
exit 0
EOF
  chmod 755 "${work}/bin/npx"

  local rc=0
  env \
    PATH="${work}/bin:${PATH}" \
    NODE_STUB_STDIN="${stdin_file}" \
    NODE_STUB_TRACE="${trace}" \
    NODE_STUB_MODE="${mode}" \
    MIGRATE_DATABASE_URL="${migrate_url}" \
    DATABASE_URL="${runtime_url}" \
    sh "${entry}" > "${stdout_file}" 2> "${stderr_file}" < /dev/null || rc=$?

  CASE_RC="${rc}"
  CASE_STDOUT="${stdout_file}"
  CASE_STDERR="${stderr_file}"
  CASE_TRACE="${trace}"
  CASE_STDIN="${stdin_file}"
  cat "${stdout_file}" "${stderr_file}" > "${work}/combined"
  CASE_COMBINED="${work}/combined"
  echo "CASE mode=${mode} rc=${rc}"
}

run_entry ok
assert "role log line" "$(grep -qx 'Migrating as current_user=cardhub_migrator rolsuper=false' "${CASE_STDOUT}" && echo 0 || echo 1)"
assert "migrate still runs" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "role query before prisma" "$(awk 'NR == 1 && $0 == "node" { ok = 1 } NR == 2 && $0 == "npx" && ok { found = 1 } END { exit found ? 0 : 1 }' "${CASE_TRACE}" && echo 0 || echo 1)"
if [ -f "${CASE_STDIN}" ]; then
  assert "node script queries rolsuper" "$(grep -q 'rolsuper' "${CASE_STDIN}" && grep -q 'current_user' "${CASE_STDIN}" && echo 0 || echo 1)"
  assert "node script has no url" "$(
    grep -F -q -- "${migrator_password}" "${CASE_STDIN}" \
      || grep -F -q -- "${migrate_url}" "${CASE_STDIN}" \
      || grep -F -q 'postgresql://' "${CASE_STDIN}" \
      && echo 1 || echo 0
  )"
else
  assert "node script queries rolsuper" 1
  assert "node script has no url" 1
fi
assert_no_secret "success output" "${CASE_COMBINED}"

run_entry query-error
assert "query error exits 1" "$([ "${CASE_RC}" -eq 1 ] && echo 0 || echo 1)"
assert "query error names current_user" "$(grep -F -q -x 'Refusing to migrate: could not read current_user and rolsuper' "${CASE_STDERR}" && echo 0 || echo 1)"
# Deleting the exit 1 after the role-query failure falls through to the shape
# check. That path still exits 1 and still skips prisma, so the assertions
# above would stay green. This one goes red.
assert "query error stops before the shape check" "$(grep -F -q 'unexpected shape' "${CASE_STDERR}" && echo 1 || echo 0)"
assert "query error does not migrate" "$(grep -qx 'npx' "${CASE_TRACE}" && echo 1 || echo 0)"
assert "query error does not run migrate deploy" "$(grep -F -q 'Running prisma migrate deploy' "${CASE_STDOUT}" && echo 1 || echo 0)"
assert_no_secret "query error output" "${CASE_COMBINED}"

run_entry dirty-stdout
assert "dirty role row is refused" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "dirty role row does not migrate" "$(grep -qx 'npx' "${CASE_TRACE}" && echo 1 || echo 0)"
assert_no_secret "dirty role output" "${CASE_COMBINED}"

if [ "${failed}" -ne 0 ]; then
  echo "migrate entrypoint tests failed" >&2
  exit 1
fi
echo "migrate entrypoint tests passed"
