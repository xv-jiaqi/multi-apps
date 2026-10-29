#!/usr/bin/env bash
# Check a running Cardhub API. Used by CI and locally.
#
# Required:
#   EXPECTED_GIT_SHA   full commit SHA baked into the image
# Optional:
#   API_BASE_URL       default http://127.0.0.1:4000
#   API_CONTAINER      container name; its logs are printed when a check fails
#   REDIS_CONTAINER    container name, or "auto" for redis:7-alpine.
#                      When set, that Redis is stopped and an authenticated
#                      request must finish in under 300ms.
#
# Responses are written to files. Nothing here closes a pipe early.

set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"
EXPECTED_GIT_SHA="${EXPECTED_GIT_SHA:-}"

if [ -z "$EXPECTED_GIT_SHA" ]; then
  echo "EXPECTED_GIT_SHA is required" >&2
  exit 2
fi

export EXPECTED_GIT_SHA
tmpdir=$(mktemp -d)
export CHECK_TMP="$tmpdir"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ] && [ -n "${API_CONTAINER:-}" ]; then
    echo "--- ${API_CONTAINER} logs ---"
    if ! docker logs "$API_CONTAINER" >"${tmpdir}/container-logs.txt" 2>&1; then
      sudo docker logs "$API_CONTAINER" >"${tmpdir}/container-logs.txt" 2>&1 || true
    fi
    if [ -f "${tmpdir}/container-logs.txt" ]; then
      cat "${tmpdir}/container-logs.txt"
    fi
  fi
  rm -rf "$tmpdir"
  exit "$status"
}
trap cleanup EXIT

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

wait_for_health() {
  deadline=$((SECONDS + 60))
  while true; do
    code=$(curl -sS -D "${tmpdir}/health.headers" -o "${tmpdir}/health.body" -w '%{http_code}' --max-time 2 \
      -H 'Origin: https://card-hub.app' \
      "${API_BASE_URL}/health" || true)
    if [ "$code" = "200" ]; then
      return 0
    fi
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "API /health did not return 200 within 60s (last HTTP status: ${code:-none})"
      if [ -s "${tmpdir}/health.body" ]; then
        echo "Last /health body:"
        cat "${tmpdir}/health.body"
      fi
      return 1
    fi
    sleep 2
  done
}

wait_for_health

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

const dir = process.env.CHECK_TMP;
const expectedSha = process.env.EXPECTED_GIT_SHA;
const body = JSON.parse(readFileSync(`${dir}/health.body`, 'utf8'));
const headers = readFileSync(`${dir}/health.headers`, 'utf8');

function header(name) {
  const wanted = name.toLowerCase();
  for (const line of headers.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    if (line.slice(0, index).trim().toLowerCase() === wanted) {
      return line.slice(index + 1).trim();
    }
  }
  return '';
}

const failures = [];
if (body?.status !== 'ok') failures.push(`status ${body?.status}`);
if (body?.services?.db !== true) failures.push('services.db is not true');
if (body?.services?.redis !== true) failures.push('services.redis is not true');
if (body?.gitSha !== expectedSha) {
  failures.push(`gitSha ${body?.gitSha} != ${expectedSha}`);
}
const timing = header('server-timing');
if (!/(?:^|, )app;dur=\d+(?:\.\d+)?(?:,|$)/.test(timing)) {
  failures.push(`Server-Timing missing app duration: ${timing || '(absent)'}`);
}
if (!/(?:^|, )db;dur=\d+(?:\.\d+)?(?:,|$)/.test(timing)) {
  failures.push(`Server-Timing missing db duration: ${timing || '(absent)'}`);
}
if (!/(?:^|, )cache;dur=\d+(?:\.\d+)?(?:,|$)/.test(timing)) {
  failures.push(`Server-Timing missing cache duration: ${timing || '(absent)'}`);
}
const leaked = ['SELECT', 'prisma', 'desc=', 'cardhub:', expectedSha].filter(
  (needle) => needle && timing.includes(needle),
);
if (leaked.length > 0) {
  failures.push(`Server-Timing contains ${leaked.join(', ')}: ${timing}`);
}
const allow = header('timing-allow-origin');
if (allow !== 'https://card-hub.app') {
  failures.push(`Timing-Allow-Origin ${allow || '(absent)'}`);
}
if (allow === '*') failures.push('Timing-Allow-Origin must not be *');

if (failures.length > 0) {
  console.error(failures.join('\n'));
  console.error(JSON.stringify(body));
  process.exit(1);
}
console.log(`health ok gitSha=${body.gitSha} server-timing=${timing}`);
JS

