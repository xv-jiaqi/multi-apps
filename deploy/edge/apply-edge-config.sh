#!/usr/bin/env bash
# Apply the edge files just synced into EDGE_DIR.
#
# A running container keeps the binds it was created with. Mounting Caddyfile
# as a single file pins that inode, so a later tar extract (unlink + create)
# is invisible to Caddy while a directory mount of optional/ is not. Reloading
# then parses the old Caddyfile against the new optional file.
#
# --recreate is the manual recreate_edge checkbox. It always force-recreates
# cardhub-edge-caddy-1, including when the container already sees the synced
# files. caddy validate runs first; a failed validate leaves the running
# container in place. After recreate, this script waits until Docker reports
# healthy, then requires a response from the four site hostnames. A second
# run with the same flag recreates again; named volumes are kept.
# Without --recreate, a container that cannot see the synced files fails
# this script before the app rollout. The running container is not reloaded
# and not recreated. Automatic deploys do not pass --recreate.
set -euo pipefail

edge_dir="${EDGE_DIR:-/opt/cardhub/edge/deploy/edge}"
env_file="${EDGE_ENV_FILE:-/opt/cardhub/edge/edge.env}"
project="${COMPOSE_PROJECT:-cardhub-edge}"
recreate=0
changed=0

while [ $# -gt 0 ]; do
  case "$1" in
    --recreate) recreate=1 ;;
    --changed) changed=1 ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

compose() {
  docker compose -p "$project" --env-file "$env_file" -f "$edge_dir/docker-compose.yml" "$@"
}

manual_hint() {
  local environment image_tag
  environment="${EDGE_ENVIRONMENT:-staging}"
  image_tag="${EDGE_IMAGE_TAG:-sha-<full git sha>}"
  cat <<EOF
Run Cardhub Deploy by hand: Actions → Cardhub Deploy → Run workflow.
Set environment to ${environment}, image tag to ${image_tag}, and recreate_edge to true.
That validates the on-disk Caddyfile, recreates the edge container once, then continues the app deploy.
Until that finishes, do not restart the current Caddy container. A restart reads the stale Caddyfile inode and the proxy does not come back.
EOF
}

# /data is the caddy_data volume, so this directory survives recreate.
# Caddy would create it as mode 0700. Make it first, mode 755, so root on
# the host can read the files after entering the volume. A failure must
# not abort the edge apply; Caddy creates the directory on its own.
ensure_edge_access_log_dir() {
  local id="$1"
  if [ -z "${id}" ]; then
    return 0
  fi
  if ! docker exec "${id}" mkdir -p /data/logs; then
    echo "Warning: could not create /data/logs in edge container ${id}; access logs may be missing" >&2
    return 0
  fi
  if ! docker exec "${id}" chmod 755 /data/logs; then
    echo "Warning: could not chmod /data/logs in edge container ${id}" >&2
  fi
  return 0
}

require_files() {
  if [ ! -f "$env_file" ]; then
    echo "missing edge env file: $env_file" >&2
    exit 1
  fi
  if [ ! -f "$edge_dir/Caddyfile" ]; then
    echo "missing $edge_dir/Caddyfile" >&2
    exit 1
  fi
  if [ ! -f "$edge_dir/docker-compose.yml" ]; then
    echo "missing $edge_dir/docker-compose.yml" >&2
    exit 1
  fi
}

# Prints host and container hashes. Returns 1 when the container cannot see
# the synced file.
file_visible() {
  local id="$1"
  local rel="$2"
  local host ctr
  host="$(sha256sum "$edge_dir/$rel" | awk '{print $1}')"
  if ! ctr="$(docker exec "$id" sha256sum "/etc/caddy/$rel" 2>/dev/null | awk '{print $1}')"; then
    echo "cannot read /etc/caddy/$rel in container ${id}" >&2
    return 1
  fi
  if [ "$host" != "$ctr" ]; then
    echo "stale /etc/caddy/$rel" >&2
    echo "  host      ${host}" >&2
    echo "  container ${ctr}" >&2
    return 1
  fi
  return 0
}

