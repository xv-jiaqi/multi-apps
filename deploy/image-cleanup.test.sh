#!/usr/bin/env bash
# image-cleanup.sh must keep the images a rollback or a recent main commit
# still needs, and a second run must not delete those tags.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
script="${repo}/deploy/image-cleanup.sh"
deploy_script="${repo}/deploy/remote-deploy.sh"
workflow="${repo}/.github/workflows/deploy.yml"
failed=0
dumped=0

unset CARDHUB_MAIN_SHAS CARDHUB_CLEANUP_KEEP_MAIN_COMMITS CARDHUB_GIT_DIR || true

assert() {
  local name="$1"
  local ok="$2"
  if [ "${ok}" -eq 0 ]; then
    echo "OK ${name}"
  else
    echo "FAIL ${name}" >&2
    failed=1
    if [ "${dumped}" -eq 0 ] && [ -n "${CASE_LOG:-}" ]; then
      dumped=1
      echo "--- stdout ---" >&2
      cat "${CASE_LOG}" >&2 || true
      echo "--- stderr ---" >&2
      cat "${CASE_ERR}" >&2 || true
    fi
  fi
}

hex40() {
  printf '%040x' "$1"
}

api_ref() {
  printf 'ghcr.io/xv-jiaqi/cardhub-api:sha-%s' "$(hex40 "$1")"
}

web_ref() {
  printf 'ghcr.io/xv-jiaqi/cardhub-web:sha-%s' "$(hex40 "$1")"
}

img_id() {
  printf 'sha256:%s' "$(hex40 "$1")"
}

STUB="$(mktemp)"
cat > "${STUB}" << 'EOF'
#!/usr/bin/env bash
set -euo pipefail
images="${DOCKER_FIXTURE_IMAGES:?}"
containers="${DOCKER_FIXTURE_CONTAINERS:?}"
cmd="${1:-}"
shift || true

if [ "${cmd}" = "ps" ]; then
  if [ "${DOCKER_STUB_PS_RC:-0}" != "0" ]; then
    echo "stub docker ps failed" >&2
    exit "${DOCKER_STUB_PS_RC}"
  fi
  list_ids=0
  list_images=0
  project=""
  for arg in "$@"; do
    case "${arg}" in
      -aq) list_ids=1 ;;
      '{{.Image}}') list_images=1 ;;
      label=com.docker.compose.project=*)
        project="${arg#label=com.docker.compose.project=}"
        ;;
    esac
  done
  while IFS=$'\t' read -r cid cproject config image_id || [ -n "${cid}" ]; do
    [ -n "${cid}" ] || continue
    if [ "${list_ids}" -eq 1 ]; then
      printf '%s\n' "${cid}"
      continue
    fi
    if [ "${list_images}" -eq 1 ]; then
      if [ -n "${project}" ] && [ "${cproject}" != "${project}" ]; then
        continue
      fi
      printf '%s\n' "${config}"
    fi
  done < "${containers}"
  exit 0
fi

if [ "${cmd}" = "inspect" ]; then
  if [ "${DOCKER_STUB_INSPECT_RC:-0}" != "0" ]; then
    echo "stub docker inspect failed" >&2
    exit "${DOCKER_STUB_INSPECT_RC}"
  fi
  fmt=""
  cid=""
  prev=""
  for arg in "$@"; do
    if [ "${prev}" = "-f" ]; then
      fmt="${arg}"
    fi
    prev="${arg}"
    cid="${arg}"
  done
  while IFS=$'\t' read -r id cproject config image_id || [ -n "${id}" ]; do
    [ "${id}" = "${cid}" ] || continue
    case "${fmt}" in
      '{{.Image}}')
        printf '%s\n' "${image_id}"
        exit 0
        ;;
      *Config.Image*)
        printf '%s\n' "${config}"
        exit 0
        ;;
    esac
    echo "stub inspect: unexpected format ${fmt}" >&2
    exit 99
  done < "${containers}"
  echo "stub inspect: no such object ${cid}" >&2
  exit 1
