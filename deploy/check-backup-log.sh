#!/usr/bin/env bash
# Fail closed unless the newest BACKUP_RESULT line for one project is ok
# and its timestamp is still inside the patrol window.
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: check-backup-log.sh <log> <project> <max_age_hours>" >&2
  exit 2
fi

log_file="$1"
project="$2"
max_age_hours="$3"

if [ -z "${project}" ]; then
  echo "project name is empty" >&2
  exit 1
fi

if ! [[ "${max_age_hours}" =~ ^[0-9]+$ ]]; then
  echo "max_age_hours must be a non-negative integer, got: ${max_age_hours}" >&2
  exit 1
fi

if [ ! -e "${log_file}" ]; then
  echo "backup log is missing: ${log_file}" >&2
  exit 1
fi

if [ ! -f "${log_file}" ] || [ ! -r "${log_file}" ]; then
  echo "backup log is unreadable: ${log_file}" >&2
  exit 1
fi

last_line="$(
  CHECK_PROJECT="${project}" awk '
    BEGIN {
      want = "project=" ENVIRON["CHECK_PROJECT"]
      last = ""
      malformed = 0
    }
    {
      sub(/\r$/, "")
      n = split($0, fields, /[[:space:]]+/)
      has_project = 0
      nproj = 0
      for (i = 1; i <= n; i++) {
        if (fields[i] == want) has_project = 1
        if (fields[i] ~ /^project=/) nproj++
      }
      # Line-start status must be exactly ok or fail, and the line may contain
      # only one BACKUP_RESULT=, one project=, and one ts=. Anything else is
      # malformed, including a later duplicate that would otherwise hide a fail.
      # A later well-formed line for this project clears an older malformed one.
      if (index($0, "BACKUP_RESULT=") > 0 && has_project) {
        nres = gsub(/BACKUP_RESULT=/, "&")
        nts = 0
        for (i = 1; i <= n; i++) if (fields[i] ~ /^ts=/) nts++
        if ((fields[1] != "BACKUP_RESULT=ok" && fields[1] != "BACKUP_RESULT=fail") || nres != 1 || nts != 1 || nproj != 1) {
          malformed = 1
          last = ""
        } else {
          malformed = 0
          last = $0
        }
      }
    }
    END {
      if (malformed) printf "%s", "MALFORMED"
      else printf "%s", last
    }
  ' "${log_file}"
)"

if [ "${last_line}" = "MALFORMED" ]; then
  echo "malformed/unanchored BACKUP_RESULT line for project ${project}" >&2
  exit 1
fi

if [ -z "${last_line}" ]; then
  echo "no BACKUP_RESULT line for project ${project}" >&2
  exit 1
fi

result=""
ts=""
set -f
read -r -a fields <<< "${last_line}"
set +f
# The line-start token is the result. A later BACKUP_RESULT= on the same
# line must not replace it. ts= is the first timestamp token only.
case "${fields[0]}" in
  BACKUP_RESULT=ok) result="ok" ;;
  BACKUP_RESULT=fail) result="fail" ;;
esac
for field in "${fields[@]}"; do
  case "${field}" in
    ts=*)
      ts="${field#ts=}"
      break
      ;;
  esac
done

if [ "${result}" = "fail" ]; then
  echo "last backup failed for project ${project}: ${last_line}" >&2
  exit 1
fi

if [ "${result}" != "ok" ]; then
  echo "last BACKUP_RESULT for project ${project} is not ok: ${last_line}" >&2
  exit 1
fi

if ! [[ "${ts}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then
  echo "cannot parse backup timestamp for project ${project}: ${ts:-<missing>}" >&2
  exit 1
fi

if ! ts_epoch="$(date -u -d "${ts}" +%s 2>/dev/null)" || ! [[ "${ts_epoch}" =~ ^[0-9]+$ ]]; then
  echo "cannot parse backup timestamp for project ${project}: ${ts}" >&2
  exit 1
fi

now_epoch="$(date -u +%s)"
age_seconds="$(( now_epoch - ts_epoch ))"
max_seconds="$(( max_age_hours * 3600 ))"
# Five minutes of clock skew is allowed. Further ahead means a future ok
# could stay green until that timestamp even if later backups never run.
if [ "${age_seconds}" -lt -300 ]; then
  echo "backup timestamp for project ${project} ts is in the future: ts=${ts} age_seconds=${age_seconds}" >&2
  exit 1
fi
if [ "${age_seconds}" -gt "${max_seconds}" ]; then
  echo "last backup for project ${project} is too old: ts=${ts} age_seconds=${age_seconds} max_age_hours=${max_age_hours}" >&2
  exit 1
fi

echo "backup log ok project=${project} ts=${ts}"
exit 0
