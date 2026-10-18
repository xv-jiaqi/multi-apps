#!/usr/bin/env bash
# Sync deploy files uploads a tar whitelist, not every file under deploy/.
# Every top-level deploy/*.sh except *.test.sh must sit in exactly one of:
#   (a) that tar whitelist, or
#   (b) not_synced_reason below, with a non-empty reason.
# A script in neither list, in both, or a not_synced name that is not a file
# fails the test. Nested deploy/db and deploy/edge scripts are out of scope:
# db/ is one whitelist member, and edge/ has its own sync step.
#
# Whitelist scripts are the ones the VPS runs from /opt/cardhub/<env>/deploy:
#   remote-deploy.sh    Deploy on VPS ssh's this path
#   backup.sh           cron
#   check-backup-log.sh backup patrol over ssh
#   image-cleanup.sh    remote-deploy.sh executes it after a successful switch
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="${root}/.github/workflows/deploy.yml"

# Scripts that must not be uploaded by Sync deploy files.
declare -A not_synced_reason=(
  [api-entrypoint.sh]="baked into the API image at /usr/local/bin/api-entrypoint.sh (Dockerfile.api); the container CMD runs that path, not a copy under /opt/cardhub"
  [migrate-entrypoint.sh]="baked into the API image at /usr/local/bin/migrate-entrypoint.sh (Dockerfile.api); compose runs that path in the one-shot migrate container"
  [resolve-deploy-inputs.sh]="run on the GitHub runner by deploy.yml to resolve the image tag and refuse a stale deploy tree before sync"
  [plan-edge-apply.sh]="run on the GitHub runner by the edge sync step to decide whether apply-edge-config.sh needs --changed"
  [prove-infra-ref.sh]="run on the GitHub runner as a checkout dry-run of resolve-deploy-inputs.sh; it compares the workflow ref with an image commit and is not installed on the VPS"
)

# bf1186a Sync deploy files tar. check-backup-log.sh was already in the tree
# and was not in this list. CI checks out the PR with fetch-depth 1, so the
# parent commit may be absent; when it is present the test parses that file.
bf1186a_members=(
  docker-compose.yml
  remote-deploy.sh
  backup.sh
  image-cleanup.sh
  db
)

step_body() {
  local file="$1"
  awk '
    /^      - name: Sync deploy files$/ { in_step = 1; next }
    in_step && /^      - name: / { exit }
    in_step && /^  [^ ]/ { exit }
    in_step { print }
  ' "${file}"
}

read_whitelist() {
  local file="$1"
  local body
  body="$(step_body "${file}")"
  if [ -z "${body}" ]; then
    echo "FAIL ${file}: deploy workflow has no Sync deploy files step" >&2
    return 1
  fi
  if printf '%s\n' "${body}" | grep -q '^[[:space:]]*sync_members=('; then
    printf '%s\n' "${body}" | awk '
      /^[[:space:]]*sync_members=\(/ { in_arr = 1; next }
      in_arr && /^[[:space:]]*\)/ { exit }
      in_arr {
        line = $0
        sub(/#.*/, "", line)
        n = split(line, parts, /[[:space:]]+/)
        for (i = 1; i <= n; i++) if (parts[i] != "") print parts[i]
      }
    '
    return 0
  fi
  printf '%s\n' "${body}" | awk '
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

list_scripts() {
  local deploy_dir="$1"
  local path base
  local nullglob_was=0
  shopt -q nullglob && nullglob_was=1
  shopt -s nullglob
  for path in "${deploy_dir}"/*.sh; do
    base="${path##*/}"
    case "${base}" in
      *.test.sh) continue ;;
    esac
    if [ -f "${path}" ]; then
      printf '%s\n' "${base}"
    fi
  done
  if [ "${nullglob_was}" -eq 0 ]; then
    shopt -u nullglob
  fi
}

