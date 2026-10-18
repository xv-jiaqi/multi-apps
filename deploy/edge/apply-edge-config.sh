#!/usr/bin/env bash
# Apply the edge files just synced into EDGE_DIR.
#
# A running container keeps the binds it was created with. Mounting Caddyfile
# as a single file pins that inode, so a later tar extract (unlink + create)
# is invisible to Caddy while a directory mount of optional/ is not. Reloading
# then parses the old Caddyfile against the new optional file.
#
# Recreating the container is the way off that mount, and it drops every
# domain for a few seconds. That happens only with --recreate, which the
# deploy workflow passes solely for a manual run with recreate_edge=true.
# Without it, a container that cannot see the synced files fails this script
# before the app rollout. The running container is not reloaded and not
# recreated.
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

wait_ready() {
  local id="$1"
  local i status
  for i in $(seq 1 30); do
    status="$(docker inspect -f '{{.State.Status}}' "$id" 2>/dev/null || echo missing)"
    if [ "$status" = "running" ]; then
      if docker exec "$id" wget -qO- http://127.0.0.1:2019/config/ >/dev/null 2>&1; then
        return 0
      fi
    elif [ "$status" = "exited" ] || [ "$status" = "dead" ] || [ "$status" = "missing" ]; then
      return 1
    fi
    sleep 1
  done
  return 1
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

recreate_running() {
  local id="$1"
  local image started
  image="$(docker inspect -f '{{.Config.Image}}' "$id")"
  started="$(docker inspect -f '{{.State.StartedAt}}' "$id")"
  echo "Validating synced edge files with ${image} before recreate"
  if ! validate_disk "$image"; then
    echo "Synced Caddyfile failed validation. The running container was not recreated." >&2
    echo "Container ${id} is still the one started at ${started}." >&2
    exit 1
  fi
  echo "Recreating edge Caddy so it bind-mounts ${edge_dir} at /etc/caddy"
  if ! compose up -d --no-deps caddy; then
    echo "docker compose up failed. If the previous container is still running, leave it running." >&2
    echo "Recovery once the new files are in place: docker compose -p ${project} --env-file ${env_file} -f ${edge_dir}/docker-compose.yml up -d caddy" >&2
    exit 1
  fi
  id="$(compose ps -q caddy)"
  if [ -z "$id" ] || ! wait_ready "$id"; then
    echo "Recreated Caddy did not become ready." >&2
    docker logs --tail 40 "$id" >&2 || true
    echo "The on-disk config validated. Retry: docker compose -p ${project} --env-file ${env_file} -f ${edge_dir}/docker-compose.yml up -d caddy" >&2
    exit 1
  fi
  if ! sees_synced_files "$id"; then
    echo "Recreated Caddy still cannot see the synced files." >&2
    print_inodes "$id" >&2
    exit 1
  fi
  print_inodes "$id"
  echo "Recreated edge Caddy. Container ${id} is serving the synced files."
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
  if [ -z "$id" ]; then
    if [ "$recreate" -eq 1 ]; then
      echo "No edge Caddy container is running. Validating, then starting one."
      validate_disk "caddy:2-alpine"
      compose up -d --no-deps caddy
      id="$(compose ps -q caddy)"
      wait_ready "$id"
      print_inodes "$id"
      echo "Started edge Caddy. Container ${id} is serving the synced files."
      exit 0
    fi
    echo "No edge Caddy container is running. Skipping edge reload."
    exit 0
  fi

  if sees_synced_files "$id"; then
    if single_file_mount "$id"; then
      echo "WARNING: Caddyfile is still a single-file bind. The bytes match, so a reload can see them, but the next tar extract can desync the inode."
      manual_hint
    fi
    if [ "$recreate" -eq 1 ]; then
      echo "recreate_edge is set, but the running container already sees the synced files. Not recreating."
    fi
    if [ "$changed" -eq 1 ]; then
      reload_running "$id"
    else
      echo "Edge files are unchanged and the running container already sees them. Not reloading."
    fi
    exit 0
  fi

  if [ "$recreate" -eq 1 ]; then
    recreate_running "$id"
    exit 0
  fi
  refuse_stale "$id"
}

main