sees_synced_files() {
  local id="$1"
  local ok=0
  local rel
  for rel in Caddyfile optional/root-web.caddy; do
    if [ ! -f "$edge_dir/$rel" ]; then
      continue
    fi
    if ! file_visible "$id" "$rel"; then
      ok=1
    fi
  done
  return "$ok"
}

print_inodes() {
  local id="$1"
  local host_inode ctr_inode
  host_inode="$(stat -c '%i' "$edge_dir/Caddyfile")"
  ctr_inode="$(docker exec "$id" stat -c '%i' /etc/caddy/Caddyfile 2>/dev/null || echo missing)"
  echo "Caddyfile inode host=${host_inode} container=${ctr_inode}"
}

single_file_mount() {
  local id="$1"
  local dest
  while IFS= read -r dest; do
    if [ "$dest" = "/etc/caddy/Caddyfile" ]; then
      return 0
    fi
  done < <(docker inspect -f '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' "$id")
  return 1
}

validate_disk() {
  local image="$1"
  docker run --rm \
    --env-file "$env_file" \
    -v "$edge_dir:/etc/caddy:ro" \
    --entrypoint caddy \
    "$image" \
    validate --config /etc/caddy/Caddyfile --adapter caddyfile
}

wait_healthy() {
  local id="$1"
  local i status health
  local attempts="${EDGE_HEALTH_ATTEMPTS:-90}"
  local pause="${EDGE_HEALTH_SLEEP_SECONDS:-1}"
  for i in $(seq 1 "$attempts"); do
    status="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo missing)"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id" 2>/dev/null || echo missing)"
    if [ "$status" = "running" ] && [ "$health" = "healthy" ]; then
      return 0
    fi
    if [ "$status" = "exited" ] || [ "$status" = "dead" ] || [ "$status" = "missing" ]; then
      return 1
    fi
    sleep "$pause"
  done
  return 1
}

read_edge_env() {
  local key="$1"
  awk -F= -v key="$key" 'BEGIN { value = "" } $1 == key { value = substr($0, index($0, "=") + 1) } END { printf "%s", value }' "$env_file" \
    | tr -d '\r' | sed 's/^"//; s/"$//'
}

# Apex, production API, staging web, staging API. www is a redirect of the
# apex and is not one of these four.
probe_edge_domains() {
  local key value domain attempt code
  local attempts="${EDGE_PROBE_ATTEMPTS:-10}"
  local pause="${EDGE_PROBE_SLEEP_SECONDS:-1}"
  local -a domains=()
  for key in ROOT_WEB_DOMAINS API_DOMAIN STAGING_WEB_DOMAIN STAGING_API_DOMAIN; do
    value="$(read_edge_env "$key")"
    if [[ ! "$value" =~ ^[A-Za-z0-9.-]+$ ]]; then
      echo "edge env ${key} is not a single hostname: ${value:-<empty>}" >&2
      return 1
    fi
    domains+=("$value")
  done
  for domain in "${domains[@]}"; do
    code=""
    for attempt in $(seq 1 "$attempts"); do
      if code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --resolve "${domain}:443:127.0.0.1" "https://${domain}/" 2>/dev/null)"; then
        if [ -n "$code" ] && [ "$code" != "000" ]; then
          echo "Edge domain ${domain} responded ${code}"
          break
        fi
      fi
      code=""
      sleep "$pause"
    done
    if [ -z "$code" ]; then
      echo "Edge domain ${domain} did not respond" >&2
      return 1
    fi
  done
}

reload_running() {
  local id="$1"
  local image
  image="$(docker inspect -f '{{.Config.Image}}' "$id")"
  echo "Validating synced edge files with ${image} before reload"
  if ! validate_disk "$image"; then
    echo "Synced Caddyfile failed validation. The running container was not reloaded." >&2
    exit 1
  fi
  docker exec "$id" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
  echo "Reloaded edge Caddy without recreating it."
}