# Fail unless every script is in the whitelist or not_synced, but not both,
# and every not_synced name is an existing file in the script set.
partition_check() {
  local deploy_dir="$1"
  local -n _scripts=$2
  local -n _whitelist=$3
  local -n _reasons=$4
  local script member name in_white in_skip found fail=0

  if [ "${#_scripts[@]}" -gt 0 ]; then
    for script in "${_scripts[@]}"; do
      in_white=0
      if [ "${#_whitelist[@]}" -gt 0 ]; then
        for member in "${_whitelist[@]}"; do
          if [ "${member}" = "${script}" ]; then
            in_white=1
            break
          fi
        done
      fi
      if [ -n "${_reasons[${script}]+x}" ]; then
        in_skip=1
      else
        in_skip=0
      fi
      if [ "${in_white}" -eq 1 ] && [ "${in_skip}" -eq 1 ]; then
        echo "FAIL ${script}: listed in the sync whitelist and in not_synced" >&2
        fail=1
      elif [ "${in_white}" -eq 0 ] && [ "${in_skip}" -eq 0 ]; then
        echo "FAIL ${script}: deploy script is neither in the Sync deploy files tar whitelist nor in not_synced" >&2
        fail=1
      fi
    done
  fi

  if [ "${#_reasons[@]}" -gt 0 ]; then
    for name in "${!_reasons[@]}"; do
      if [ ! -f "${deploy_dir}/${name}" ]; then
        echo "FAIL ${name}: not_synced entry does not exist" >&2
        fail=1
        continue
      fi
      found=0
      if [ "${#_scripts[@]}" -gt 0 ]; then
        for script in "${_scripts[@]}"; do
          if [ "${script}" = "${name}" ]; then
            found=1
            break
          fi
        done
      fi
      if [ "${found}" -ne 1 ]; then
        echo "FAIL ${name}: not_synced entry is not a deploy/*.sh script outside *.test.sh" >&2
        fail=1
      fi
      if [ -z "${_reasons[${name}]}" ]; then
        echo "FAIL ${name}: not_synced entry has no reason" >&2
        fail=1
      fi
    done
  fi
  return "${fail}"
}

check_whitelist_files() {
  local deploy_dir="$1"
  shift
  local -a members=("$@")
  local member fail=0
  if [ "${#members[@]}" -eq 0 ]; then
    echo "FAIL sync whitelist is empty" >&2
    return 1
  fi
  for member in "${members[@]}"; do
    if [[ ! "${member}" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      echo "FAIL ${member}: whitelist entry is not a deploy path" >&2
      fail=1
      continue
    fi
    if [ ! -e "${deploy_dir}/${member}" ]; then
      echo "FAIL ${member}: whitelist entry does not exist under deploy/" >&2
      fail=1
      continue
    fi
    if [[ "${member}" == *.sh ]] && [ ! -x "${deploy_dir}/${member}" ]; then
      echo "FAIL ${member}: whitelist script is not executable" >&2
      fail=1
    fi
  done
  return "${fail}"
}

indent_file() {
  sed -n 's/^/  /p' "$1"
}

expect_partition_fail() {
  local label="$1"
  local needle="$2"
  local deploy_dir="$3"
  local scripts_name="$4"
  local whitelist_name="$5"
  local reasons_name="$6"
  local log rc
  log="$(mktemp)"
  set +e
  partition_check "${deploy_dir}" "${scripts_name}" "${whitelist_name}" "${reasons_name}" >"${log}" 2>&1
  rc=$?
  set -e
  if [ "${rc}" -eq 0 ]; then
    echo "FAIL self-test ${label}: partition returned rc=0" >&2
    indent_file "${log}" >&2
    rm -f "${log}"
    exit 1
  fi
  if ! grep -q "${needle}" "${log}"; then
    echo "FAIL self-test ${label}: rejection did not match ${needle}" >&2
    indent_file "${log}" >&2
    rm -f "${log}"
    exit 1
  fi
  partition_fail_count="$(grep -c '^FAIL ' "${log}" || true)"
  echo "OK self-test ${label}: rc=${rc}"
  indent_file "${log}"
  rm -f "${log}"
}

write_bf1186a_fixture() {
  local dest="$1"
  cat >"${dest}" <<'EOF'
      - name: Sync deploy files
        shell: bash
        run: |
          set -euo pipefail
          tar -C deploy -czf - docker-compose.yml remote-deploy.sh backup.sh image-cleanup.sh db \
            | ssh -i ~/.ssh/deploy_key -o StrictHostKeyChecking=yes "${remote}" \
                "mkdir -p ${remote_deploy_dir_q} && tar -xzf - -C ${remote_deploy_dir_q}"
EOF
}

mapfile -t scripts < <(list_scripts "${root}/deploy" | sort)
if [ "${#scripts[@]}" -eq 0 ]; then
  echo "FAIL no deploy/*.sh scripts found" >&2
  exit 1
fi
for script in "${scripts[@]}"; do
  case "${script}" in
    *.test.sh)
      echo "FAIL ${script}: test script was included in the deploy script set" >&2
      exit 1
      ;;
  esac
done

if [ -z "$(step_body "${workflow}")" ]; then
  echo "FAIL deploy workflow has no Sync deploy files step" >&2
  exit 1
fi
mapfile -t whitelist < <(read_whitelist "${workflow}")
if [ "${#whitelist[@]}" -eq 0 ]; then
  echo "FAIL could not read the Sync deploy files tar whitelist" >&2
  exit 1
fi

echo "scripts: ${scripts[*]}"
echo "whitelist: ${whitelist[*]}"
echo "not_synced:"
while IFS= read -r name; do
  printf '  %s: %s\n' "${name}" "${not_synced_reason[${name}]}"
done < <(printf '%s\n' "${!not_synced_reason[@]}" | sort)
echo "synced:"
for member in "${whitelist[@]}"; do
  case "${member}" in
    *.sh) printf '  %s\n' "${member}" ;;
  esac
