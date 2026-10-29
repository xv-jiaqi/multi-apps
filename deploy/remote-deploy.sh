#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  echo "Usage: $0 <production|staging> <sha-40hex-image-tag> <40hex-expected-sha>" >&2
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  if [ "$#" -ne 3 ]; then
    usage
    exit 64
  fi
fi

# CARDHUB_ROOT is /opt/cardhub in production. Tests point it at a temp tree.
cardhub_root="${CARDHUB_ROOT:-/opt/cardhub}"
# Seconds `docker stop -t` waits after SIGTERM while in-flight requests finish.
# Compose stop_grace_period is the same 30s ceiling.
stop_grace_seconds="${CARDHUB_STOP_GRACE_SECONDS:-30}"
health_timeout_seconds="${CARDHUB_HEALTH_TIMEOUT_SECONDS:-180}"

if ! [[ "${stop_grace_seconds}" =~ ^[0-9]+$ ]]; then
  echo "Invalid CARDHUB_STOP_GRACE_SECONDS: ${stop_grace_seconds}" >&2
  exit 64
fi
if ! [[ "${health_timeout_seconds}" =~ ^[0-9]+$ ]]; then
  echo "Invalid CARDHUB_HEALTH_TIMEOUT_SECONDS: ${health_timeout_seconds}" >&2
  exit 64
fi

# Lookup helpers are top-level so a test can source this file and call
# read_previous_image. main uses the same functions. Nothing here returns
# success before the image switch.

compose() {
  : "${env_name:?}" "${active_image_tag:?}" "${project:?}" "${env_file:?}" "${compose_file:?}"
  ENV_NAME="${env_name}" IMAGE_TAG="${active_image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" "$@"
}

count_lines() {
  printf '%s\n' "$1" | awk 'NF { n++ } END { print n + 0 }'
}

# Empty only when this service has no container. "No such object" from
# inspect is that case. Any other inspect or list failure exits 1 before
# rollback is armed.
read_previous_image() {
  local svc="$1"
  local ids id image err rc listed named name_line name_id name_project
  if ! ids="$(compose ps -aq "${svc}")"; then
    echo "Refusing deploy: could not list ${svc} containers. The running API was not replaced." >&2
    exit 1
  fi
  ids="$(printf '%s\n' "${ids}" | awk 'NF' | sort -u)"
  if [ -z "${ids}" ]; then
    # Same labels compose itself uses. A hit means compose missed a
    # container that still belongs to this project.
    if ! listed="$(docker ps -a \
      --filter "label=com.docker.compose.project=${project}" \
      --filter "label=com.docker.compose.service=${svc}" \
      --format '{{.ID}}')"; then
      echo "Refusing deploy: docker ps failed while checking for a ${svc} container. The running API was not replaced." >&2
      exit 1
    fi
    listed="$(printf '%s\n' "${listed}" | awk 'NF')"
    if [ -n "${listed}" ]; then
      echo "Refusing deploy: compose listed no ${svc} container, but docker ps still shows one. The running API was not replaced." >&2
      exit 1
    fi
    # A leftover can keep the compose container name after its labels are
    # gone. The label query above does not see it. A different compose
    # project label means the name belongs to someone else.
    if ! named="$(docker ps -a \
      --filter "name=^${project}-${svc}-[0-9]+$" \
      --format '{{.ID}}{{"\t"}}{{.Label "com.docker.compose.project"}}')"; then
      echo "Refusing deploy: docker ps failed while checking for a named ${svc} container. The running API was not replaced." >&2
      exit 1
    fi
    if [ -n "${named}" ]; then
      while IFS= read -r name_line; do
        [ -n "${name_line}" ] || continue
        if [[ "${name_line}" == *$'\t'* ]]; then
          name_id="${name_line%%$'\t'*}"
          name_project="${name_line#*$'\t'}"
        else
          name_id="${name_line}"
          name_project=""
        fi
        if [ -n "${name_project}" ] && [ "${name_project}" != "${project}" ]; then
          continue
        fi
        echo "Refusing deploy: leftover container ${name_id} occupies ${project}-${svc} without another project's compose label. The running API was not replaced." >&2
        exit 1
      done <<< "${named}"
    fi
    printf '%s' ""
    return 0
  fi
  if [ "$(count_lines "${ids}")" -ne 1 ]; then
    echo "Refusing deploy: ${svc} has $(count_lines "${ids}") containers; cannot choose a rollback image. The running API was not replaced." >&2
    exit 1
  fi
  id="$(printf '%s\n' "${ids}" | head -n 1)"
  err="$(mktemp)"
  rc=0
  image="$(docker inspect -f '{{.Config.Image}}' "${id}" 2>"${err}")" || rc=$?
  if [ "${rc}" -ne 0 ]; then
    if grep -Eq 'No such (object|container)' "${err}"; then
      rm -f "${err}"
      printf '%s' ""
      return 0
    fi
    echo "Refusing deploy: docker inspect of the previous ${svc} container exited ${rc}. The running API was not replaced." >&2
    rm -f "${err}"
    exit 1
  fi
  rm -f "${err}"
  printf '%s' "${image}"
}

