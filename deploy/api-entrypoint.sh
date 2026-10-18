#!/bin/sh
# Long-running API process.
#
# Migrations run in the one-shot migrate container
# (deploy/migrate-entrypoint.sh). That container is the only one that
# receives MIGRATE_DATABASE_URL. This process keeps DATABASE_URL, the
# runtime credential.
#
# `exec` replaces the shell so node is tini's child. Compose `init: true`
# makes tini PID 1 and forwards SIGTERM. Unsetting MIGRATE_DATABASE_URL here
# would not be enough: tini is the same uid and keeps the container
# environment in /proc/1/environ. The variable must not be injected at all.

set -eu

if [ -n "${MIGRATE_DATABASE_URL-}" ]; then
  echo "Refusing to start: MIGRATE_DATABASE_URL must not be set on the API container" >&2
  exit 1
fi

if [ -z "${DATABASE_URL-}" ]; then
  echo "DATABASE_URL is required to start the API" >&2
  exit 1
fi

exec node dist/main.js
