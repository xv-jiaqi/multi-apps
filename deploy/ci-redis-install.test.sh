#!/usr/bin/env bash
# Installing redis-server must not leave policy-rc.d in place, or later apt
# installs in the same job refuse to start services.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
workflow="${root}/.github/workflows/ci.yml"

python3 - "${workflow}" <<'PY'
import pathlib
import sys

text = pathlib.Path(sys.argv[1]).read_text()
marker = "Install redis-server for the reconnect purge test"
start = text.find(marker)
if start < 0:
    sys.exit("missing redis-server install step")
rest = text[start:]
next_step = rest.find("\n      - name:", 1)
block = rest if next_step < 0 else rest[:next_step]
install_at = block.find("apt-get install -y redis-server")
remove_at = block.find("rm -f /usr/sbin/policy-rc.d")
if install_at < 0 or remove_at < 0 or remove_at < install_at:
    sys.exit("policy-rc.d must be removed after redis-server is installed")
print("OK redis-server install removes policy-rc.d")
PY
