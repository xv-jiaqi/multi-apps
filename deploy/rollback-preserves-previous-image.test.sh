#!/usr/bin/env bash
# After an automatic rollback, the previous image recorded by the last
# successful switch must still be the cleanup keep reason.
#
# Seed previous-images.env with a true previous tag that no container is
# running. Deploy a healthy release (it has no prior sha- containers, so it
# must not rewrite that file). Then deploy a crashing release. Rollback has
# to exit non-zero and leave the seeded file alone. A later dry-run of the
# real image-cleanup.sh must KEEP that tag because it is the previous image,
# not delete it.
#
# The copy of image-cleanup.sh that remote-deploy.sh invokes is a no-op.
# This script never runs the real cleanup without --dry-run.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
real_docker="$(command -v docker)"
if ! "${real_docker}" info >/dev/null 2>&1; then
  echo "docker is not available" >&2
  exit 1
fi

GOOD="$(printf '1%.0s' {1..40})"
BAD="$(printf '2%.0s' {1..40})"
TRUE_PREV="$(printf '3%.0s' {1..40})"

lab="$(mktemp -d /tmp/cardhub-rollback-prev.XXXXXX)"
bin="${lab}/bin"
app="${lab}/staging/deploy"
state="${lab}/staging/.deploy-state"
mkdir -p "${bin}" "${app}" "${state}" "${lab}/context/api" "${lab}/context/web" "${lab}/context/bad"

cleanup() {
  local rc=$?
  (
    cd "${app}" 2>/dev/null || exit 0
    ENV_NAME=staging IMAGE_TAG="sha-${GOOD}" \
      "${real_docker}" compose -p cardhub-staging --env-file "${lab}/staging/staging.env" -f "${app}/docker-compose.yml" \
      down -v --remove-orphans >/dev/null 2>&1 || true
  )
  "${real_docker}" image rm -f \
    "ghcr.io/xv-jiaqi/cardhub-api:sha-${GOOD}" \
    "ghcr.io/xv-jiaqi/cardhub-web:sha-${GOOD}" \
    "ghcr.io/xv-jiaqi/cardhub-api:sha-${BAD}" \
    "ghcr.io/xv-jiaqi/cardhub-web:sha-${BAD}" \
    "ghcr.io/xv-jiaqi/cardhub-api:sha-${TRUE_PREV}" \
    "ghcr.io/xv-jiaqi/cardhub-web:sha-${TRUE_PREV}" \
    >/dev/null 2>&1 || true
  rm -rf "${lab}"
  exit "${rc}"
}
trap cleanup EXIT

# Drop a leftover lab project so replica limits do not trip on this VM.
leftovers="$("${real_docker}" ps -aq --filter label=com.docker.compose.project=cardhub-staging || true)"
if [ -n "${leftovers}" ]; then
  # shellcheck disable=SC2086
  "${real_docker}" rm -f ${leftovers} >/dev/null
fi

if ! "${real_docker}" network inspect edge >/dev/null 2>&1; then
  "${real_docker}" network create edge >/dev/null
fi

cat > "${bin}/docker" <<EOF
#!/bin/bash
# The lab images are already built locally. A bare \`docker pull\` of the
# ghcr.io tag must not reach GHCR.
if [ "\${1:-}" = "pull" ]; then
  exit 0
fi
if [ "\${1:-}" = "compose" ]; then
  for arg in "\$@"; do
    if [ "\${arg}" = "pull" ]; then
      exit 0
    fi
  done
fi
exec ${real_docker} "\$@"
EOF
chmod +x "${bin}/docker"

cat > "${bin}/curl" <<EOF
#!/bin/bash
output=""
previous=""
for arg in "\$@"; do
  if [ "\${previous}" = "-o" ]; then
    output="\${arg}"
  fi
  previous="\${arg}"
done
if [ -z "\${output}" ]; then
  echo "lab curl stub expected -o <file>" >&2
  exit 1
fi
ids="\$(${real_docker} ps -q --filter label=com.docker.compose.project=cardhub-staging --filter label=com.docker.compose.service=api)"
id="\${ids%%\$'\n'*}"
if [ -z "\${id}" ]; then
  echo "lab curl stub found no staging api container" >&2
  exit 1