code=$(curl -sS -D "${tmpdir}/preflight.headers" -o "${tmpdir}/preflight.body" -w '%{http_code}' --max-time 5 \
  -X OPTIONS \
  -H 'Origin: https://card-hub.app' \
  -H 'Access-Control-Request-Method: GET' \
  "${API_BASE_URL}/health" || true)
if [ "$code" != "204" ] && [ "$code" != "200" ]; then
  echo "preflight returned ${code:-none}, expected 204"
  cat "${tmpdir}/preflight.body"
  exit 1
fi

code=$(curl -sS -D "${tmpdir}/evil.headers" -o "${tmpdir}/evil.body" -w '%{http_code}' --max-time 5 \
  -X OPTIONS \
  -H 'Origin: https://evil.example' \
  -H 'Access-Control-Request-Method: GET' \
  "${API_BASE_URL}/health" || true)

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

function headerFile(file, name) {
  const headers = readFileSync(file, 'utf8');
  const wanted = name.toLowerCase();
  for (const line of headers.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    if (line.slice(0, index).trim().toLowerCase() === wanted) {
      return line.slice(index + 1).trim();
    }
  }
  return '';
}

const dir = process.env.CHECK_TMP;
const allowed = headerFile(`${dir}/preflight.headers`, 'timing-allow-origin');
const allowedCors = headerFile(`${dir}/preflight.headers`, 'access-control-allow-origin');
if (allowed !== 'https://card-hub.app' || allowedCors !== 'https://card-hub.app') {
  console.error(`preflight Timing-Allow-Origin ${allowed || '(absent)'}`);
  process.exit(1);
}
if (allowed === '*') {
  console.error('Timing-Allow-Origin must not be *');
  process.exit(1);
}
const rejected = headerFile(`${dir}/evil.headers`, 'timing-allow-origin');
if (rejected !== '') {
  console.error(`disallowed origin received Timing-Allow-Origin ${rejected}`);
  process.exit(1);
}
console.log('preflight Timing-Allow-Origin ok');
JS

if [ -n "${API_CONTAINER:-}" ]; then
  docker_cmd exec "$API_CONTAINER" sh -c 'tr "\0" "\n" < /proc/1/environ' >"${tmpdir}/environ"
  if grep -F 'MIGRATE_DATABASE_URL=' "${tmpdir}/environ" >/dev/null; then
    echo "API PID 1 environment contains MIGRATE_DATABASE_URL"
    exit 1
  fi
fi

node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
writeFileSync(`${process.env.CHECK_TMP}/large.json`, `{"pad":"${'x'.repeat(120_000)}"}`);
JS

code=$(curl -sS -D "${tmpdir}/large.headers" -o "${tmpdir}/large.body" -w '%{http_code}' --max-time 10 \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://card-hub.app' \
  --data-binary @"${tmpdir}/large.json" \
  "${API_BASE_URL}/trpc/collection.upsert" || true)
if [ "$code" != "413" ]; then
  echo "oversized body returned ${code:-none}, expected 413"
  cat "${tmpdir}/large.body"
  exit 1
fi

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

function headerValue(file, name) {
  const headers = readFileSync(file, 'utf8');
  const wanted = name.toLowerCase();
  for (const line of headers.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    if (line.slice(0, index).trim().toLowerCase() === wanted) {
      return line.slice(index + 1).trim();
    }
  }
  return '';
}

const dir = process.env.CHECK_TMP;
const timing = headerValue(`${dir}/large.headers`, 'server-timing');
const body = readFileSync(`${dir}/large.body`, 'utf8');
if (!/(?:^|, )app;dur=\d+(?:\.\d+)?(?:,|$)/.test(timing)) {
  console.error(`413 response missing Server-Timing: ${timing || '(absent)'}`);
  process.exit(1);
}
for (const needle of ['SyntaxError', 'ZodError', 'prisma', 'Unexpected token', 'entity.too.large']) {
  if (body.includes(needle) || timing.includes(needle)) {
    console.error(`413 response leaked ${needle}`);
    process.exit(1);
  }
}
if (!body.includes('PAYLOAD_TOO_LARGE')) {
  console.error('413 response missing PAYLOAD_TOO_LARGE');
  process.exit(1);
}
console.log('413 PAYLOAD_TOO_LARGE');
JS

printf '%s' '{"content":"LEAK_MARKER"' >"${tmpdir}/bad.json"
code=$(curl -sS -D "${tmpdir}/bad.headers" -o "${tmpdir}/bad.body" -w '%{http_code}' --max-time 10 \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://card-hub.app' \
  --data-binary @"${tmpdir}/bad.json" \
  "${API_BASE_URL}/trpc/comments.create" || true)