done

set +e
partition_check "${root}/deploy" scripts whitelist not_synced_reason
live_rc=$?
set -e
if [ "${live_rc}" -ne 0 ]; then
  exit "${live_rc}"
fi
echo "OK partition: every deploy/*.sh is in exactly one of the sync whitelist or not_synced"

set +e
check_whitelist_files "${root}/deploy" "${whitelist[@]}"
files_rc=$?
set -e
if [ "${files_rc}" -ne 0 ]; then
  exit "${files_rc}"
fi
echo "OK whitelist: members exist and every *.sh is executable"

body="$(step_body "${workflow}")"
if ! printf '%s\n' "${body}" | grep -Fq 'for member in "${sync_members[@]}"'; then
  echo "FAIL Sync deploy files does not walk sync_members to build the remote assert" >&2
  exit 1
fi
if ! printf '%s\n' "${body}" | grep -Fq '*.sh) sh_scripts+=("${member}")'; then
  echo "FAIL Sync deploy files does not select every whitelist *.sh" >&2
  exit 1
fi
if ! printf '%s\n' "${body}" | grep -Fq 'tar -C deploy -czf - "${sync_members[@]}"'; then
  echo "FAIL tar does not upload sync_members" >&2
  exit 1
fi
assert_line="$(printf '%s\n' "${body}" | grep -E '^[[:space:]]*remote_assert=' || true)"
if [ -z "${assert_line}" ]; then
  echo "FAIL Sync deploy files step has no remote_assert" >&2
  exit 1
fi
if [ "$(printf '%s\n' "${assert_line}" | wc -l)" -ne 1 ]; then
  echo "FAIL Sync deploy files step has more than one remote_assert" >&2
  exit 1
fi
if printf '%s\n' "${assert_line}" | grep -q '\.sh'; then
  echo "FAIL remote_assert hardcodes a script name; it must loop over whitelist *.sh" >&2
  printf '%s\n' "${assert_line}" >&2
  exit 1
fi
if ! printf '%s\n' "${assert_line}" | grep -q 'sh_scripts'; then
  echo "FAIL remote_assert does not use the scripts taken from the whitelist" >&2
  exit 1
fi
if ! printf '%s\n' "${body}" | grep -Fq '&& ${remote_assert}'; then
  echo "FAIL remote_assert is not the remote command after tar extract" >&2
  exit 1