fi

if [ "${cmd}" = "image" ]; then
  sub="${1:-}"
  shift || true
  case "${sub}" in
    ls)
      repo="${1:-}"
      while IFS=$'\t' read -r created id ref || [ -n "${ref}" ]; do
        [ -n "${ref}" ] || continue
        case "${ref}" in
          "${repo}:"*) printf '%s\n' "${ref}" ;;
        esac
      done < "${images}"
      exit 0
      ;;
    inspect)
      if [ "${DOCKER_STUB_IMAGE_INSPECT_RC:-0}" != "0" ]; then
        echo "stub image inspect failed" >&2
        exit "${DOCKER_STUB_IMAGE_INSPECT_RC}"
      fi
      fmt=""
      ref=""
      prev=""
      for arg in "$@"; do
        if [ "${prev}" = "-f" ]; then
          fmt="${arg}"
        fi
        prev="${arg}"
        ref="${arg}"
      done
      while IFS=$'\t' read -r created id have || [ -n "${have}" ]; do
        [ "${have}" = "${ref}" ] || continue
        case "${fmt}" in
          '{{.Id}}')
            printf '%s\n' "${id}"
            exit 0
            ;;
          '{{.Created}}')
            printf '%s\n' "${created}"
            exit 0
            ;;
        esac
        echo "stub image inspect: unexpected format ${fmt}" >&2
        exit 99
      done < "${images}"
      echo "stub image inspect: no such image ${ref}" >&2
      exit 1
      ;;
    rm)
      target="${1:-}"
      printf 'rm %s\n' "${target}" >> "${DOCKER_FIXTURE_LOG:?}"
      tmp="${images}.tmp"
      found=0
      : > "${tmp}"
      while IFS=$'\t' read -r created id ref || [ -n "${ref}" ]; do
        [ -n "${ref}" ] || continue
        if [ "${ref}" = "${target}" ]; then
          found=1
          continue
        fi
        printf '%s\t%s\t%s\n' "${created}" "${id}" "${ref}" >> "${tmp}"
      done < "${images}"
      mv "${tmp}" "${images}"
      if [ "${found}" -eq 1 ]; then
        exit 0
      fi
      echo "stub image rm: no such image ${target}" >&2
      exit 1
      ;;
  esac
fi

echo "stub docker: unexpected ${cmd} $*" >&2
exit 99
EOF
chmod 755 "${STUB}"

LAB=""
IMAGES=""
CONTAINERS=""
CASE_LOG=""
CASE_ERR=""
CASE_RC=0

invoke() {
  local log="$1"
  shift
  CASE_RC=0
  env \
    CARDHUB_DOCKER_BIN="${STUB}" \
    DOCKER_FIXTURE_IMAGES="${IMAGES}" \
    DOCKER_FIXTURE_CONTAINERS="${CONTAINERS}" \
    DOCKER_FIXTURE_LOG="${DOCKER_LOG}" \
    bash "${script}" --root "${LAB}" "$@" >"${log}" 2>"${log}.err" || CASE_RC=$?
  CASE_LOG="${log}"
  CASE_ERR="${log}.err"
}

add_image() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >> "${IMAGES}"
}

add_container() {
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "${CONTAINERS}"
}

new_lab() {
  LAB="$(mktemp -d)"
  IMAGES="${LAB}/images.tsv"
  CONTAINERS="${LAB}/containers.tsv"
  : > "${IMAGES}"
  : > "${CONTAINERS}"
  DOCKER_LOG="${LAB}/docker-calls.log"
  : > "${DOCKER_LOG}"
}

rm_calls() {
  awk '$1 == "rm" { n++ } END { print n + 0 }' "${DOCKER_LOG}"
}