# Print true, false, or nothing. Empty means the GitHub variable is unset
# and the env file must be left alone. Anything else is refused. The raw
# value is never printed.
normalize_password_prehash_write() {
  local value
  value="${PASSWORD_PREHASH_WRITE-}"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  case "${value}" in
    ""|true|false)
      printf '%s' "${value}"
      ;;
    *)
      echo "PASSWORD_PREHASH_WRITE must be the exact string true or false" >&2
      return 64
      ;;
  esac
}

# Replace every PASSWORD_PREHASH_WRITE assignment, or append one. A line
# whose name is `export PASSWORD_PREHASH_WRITE` is rewritten in place and
# keeps the export prefix. Comments and other keys are copied through and
# are not printed. Unset, empty, and whitespace leave the file untouched,
# including its inode.
apply_password_prehash_write() {
  local file="$1"
  local value key tmp
  key="PASSWORD_PREHASH_WRITE"
  value="$(normalize_password_prehash_write)" || return $?
  if [ -z "${value}" ]; then
    return 0
  fi
  if [ ! -f "${file}" ]; then
    echo "Missing env file: ${file}" >&2
    return 1
  fi

  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1
  chmod 600 "${tmp}"
  if ! awk -v key="${key}" -v value="${value}" '
    function trim(s) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
      return s
    }
    function assignment_kind(raw,    eq, name, rest) {
      eq = index(raw, "=")
      if (eq == 0) return ""
      name = trim(substr(raw, 1, eq - 1))
      if (name == key) return "plain"
      rest = name
      if (sub(/^export[[:space:]]+/, "", rest)) {
        rest = trim(rest)
        if (rest == key) return "export"
      }
      return ""
    }
    BEGIN { found = 0 }
    {
      raw = $0
      sub(/\r$/, "", raw)
      if (raw ~ /^[[:space:]]*#/ || raw ~ /^[[:space:]]*$/) {
        print
        next
      }
      kind = assignment_kind(raw)
      if (kind == "plain") {
        print key "=" value
        found = 1
        next
      }
      if (kind == "export") {
        print "export " key "=" value
        found = 1
        next
      }
      print
    }
    END {
      if (!found) print key "=" value
    }
  ' "${file}" > "${tmp}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not rewrite ${key}" >&2
    return 1
  fi

  if [ -s "${file}" ] && [ ! -s "${tmp}" ]; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: rewrite produced an empty file" >&2
    return 1
  fi

  if cmp -s "${file}" "${tmp}"; then
    rm -f "${tmp}"
    return 0
  fi

  chmod --reference="${file}" "${tmp}" || chmod 600 "${tmp}"
  if ! mv -f "${tmp}" "${file}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not replace it" >&2
    return 1
  fi
  printf '%s\n' "${key}=${value}"
}

# Print true or false. Only the exact string true enables X-Cache. Empty,
# whitespace, and every other value are false. The raw value is not printed.
normalize_catalog_cache_header() {
  local value
  value="${CATALOG_CACHE_HEADER-}"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [ "${value}" = "true" ]; then
    printf '%s' "true"
  else
    printf '%s' "false"
  fi
}