fi

fragment="$(printf '%s\n' "${body}" | awk '
  /^[[:space:]]*sync_members=\(/ { p = 1 }
  p && /^[[:space:]]*remote_assert=/ { print; exit }
  p { print }
')"
if [ -z "${fragment}" ]; then
  echo "FAIL could not isolate the sync_members/remote_assert fragment" >&2
  exit 1
fi
if printf '%s\n' "${fragment}" | grep -Eq '(^|[[:space:]])(ssh|tar)([[:space:]]|$)'; then
  echo "FAIL refusing to evaluate tar or ssh from the Sync deploy files step" >&2
  exit 1
fi
# The fragment is the workflow's own list and the loop that builds remote_assert.
eval "${fragment}"

if [ "${sync_members[*]}" != "${whitelist[*]}" ]; then
  echo "FAIL executed sync_members do not match the parsed whitelist" >&2
  printf 'parsed: %s\n' "${whitelist[*]}" >&2
  printf 'executed: %s\n' "${sync_members[*]}" >&2
  exit 1
fi
expected_sh=()
for member in "${whitelist[@]}"; do
  case "${member}" in
    *.sh) expected_sh+=("${member}") ;;
  esac
done
if [ "${#expected_sh[@]}" -eq 0 ]; then
  echo "FAIL whitelist has no *.sh" >&2
  exit 1
fi
if [ "${sh_scripts[*]}" != "${expected_sh[*]}" ]; then
  echo "FAIL sh_scripts is not every *.sh in the whitelist" >&2
  printf 'sh_scripts: %s\n' "${sh_scripts[*]}" >&2
  printf 'whitelist: %s\n' "${expected_sh[*]}" >&2
  exit 1
fi
for_list="${remote_assert#for script in }"
for_list="${for_list%%; do*}"
if [ "${for_list}" != "${expected_sh[*]}" ]; then
  echo "FAIL remote_assert does not loop over every whitelist *.sh" >&2
  printf 'assert: %s\n' "${for_list}" >&2
  printf 'whitelist: %s\n' "${expected_sh[*]}" >&2
  exit 1
fi
if ! printf '%s\n' "${remote_assert}" | grep -Fq 'missing or not executable'; then
  echo "FAIL remote_assert has no clear failure message" >&2
  exit 1
fi
if ! printf '%s\n' "${remote_assert}" | grep -Fq '[ ! -f ' || ! printf '%s\n' "${remote_assert}" | grep -Fq '[ ! -x '; then
  echo "FAIL remote_assert does not require the file to exist and be executable" >&2
  exit 1
fi
echo "OK remote_assert loops over: ${expected_sh[*]}"

run_remote_assert() {
  local dest="$1"
  local dest_q cmd
  dest_q="$(printf '%q' "${dest}")"
  cmd="mkdir -p ${dest_q} && tar -xzf - -C ${dest_q} && deploy_dir=${dest_q} && ${remote_assert}"
  # The VPS login shell is not necessarily bash. /bin/sh on the runner is dash.
  sh -c "${cmd}"
}