write_stamp() {
  local env_name="$1"
  local api_n="$2"
  local web_n="$3"
  local dir="${LAB}/${env_name}/.deploy-state"
  mkdir -p "${dir}"
  printf 'PREVIOUS_API_TAG=sha-%s\nPREVIOUS_WEB_TAG=sha-%s\n' "$(hex40 "${api_n}")" "$(hex40 "${web_n}")" > "${dir}/previous-images.env"
}

expect_keep() {
  local name="$1"
  local ref="$2"
  local reason="$3"
  local line
  line="$(grep -F "KEEP ${ref} (" "${CASE_LOG}" || true)"
  if [ -n "${line}" ] && [[ "${line}" == *"${reason}"* ]]; then
    assert "${name}" 0
  else
    assert "${name}" 1
  fi
}

expect_dry_delete() {
  local name="$1"
  local ref="$2"
  if grep -F -x -q "DRY-RUN DELETE ${ref}" "${CASE_LOG}"; then
    assert "${name}" 0
  else
    assert "${name}" 1
  fi
}

assert "deploy passes recent main commits to the VPS" "$(
  grep -F -q 'git rev-list --max-count' "${workflow}" \
    && grep -F -q "CARDHUB_MAIN_SHAS='" "${workflow}" \
    && grep -F -q 'persist_main_shas' "${deploy_script}" \
    && echo 0 || echo 1
)"
assert "cleanup reads the production rollback stamp" "$(
  grep -F -q 'previous-images.env' "${script}" \
    && grep -F -q 'PREVIOUS_API_TAG' "${script}" \
    && echo 0 || echo 1
)"
assert "persist_main_shas runs before image cleanup" "$(
  awk '
    /^  persist_main_shas$/ { persist = NR }
    /if ! cleanup_old_images/ { cleanup = NR }
    END { exit (persist > 0 && cleanup > persist) ? 0 : 1 }
  ' "${deploy_script}" && echo 0 || echo 1
)"
assert "cleanup failure is after rollback is disarmed and fails the job" "$(
  awk '
    /rollback_armed=0/ { armed = NR }
    /if ! cleanup_old_images/ { cleanup = NR }
    END { exit (armed > 0 && cleanup > armed) ? 0 : 1 }
  ' "${deploy_script}" \
    && grep -F -q '::error::Image cleanup failed after api and web were healthy. Running containers were not rolled back.' "${deploy_script}" \
    && echo 0 || echo 1
)"

# Running prod and staging, both rollback stamps, five main commits.
# The newest local tags are not in that set and must still be deleted.
new_lab
write_stamp production 21 22
write_stamp staging 23 24
add_image "2024-01-01T00:00:00Z" "$(img_id 11)" "$(api_ref 11)"
add_image "2024-01-01T00:00:00Z" "$(img_id 12)" "$(web_ref 12)"
add_image "2024-06-01T00:00:00Z" "$(img_id 13)" "$(api_ref 13)"
add_image "2024-06-01T00:00:00Z" "$(img_id 14)" "$(web_ref 14)"
add_image "2025-01-01T00:00:00Z" "$(img_id 21)" "$(api_ref 21)"
add_image "2025-01-01T00:00:00Z" "$(img_id 22)" "$(web_ref 22)"
add_image "2025-02-01T00:00:00Z" "$(img_id 23)" "$(api_ref 23)"
add_image "2025-02-01T00:00:00Z" "$(img_id 24)" "$(web_ref 24)"
for n in 1 2 3 4 5 6; do
  add_image "2026-0${n}-01T00:00:00Z" "$(img_id "$((100 + n))")" "$(api_ref "${n}")"
  add_image "2026-0${n}-01T00:00:00Z" "$(img_id "$((110 + n))")" "$(web_ref "${n}")"
