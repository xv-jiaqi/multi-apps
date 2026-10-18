#!/usr/bin/env bash
# Patrol checker: last BACKUP_RESULT for one project, exact project token.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
checker="${root}/deploy/check-backup-log.sh"
failed=0

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
    if [ "${CASE_DUMPED:-0}" -eq 0 ]; then
      CASE_DUMPED=1
      echo "--- stdout ---" >&2
      cat "${CASE_OUT}" >&2 || true
      echo "--- stderr ---" >&2
      cat "${CASE_ERR}" >&2 || true
    fi
  fi
}

iso_ago() {
  local seconds="$1"
  date -u -d "@$(( $(date -u +%s) - seconds ))" +%Y-%m-%dT%H:%M:%SZ
}

run_check() {
  local log="$1"
  local project="$2"
  local hours="$3"
  local work rc
  work="$(mktemp -d)"
  CASE_OUT="${work}/out"
  CASE_ERR="${work}/err"
  CASE_DUMPED=0
  rc=0
  bash "${checker}" "${log}" "${project}" "${hours}" > "${CASE_OUT}" 2> "${CASE_ERR}" || rc=$?
  CASE_RC="${rc}"
}

fresh="$(iso_ago 60)"
old="$(iso_ago $((48 * 3600)))"
soon="$(date -u -d "@$(( $(date -u +%s) + 60 ))" +%Y-%m-%dT%H:%M:%SZ)"

work="$(mktemp -d)"
log="${work}/backup.log"