run_assert_in() {
  local dest="$1"
  local dest_q
  dest_q="$(printf '%q' "${dest}")"
  sh -c "deploy_dir=${dest_q} && ${remote_assert}"
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

before_members=()
for member in "${whitelist[@]}"; do
  if [ "${member}" != "check-backup-log.sh" ]; then
    before_members+=("${member}")
  fi
done
if [ "${#before_members[@]}" -eq "${#whitelist[@]}" ]; then
  echo "FAIL setup: whitelist has no check-backup-log.sh to omit" >&2
  exit 1
fi

before_err="${tmp}/before.err"
set +e
tar -C "${root}/deploy" -czf - "${before_members[@]}" \
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
echo "OK before: post-sync assert fails when check-backup-log.sh was not uploaded (rc=${before_rc})"
indent_file "${before_err}"

tar -C "${root}/deploy" -czf - "${whitelist[@]}" \
  | run_remote_assert "${tmp}/after"
for script in "${expected_sh[@]}"; do
  if [ ! -f "${tmp}/after/${script}" ] || [ ! -x "${tmp}/after/${script}" ]; then
    echo "FAIL after: ${script} is missing or not executable after extract" >&2
    exit 1
  fi
  echo "OK after: extracted ${script} exists and is executable"
done

umask_dest="${tmp}/umask"
(
  umask 077
  tar -C "${root}/deploy" -czf - "${whitelist[@]}" | run_remote_assert "${umask_dest}"
)
for script in "${expected_sh[@]}"; do
  if [ ! -x "${umask_dest}/${script}" ]; then
    echo "FAIL after: ${script} lost its execute bit under umask 077" >&2
    exit 1
  fi
done
echo "OK after: execute bit survives extract under umask 077"

# The text check above only proves the assert mentions [ ! -x ]. This runs it.
nox="${tmp}/nox"
mkdir -p "${nox}"
tar -C "${root}/deploy" -czf - "${whitelist[@]}" | tar -xzf - -C "${nox}"
nox_target="${nox}/image-cleanup.sh"
if [ ! -f "${nox_target}" ] || [ ! -x "${nox_target}" ]; then
  echo "FAIL runtime setup: image-cleanup.sh was not executable after extract" >&2
  exit 1
fi
chmod a-x "${nox_target}"
nox_mode="$(stat -c '%a' "${nox_target}")"
if [ ! -f "${nox_target}" ] || [ -x "${nox_target}" ]; then
  echo "FAIL runtime setup: image-cleanup.sh should exist without the execute bit (mode ${nox_mode})" >&2
  exit 1
fi
nox_err="${tmp}/nox.err"
set +e
run_assert_in "${nox}" >"${tmp}/nox.out" 2>"${nox_err}"
nox_rc=$?
set -e
if [ "${nox_rc}" -eq 0 ]; then
  echo "FAIL remote assert accepted image-cleanup.sh without the execute bit" >&2
  exit 1
fi
if ! grep -q 'deploy sync failed: .*/image-cleanup.sh is missing or not executable' "${nox_err}"; then
  echo "FAIL remote assert did not name the non-executable image-cleanup.sh" >&2
  cat "${nox_err}" >&2
  exit 1
fi
chmod a+x "${nox_target}"
if [ ! -x "${nox_target}" ]; then
  echo "FAIL runtime setup: could not restore the execute bit on image-cleanup.sh" >&2
  exit 1
fi
set +e
run_assert_in "${nox}" >"${tmp}/nox-restored.out" 2>"${tmp}/nox-restored.err"
restored_rc=$?
set -e
if [ "${restored_rc}" -ne 0 ]; then
  echo "FAIL remote assert still failed after restoring +x on image-cleanup.sh" >&2
  cat "${tmp}/nox-restored.err" >&2
  exit 1
fi
echo "OK runtime: post-sync assert fails when image-cleanup.sh exists without +x (mode ${nox_mode}, rc=${nox_rc}, shell $(readlink -f /bin/sh)) and passes once +x is restored"
indent_file "${nox_err}"

# --- self-tests: the checker itself must reject the failure modes ---

stray_root="$(mktemp -d)"
mkdir -p "${stray_root}/deploy"
printf '#!/bin/sh\n' >"${stray_root}/deploy/foo.sh"
chmod +x "${stray_root}/deploy/foo.sh"
printf '#!/bin/sh\n' >"${stray_root}/deploy/foo.test.sh"
chmod +x "${stray_root}/deploy/foo.test.sh"
mapfile -t stray_scripts < <(list_scripts "${stray_root}/deploy" | sort)
if [ "${stray_scripts[*]}" != "foo.sh" ]; then
  echo "FAIL self-test stray: discovery returned '${stray_scripts[*]:-<empty>}', want foo.sh" >&2
  rm -rf "${stray_root}"
  exit 1
fi
stray_workflow="${stray_root}/deploy.yml"
cat >"${stray_workflow}" <<'EOF'
      - name: Sync deploy files
        shell: bash
        run: |
          tar -C deploy -czf - docker-compose.yml remote-deploy.sh \
            | ssh example true
EOF
mapfile -t stray_whitelist < <(read_whitelist "${stray_workflow}")
if [ "${stray_whitelist[*]}" != "docker-compose.yml remote-deploy.sh" ]; then
  echo "FAIL self-test stray: parsed whitelist '${stray_whitelist[*]}'" >&2
  rm -rf "${stray_root}"
  exit 1
fi
declare -A stray_reasons=()
expect_partition_fail stray \
  'FAIL foo.sh: deploy script is neither in the Sync deploy files tar whitelist nor in not_synced' \
  "${stray_root}/deploy" stray_scripts stray_whitelist stray_reasons
if [ "${partition_fail_count}" -ne 1 ]; then
  echo "FAIL self-test stray: expected one FAIL line, got ${partition_fail_count}" >&2
  rm -rf "${stray_root}"
  exit 1
fi
rm -rf "${stray_root}"

declare -A both_reasons
for name in "${!not_synced_reason[@]}"; do
  both_reasons["${name}"]="${not_synced_reason[${name}]}"
done
both_target=""
for member in "${whitelist[@]}"; do
  case "${member}" in
    *.sh) both_target="${member}"; break ;;
  esac