done
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
add_image "2026-12-01T00:00:00Z" "$(img_id 32)" "$(web_ref 32)"
add_container cprod-api cardhub-prod "ghcr.io/xv-jiaqi/cardhub-api@$(img_id 90)" "$(img_id 11)"
add_container cprod-web cardhub-prod "ghcr.io/xv-jiaqi/cardhub-web@$(img_id 91)" "$(img_id 12)"
add_container cstag-api cardhub-staging "ghcr.io/xv-jiaqi/cardhub-api@$(img_id 92)" "$(img_id 13)"
add_container cstag-web cardhub-staging "ghcr.io/xv-jiaqi/cardhub-web@$(img_id 93)" "$(img_id 14)"
main_shas="$(hex40 1) $(hex40 2) $(hex40 3) $(hex40 4) $(hex40 5) $(hex40 6)"
CARDHUB_MAIN_SHAS="${main_shas}" invoke "${LAB}/a.out" --dry-run --keep-main 5
assert "protected set exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
expect_keep "running prod api is kept" "$(api_ref 11)" "image id in use by a container"
expect_keep "running prod web is kept" "$(web_ref 12)" "image id in use by a container"
expect_keep "running staging api is kept" "$(api_ref 13)" "image id in use by a container"
expect_keep "running staging web is kept" "$(web_ref 14)" "image id in use by a container"
expect_keep "prod rollback api is kept" "$(api_ref 21)" "previous api"
expect_keep "prod rollback web is kept" "$(web_ref 22)" "previous web"
expect_keep "staging rollback api is kept" "$(api_ref 23)" "previous api"
expect_keep "staging rollback web is kept" "$(web_ref 24)" "previous web"
for n in 1 2 3 4 5; do
  expect_keep "main api ${n} is kept" "$(api_ref "${n}")" "recent main commit"
  expect_keep "main web ${n} is kept" "$(web_ref "${n}")" "recent main commit"
done
expect_dry_delete "sixth main api is deleted" "$(api_ref 6)"
expect_dry_delete "sixth main web is deleted" "$(web_ref 6)"
expect_dry_delete "newest unused api is deleted when the prod stamp exists" "$(api_ref 31)"
expect_dry_delete "newest unused web is deleted when the prod stamp exists" "$(web_ref 32)"
CARDHUB_MAIN_SHAS="${main_shas}" invoke "${LAB}/a2.out" --dry-run --keep-main 5
assert "dry-run is idempotent" "$(cmp -s "${LAB}/a.out" "${LAB}/a2.out" && echo 0 || echo 1)"

# A real delete, then the same command again, removes nothing further.
new_lab
dumped=0
write_stamp production 21 22
add_image "2020-01-01T00:00:00Z" "$(img_id 21)" "$(api_ref 21)"
add_image "2020-01-01T00:00:00Z" "$(img_id 22)" "$(web_ref 22)"
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
CARDHUB_MAIN_SHAS="$(hex40 41)" invoke "${LAB}/c1.out"
assert "first delete exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "first delete removes the unused tag" "$(
  grep -F -x -q "DELETE $(api_ref 31)" "${CASE_LOG}" && echo 0 || echo 1
)"
assert "first delete leaves the rollback tag on disk" "$(
  grep -F -q "$(api_ref 21)" "${IMAGES}" && echo 0 || echo 1
)"
assert "first delete drops the unused tag from the fixture" "$(
  grep -F -q "$(api_ref 31)" "${IMAGES}" && echo 1 || echo 0
)"
CARDHUB_MAIN_SHAS="$(hex40 41)" invoke "${LAB}/c2.out"
assert "second delete exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "second delete removes nothing" "$(
  grep -F -q 'DELETE ' "${CASE_LOG}" && echo 1 || echo 0
)"
expect_keep "rollback tag still kept on the second run" "$(api_ref 21)" "previous api"

# The file written by remote-deploy.sh is the manual-run source of main SHAs.
new_lab
dumped=0
write_stamp production 50 50
add_image "2020-01-01T00:00:00Z" "$(img_id 50)" "$(api_ref 50)"
add_image "2020-01-01T00:00:00Z" "$(img_id 51)" "$(web_ref 50)"
for n in 41 42 43 44; do
  add_image "2024-01-0$((n - 40))T00:00:00Z" "$(img_id "${n}")" "$(api_ref "${n}")"
