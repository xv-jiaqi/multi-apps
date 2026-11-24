#!/usr/bin/env bash
# The boot checks stay inside the jobs that already build the images.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
python3 - "$root" <<'PY'
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
ci = (root / ".github/workflows/ci.yml").read_text()
images = (root / ".github/workflows/images.yml").read_text()

def between(text, start, end):
    at = text.find(start)
    if at < 0:
        sys.exit(f"missing {start!r}")
    if end is None:
        return text[at:]
    stop = text.find(end, at + len(start))
    if stop < 0:
        sys.exit(f"missing {end!r} after {start!r}")
    return text[at:stop]

def require(label, blob, needles):
    cursor = 0
    for needle in needles:
        found = blob.find(needle, cursor)
        if found < 0:
            sys.exit(f"{label} missing {needle!r}")
        cursor = found + len(needle)

api = between(ci, "  api-image:", "  web-image:")
web = between(ci, "  web-image:", None)
require(
    "ci api job",
    api,
    [
        "push: false",
        "tags: cardhub-api:ci",
        "- name: Boot API image",
        "openssl rand -hex 32",
        "cardhub-api:ci",
        "bash scripts/check-api-health.sh",
        "- name: Check API image",
        "bash scripts/check-api-image.sh",
    ],
)
if "secrets." in api[api.find("- name: Boot API image") : api.find("- name: Check API image")]:
    sys.exit("API boot step references secrets")
if api.find("bash scripts/check-api-health.sh") > api.find("bash scripts/check-api-image.sh"):
    sys.exit("API health boot must run before the deeper image check")

require(
    "ci web job",
    web,
    [
        "push: false",
        "tags: cardhub-web:ci",
        "- name: Boot Web image",
        "docker run -d --name \"$name\" -p 127.0.0.1:8080:8080",
        "TRPC_URL=http://127.0.0.1:4000/trpc",
        "cardhub-web:ci",
        "bash scripts/check-web-image.sh",
    ],
)
# Only the boot step itself must stay secret-free and must not push.
# Later steps may read SENTRY_AUTH_TOKEN to upload maps (CH-247).
def first_step(blob, name):
    start = blob.find(name)
    if start < 0:
        sys.exit(f"missing {name!r}")
    nxt = blob.find("\n      - name:", start + len(name))
    return blob[start:] if nxt < 0 else blob[start:nxt]

boot_web = first_step(web, "- name: Boot Web image")
if "secrets." in boot_web or "docker push" in boot_web:
    sys.exit("Web boot step pushes or references secrets")
require(
    "ci web sentry upload",
    web,
    [
        "bash scripts/check-web-image.sh",
        "- name: Export Web source maps",
        "target: sourcemaps",
        "- name: Upload Sentry source maps",
        "secrets.SENTRY_AUTH_TOKEN",
        "bash apps/cardhub/web/scripts/upload-sentry-sourcemaps.sh",
    ],
)

build = between(images, "      - name: Build and push", "      - name: Boot")
boot = between(images, "      - name: Boot", "      - name: Export Web source maps")
upload = between(images, "      - name: Export Web source maps", "      - name: Record image digest")
record = between(images, "      - name: Record image digest", "      - name: Upload image digest")
require(
    "images build",
    build,
    [
        "id: build",
        "push: true",
        "${{ matrix.image }}:sha-${{ github.event.workflow_run.head_sha }}",
        "${{ matrix.image }}:main",
    ],
)
require(
    "images boot",
    boot,
    [
        'docker pull "${IMAGE}@${DIGEST}"',
        "migrate-entrypoint.sh",
        "openssl rand -hex 32",
        "bash scripts/check-api-health.sh",
        "bash scripts/check-web-image.sh",
    ],
)
if "docker push" in boot or "secrets." in boot or "push: true" in boot:
    sys.exit("Images boot step must not push or read secrets")
require(
    "images sentry upload",
    upload,
    [
        "if: matrix.name == 'web'",
        "target: sourcemaps",
        "secrets.SENTRY_AUTH_TOKEN",
        "bash apps/cardhub/web/scripts/upload-sentry-sourcemaps.sh",
    ],
)
if "image: postgres:16-alpine" not in images or "image: redis:7-alpine" not in images:
    sys.exit("Images job is missing Postgres or Redis services")
require(
    "images digest",
    record,
    [
        "DIGEST: ${{ steps.build.outputs.digest }}",
        'printf \'%s\\n\' "${DIGEST}" > "${RUNNER_TEMP}/image-digest/digest"',
    ],
)
print("OK image boot checks stay in the build jobs")
PY