done
if [ -z "${both_target}" ]; then
  echo "FAIL self-test both: whitelist has no script" >&2
  exit 1
fi
both_reasons["${both_target}"]="self-test: also listed in the whitelist"
expect_partition_fail both \
  "FAIL ${both_target}: listed in the sync whitelist and in not_synced" \
  "${root}/deploy" scripts whitelist both_reasons
if [ "${partition_fail_count}" -ne 1 ]; then
  echo "FAIL self-test both: expected one FAIL line, got ${partition_fail_count}" >&2
  exit 1
fi

declare -A stale_reasons
for name in "${!not_synced_reason[@]}"; do
  stale_reasons["${name}"]="${not_synced_reason[${name}]}"
done
stale_reasons["gone.sh"]="self-test: file was removed"
expect_partition_fail stale \
  'FAIL gone.sh: not_synced entry does not exist' \
  "${root}/deploy" scripts whitelist stale_reasons
if [ "${partition_fail_count}" -ne 1 ]; then
  echo "FAIL self-test stale: expected one FAIL line, got ${partition_fail_count}" >&2
  exit 1
fi

legacy_file="${tmp}/bf1186a-deploy.yml"
if git -C "${root}" cat-file -e 'bf1186a^{commit}' 2>/dev/null; then
  git -C "${root}" show 'bf1186a:.github/workflows/deploy.yml' >"${legacy_file}"
  legacy_source="bf1186a:.github/workflows/deploy.yml"
else
  write_bf1186a_fixture "${legacy_file}"
  legacy_source="embedded Sync deploy files step from bf1186a"
fi
mapfile -t legacy_whitelist < <(read_whitelist "${legacy_file}")
if [ "${legacy_whitelist[*]}" != "${bf1186a_members[*]}" ]; then
  echo "FAIL self-test bf1186a: ${legacy_source} whitelist is '${legacy_whitelist[*]}'" >&2
  exit 1
fi
legacy_log="${tmp}/bf1186a.log"
set +e
partition_check "${root}/deploy" scripts legacy_whitelist not_synced_reason >"${legacy_log}" 2>&1
legacy_rc=$?
set -e
if [ "${legacy_rc}" -eq 0 ]; then
  echo "FAIL self-test bf1186a: ${legacy_source} was accepted" >&2
  exit 1
fi
if ! grep -q 'FAIL check-backup-log.sh: deploy script is neither in the Sync deploy files tar whitelist nor in not_synced' "${legacy_log}"; then
  echo "FAIL self-test bf1186a: rejection did not name check-backup-log.sh" >&2
  indent_file "${legacy_log}" >&2
  exit 1
fi
echo "OK self-test bf1186a: rc=${legacy_rc} against ${legacy_source}"
indent_file "${legacy_log}"

echo "sync whitelist tests passed"