# Replace every CATALOG_CACHE_HEADER assignment, or append one. A line whose
# name is `export CATALOG_CACHE_HEADER` is rewritten in place and keeps the
# export prefix. The key is not appended again when a line already exists.
# Comments and other keys are copied through and are not printed.
apply_catalog_cache_header() {
  local file="$1"
  local value key tmp
  key="CATALOG_CACHE_HEADER"
  value="$(normalize_catalog_cache_header)"
  if [ ! -f "${file}" ]; then
    echo "Missing env file: ${file}" >&2
    return 1
  fi

  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1
  chmod 600 "${tmp}"
  if ! awk -v key="${key}" -v value="${value}" '
    function trim(s) {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)
      return s
    }
    function assignment_kind(raw,    eq, name, rest) {
      eq = index(raw, "=")
      if (eq == 0) return ""
      name = trim(substr(raw, 1, eq - 1))
      if (name == key) return "plain"
      rest = name
      if (sub(/^export[[:space:]]+/, "", rest)) {
        rest = trim(rest)
        if (rest == key) return "export"
      }
      return ""
    }
    BEGIN { found = 0 }
    {
      raw = $0
      sub(/\r$/, "", raw)
      if (raw ~ /^[[:space:]]*#/ || raw ~ /^[[:space:]]*$/) {
        print
        next
      }
      kind = assignment_kind(raw)
      if (kind == "plain") {
        print key "=" value
        found = 1
        next
      }
      if (kind == "export") {
        print "export " key "=" value
        found = 1
        next
      }
      print
    }
    END {
      if (!found) print key "=" value
    }
  ' "${file}" > "${tmp}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not rewrite ${key}" >&2
    return 1
  fi

  if [ -s "${file}" ] && [ ! -s "${tmp}" ]; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: rewrite produced an empty file" >&2
    return 1
  fi

  if cmp -s "${file}" "${tmp}"; then
    rm -f "${tmp}"
    return 0
  fi

  chmod --reference="${file}" "${tmp}" || chmod 600 "${tmp}"
  if ! mv -f "${tmp}" "${file}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not replace it" >&2
    return 1
  fi
  printf '%s\n' "${key}=${value}"
}

# Print the DSN, or nothing. Empty means the GitHub secret is unset and the
# env file must be left alone. Anything else must be an http or https URL
# with no whitespace, quotes, backslashes, or shell substitutions. The value
# is written to stdout only so the caller can capture it. It is never logged.
normalize_web_sentry_dsn() {
  local value
  value="${WEB_SENTRY_DSN-}"
  while [ -n "${value}" ] && { [ "${value: -1}" = $'\n' ] || [ "${value: -1}" = $'\r' ]; }; do
    value="${value%?}"
  done
  case "${value}" in
    *$'\n'*|*$'\r'*)
      echo "WEB_SENTRY_DSN must be an http or https URL" >&2
      return 64
      ;;
  esac
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [ -z "${value}" ]; then
    printf '%s' ""
    return 0
  fi
  # Same shape the web entrypoint accepts, plus no $ or backtick: compose
  # interpolates $ in the env file, and the value is placed in a shell
  # assignment before that.
  if printf '%s' "${value}" | grep -Eq '^https?://[^[:space:]"\\$`]+$'; then
    printf '%s' "${value}"
    return 0
  fi
  echo "WEB_SENTRY_DSN must be an http or https URL" >&2
  return 64
}

# Replace every WEB_SENTRY_DSN assignment, including a line whose name has an
# export prefix, or append one. Comments and other keys are copied through
# and are not printed. Unset, empty, and whitespace leave the file untouched,
# including its inode. Owner and mode are kept the same way as
# PASSWORD_PREHASH_WRITE (env files are 600). The DSN is never printed.
apply_web_sentry_dsn() {
  local file="$1"
  local value key tmp
  key="WEB_SENTRY_DSN"
  value="$(normalize_web_sentry_dsn)" || return $?
  if [ -z "${value}" ]; then
    return 0
  fi
  if [ ! -f "${file}" ]; then
    echo "Missing env file: ${file}" >&2
    return 1
  fi

  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1
  chmod 600 "${tmp}"
  if ! awk -v key="${key}" -v value="${value}" '
    function assignment_name(raw,    name, eq) {
      eq = index(raw, "=")
      if (eq == 0) return ""
      name = substr(raw, 1, eq - 1)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      sub(/^export[[:space:]]+/, "", name)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
      return name
    }
    BEGIN { found = 0 }
    {
      raw = $0
      sub(/\r$/, "", raw)
      if (raw ~ /^[[:space:]]*#/ || raw ~ /^[[:space:]]*$/) {
        print
        next
      }
      if (assignment_name(raw) == key) {
        print key "=" value
        found = 1
        next
      }
      print
    }
    END {
      if (!found) print key "=" value
    }
  ' "${file}" > "${tmp}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not rewrite ${key}" >&2
    return 1
  fi

  if [ -s "${file}" ] && [ ! -s "${tmp}" ]; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: rewrite produced an empty file" >&2
    return 1
  fi

  if cmp -s "${file}" "${tmp}"; then
    rm -f "${tmp}"
    return 0
  fi

  if ! chown --reference="${file}" "${tmp}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not preserve owner" >&2
    return 1
  fi
  chmod --reference="${file}" "${tmp}" || chmod 600 "${tmp}"
  if ! mv -f "${tmp}" "${file}"; then
    rm -f "${tmp}"
    echo "Refusing to update ${file}: could not replace it" >&2
    return 1
  fi
}