validate_before_recreate() {
  local image="$1"
  local id="$2"
  local started
  echo "Validating synced edge files with ${image} before recreate"
  if ! validate_disk "$image"; then
    echo "Synced Caddyfile failed validation. The running container was not recreated." >&2
    if [ -n "$id" ]; then
      started="$(docker inspect -f '{{.State.StartedAt}}' "$id" 2>/dev/null || echo unknown)"
      echo "Container ${id} is still the one started at ${started}." >&2
    fi
    exit 1
  fi
}

finish_recreate() {
  local id
  echo "Force-recreating edge Caddy (${project}-caddy-1)"
  if ! compose up -d --no-deps --force-recreate caddy; then
    echo "docker compose up --force-recreate failed. If the previous container is still running, leave it running." >&2
    echo "Recovery once the new files are in place: docker compose -p ${project} --env-file ${env_file} -f ${edge_dir}/docker-compose.yml up -d --force-recreate caddy" >&2
    exit 1
  fi
  id="$(compose ps -q caddy)"
  if [ -z "$id" ] || ! wait_healthy "$id"; then
    echo "Recreated Caddy did not become healthy." >&2
    docker logs --tail 40 "${id}" >&2 || true
    exit 1
  fi
  ensure_edge_access_log_dir "${id}"
  if ! sees_synced_files "$id"; then
    echo "Recreated Caddy still cannot see the synced files." >&2
    print_inodes "$id" >&2
    exit 1
  fi
  print_inodes "$id"
  if ! probe_edge_domains; then
    echo "Recreated Caddy is healthy, but a site hostname did not respond. The workflow fails." >&2
    exit 1
  fi
  echo "Force-recreated edge Caddy. Container ${id} is healthy and the four domains responded."
}

refuse_stale() {
  local id="$1"
  echo "Edge Caddy cannot see the files just synced, and recreate_edge is not set." >&2
  print_inodes "$id" >&2
  if single_file_mount "$id"; then
    echo "The container still bind-mounts /etc/caddy/Caddyfile as a single file." >&2
  fi
  echo "The running process was left as-is: not reloaded, not recreated." >&2
  echo "The app deploy does not continue, so this environment is not rolled out against that edge." >&2
  manual_hint >&2
  exit 1
}

main() {
  local id
  require_files
  id="$(compose ps -q caddy)"
  if [ -n "${id}" ]; then
    ensure_edge_access_log_dir "${id}"
  fi
  if [ -z "$id" ]; then
    if [ "$recreate" -eq 1 ]; then
      echo "No edge Caddy container is running. Validating, then starting one."
      validate_before_recreate "caddy:2-alpine" ""
      finish_recreate
      exit 0
    fi
    echo "No edge Caddy container is running. Skipping edge reload."
    exit 0
  fi

  if sees_synced_files "$id"; then
    if [ "$recreate" -eq 1 ]; then
      echo "recreate_edge is set. The running container already sees the synced files; force-recreating anyway."
      validate_before_recreate "$(docker inspect -f '{{.Config.Image}}' "$id")" "$id"
      finish_recreate
      exit 0
    fi
    if single_file_mount "$id"; then
      echo "WARNING: Caddyfile is still a single-file bind. The bytes match, so a reload can see them, but the next tar extract can desync the inode."
      manual_hint
    fi
    if [ "$changed" -eq 1 ]; then
      reload_running "$id"
    else
      echo "Edge files are unchanged and the running container already sees them. Not reloading."
    fi
    exit 0
  fi

  if [ "$recreate" -eq 1 ]; then
    validate_before_recreate "$(docker inspect -f '{{.Config.Image}}' "$id")" "$id"
    finish_recreate
    exit 0
  fi
  refuse_stale "$id"
}

main