done
persist_shas="$(hex40 41) $(hex40 42) $(hex40 43) $(hex40 44)"
(
  export CARDHUB_ROOT="${LAB}"
  export CARDHUB_MAIN_SHAS="${persist_shas}"
  export CARDHUB_CLEANUP_KEEP_MAIN_COMMITS=2
  # shellcheck disable=SC1090
  source "${deploy_script}"
  persist_main_shas
) > "${LAB}/persist.out"
assert "remote-deploy records the main sha file" "$(
  [ -f "${LAB}/.main-shas" ] && grep -F -q '# keep-count=2' "${LAB}/.main-shas" && echo 0 || echo 1
)"
invoke "${LAB}/e.out" --dry-run
assert "file-backed main list exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
expect_keep "first recorded main commit is kept" "$(api_ref 41)" "recent main commit"
expect_keep "second recorded main commit is kept" "$(api_ref 42)" "recent main commit"
expect_dry_delete "third recorded main commit is past keep-count" "$(api_ref 43)"
expect_dry_delete "fourth recorded main commit is past keep-count" "$(api_ref 44)"
expect_keep "stamp is kept beside the main file" "$(api_ref 50)" "previous api"

# git rev-list supplies the newest main commits when no file and no variable.
new_lab
dumped=0
gitdir="${LAB}/src"
git init -b main "${gitdir}" >/dev/null
git -C "${gitdir}" config user.email "cleanup-test@example.com"
git -C "${gitdir}" config user.name "cleanup-test"
for i in 1 2 3 4 5 6; do
  printf '%s\n' "${i}" > "${gitdir}/f"
  git -C "${gitdir}" add f
  git -C "${gitdir}" commit -m "c${i}" >/dev/null
done
git -C "${gitdir}" rev-list main > "${LAB}/rev-list"
commits=()
while IFS= read -r sha; do
  [ -n "${sha}" ] || continue
  commits+=("${sha}")
done < "${LAB}/rev-list"
write_stamp production 80 80
add_image "2019-01-01T00:00:00Z" "$(img_id 80)" "$(api_ref 80)"
i=0
for sha in "${commits[@]}"; do
  i=$((i + 1))
  add_image "2024-01-0${i}T00:00:00Z" "sha256:${sha}" "ghcr.io/xv-jiaqi/cardhub-api:sha-${sha}"
done
CARDHUB_GIT_DIR="${gitdir}" invoke "${LAB}/d.out" --dry-run
assert "git main list exits 0" "$([ "${CASE_RC}" -eq 0 ] && echo 0 || echo 1)"
assert "git main list protects five commits" "$(
  grep -F -q 'Protecting 5 recent main commits' "${CASE_LOG}" && echo 0 || echo 1
)"
expect_keep "newest git commit is kept" "ghcr.io/xv-jiaqi/cardhub-api:sha-${commits[0]}" "recent main commit"
expect_keep "fifth git commit is kept" "ghcr.io/xv-jiaqi/cardhub-api:sha-${commits[4]}" "recent main commit"
expect_dry_delete "oldest git commit is deleted" "ghcr.io/xv-jiaqi/cardhub-api:sha-${commits[5]}"
expect_keep "prod stamp is kept beside git commits" "$(api_ref 80)" "previous api"

