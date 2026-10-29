#!/usr/bin/env bash
# Saved api/web logs. A failed docker logs or gzip must not trip the ERR trap
# that rolls a deploy back. Retention is 14 days, then a shared byte cap.
# shellcheck disable=SC2034 # project, cardhub_root, and the cap are read by the sourced script
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
deploy_script="${root}/deploy/remote-deploy.sh"
sha="$(printf 'ab%.0s' {1..20})"
if [ "${#sha}" -ne 40 ]; then
  echo "FAIL fixture sha length ${#sha}" >&2
  exit 1
fi
short="${sha:0:12}"
failed=0

ok() {
  echo "OK $1"
}

bad() {
  echo "FAIL $1" >&2
  failed=1
}

write_docker_stub() {
  local bin="$1"
  mkdir -p "${bin}"
  cat > "${bin}/docker" <<'EOF'
#!/usr/bin/env bash
set -u
cmd="${1-}"
shift || true
case "${cmd}" in
  inspect)
    if [ "${STUB_INSPECT_RC:-0}" -ne 0 ]; then
      echo "inspect failed" >&2
      exit "${STUB_INSPECT_RC}"
    fi
    printf '%s\n' "${STUB_IMAGE:-}"
    ;;
  logs)
    if [ "${STUB_LOGS_RC:-0}" -ne 0 ]; then
      echo "logs failed" >&2
      exit "${STUB_LOGS_RC}"
    fi
    printf '%s\n' "${STUB_LOG_LINE:-}"
    ;;
  *)
    echo "unexpected docker ${cmd}" >&2
    exit 99
    ;;
esac
EOF
  chmod +x "${bin}/docker"
}

