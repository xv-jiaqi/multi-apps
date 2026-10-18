#!/usr/bin/env bash
# The Sync deploy files step uploads a tar whitelist, not every file in deploy/.
# Scripts the VPS runs from /opt/cardhub/<env>/deploy must be in that list and
# stay executable. #118 added check-backup-log.sh and the whitelist did not,
# so the patrol script never landed on the server.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="${root}/.github/workflows/deploy.yml"

# Scripts executed on the VPS from /opt/cardhub/<env>/deploy.
# A new one has to be added here and to the tar whitelist together.
server_scripts=(
  remote-deploy.sh
  backup.sh
  image-cleanup.sh
  check-backup-log.sh
)

# main at bf1186a. check-backup-log.sh exists and is executable, but this
# list is what the workflow uploaded.
legacy_whitelist=(
  docker-compose.yml
  remote-deploy.sh
  backup.sh
  image-cleanup.sh
  db
)

step_body() {
  awk '
    /^      - name: Sync deploy files$/ { in_step = 1; next }
    in_step && /^      - name: / { exit }
    in_step && /^  [^ ]/ { exit }
    in_step { print }
  ' "${workflow}"
}

read_whitelist() {
  step_body | awk '
    /tar -C deploy -czf -/ { in_tar = 1 }
    in_tar {
      line = $0
      sub(/.*tar -C deploy -czf -/, "", line)
      if (index(line, "|") > 0) {
        line = substr(line, 1, index(line, "|") - 1)
        in_tar = 2
      }
      gsub(/\\/, " ", line)
      n = split(line, parts, /[[:space:]]+/)
      for (i = 1; i <= n; i++) if (parts[i] != "") print parts[i]
      if (in_tar == 2) exit
    }
  '
}