main() {
  local environment image_tag expected_sha env_name project base_dir
  environment="$1"
  image_tag="$2"
  expected_sha="$3"

  case "${environment}" in
    production)
      env_name="prod"
      project="cardhub-prod"
      base_dir="${cardhub_root}/production"
      ;;
    staging)
      env_name="staging"
      project="cardhub-staging"
      base_dir="${cardhub_root}/staging"
      ;;
    *)
      usage
      exit 64
      ;;
  esac

  if [[ ! "${image_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then
    echo "Invalid image tag: ${image_tag}" >&2
    exit 64
  fi

  if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "Invalid expected SHA: ${expected_sha}" >&2
    exit 64
  fi

  if [ "${image_tag#sha-}" != "${expected_sha}" ]; then
    echo "Image tag and expected SHA disagree" >&2
    exit 64
  fi

  local app_dir compose_file env_file active_image_tag
  app_dir="${base_dir}/deploy"
  compose_file="${app_dir}/docker-compose.yml"
  env_file="${base_dir}/${environment}.env"
  active_image_tag="${image_tag}"

  if ! docker network inspect edge >/dev/null 2>&1; then
    echo "Docker network 'edge' does not exist. Start deploy/edge first." >&2
    exit 1
  fi

  if [ ! -f "${env_file}" ]; then
    echo "Missing env file: ${env_file}" >&2
    exit 1
  fi

  local env_file_env_name
  env_file_env_name="$(awk -F= '$1 == "ENV_NAME" { print $2 }' "${env_file}" | tail -n 1 | tr -d '\r' | sed 's/^"//; s/"$//')"
  if [ "${env_file_env_name}" != "${env_name}" ]; then
    echo "ENV_NAME in ${env_file} must be '${env_name}', got '${env_file_env_name:-<missing>}'" >&2
    exit 1
  fi

  # GitHub Environment variable, forwarded by deploy.yml. Unset or blank
  # keeps the line already on disk (staging stays true until the variable
  # is set). true and false are written before any container is replaced.
  # Other lines in the env file are secrets and are not printed.
  apply_password_prehash_write "${env_file}" || exit $?

  # GitHub Environment secret WEB_SENTRY_DSN, forwarded by deploy.yml.
  # Unset or blank keeps the line already on disk. An http(s) URL replaces
  # every assignment of that key, including an export prefix, or appends
  # one. The value is not printed.
  apply_web_sentry_dsn "${env_file}" || exit $?

  # GitHub Environment variable, forwarded by deploy.yml. Only the exact
  # string true is kept; empty and every other value are written as false.
  # Runs after the checks above so a rejected prehash or DSN does not
  # rewrite this file. ENV_NAME is already staging or prod.
  apply_catalog_cache_header "${env_file}" || exit $?

  cd "${app_dir}"

  local previous_api_image previous_web_image previous_tag previous_api_tag previous_web_tag
  # Global so the EXIT trap can still see it after main returns.
  tmp=""
  cleanup() {
    [ -z "${tmp:-}" ] || rm -f "${tmp}"
  }
  trap cleanup EXIT

  # Last assignment wins. The value is not printed.
  read_env_file_var() {
    local file="$1"
    local key="$2"
    awk -v key="$key" '
      BEGIN { found = "" }
      /^[[:space:]]*#/ { next }
      /^[[:space:]]*$/ { next }
      {
        eq = index($0, "=")
        if (eq == 0) next
        name = substr($0, 1, eq - 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
        if (name != key) next
        value = substr($0, eq + 1)
        gsub(/\r$/, "", value)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        if (length(value) >= 2 && substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") {
          value = substr(value, 2, length(value) - 2)
        }
        q = sprintf("%c", 39)
        if (length(value) >= 2 && substr(value, 1, 1) == q && substr(value, length(value), 1) == q) {
          value = substr(value, 2, length(value) - 2)
        }
        found = value
      }
      END { printf "%s", found }
    ' "${file}"
  }

  # Status is the `docker run` status of the classification script.
  # 0: both split entrypoints exist and are executable.
  # 10: both files are absent, so the image is from before the split.
  #     A dangling symlink counts as present (`! -e` is not enough).
  # 3: at least one file exists, but the pair is incomplete (the other is
  #    missing, or a file is present and not executable).
  # Docker itself returns 1 for an attach or stream error, so 1 is not an
  # old image. Any status other than 0, 10, or 3 aborts before a container
  # changes.
  probe_split_entrypoint() {
    docker run --rm --network none --entrypoint sh "${api_image}" -c '
      api=/usr/local/bin/api-entrypoint.sh
      mig=/usr/local/bin/migrate-entrypoint.sh
      if [ ! -e "$api" ] && [ ! -L "$api" ] && [ ! -e "$mig" ] && [ ! -L "$mig" ]; then
        exit 10
      fi
      test -x "$api" && test -x "$mig" || exit 3
    '
  }

  service_ids() {
    compose ps -aq "$1" | awk 'NF' | sort -u
  }

  # One rollout at a time on the shared 4G+2G host. Prod and staging must not
  # each add an API or web replica together.
  mkdir -p "${cardhub_root}"
  if ! command -v flock >/dev/null 2>&1; then
    echo "flock is required so prod and staging do not roll out together" >&2
    exit 1
  fi
  exec 8>"${cardhub_root}/.rollout.lock"
  if ! flock -w 900 8; then
    echo "Timed out waiting for ${cardhub_root}/.rollout.lock; another rollout is still adding a replica" >&2
    exit 1
  fi

  local svc id n
  for svc in api web; do
    id="$(service_ids "${svc}")"
    n="$(count_lines "${id}")"
    if [ "${n}" -gt 1 ]; then
      echo "${svc} already has ${n} containers; refusing to add another replica" >&2
      exit 1
    fi
  done

  previous_api_image="$(read_previous_image api)"
  previous_web_image="$(read_previous_image web)"
  previous_tag=""
  previous_api_tag=""
  previous_web_tag=""
  if [[ "${previous_api_image}" =~ :sha-[0-9a-f]{40}$ ]] && [[ "${previous_web_image}" =~ :sha-[0-9a-f]{40}$ ]]; then
    previous_api_tag="${previous_api_image##*:}"
    previous_web_tag="${previous_web_image##*:}"
    if [ "${previous_api_tag}" = "${previous_web_tag}" ]; then
      previous_tag="${previous_api_tag}"
    else
      echo "Previous api/web tags differ (${previous_api_tag} vs ${previous_web_tag}); automatic rollback requires matching immutable tags" >&2
    fi
  elif [[ "${previous_api_image}" =~ :sha-[0-9a-f]{40}$ ]]; then
    previous_api_tag="${previous_api_image##*:}"
    previous_tag="${previous_api_tag}"
  elif [[ "${previous_web_image}" =~ :sha-[0-9a-f]{40}$ ]]; then
    previous_web_tag="${previous_web_image##*:}"
  fi

  record_previous_images() {
    local state_dir state_file tmp_state wrote
    state_dir="${base_dir}/.deploy-state"
    state_file="${state_dir}/previous-images.env"
    wrote=0

    if [[ ! "${previous_api_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [[ ! "${previous_web_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then
      return 0
    fi

    mkdir -p "${state_dir}"
    tmp_state="$(mktemp "${state_dir}/previous-images.env.XXXXXX")"
    {
      echo "# Generated by remote-deploy.sh after this environment switched successfully."
      if [[ "${previous_api_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_api_tag}" != "${image_tag}" ]; then
        echo "PREVIOUS_API_TAG=${previous_api_tag}"
        wrote=1
      fi
      if [[ "${previous_web_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_web_tag}" != "${image_tag}" ]; then
        echo "PREVIOUS_WEB_TAG=${previous_web_tag}"
        wrote=1
      fi
    } > "${tmp_state}"

    if [ "${wrote}" -eq 1 ]; then
      mv "${tmp_state}" "${state_file}"
    else
      rm -f "${tmp_state}"
    fi
  }

  cleanup_old_images() {
    if [ ! -x "${app_dir}/image-cleanup.sh" ]; then
      echo "Warning: ${app_dir}/image-cleanup.sh is missing or not executable; skipping image cleanup" >&2
      return 0
    fi

    "${app_dir}/image-cleanup.sh" --root "${cardhub_root}" || echo "Warning: image cleanup failed; deploy continues" >&2
  }

  local rollback_armed rollback_in_progress
  rollback_armed=0
  rollback_in_progress=0

  rollback() {
    if [ "${rollback_armed}" -ne 1 ] || [ "${rollback_in_progress}" -eq 1 ]; then
      return 0
    fi
    rollback_in_progress=1
    trap - ERR
    if [[ "${previous_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_tag}" != "${image_tag}" ]; then
      echo "Rolling back ${environment} to ${previous_tag}" >&2
      active_image_tag="${previous_tag}"
      compose pull api web || true
      # Keeps a replica already running previous_tag and drops a mismatched
      # extra one. Recreates only a service that has already cut over.
      compose up -d postgres redis api web || true
    else
      echo "No previous immutable sha tag available for automatic rollback" >&2
    fi
  }

  on_error() {
    local rc="$?"
    rollback
    exit "${rc}"
  }

  wait_for_container_healthy() {
    local id="$1"
    local label="$2"
    local deadline previous_restart restart_count state health
    deadline=$((SECONDS + health_timeout_seconds))
    previous_restart=""

    while [ "${SECONDS}" -lt "${deadline}" ]; do
      state="$(docker inspect -f '{{.State.Status}}' "${id}")"
      restart_count="$(docker inspect -f '{{.RestartCount}}' "${id}")"
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${id}")"

      if [ -n "${previous_restart}" ] && [ "${restart_count}" -gt "${previous_restart}" ]; then
        echo "${label} container restart count increased (${previous_restart} -> ${restart_count})" >&2
        return 1
      fi
      previous_restart="${restart_count}"

      if [ "${state}" != "running" ]; then
        echo "${label} container state is ${state}" >&2
        return 1
      fi

      case "${health}" in
        healthy)
          echo "Container ${label} ${id:0:12} is healthy"
          return 0
          ;;
        unhealthy)
          echo "${label} container is unhealthy" >&2
          return 1
          ;;
        none)
          echo "${label} container has no healthcheck" >&2
          return 1
          ;;
      esac

      sleep 5
    done

    echo "Timed out waiting for ${label} container to become healthy" >&2
    return 1
  }

  discard_container() {
    local id="$1"
    local label="$2"
    echo "Removing failed ${label} container ${id:0:12}; the previous container keeps serving" >&2
    docker logs --tail 80 "${id}" >&2 || true
    docker rm -f "${id}" >/dev/null
  }

  confirm_api() {
    local id="$1"
    local body sha
    if ! body="$(docker exec "${id}" node -e 'fetch("http://127.0.0.1:4000/health").then(async (r) => { const t = await r.text(); if (!r.ok) { process.stderr.write(t); process.exit(1); } process.stdout.write(t); }).catch((err) => { process.stderr.write(String(err)); process.exit(1); })')"; then
      echo "api container ${id:0:12} /health probe failed" >&2
      return 1
    fi
    sha="$(printf '%s\n' "${body}" | sed -n 's/.*"gitSha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' | head -n 1)"
    if [ "${sha}" != "${expected_sha}" ]; then
      echo "api container ${id:0:12} gitSha='${sha}' expected '${expected_sha}'. body='${body}'" >&2
      return 1
    fi
    echo "Verified new api container gitSha=${sha}"
  }

  confirm_web() {
    local id="$1"
    if ! docker exec "${id}" wget -qO- http://127.0.0.1:8080/healthz >/dev/null; then
      echo "web container ${id:0:12} /healthz probe failed" >&2
      return 1
    fi
    echo "Verified new web container /healthz"
  }

  confirm_new_container() {
    local svc="$1"
    local id="$2"
    local image
    image="$(docker inspect -f '{{.Config.Image}}' "${id}")"
    case "${image}" in
      *:"${image_tag}") ;;
      *)
        echo "new ${svc} container image is ${image}, expected tag ${image_tag}" >&2
        return 1
        ;;
    esac
    case "${svc}" in
      api) confirm_api "${id}" ;;
      web) confirm_web "${id}" ;;
      *)
        echo "unknown service ${svc}" >&2
        return 1
        ;;
    esac
  }

  running_replica_count() {
    local svc="$1"
    local project_name id n
    n=0
    for project_name in cardhub-prod cardhub-staging; do
      while IFS= read -r id; do
        [ -n "${id}" ] || continue
        n=$((n + 1))
      done < <(docker ps -q --filter "label=com.docker.compose.project=${project_name}" --filter "label=com.docker.compose.service=${svc}" 2>/dev/null || true)
    done
    printf '%s\n' "${n}"
  }

  # Scale to 2, wait until the new container is healthy, then stop the old
  # one by ID. Docker DNS for the edge alias lists both containers until the
  # old one is removed. A failed new container is deleted and the old one is
  # left running.
  rollout_service() {
    local svc="$1"
    local before after old_id new_ids new_id n state survivor
    before="$(service_ids "${svc}")"
    n="$(count_lines "${before}")"

    if [ "${n}" -eq 0 ]; then
      echo "Starting ${svc} (no previous container)"
      compose up -d --no-deps "${svc}"
      new_id="$(service_ids "${svc}")"
      if [ "$(count_lines "${new_id}")" -ne 1 ]; then
        echo "expected one ${svc} container after initial start" >&2
        return 1
      fi
      if ! wait_for_container_healthy "${new_id}" "${svc}" || ! confirm_new_container "${svc}" "${new_id}"; then
        discard_container "${new_id}" "${svc}" || true
        return 1
      fi
      return 0
    fi

    if [ "${n}" -ne 1 ]; then
      echo "${svc} has ${n} containers; refusing to scale" >&2
      return 1
    fi
    old_id="${before}"

    n="$(running_replica_count "${svc}")"
    if [ "${n}" -gt 2 ]; then
      echo "Refusing to start another ${svc}: ${n} already running across prod and staging" >&2
      return 1
    fi

    echo "Starting new ${svc} beside ${old_id:0:12}"
    compose up -d --no-deps --scale "${svc}=2" --no-recreate "${svc}"
    after="$(service_ids "${svc}")"
    if ! docker inspect "${old_id}" >/dev/null 2>&1; then
      echo "old ${svc} container disappeared during scale-up" >&2
      return 1
    fi
    state="$(docker inspect -f '{{.State.Status}}' "${old_id}")"
    if [ "${state}" != "running" ]; then
      echo "old ${svc} container is ${state} after scale-up" >&2
      return 1
    fi
    new_ids="$(comm -13 <(printf '%s\n' "${before}") <(printf '%s\n' "${after}") | awk 'NF')"
    if [ "$(count_lines "${new_ids}")" -ne 1 ]; then
      echo "expected one new ${svc} container, found $(count_lines "${new_ids}")" >&2
      if [ -n "${new_ids}" ]; then
        # shellcheck disable=SC2086
        docker rm -f ${new_ids} >/dev/null || true
      fi
      return 1
    fi
    new_id="${new_ids}"

    if ! wait_for_container_healthy "${new_id}" "${svc}" || ! confirm_new_container "${svc}" "${new_id}"; then
      discard_container "${new_id}" "${svc}" || true
      return 1
    fi

    echo "Stopping old ${svc} ${old_id:0:12} (grace ${stop_grace_seconds}s)"
    docker stop -t "${stop_grace_seconds}" "${old_id}" >/dev/null
    docker rm "${old_id}" >/dev/null
    compose up -d --no-deps --scale "${svc}=1" --no-recreate "${svc}"
    survivor="$(compose ps -q "${svc}" | awk 'NF')"
    if [ "$(count_lines "${survivor}")" -ne 1 ] || [ "${survivor}" != "${new_id}" ]; then
      echo "scale-down did not keep the new ${svc} container (survivor='${survivor}')" >&2
      return 1
    fi
    echo "Cut ${svc} over to ${new_id:0:12}"
  }

  public_https_get() {
    local domain path output
    domain="$1"
    path="$2"
    output="$3"

    "${CURL_BIN:-curl}" -fsS --resolve "${domain}:443:127.0.0.1" "https://${domain}${path}" -o "${output}"
  }

  verify_api_health() {
    local domain expected response_file deadline last_body last_sha
    domain="$1"
    expected="$2"
    response_file="$3"
    deadline=$((SECONDS + health_timeout_seconds))
    last_body=""
    last_sha=""

    while [ "${SECONDS}" -lt "${deadline}" ]; do
      if public_https_get "${domain}" "/health" "${response_file}"; then
        last_body="$(cat "${response_file}")"
        last_sha="$(sed -n 's/.*"gitSha"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{40\}\)".*/\1/p' "${response_file}" | head -n 1)"
        if [ "${last_sha}" = "${expected}" ]; then
          echo "Verified ${domain} gitSha=${last_sha}"
          return 0
        fi
      fi
      sleep 5
    done

    echo "Timed out waiting for https://${domain}/health gitSha=${expected}. Last gitSha='${last_sha}', body='${last_body}'" >&2
    return 1
  }

  # Classify the image before rollback is armed and before compose pull
  # or compose up. Old means both split entrypoint files are absent.
  # An incomplete pair is not an old image, even when MIGRATE_DATABASE_URL
  # is empty. A daemon error must not skip migrations and roll the API forward.
  local migrate_database_url api_image entrypoint_rc
  migrate_database_url="$(read_env_file_var "${env_file}" MIGRATE_DATABASE_URL)"
  api_image="ghcr.io/xv-jiaqi/cardhub-api:${image_tag}"
  if ! docker pull "${api_image}"; then
    echo "Failed to pull ${api_image}; the running API was not replaced" >&2
    exit 1
  fi
  entrypoint_rc=0
  probe_split_entrypoint || entrypoint_rc=$?
  if [ "${entrypoint_rc}" -eq 3 ]; then
    echo "Refusing deploy: ${image_tag} has an incomplete split entrypoint pair (one of /usr/local/bin/api-entrypoint.sh or /usr/local/bin/migrate-entrypoint.sh is missing or not executable). The running API was not replaced." >&2
    exit 1
  fi
  if [ "${entrypoint_rc}" -ne 0 ] && [ "${entrypoint_rc}" -ne 10 ]; then
    echo "Refusing deploy: entrypoint probe exited ${entrypoint_rc}, not 0 (both entrypoints executable), 10 (both absent), or 3 (incomplete pair). The running API was not replaced." >&2
    exit 1
  fi
  if [ -n "${migrate_database_url}" ] && [ "${entrypoint_rc}" -eq 10 ]; then
    echo "Refusing deploy: MIGRATE_DATABASE_URL is set, but ${image_tag} is an old image (both split entrypoints are absent)." >&2
    echo "The running API was not replaced. Switch DATABASE_URL back to the admin superuser, clear MIGRATE_DATABASE_URL, then deploy an older image." >&2
    exit 1
  fi
  unset migrate_database_url

  trap on_error ERR
  rollback_armed=1

  compose pull api web
  compose up -d postgres redis
  wait_for_container_healthy "$(service_ids postgres | head -n 1)" postgres
  wait_for_container_healthy "$(service_ids redis | head -n 1)" redis

  # Migrations finish before the API swap. A failure here exits without
  # calling rollback, so the container that is already serving stays up.
  # Images from before the split migrate inside their own command instead.
  if [ "${entrypoint_rc}" -eq 0 ]; then
    echo "Running database migrations before the API rollout"
    if ! compose run --rm -T --no-deps migrate; then
      echo "Migrations failed; the running API was not replaced" >&2
      exit 1
    fi
  else
    echo "Target image has no migrate entrypoint; it migrates inside the API container"
  fi

  # One extra container at a time: finish API before web.
  rollout_service api
  rollout_service web

  local api_domain catalog_seed_cmd
  api_domain="$(awk -F= '$1 == "API_DOMAIN" { print $2 }' "${env_file}" | tail -n 1 | tr -d '\r' | sed 's/^"//; s/"$//')"
  if [ -z "${api_domain}" ]; then
    echo "API_DOMAIN is missing from ${env_file}" >&2
    exit 1
  fi

  tmp="$(mktemp)"

  verify_api_health "${api_domain}" "${expected_sha}" "${tmp}"
  catalog_seed_cmd="$(awk -F= '$1 == "CATALOG_SEED_CMD" { print substr($0, index($0, "=") + 1) }' "${env_file}" | tail -n 1 | tr -d '\r')"
  if [ -n "${catalog_seed_cmd}" ]; then
    echo "Running catalog seed command"
    compose exec -T api sh -c "${catalog_seed_cmd}"
  fi
  rollback_armed=0
  # Only a finished switch may replace the rollback target. Writing this file
  # before the switch made a failed deploy record the version just rolled
  # back to, and the next cleanup then deleted the real previous image.
  record_previous_images
  cleanup_old_images || true
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  main "$@"
fi