if [ "$code" != "400" ]; then
  echo "bad JSON returned ${code:-none}, expected 400"
  cat "${tmpdir}/bad.body"
  exit 1
fi

node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

function headerValue(file, name) {
  const headers = readFileSync(file, 'utf8');
  const wanted = name.toLowerCase();
  for (const line of headers.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    if (line.slice(0, index).trim().toLowerCase() === wanted) {
      return line.slice(index + 1).trim();
    }
  }
  return '';
}

const dir = process.env.CHECK_TMP;
const timing = headerValue(`${dir}/bad.headers`, 'server-timing');
const body = readFileSync(`${dir}/bad.body`, 'utf8');
if (!/(?:^|, )app;dur=\d+(?:\.\d+)?(?:,|$)/.test(timing)) {
  console.error(`400 response missing Server-Timing: ${timing || '(absent)'}`);
  process.exit(1);
}
for (const needle of ['LEAK_MARKER', 'SyntaxError', 'ZodError', 'prisma', 'Unexpected token', 'entity.too.large']) {
  if (body.includes(needle) || timing.includes(needle)) {
    console.error(`400 response leaked ${needle}`);
    process.exit(1);
  }
}
if (!body.includes('PARSE_ERROR')) {
  console.error('400 response missing PARSE_ERROR');
  process.exit(1);
}
console.log('400 PARSE_ERROR');
JS

if [ -n "${REDIS_CONTAINER:-}" ]; then
  od -An -N3 -tx1 /dev/urandom >"${tmpdir}/rand"
  suffix=$(tr -d ' \n' <"${tmpdir}/rand")
  username="img${suffix}"
  node --input-type=module <<JS
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.CHECK_TMP + '/register.json', JSON.stringify({
  email: '${username}@cardhub.test',
  username: '${username}',
  password: 'collection-password',
}));
JS
  code=$(curl -sS -D "${tmpdir}/register.headers" -o "${tmpdir}/register.body" -w '%{http_code}' --max-time 10 \
    -H 'Content-Type: application/json' \
    --data-binary @"${tmpdir}/register.json" \
    "${API_BASE_URL}/trpc/auth.register" || true)
  if [ "$code" != "200" ]; then
    echo "register returned ${code:-none}"
    cat "${tmpdir}/register.body"
    exit 1
  fi

  if [ "$REDIS_CONTAINER" = "auto" ]; then
    docker_cmd ps -q --filter ancestor=redis:7-alpine >"${tmpdir}/redis-ids"
  else
    printf '%s\n' "$REDIS_CONTAINER" >"${tmpdir}/redis-ids"
  fi
  stopped=0
  while IFS= read -r redis_id; do
    if [ -n "$redis_id" ]; then
      docker_cmd stop "$redis_id" >/dev/null
      stopped=$((stopped + 1))
    fi
  done <"${tmpdir}/redis-ids"
  if [ "$stopped" -lt 1 ]; then
    echo "REDIS_CONTAINER is set but no redis container was stopped"
    exit 1
  fi

  node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const dir = process.env.CHECK_TMP;
const body = JSON.parse(readFileSync(`${dir}/register.body`, 'utf8'));
const token = body?.result?.data?.token;
if (typeof token !== 'string' || token.length < 20) {
  console.error('register response did not include a token');
  process.exit(1);
}
writeFileSync(`${dir}/token`, token);
JS

  seconds=$(curl -sS -D "${tmpdir}/authed.headers" -o "${tmpdir}/authed.body" -w '%{time_total}' --max-time 5 \
    -H "Authorization: Bearer $(cat "${tmpdir}/token")" \
    "${API_BASE_URL}/trpc/collection.list?input=%7B%22limit%22%3A20%7D" || true)
  export CHECK_SECONDS="$seconds"
  node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';

const seconds = Number(process.env.CHECK_SECONDS);
const headers = readFileSync(`${process.env.CHECK_TMP}/authed.headers`, 'utf8');
const statusLine = headers.split(/\r?\n/)[0] ?? '';
const match = statusLine.match(/\s(\d{3})\b/);
const status = match ? Number(match[1]) : 0;
if (!Number.isFinite(seconds) || !(seconds < 0.3)) {
  console.error(`authenticated request after redis stop took ${seconds}s`);
  process.exit(1);
}
if (status !== 200) {
  console.error(`authenticated request after redis stop returned ${status}`);
  console.error(readFileSync(`${process.env.CHECK_TMP}/authed.body`, 'utf8').slice(0, 500));
  process.exit(1);
}
console.log(`redis down authenticated request ${seconds}s`);
JS
fi

echo "api image checks passed"