fi
${real_docker} exec "\${id}" node -e 'fetch("http://127.0.0.1:4000/health").then(async (r) => { const t = await r.text(); if (!r.ok) process.exit(1); process.stdout.write(t); })' > "\${output}"
EOF
chmod +x "${bin}/curl"

cat > "${app}/image-cleanup.sh" <<'EOF'
#!/bin/sh
echo "lab noop image cleanup; real tags are not deleted"
exit 0
EOF
chmod +x "${app}/image-cleanup.sh"

sed -E \
  -e 's/interval: 30s/interval: 1s/g' \
  -e 's/interval: 10s/interval: 1s/g' \
  -e 's/start_period: 45s/start_period: 1s/g' \
  -e 's/start_period: 20s/start_period: 1s/g' \
  -e 's/start_period: 10s/start_period: 1s/g' \
  "${repo}/deploy/docker-compose.yml" > "${app}/docker-compose.yml"

cat > "${lab}/staging/staging.env" <<'EOF'
NODE_ENV=production
ENV_NAME=staging
DATABASE_URL=postgresql://cardhub:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef@postgres:5432/cardhub_staging?schema=public
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=lab-redis-password
JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://staging.card-hub.app
SENTRY_DSN=
WEB_SENTRY_DSN=
SENTRY_ENVIRONMENT=staging
SENTRY_TRACES_SAMPLE_RATE=0
WEB_DOMAIN=staging.card-hub.app
API_DOMAIN=api-staging.card-hub.app
TRPC_URL=https://api-staging.card-hub.app/trpc
POSTGRES_USER=cardhub
POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
POSTGRES_DB=cardhub_staging
CATALOG_SEED_CMD=
IMAGE_TAG=sha-0000000000000000000000000000000000000000
EOF