echo "CASE missing log"
run_check "${work}/no-such-log" cardhub-prod 26
assert "missing log exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "missing log explains why" "$(grep -F -q 'backup log is missing' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE unreadable log"
printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-x.sql.gz\n' "${fresh}" > "${log}"
if [ "$(id -u)" -eq 0 ]; then
  echo "FAIL unreadable log skipped because root can read mode 000" >&2
  failed=1
else
  chmod 000 "${log}"
  if [ -r "${log}" ]; then
    echo "FAIL unreadable log fixture is still readable" >&2
    failed=1
  else
    run_check "${log}" cardhub-prod 26
    chmod 600 "${log}" || true
    assert "unreadable log exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
    assert "unreadable log explains why" "$(grep -F -q 'backup log is unreadable' "${CASE_ERR}" && echo 0 || echo 1)"
  fi
fi
chmod 600 "${log}" || true

echo "CASE no project line"
cat > "${log}" << EOF
Wrote /opt/cardhub/backups/cardhub-staging/cardhub-staging-old.sql.gz
note project=cardhub-prod is mentioned but this is not a result line
BACKUP_RESULT=ok project=cardhub-staging ts=${fresh} file=cardhub-staging-1.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "no project line exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "no project line explains why" "$(grep -F -q 'no BACKUP_RESULT line for project cardhub-prod' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE unparsable ts"
cat > "${log}" << EOF
BACKUP_RESULT=ok project=cardhub-prod ts=not-a-timestamp file=cardhub-prod-x.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "bad ts exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "bad ts explains why" "$(grep -F -q 'cannot parse backup timestamp' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE impossible ts"
cat > "${log}" << EOF
BACKUP_RESULT=ok project=cardhub-prod ts=2026-10-18T25:61:00Z file=cardhub-prod-x.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "impossible ts exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "impossible ts explains why" "$(grep -F -q 'cannot parse backup timestamp' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE last result fail"
cat > "${log}" << EOF
BACKUP_RESULT=ok project=cardhub-prod ts=${fresh} file=cardhub-prod-earlier.sql.gz
BACKUP_RESULT=fail project=cardhub-prod ts=${fresh} rc=1 reason=pipefail
EOF
run_check "${log}" cardhub-prod 26
assert "fail result exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "fail result explains why" "$(grep -F -q 'last backup failed for project cardhub-prod' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE too old"
cat > "${log}" << EOF
BACKUP_RESULT=ok project=cardhub-prod ts=${old} file=cardhub-prod-old.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "too old exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "too old explains why" "$(grep -F -q 'too old' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE fresh ok"
printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-x.sql.gz\n' "${fresh}" > "${log}"
run_check "${log}" cardhub-prod 26
assert "fresh ok exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "fresh ok is quiet on stderr" "$([ ! -s "${CASE_ERR}" ] && echo 0 || echo 1)"

echo "CASE future ok"
printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-x.sql.gz\n' '2099-01-01T00:00:00Z' > "${log}"
run_check "${log}" cardhub-prod 26
assert "future ok exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "future ok explains why" "$(grep -F -q 'ts is in the future' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE near future ok"
printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-x.sql.gz\n' "${soon}" > "${log}"
run_check "${log}" cardhub-prod 26
assert "near future ok exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"

echo "CASE prefixed ok only"
printf 'WARN BACKUP_RESULT=ok project=cardhub-prod ts=%s\n' "${fresh}" > "${log}"
run_check "${log}" cardhub-prod 26
assert "prefixed ok exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "prefixed ok is unanchored" "$(grep -F -q 'malformed/unanchored BACKUP_RESULT line' "${CASE_ERR}" && echo 0 || echo 1)"
assert "prefixed ok is not a pass" "$(grep -F -q 'backup log ok' "${CASE_OUT}" && echo 1 || echo 0)"

echo "CASE older ok then prefixed fail"
{
  printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-earlier.sql.gz\n' "${fresh}"
  printf 'WARN BACKUP_RESULT=fail project=cardhub-prod ts=%s rc=1 reason=pipefail\n' "${fresh}"
} > "${log}"
run_check "${log}" cardhub-prod 26
assert "prefixed fail exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "prefixed fail is unanchored" "$(grep -F -q 'malformed/unanchored BACKUP_RESULT line' "${CASE_ERR}" && echo 0 || echo 1)"
assert "prefixed fail does not fall back to older ok" "$(grep -F -q 'backup log ok' "${CASE_OUT}" && echo 1 || echo 0)"

echo "CASE unterminated output then fail, glued ok ignored"
{
  printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-earlier.sql.gz\n' "${fresh}"
  printf 'partial output without newline'
  printf '\nBACKUP_RESULT=fail project=cardhub-prod ts=%s rc=1 reason=pipefail\n' "${fresh}"
  printf 'xxxBACKUP_RESULT=ok project=cardhub-staging ts=%s file=sneaky.sql.gz\n' "${fresh}"
} > "${log}"
run_check "${log}" cardhub-prod 26
assert "unterminated then fail exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "unterminated then fail is the fail line" "$(grep -F -q 'last backup failed for project cardhub-prod' "${CASE_ERR}" && echo 0 || echo 1)"
assert "unterminated then fail does not accept the older ok" "$(grep -F -q 'backup log ok' "${CASE_OUT}" && echo 1 || echo 0)"

echo "CASE interleaved prod fail then staging ok"
cat > "${log}" << EOF
Dumping cardhub-prod as database role cardhub_backup
BACKUP_RESULT=ok project=cardhub-prod-old ts=${fresh} file=cardhub-prod-old-1.sql.gz
BACKUP_RESULT=fail project=cardhub-prod ts=${fresh} rc=1 reason=offsite-env-missing
Wrote /opt/cardhub/backups/cardhub-staging/cardhub-staging-1.sql.gz
BACKUP_RESULT=ok project=cardhub-staging ts=${fresh} file=cardhub-staging-1.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "interleaved prod exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "interleaved prod is the prod failure" "$(grep -F -q 'last backup failed for project cardhub-prod' "${CASE_ERR}" && echo 0 || echo 1)"
run_check "${log}" cardhub-staging 26
assert "interleaved staging exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
run_check "${log}" cardhub-prod-old 26
assert "interleaved prod-old exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
run_check "${log}" cardhub 26
assert "shorter project name does not match" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "shorter project name has no line" "$(grep -F -q 'no BACKUP_RESULT line for project cardhub' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE prod must not match prod-old"
cat > "${log}" << EOF
BACKUP_RESULT=ok project=cardhub-prod-old ts=${fresh} file=cardhub-prod-old-1.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "prod-old is not prod" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "prod-old match explains why" "$(grep -F -q 'no BACKUP_RESULT line for project cardhub-prod' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE file name does not count as the project"
printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-old.sql.gz\n' "${fresh}" > "${log}"
run_check "${log}" cardhub-prod 26
assert "file token does not hide prod ok" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
run_check "${log}" cardhub-prod-old 26
assert "file token is not a project match" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"

echo "CASE last ok wins over an older fail"
cat > "${log}" << EOF
BACKUP_RESULT=fail project=cardhub-prod ts=${fresh} rc=1 reason=command-failed
BACKUP_RESULT=ok project=cardhub-prod ts=${fresh} file=cardhub-prod-new.sql.gz
EOF
run_check "${log}" cardhub-prod 26
assert "recovered backup exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"

echo "CASE no trailing newline"
printf 'BACKUP_RESULT=ok project=cardhub-prod ts=%s file=cardhub-prod-x.sql.gz' "${fresh}" > "${log}"
run_check "${log}" cardhub-prod 26
assert "no trailing newline exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"

echo "CASE bad age"
run_check "${log}" cardhub-prod hours
assert "bad age exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "bad age explains why" "$(grep -F -q 'max_age_hours' "${CASE_ERR}" && echo 0 || echo 1)"

echo "CASE usage"
run_check_usage() {
  local work rc
  work="$(mktemp -d)"
  CASE_OUT="${work}/out"
  CASE_ERR="${work}/err"
  CASE_DUMPED=0
  rc=0
  bash "${checker}" > "${CASE_OUT}" 2> "${CASE_ERR}" || rc=$?
  CASE_RC="${rc}"
}
run_check_usage
assert "usage exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
assert "usage explains why" "$(grep -F -q 'usage:' "${CASE_ERR}" && echo 0 || echo 1)"

if [ "${failed}" -ne 0 ]; then
  echo "check-backup-log tests failed" >&2
  exit 1
fi
echo "check-backup-log tests passed"
