#!/usr/bin/env sh
set -eu

PROJECT="${PROJECT:-cardhub-production}"
ENV_FILE="${ENV_FILE:-/opt/cardhub/production.env}"
COMPOSE_FILE="${COMPOSE_FILE:-/opt/cardhub/deploy/docker-compose.yml}"
BACKUP_DIR="${BACKUP_DIR:-/opt/cardhub/backups/${PROJECT}}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${BACKUP_DIR}/${PROJECT}-${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

docker compose -p "${PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres sh -c \
  'PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}"' \
  | gzip -9 > "${OUT}"

ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | awk 'NR > 7' | xargs -r rm -f

echo "Wrote ${OUT}"