# Bad keep-set: exit non-zero and do not call image rm.
refuse_rm() {
  local name="$1"
  assert "${name} exits non-zero" "$([ "${CASE_RC}" -ne 0 ] && echo 0 || echo 1)"
  assert "${name} does not call image rm" "$([ "$(rm_calls)" -eq 0 ] && echo 0 || echo 1)"
}

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
add_image "2026-11-01T00:00:00Z" "$(img_id 1)" "$(api_ref 1)"
invoke "${LAB}/missing-main.out"
refuse_rm "missing main sha list"
assert "missing main sha list names the gap" "$(
  grep -F -q 'no usable main commits' "${CASE_ERR}" && echo 0 || echo 1
)"

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
: > "${LAB}/.main-shas"
invoke "${LAB}/empty-main.out"
refuse_rm "empty main sha list"

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
printf '%s\n' 'c3c7bf0' > "${LAB}/.main-shas"
invoke "${LAB}/short-main.out"
refuse_rm "short main sha"
assert "short main sha names the bad line" "$(
  grep -F -q 'not a 40-hex commit' "${CASE_ERR}" && echo 0 || echo 1
)"

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
add_image "2026-11-01T00:00:00Z" "$(img_id 1)" "$(api_ref 1)"
printf '# keep-count=0\n%s\n' "$(hex40 1)" > "${LAB}/.main-shas"
invoke "${LAB}/zero-count.out"
refuse_rm "keep-count 0"
assert "keep-count 0 names the count" "$(
  grep -F -q 'keep-count' "${CASE_ERR}" && echo 0 || echo 1
)"

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
printf '# keep-count=abc\n%s\n' "$(hex40 1)" > "${LAB}/.main-shas"
invoke "${LAB}/bad-count.out"
refuse_rm "non-numeric keep-count"

new_lab
dumped=0
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
add_image "2020-01-01T00:00:00Z" "$(img_id 1)" "$(api_ref 1)"
CARDHUB_MAIN_SHAS="$(hex40 1)" invoke "${LAB}/no-stamp.out"
refuse_rm "missing prod rollback stamp"
assert "missing prod rollback stamp names the file" "$(
  grep -F -q 'previous-images.env is missing' "${CASE_ERR}" && echo 0 || echo 1
)"

new_lab
dumped=0
mkdir -p "${LAB}/production/.deploy-state"
printf 'PREVIOUS_API_TAG=garbage\nPREVIOUS_WEB_TAG=sha-%s\n' "$(hex40 22)" > "${LAB}/production/.deploy-state/previous-images.env"
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
CARDHUB_MAIN_SHAS="$(hex40 1)" invoke "${LAB}/bad-stamp.out"
refuse_rm "invalid prod rollback stamp"
assert "invalid prod rollback stamp names the tags" "$(
  grep -F -q 'no valid PREVIOUS_API_TAG and PREVIOUS_WEB_TAG' "${CASE_ERR}" && echo 0 || echo 1
)"

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
add_container cone cardhub-prod "ghcr.io/xv-jiaqi/cardhub-api@$(img_id 90)" "$(img_id 11)"
DOCKER_STUB_PS_RC=1 CARDHUB_MAIN_SHAS="$(hex40 1)" invoke "${LAB}/ps-fail.out"
refuse_rm "docker ps failure"
assert "docker ps failure names the query" "$(
  grep -F -q 'docker ps failed' "${CASE_ERR}" || grep -F -q 'ps -a' "${CASE_ERR}" && echo 0 || echo 1
)"

new_lab
dumped=0
write_stamp production 21 22
add_image "2026-12-01T00:00:00Z" "$(img_id 31)" "$(api_ref 31)"
DOCKER_STUB_IMAGE_INSPECT_RC=1 CARDHUB_MAIN_SHAS="$(hex40 1)" invoke "${LAB}/inspect-fail.out"
refuse_rm "docker image inspect failure"

rc=0
bash "${script}" --keep-main no --root "${LAB}" >"${LAB}/bad.out" 2>"${LAB}/bad.err" || rc=$?
assert "bad keep-main exits 64" "$([ "${rc}" -eq 64 ] && echo 0 || echo 1)"

rm -f "${STUB}"

if [ "${failed}" -ne 0 ]; then
  echo "image-cleanup tests failed" >&2
  exit 1
fi
echo "image-cleanup tests passed"