cat > "${lab}/context/api/server.js" <<'EOF'
const http = require('http');
const sha = process.env.GIT_SHA || '';
http.createServer((req, res) => {
  if ((req.url || '').split('?')[0] === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', gitSha: sha }));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(4000, '0.0.0.0');
EOF

cat > "${lab}/context/api/Dockerfile" <<'EOF'
FROM node:22-alpine
WORKDIR /app
COPY server.js /app/server.js
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
EXPOSE 4000
CMD ["node", "/app/server.js"]
EOF

cat > "${lab}/context/web/default.conf" <<'EOF'
server {
  listen 8080;
  location /healthz {
    default_type text/plain;
    return 200 'ok\n';
  }
}
EOF

cat > "${lab}/context/web/Dockerfile" <<'EOF'
FROM nginx:alpine
COPY default.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
EOF

cat > "${lab}/context/bad/Dockerfile.api" <<'EOF'
FROM node:22-alpine
CMD ["node", "-e", "process.exit(1)"]
EOF

cat > "${lab}/context/bad/Dockerfile.web" <<'EOF'
FROM nginx:alpine
CMD ["sh", "-c", "exit 1"]
EOF

echo "building lab images"
"${real_docker}" build -t "ghcr.io/xv-jiaqi/cardhub-api:sha-${GOOD}" \
  --build-arg "GIT_SHA=${GOOD}" "${lab}/context/api" >/dev/null
"${real_docker}" build -t "ghcr.io/xv-jiaqi/cardhub-web:sha-${GOOD}" \
  "${lab}/context/web" >/dev/null
"${real_docker}" build -t "ghcr.io/xv-jiaqi/cardhub-api:sha-${BAD}" \
  -f "${lab}/context/bad/Dockerfile.api" "${lab}/context/bad" >/dev/null
"${real_docker}" build -t "ghcr.io/xv-jiaqi/cardhub-web:sha-${BAD}" \
  -f "${lab}/context/bad/Dockerfile.web" "${lab}/context/bad" >/dev/null
# Unused image id: not the GOOD or BAD image, so cleanup cannot keep it
# just because a cardhub container is running that id.
"${real_docker}" pull -q alpine:3.20 >/dev/null
"${real_docker}" tag alpine:3.20 "ghcr.io/xv-jiaqi/cardhub-api:sha-${TRUE_PREV}"
"${real_docker}" tag alpine:3.20 "ghcr.io/xv-jiaqi/cardhub-web:sha-${TRUE_PREV}"

cat > "${state}/previous-images.env" <<EOF
# Seeded true previous from the last successful switch.
PREVIOUS_API_TAG=sha-${TRUE_PREV}
PREVIOUS_WEB_TAG=sha-${TRUE_PREV}
EOF

unset PASSWORD_PREHASH_WRITE
unset WEB_SENTRY_DSN
export PATH="${bin}:${PATH}"
export CARDHUB_ROOT="${lab}"
export CARDHUB_HEALTH_TIMEOUT_SECONDS=120
export CARDHUB_STOP_GRACE_SECONDS=5
export CURL_BIN="${bin}/curl"

echo "deploying healthy release ${GOOD}"
good_log="${lab}/good.log"
if ! bash "${repo}/deploy/remote-deploy.sh" staging "sha-${GOOD}" "${GOOD}" >"${good_log}" 2>&1; then
  echo "FAIL healthy deploy exited non-zero" >&2
  cat "${good_log}" >&2
  exit 1
fi
if grep -q "PREVIOUS_API_TAG=sha-${GOOD}" "${state}/previous-images.env"; then
  echo "FAIL healthy deploy rewrote previous-images.env to the new tag" >&2
  cat "${state}/previous-images.env" >&2
  exit 1
fi
if ! grep -qx "PREVIOUS_API_TAG=sha-${TRUE_PREV}" "${state}/previous-images.env"; then
  echo "FAIL healthy deploy clobbered the seeded previous api tag" >&2
  cat "${state}/previous-images.env" >&2
  exit 1
fi
echo "OK healthy deploy left the seeded previous image in place"

echo "deploying crashing release ${BAD}"
bad_log="${lab}/bad.log"
set +e
bash "${repo}/deploy/remote-deploy.sh" staging "sha-${BAD}" "${BAD}" >"${bad_log}" 2>&1
bad_rc=$?
set -e
if [ "${bad_rc}" -eq 0 ]; then
  echo "FAIL crashing deploy exited 0" >&2
  cat "${bad_log}" >&2
  exit 1
fi
if ! grep -q "Rolling back staging to sha-${GOOD}" "${bad_log}"; then
  echo "FAIL crashing deploy did not roll back" >&2
  cat "${bad_log}" >&2
  exit 1
fi
if grep -q "PREVIOUS_API_TAG=sha-${GOOD}" "${state}/previous-images.env" \
  || grep -q "PREVIOUS_WEB_TAG=sha-${GOOD}" "${state}/previous-images.env" \
  || grep -q "PREVIOUS_API_TAG=sha-${BAD}" "${state}/previous-images.env"; then
  echo "FAIL rollback rewrote previous-images.env to the current or failed tag" >&2
  cat "${state}/previous-images.env" >&2
  exit 1
fi
if ! grep -qx "PREVIOUS_API_TAG=sha-${TRUE_PREV}" "${state}/previous-images.env" \
  || ! grep -qx "PREVIOUS_WEB_TAG=sha-${TRUE_PREV}" "${state}/previous-images.env"; then
  echo "FAIL rollback did not preserve the true previous tags" >&2
  cat "${state}/previous-images.env" >&2
  exit 1
fi
echo "OK rollback exited ${bad_rc} and preserved previous-images.env"

cleanup_log="${lab}/cleanup.log"
bash "${repo}/deploy/image-cleanup.sh" --dry-run --root "${lab}" >"${cleanup_log}"
for repo_name in cardhub-api cardhub-web; do
  ref="ghcr.io/xv-jiaqi/${repo_name}:sha-${TRUE_PREV}"
  if grep -q "DRY-RUN DELETE ${ref}" "${cleanup_log}"; then
    echo "FAIL cleanup would delete the true previous image ${ref}" >&2
    cat "${cleanup_log}" >&2
    exit 1
  fi
  keep="$(grep "KEEP ${ref} " "${cleanup_log}" || true)"
  if [ -z "${keep}" ] || ! grep -q 'previous' <<< "${keep}"; then
    echo "FAIL cleanup did not keep ${ref} as a previous image" >&2
    echo "line=${keep}" >&2
    cat "${cleanup_log}" >&2
    exit 1
  fi
  echo "OK ${keep}"
done

echo "rollback preserves the true previous image through cleanup"