# Runs the real helper under set -E and an ERR trap that exits 42.
# The trap is armed. A later `false` must be what exits 42, which only
# happens when the helper returned and the script continued.
run_archive_case() {
  local name="$1"
  local mode="$2"
  local work out err rc continued trap_line
  work="$(mktemp -d)"
  write_docker_stub "${work}/bin"
  if [ "${mode}" = "gzip-fails" ]; then
    cat > "${work}/bin/gzip" <<'EOF'
#!/usr/bin/env bash
echo "gzip stub failed" >&2
exit 1
EOF
    chmod +x "${work}/bin/gzip"
  fi
  if [ "${mode}" = "mkdir-fails" ]; then
    : >"${work}/root"
  else
    mkdir -p "${work}/root"
  fi
  out="${work}/out"
  err="${work}/err"
  set +e
  (
    export PATH="${work}/bin:${PATH}"
    export STUB_IMAGE="ghcr.io/xv-jiaqi/cardhub-api:sha-${sha}"
    export STUB_LOG_LINE='{"msg":"POST /trpc/auth.login,auth.login"}'
    if [ "${mode}" = "logs-fail" ]; then
      export STUB_LOGS_RC=1
    fi
    if [ "${mode}" = "non-sha" ]; then
      export STUB_IMAGE="redis:7"
    fi
    # shellcheck disable=SC1090
    source "${deploy_script}"
    cardhub_root="${work}/root"
    project="cardhub-staging"
    trap 'echo TRAP; exit 42' ERR
    archive_removed_container_logs "0123456789abcdef" api
    echo CONTINUED
    false
  ) >"${out}" 2>"${err}"
  rc=$?
  set -e
  continued="$(grep -n '^CONTINUED$' "${out}" || true)"
  trap_line="$(grep -n '^TRAP$' "${out}" || true)"
  if [ "${rc}" -ne 42 ] || [ -z "${continued}" ] || [ -z "${trap_line}" ]; then
    bad "${name}: expected continue then trap exit 42, rc=${rc}"
    echo "--- stdout ---" >&2
    cat "${out}" >&2 || true
    echo "--- stderr ---" >&2
    cat "${err}" >&2 || true
    return
  fi
  if [ "${continued%%:*}" -gt "${trap_line%%:*}" ]; then
    bad "${name}: ERR trap fired before the helper returned"
    return
  fi
  shopt -s nullglob
  local archives=("${work}/root"/logs/cardhub-staging/api-*.log.gz)
  local partials=("${work}/root"/logs/cardhub-staging/*.partial)
  local temps=("${work}/root"/logs/cardhub-staging/.api-*)
  shopt -u nullglob
  case "${mode}" in
    logs-fail|gzip-fails|mkdir-fails)
      if [ "${#archives[@]}" -ne 0 ] || [ "${#partials[@]}" -ne 0 ] || [ "${#temps[@]}" -ne 0 ]; then
        bad "${name}: failed save left files: ${archives[*]:-} ${partials[*]:-} ${temps[*]:-}"
        return
      fi
      if ! grep -q 'Deploy continues' "${err}"; then
        bad "${name}: stderr did not say the deploy continues"
        return
      fi
      ;;
    success)
      if [ "${#archives[@]}" -ne 1 ]; then
        bad "${name}: expected one archive, found ${#archives[@]}"
        printf '%s\n' "${archives[@]:-}" >&2
        return
      fi
      local base
      base="$(basename "${archives[0]}")"
      if ! [[ "${base}" =~ ^api-${short}-[0-9]{8}T[0-9]{6}Z\.log\.gz$ ]]; then
        bad "${name}: archive name ${base}"
        return
      fi
      if ! gzip -t "${archives[0]}"; then
        bad "${name}: archive is not gzip"
        return
      fi
      if ! zgrep -F 'auth.login,auth.login' "${archives[0]}" >/dev/null; then
        bad "${name}: zgrep did not find the request"
        return
      fi
      ;;
    non-sha)
      if [ "${#archives[@]}" -ne 1 ]; then
        bad "${name}: expected one archive, found ${#archives[@]}"
        return
      fi
      local base
      base="$(basename "${archives[0]}")"
      if ! [[ "${base}" =~ ^api-0123456789ab-[0-9]{8}T[0-9]{6}Z\.log\.gz$ ]]; then
        bad "${name}: non-sha archive name ${base}"
        return
      fi
      ;;
  esac
  ok "${name}"
}

run_archive_case "docker logs failure does not abort" logs-fail
run_archive_case "gzip failure does not abort" gzip-fails
run_archive_case "mkdir failure does not abort" mkdir-fails
run_archive_case "successful save keeps a gzipped log" success
run_archive_case "non-sha image uses the container id" non-sha

python3 - "${deploy_script}" <<'PY'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
start = text.index("  rollout_service() {")
end = text.index("\n  public_https_get()", start)
body = text[start:end]
stop = body.index('docker stop -t')
arch = body.index("archive_removed_container_logs")
remove = body.index('docker rm "${old_id}"')
if not (stop < arch < remove):
    print("FAIL archive call is not between docker stop and docker rm", file=sys.stderr)
    sys.exit(1)
print("OK rollout archives the old container before docker rm")
PY

# shellcheck disable=SC1090
source "${deploy_script}"

write_bytes() {
  local path="$1"
  local bytes="$2"
  local when="$3"
  mkdir -p "$(dirname "${path}")"
  dd if=/dev/zero of="${path}" bs=1 count="${bytes}" status=none
  touch -d "${when}" "${path}"
}

list_archives() {
  local dir="$1"
  find "${dir}/logs/cardhub-prod" "${dir}/logs/cardhub-staging" \
    -mindepth 1 -maxdepth 1 -type f -name '*.log.gz' -printf '%f\n' 2>/dev/null | sort
}

age_root="$(mktemp -d)"
cardhub_root="${age_root}"
container_log_cap_bytes=1073741824
write_bytes "${age_root}/logs/cardhub-prod/api-aaaaaaaaaaaa-20260101T000000Z.log.gz" 100 "20 days ago"
write_bytes "${age_root}/logs/cardhub-staging/web-bbbbbbbbbbbb-20260102T000000Z.log.gz" 100 "1 day ago"
write_bytes "${age_root}/logs/cardhub-prod/notes.txt" 100 "20 days ago"
write_bytes "${age_root}/logs/edge/access-old.log.gz" 100 "20 days ago"
prune_saved_container_logs
age_left="$(list_archives "${age_root}")"
if [ "${age_left}" != "web-bbbbbbbbbbbb-20260102T000000Z.log.gz" ]; then
  bad "14 day retention kept: ${age_left}"
else
  ok "archives older than 14 days are removed"
fi
if [ ! -f "${age_root}/logs/cardhub-prod/notes.txt" ]; then
  bad "retention deleted a file that is not an archive"
else
  ok "non-archive files stay"
fi
if [ ! -f "${age_root}/logs/edge/access-old.log.gz" ]; then
  bad "retention deleted a file outside the two project directories"
else
  ok "cleanup ignores other directories"
fi

cap_root="$(mktemp -d)"
cardhub_root="${cap_root}"
container_log_cap_bytes=500
write_bytes "${cap_root}/logs/cardhub-prod/api-aaaaaaaaaaaa-20261001T000000Z.log.gz" 400 "3 days ago"
write_bytes "${cap_root}/logs/cardhub-staging/api-bbbbbbbbbbbb-20261002T000000Z.log.gz" 400 "2 days ago"
write_bytes "${cap_root}/logs/cardhub-staging/web-cccccccccccc-20261003T000000Z.log.gz" 400 "1 day ago"
write_bytes "${cap_root}/logs/cardhub-prod/api-dddddddddddd-20261001T000000Z.log.gz.partial" 50 "1 day ago"
write_bytes "${cap_root}/logs/cardhub-prod/.api-tempXXXX" 50 "1 day ago"
prune_saved_container_logs
cap_left="$(list_archives "${cap_root}")"
if [ "${cap_left}" != "web-cccccccccccc-20261003T000000Z.log.gz" ]; then
  bad "1 GiB cap kept: ${cap_left}"
else
  ok "shared cap deletes the oldest archives across both projects"
fi
if [ -e "${cap_root}/logs/cardhub-prod/api-dddddddddddd-20261001T000000Z.log.gz.partial" ] \
  || [ -e "${cap_root}/logs/cardhub-prod/.api-tempXXXX" ]; then
  bad "incomplete archive files were kept"
else
  ok "partial and temp files are removed"
fi
cap_bytes="$(stat -c '%s' "${cap_root}/logs/cardhub-staging/web-cccccccccccc-20261003T000000Z.log.gz")"
if [ "${cap_bytes}" -gt 500 ]; then
  bad "remaining archive is over the cap"
else
  ok "remaining archives are within the cap"
fi

# Empty root, a `..` component, and a symlink out of the log dir must not
# delete files that live outside the two allowlisted directories.
outside="$(mktemp -d)"
planted="${outside}/api-aaaaaaaaaaaa-20200101T000000Z.log.gz"
write_bytes "${planted}" 40 "20 days ago"
container_log_cap_bytes=0
cardhub_root=""
prune_saved_container_logs
if [ ! -f "${planted}" ]; then
  bad "empty CARDHUB_ROOT deleted ${planted}"
else
  ok "empty CARDHUB_ROOT leaves outside files"
fi

cardhub_root="${outside}/nested/.."
mkdir -p "${outside}/nested"
prune_saved_container_logs
if [ ! -f "${planted}" ]; then
  bad "CARDHUB_ROOT with .. deleted ${planted}"
else
  ok ".. path leaves outside files"
fi

link_root="$(mktemp -d)"
mkdir -p "${link_root}/logs"
ln -s "${outside}" "${link_root}/logs/cardhub-prod"
mkdir -p "${link_root}/logs/cardhub-staging"
ln -s "${planted}" "${link_root}/logs/cardhub-staging/api-aaaaaaaaaaaa-20200101T000000Z.log.gz"
cardhub_root="${link_root}"
prune_saved_container_logs
if [ ! -f "${planted}" ]; then
  bad "symlink out of the log dir deleted ${planted}"
else
  ok "symlink out of the log dir leaves the target"
fi
if [ ! -L "${link_root}/logs/cardhub-prod" ]; then
  bad "directory symlink was removed or replaced"
else
  ok "directory symlink was not used as a log dir"
fi

if [ "${failed}" -ne 0 ]; then
  exit 1
fi