# Reject a whitelist that omits a server script, names a missing path, or
# lists a deploy/*.sh that is not executable. Prints one FAIL line per problem.
check_whitelist() {
  local -a members=("$@")
  local script member found fail=0
  if [ "${#members[@]}" -eq 0 ]; then
    echo "FAIL sync whitelist is empty" >&2
    return 1
  fi
  for member in "${members[@]}"; do
    if [[ ! "${member}" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      echo "FAIL ${member}: whitelist entry is not a deploy path" >&2
      fail=1
    fi
  done
  for script in "${server_scripts[@]}"; do
    if [ ! -f "${root}/deploy/${script}" ]; then
      echo "FAIL ${script}: server script deploy/${script} does not exist" >&2
      fail=1
      continue
    fi
    if [ ! -x "${root}/deploy/${script}" ]; then
      echo "FAIL ${script}: deploy/${script} is not executable" >&2
      fail=1
    fi
    found=0
    for member in "${members[@]}"; do
      if [ "${member}" = "${script}" ]; then
        found=1
        break
      fi
    done
    if [ "${found}" -ne 1 ]; then
      echo "FAIL ${script}: executable server script is missing from the Sync deploy files tar whitelist" >&2
      fail=1
    fi
  done
  for member in "${members[@]}"; do
    if [ ! -e "${root}/deploy/${member}" ]; then
      echo "FAIL ${member}: whitelist entry does not exist under deploy/" >&2
      fail=1
      continue
    fi
    if [[ "${member}" == *.sh ]] && [ ! -x "${root}/deploy/${member}" ]; then
      echo "FAIL ${member}: whitelist script is not executable" >&2
      fail=1
    fi
  done
  return "${fail}"
}

for member in "${legacy_whitelist[@]}"; do
  if [ "${member}" = "check-backup-log.sh" ]; then
    echo "FAIL legacy fixture must omit check-backup-log.sh" >&2
    exit 1
  fi
done

legacy_log="$(mktemp)"
live_log="$(mktemp)"
trap 'rm -f "${legacy_log}" "${live_log}"' EXIT

set +e
check_whitelist "${legacy_whitelist[@]}" >"${legacy_log}" 2>&1
legacy_rc=$?
set -e
if [ "${legacy_rc}" -eq 0 ]; then
  echo "FAIL before: whitelist without check-backup-log.sh was accepted" >&2
  cat "${legacy_log}" >&2
  exit 1
fi
if ! grep -q 'check-backup-log.sh: executable server script is missing from the Sync deploy files tar whitelist' "${legacy_log}"; then
  echo "FAIL before: rejection did not name the missing check-backup-log.sh whitelist entry" >&2
  cat "${legacy_log}" >&2
  exit 1
fi
echo "OK before: whitelist without check-backup-log.sh is rejected"
sed -n 's/^/  /p' "${legacy_log}"

if [ -z "$(step_body)" ]; then
  echo "FAIL deploy workflow has no Sync deploy files step" >&2
  exit 1
fi

mapfile -t whitelist < <(read_whitelist)
if [ "${#whitelist[@]}" -eq 0 ]; then
  echo "FAIL could not read the Sync deploy files tar whitelist" >&2
  exit 1
fi
echo "whitelist: ${whitelist[*]}"

set +e
check_whitelist "${whitelist[@]}" >"${live_log}" 2>&1
live_rc=$?
set -e
if [ "${live_rc}" -ne 0 ]; then
  echo "FAIL current Sync deploy files whitelist rejected a server script" >&2
  cat "${live_log}" >&2
  exit 1
fi
for script in "${server_scripts[@]}"; do
  echo "OK after: ${script} is in the sync whitelist and executable"
done

body="$(step_body)"
assert_line="$(printf '%s\n' "${body}" | grep -E '^[[:space:]]*remote_assert=' || true)"
if [ -z "${assert_line}" ]; then
  echo "FAIL Sync deploy files step has no remote_assert" >&2
  exit 1
fi
if [ "$(printf '%s\n' "${assert_line}" | wc -l)" -ne 1 ]; then
  echo "FAIL Sync deploy files step has more than one remote_assert" >&2
  exit 1
fi
if [[ ! "${assert_line}" =~ ^[[:space:]]*remote_assert=\'.*\'$ ]]; then
  echo "FAIL remote_assert is not a single-quoted assignment" >&2
  printf '%s\n' "${assert_line}" >&2
  exit 1
fi
if ! printf '%s\n' "${body}" | grep -q '&& ${remote_assert}'; then
  echo "FAIL remote_assert is not the remote command after tar extract" >&2
  exit 1
fi

remote_assert=""
# The assignment is a single-quoted literal from this repo's workflow.
eval "${assert_line}"
if [ -z "${remote_assert}" ]; then
  echo "FAIL remote_assert evaluated empty" >&2
  exit 1
fi
for script in check-backup-log.sh backup.sh; do
  if ! printf '%s\n' "${remote_assert}" | grep -q "${script}"; then
    echo "FAIL remote_assert does not check ${script}" >&2
    exit 1
  fi
done
if ! printf '%s\n' "${remote_assert}" | grep -q 'missing or not executable'; then
  echo "FAIL remote_assert has no clear failure message" >&2
  exit 1
fi
if ! printf '%s\n' "${remote_assert}" | grep -q '\[ ! -f ' || ! printf '%s\n' "${remote_assert}" | grep -q '\[ ! -x '; then
  echo "FAIL remote_assert does not require the file to exist and be executable" >&2
  exit 1
fi

run_remote_assert() {
  local dest="$1"
  local dest_q cmd
  dest_q="$(printf '%q' "${dest}")"
  cmd="mkdir -p ${dest_q} && tar -xzf - -C ${dest_q} && deploy_dir=${dest_q} && ${remote_assert}"
  bash -c "${cmd}"
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"; rm -f "${legacy_log}" "${live_log}"' EXIT

before_err="${tmp}/before.err"
set +e
tar -C "${root}/deploy" -czf - "${legacy_whitelist[@]}" \
  | run_remote_assert "${tmp}/before" >"${tmp}/before.out" 2>"${before_err}"
before_rc=$?
set -e
if [ "${before_rc}" -eq 0 ]; then
  echo "FAIL remote assert accepted an extract that omitted check-backup-log.sh" >&2
  exit 1
fi
if ! grep -q 'deploy sync failed: .*/check-backup-log.sh is missing or not executable' "${before_err}"; then
  echo "FAIL remote assert did not name the missing check-backup-log.sh" >&2
  cat "${before_err}" >&2
  exit 1
fi
echo "OK before: post-sync assert fails when check-backup-log.sh was not uploaded"
sed -n 's/^/  /p' "${before_err}"

tar -C "${root}/deploy" -czf - "${whitelist[@]}" \
  | run_remote_assert "${tmp}/after"
for script in check-backup-log.sh backup.sh; do
  if [ ! -f "${tmp}/after/${script}" ] || [ ! -x "${tmp}/after/${script}" ]; then
    echo "FAIL after: ${script} is missing or not executable after extract" >&2
    exit 1
  fi
  echo "OK after: extracted ${script} exists and is executable"
done

# A strict umask must not strip the owner execute bit the whitelist carries.
umask_dest="${tmp}/umask"
(
  umask 077
  tar -C "${root}/deploy" -czf - "${whitelist[@]}" | run_remote_assert "${umask_dest}"
)
for script in check-backup-log.sh backup.sh; do
  if [ ! -x "${umask_dest}/${script}" ]; then
    echo "FAIL after: ${script} lost its execute bit under umask 077" >&2
    exit 1
  fi
done
echo "OK after: execute bit survives extract under umask 077"

echo "sync whitelist tests passed"
