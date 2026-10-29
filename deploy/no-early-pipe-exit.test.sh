#!/usr/bin/env bash
# Under set -o pipefail, a reader that exits before EOF delivers SIGPIPE
# (141) to the writer. A pipe inside double quotes still counts when it is
# inside $(...) or backticks. deploy shell must not pipe into grep -q,
# grep -m, head, sed q, or an awk that exits before END.
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"

python3 - "$root" << 'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])

def tokenize(segment):
    toks = []
    buf = []
    quote = None
    i = 0
    while i < len(segment):
        c = segment[i]
        if quote:
            buf.append(c)
            if c == quote:
                quote = None
            i += 1
            continue
        if c in ("'", '"'):
            quote = c
            buf.append(c)
            i += 1
            continue
        if c in " \t\n":
            if buf:
                toks.append("".join(buf))
                buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    if buf:
        toks.append("".join(buf))
    return toks

def unquote(tok):
    if len(tok) >= 2 and tok[0] == tok[-1] and tok[0] in ("'", '"'):
        return tok[1:-1]
    return tok

def grep_flagged(args):
    quiet = False
    limited = False
    for arg in args:
        if arg == "--":
            break
        if arg in ("--quiet", "--silent"):
            quiet = True
            continue
        if arg == "--max-count" or arg.startswith("--max-count="):
            limited = True
            continue
        if arg.startswith("--"):
            continue
        if arg.startswith("-"):
            flags = arg[1:]
            if "q" in flags:
                quiet = True
            if "m" in flags:
                limited = True
    if quiet:
        return "grep -q closes the pipe on the first match"
    if limited:
        return "grep -m closes the pipe after the match limit"
    return None

def awk_program(args):
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-v", "-F", "-f"):
            i += 2
            continue
        if arg.startswith("-v") or arg.startswith("-F") or arg.startswith("-f"):
            i += 1
            continue
        if arg == "--":
            return unquote(args[i + 1]) if i + 1 < len(args) else None
        if arg.startswith("-"):
            i += 1
            continue
        return unquote(arg)
    return None

def strip_end_blocks(program):
    out = []
    i = 0
    while True:
        match = re.search(r"\bEND\b", program[i:])
        if not match:
            out.append(program[i:])
            break
        out.append(program[i:i + match.start()])
        j = i + match.end()
        while j < len(program) and program[j].isspace():
            j += 1
        if j < len(program) and program[j] == "{":
            depth = 0
            while j < len(program):
                if program[j] == "{":
                    depth += 1
                elif program[j] == "}":
                    depth -= 1
                    if depth == 0:
                        j += 1
                        break
                j += 1
            i = j
        else:
            i = j
    return "".join(out)

def strip_sed_substitutions(script):
    out = []
    i = 0
    n = len(script)
    while i < n:
        if script[i] in "sy" and i + 1 < n and script[i + 1] not in " \t\n;":
            delim = script[i + 1]
            i += 2
            found = 0
            while i < n and found < 2:
                if script[i] == "\\" and i + 1 < n:
                    i += 2
                    continue
                if script[i] == delim:
                    found += 1
                i += 1
            continue
        out.append(script[i])
        i += 1
    return "".join(out)

def sed_script_quits(script):
    # q, 1q, or an address then q (/^foo/q). Substitutions are removed first
    # so s/q/x/ is not a quit.
    address = r"(?:[0-9]+|\$|/(?:\\.|[^/])*/)"
    return (
        re.search(
            rf"(?:^|[;{{\n])\s*(?:{address})?\s*q\b",
            strip_sed_substitutions(script),
        )
        is not None
    )

def sed_quits(args):
    scripts = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--":
            scripts.extend(unquote(item) for item in args[i + 1 :])
            break
        if arg == "-e" and i + 1 < len(args):
            scripts.append(unquote(args[i + 1]))
            i += 2
            continue
        if arg.startswith("-e") and len(arg) > 2:
            scripts.append(unquote(arg[2:]))
            i += 1
            continue
        if arg.startswith("-"):
            i += 1
            continue
        scripts.append(unquote(arg))
        i += 1
    return any(sed_script_quits(script) for script in scripts)

def classify(segment):
    toks = tokenize(segment.strip())
    while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
        toks.pop(0)
    if not toks:
        return None
    base = toks[0].rsplit("/", 1)[-1]
    if base == "grep":
        return grep_flagged(toks[1:])
    if base == "head":
        return "head closes the pipe before EOF"
    if base == "sed" and sed_quits(toks[1:]):
        return "sed q closes the pipe before EOF"
    if base == "awk":
        program = awk_program(toks[1:])
        if program and re.search(r"\bexit\b", strip_end_blocks(program)):
            return "awk exit closes the pipe before EOF"
    return None

def add_hit(hits, name, cmd_line, segment, reason):
    preview = " ".join(segment.split())
    if len(preview) > 120:
        preview = preview[:117] + "..."
    hits.append(f"{name}:{cmd_line}: {reason}: {preview}")

def consume_pipe(text, i, n, line, name, hits):
    while i < n and text[i] in " \t\n":
        if text[i] == "\n":
            line += 1
        i += 1
    cmd_line = line
    buf = []
    seg_quote = None
    while i < n:
        c = text[i]
        if seg_quote:
            buf.append(c)
            if c == "\\" and seg_quote == '"' and i + 1 < n:
                buf.append(text[i + 1])
                i += 2
                continue
            if c == "\n":
                line += 1
            if c == seg_quote:
                seg_quote = None
            i += 1
            continue
        if c in "'\"":
            seg_quote = c
            buf.append(c)
            i += 1
            continue
        if c == "\\" and i + 1 < n and text[i + 1] == "\n":
            i += 2
            line += 1
            continue
        if c in ";\n&|)`":
            break
        buf.append(c)
        i += 1
    segment = "".join(buf)
    reason = classify(segment)
    if reason:
        add_hit(hits, name, cmd_line, segment, reason)
    return i, line

def skip_arith(text, i, n, line):
    depth = 0
    quote = None
    while i < n:
        c = text[i]
        if quote:
            if c == "\\" and quote == '"' and i + 1 < n:
                i += 2
                continue
            if c == "\n":
                line += 1
            if c == quote:
                quote = None
            i += 1
            continue
        if c in "'\"":
            quote = c
            i += 1
            continue
        if c == "\n":
            line += 1
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return i + 1, line
        i += 1
    return i, line

def scan_dquote(text, i, n, line, name, hits):
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n:
            if text[i + 1] == "\n":
                line += 1
            i += 2
            continue
        if c == '"':
            return i + 1, line
        if c == "\n":
            line += 1
            i += 1
            continue
        if c == "`":
            i, line = scan_code(text, i + 1, n, line, name, hits, paren_depth=None, stop_backtick=True)
            continue
        if c == "$" and i + 1 < n and text[i + 1] == "(":
            if i + 2 < n and text[i + 2] == "(":
                i, line = skip_arith(text, i + 2, n, line)
                continue
            i, line = scan_code(text, i + 2, n, line, name, hits, paren_depth=1, stop_backtick=False)
            continue
        i += 1
    return i, line

def scan_code(text, i, n, line, name, hits, paren_depth, stop_backtick):
    depth = 0 if paren_depth is None else paren_depth
    while i < n:
        c = text[i]
        if c == "\\" and i + 1 < n and text[i + 1] == "\n":
            i += 2
            line += 1
            continue
        if stop_backtick and c == "`":
            return i + 1, line
        if c == "'":
            i += 1
            while i < n and text[i] != "'":
                if text[i] == "\n":
                    line += 1
                i += 1
            if i < n:
                i += 1
            continue
        if c == '"':
            i, line = scan_dquote(text, i + 1, n, line, name, hits)
            continue
        if c == "`":
            i, line = scan_code(text, i + 1, n, line, name, hits, paren_depth=None, stop_backtick=True)
            continue
        if c == "$" and i + 1 < n and text[i + 1] == "(":
            if i + 2 < n and text[i + 2] == "(":
                i, line = skip_arith(text, i + 2, n, line)
                continue
            i, line = scan_code(text, i + 2, n, line, name, hits, paren_depth=1, stop_backtick=False)
            continue
        if c == "#":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "|" and i + 1 < n and text[i + 1] == "|":
            i += 2
            continue
        if c == "|":
            i, line = consume_pipe(text, i + 1, n, line, name, hits)
            continue
        if paren_depth is not None:
            if c == "(":
                depth += 1
                i += 1
                continue
            if c == ")":
                depth -= 1
                i += 1
                if depth == 0:
                    return i, line
                continue
        if c == "\n":
            line += 1
        i += 1
    return i, line

def scan_text(name, text):
    hits = []
    scan_code(text, 0, len(text), 1, name, hits, paren_depth=None, stop_backtick=False)
    return hits

def hit_lines(hits):
    return [int(hit.split(":", 2)[1]) for hit in hits]

samples = [
    ("printf | grep -q", "printf '%s\\n' \"$x\" | grep -q foo\n", True),
    ("here string", "grep -q foo <<< \"$x\"\n", False),
    ("grep file", "grep -q foo file\n", False),
    ("or grep file", "foo || grep -q bar file\n", False),
    ("grep -Eq", "printf '%s\\n' \"$x\" | grep -Eq foo\n", True),
    ("grep -F -q", "printf '%s\\n' \"$x\" | grep -F -q -- foo\n", True),
    ("grep -ci", "printf '%s\\n' \"$x\" | grep -ci foo\n", False),
    ("head", "printf '%s\\n' \"$x\" | head -n 1\n", True),
    ("tail", "printf '%s\\n' \"$x\" | tail -n 1\n", False),
    ("awk end exit", "printf '%s\\n' \"$x\" | awk 'END { exit 1 }'\n", False),
    ("awk early exit", "printf '%s\\n' \"$x\" | awk '{ exit }'\n", True),
    ("writer exit", "awk '{ exit }' file | cat\n", False),
    (
        "old step reader",
        "awk '{ print }' file | awk '\n/^name/ { if (capturing) exit }\n'\n",
        True,
    ),
    (
        "read until eof",
        "awk '{ exit }' file | awk '\ndone { next }\n/^name/ { capturing = 0; done = 1; next }\n'\n",
        False,
    ),
    ("literal pipe in quotes", 'echo "not a pipe | head"\n', False),
    ("unquoted command sub", "x=$(docker ps | head -n 1)\n", True),
    ("quoted command sub head", 'x="$(docker ps | head -n 1)"\n', True),
    ("quoted command sub grep -q", 'x="$(printf \'%s\\n\' "$y" | grep -q foo)"\n', True),
    (
        "remote-deploy id assignment",
        'id="$(printf \'%s\\n\' "${ids}" | head -n 1)"\n',
        True,
    ),
    (
        "remote-deploy health sha",
        "sha=\"$(printf '%s\\n' \"${body}\" | sed -n 's/.*gitSha.*/\\\\1/p' | head -n 1)\"\n",
        True,
    ),
    (
        "remote-deploy service id",
        'wait_for_container_healthy "$(service_ids postgres | head -n 1)" postgres\n',
        True,
    ),
    (
        "backup network head",
        "pg_network=\"$(\\n  docker inspect \\\\\\n    | awk 'NF' | head -n 1\\n)\"\\n",
        True,
    ),
    (
        "quoted awk that reads all",
        'ids="$(printf \'%s\\n\' "${ids}" | awk \'NF\' | sort -u)"\n',
        False,
    ),
    (
        "quoted tail and sed substitution",
        "name=\"$(printf '%s\\n' \"$y\" | tail -n 1 | sed 's/^\\\"//; s/\\\"$//')\"\n",
        False,
    ),
    ("backtick head", 'id=`printf \'%s\\n\' "$ids" | head -n 1`\n', True),
    ("backtick inside double quotes", 'id="`printf %s "$ids" | head -n 1`"\n', True),
    (
        "nested command substitution",
        'outer="$(inner="$(printf \'%s\\n\' "$x" | head -n 1)")"\n',
        True,
    ),
    ("grep -m1", "printf '%s\\n' \"$x\" | grep -m1 foo\n", True),
    ("grep -m 1", "printf '%s\\n' \"$x\" | grep -m 1 foo\n", True),
    ("grep --max-count", "printf '%s\\n' \"$x\" | grep --max-count=1 foo\n", True),
    ("quoted grep -m1", 'x="$(printf \'%s\\n\' "$y" | grep -m1 foo)"\n', True),
    ("sed q", "printf '%s\\n' \"$x\" | sed q\n", True),
    ("sed 1q", "printf '%s\\n' \"$x\" | sed 1q\n", True),
    ("sed -n 1p;q", "printf '%s\\n' \"$x\" | sed -n '1p;q'\n", True),
    ("sed -n pattern q", "printf '%s\\n' \"$x\" | sed -n '/^foo/q'\n", True),
    ("sed -n 1p reads all", "printf '%s\\n' \"$x\" | sed -n 1p\n", False),
    ("sed substitution containing q", "printf '%s\\n' \"$x\" | sed 's/q/x/'\n", False),
]

failed = 0
for label, text, expect in samples:
    found = scan_text(label, text)
    if bool(found) != expect:
        print(f"FAIL lint self-check {label}: expected hit={expect} got {found}", file=sys.stderr)
        failed = 1
if failed:
    sys.exit(1)
print("OK early-pipe lint self-check")

# Full copies of deploy/remote-deploy.sh and deploy/backup.sh from main at
# 33bc778, before this branch removed the early-closing readers.
PRE_REMOTE = '#!/usr/bin/env bash\nset -Eeuo pipefail\n\nusage() {\n  echo "Usage: $0 <production|staging> <sha-40hex-image-tag> <40hex-expected-sha>" >&2\n}\n\nif [ "${BASH_SOURCE[0]}" = "$0" ]; then\n  if [ "$#" -ne 3 ]; then\n    usage\n    exit 64\n  fi\nfi\n\n# CARDHUB_ROOT is /opt/cardhub in production. Tests point it at a temp tree.\ncardhub_root="${CARDHUB_ROOT:-/opt/cardhub}"\n# Seconds `docker stop -t` waits after SIGTERM while in-flight requests finish.\n# Compose stop_grace_period is the same 30s ceiling.\nstop_grace_seconds="${CARDHUB_STOP_GRACE_SECONDS:-30}"\nhealth_timeout_seconds="${CARDHUB_HEALTH_TIMEOUT_SECONDS:-180}"\n\nif ! [[ "${stop_grace_seconds}" =~ ^[0-9]+$ ]]; then\n  echo "Invalid CARDHUB_STOP_GRACE_SECONDS: ${stop_grace_seconds}" >&2\n  exit 64\nfi\nif ! [[ "${health_timeout_seconds}" =~ ^[0-9]+$ ]]; then\n  echo "Invalid CARDHUB_HEALTH_TIMEOUT_SECONDS: ${health_timeout_seconds}" >&2\n  exit 64\nfi\n\n# Lookup helpers are top-level so a test can source this file and call\n# read_previous_image. main uses the same functions. Nothing here returns\n# success before the image switch.\n\ncompose() {\n  : "${env_name:?}" "${active_image_tag:?}" "${project:?}" "${env_file:?}" "${compose_file:?}"\n  ENV_NAME="${env_name}" IMAGE_TAG="${active_image_tag}" docker compose -p "${project}" --env-file "${env_file}" -f "${compose_file}" "$@"\n}\n\ncount_lines() {\n  printf \'%s\\n\' "$1" | awk \'NF { n++ } END { print n + 0 }\'\n}\n\n# Empty only when this service has no container. "No such object" from\n# inspect is that case. Any other inspect or list failure exits 1 before\n# rollback is armed.\nread_previous_image() {\n  local svc="$1"\n  local ids id image err rc listed named name_line name_id name_project\n  if ! ids="$(compose ps -aq "${svc}")"; then\n    echo "Refusing deploy: could not list ${svc} containers. The running API was not replaced." >&2\n    exit 1\n  fi\n  ids="$(printf \'%s\\n\' "${ids}" | awk \'NF\' | sort -u)"\n  if [ -z "${ids}" ]; then\n    # Same labels compose itself uses. A hit means compose missed a\n    # container that still belongs to this project.\n    if ! listed="$(docker ps -a \\\n      --filter "label=com.docker.compose.project=${project}" \\\n      --filter "label=com.docker.compose.service=${svc}" \\\n      --format \'{{.ID}}\')"; then\n      echo "Refusing deploy: docker ps failed while checking for a ${svc} container. The running API was not replaced." >&2\n      exit 1\n    fi\n    listed="$(printf \'%s\\n\' "${listed}" | awk \'NF\')"\n    if [ -n "${listed}" ]; then\n      echo "Refusing deploy: compose listed no ${svc} container, but docker ps still shows one. The running API was not replaced." >&2\n      exit 1\n    fi\n    # A leftover can keep the compose container name after its labels are\n    # gone. The label query above does not see it. A different compose\n    # project label means the name belongs to someone else.\n    if ! named="$(docker ps -a \\\n      --filter "name=^${project}-${svc}-[0-9]+$" \\\n      --format \'{{.ID}}{{"\\t"}}{{.Label "com.docker.compose.project"}}\')"; then\n      echo "Refusing deploy: docker ps failed while checking for a named ${svc} container. The running API was not replaced." >&2\n      exit 1\n    fi\n    if [ -n "${named}" ]; then\n      while IFS= read -r name_line; do\n        [ -n "${name_line}" ] || continue\n        if [[ "${name_line}" == *$\'\\t\'* ]]; then\n          name_id="${name_line%%$\'\\t\'*}"\n          name_project="${name_line#*$\'\\t\'}"\n        else\n          name_id="${name_line}"\n          name_project=""\n        fi\n        if [ -n "${name_project}" ] && [ "${name_project}" != "${project}" ]; then\n          continue\n        fi\n        echo "Refusing deploy: leftover container ${name_id} occupies ${project}-${svc} without another project\'s compose label. The running API was not replaced." >&2\n        exit 1\n      done <<< "${named}"\n    fi\n    printf \'%s\' ""\n    return 0\n  fi\n  if [ "$(count_lines "${ids}")" -ne 1 ]; then\n    echo "Refusing deploy: ${svc} has $(count_lines "${ids}") containers; cannot choose a rollback image. The running API was not replaced." >&2\n    exit 1\n  fi\n  id="$(printf \'%s\\n\' "${ids}" | head -n 1)"\n  err="$(mktemp)"\n  rc=0\n  image="$(docker inspect -f \'{{.Config.Image}}\' "${id}" 2>"${err}")" || rc=$?\n  if [ "${rc}" -ne 0 ]; then\n    if grep -Eq \'No such (object|container)\' "${err}"; then\n      rm -f "${err}"\n      printf \'%s\' ""\n      return 0\n    fi\n    echo "Refusing deploy: docker inspect of the previous ${svc} container exited ${rc}. The running API was not replaced." >&2\n    rm -f "${err}"\n    exit 1\n  fi\n  rm -f "${err}"\n  printf \'%s\' "${image}"\n}\n\n# Print true, false, or nothing. Empty means the GitHub variable is unset\n# and the env file must be left alone. Anything else is refused. The raw\n# value is never printed.\nnormalize_password_prehash_write() {\n  local value\n  value="${PASSWORD_PREHASH_WRITE-}"\n  value="${value//$\'\\r\'/}"\n  value="${value#"${value%%[![:space:]]*}"}"\n  value="${value%"${value##*[![:space:]]}"}"\n  case "${value}" in\n    ""|true|false)\n      printf \'%s\' "${value}"\n      ;;\n    *)\n      echo "PASSWORD_PREHASH_WRITE must be the exact string true or false" >&2\n      return 64\n      ;;\n  esac\n}\n\n# Replace every PASSWORD_PREHASH_WRITE assignment, or append one. A line\n# whose name is `export PASSWORD_PREHASH_WRITE` is rewritten in place and\n# keeps the export prefix. Comments and other keys are copied through and\n# are not printed. Unset, empty, and whitespace leave the file untouched,\n# including its inode.\napply_password_prehash_write() {\n  local file="$1"\n  local value key tmp\n  key="PASSWORD_PREHASH_WRITE"\n  value="$(normalize_password_prehash_write)" || return $?\n  if [ -z "${value}" ]; then\n    return 0\n  fi\n  if [ ! -f "${file}" ]; then\n    echo "Missing env file: ${file}" >&2\n    return 1\n  fi\n\n  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1\n  chmod 600 "${tmp}"\n  if ! awk -v key="${key}" -v value="${value}" \'\n    function trim(s) {\n      gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)\n      return s\n    }\n    function assignment_kind(raw,    eq, name, rest) {\n      eq = index(raw, "=")\n      if (eq == 0) return ""\n      name = trim(substr(raw, 1, eq - 1))\n      if (name == key) return "plain"\n      rest = name\n      if (sub(/^export[[:space:]]+/, "", rest)) {\n        rest = trim(rest)\n        if (rest == key) return "export"\n      }\n      return ""\n    }\n    BEGIN { found = 0 }\n    {\n      raw = $0\n      sub(/\\r$/, "", raw)\n      if (raw ~ /^[[:space:]]*#/ || raw ~ /^[[:space:]]*$/) {\n        print\n        next\n      }\n      kind = assignment_kind(raw)\n      if (kind == "plain") {\n        print key "=" value\n        found = 1\n        next\n      }\n      if (kind == "export") {\n        print "export " key "=" value\n        found = 1\n        next\n      }\n      print\n    }\n    END {\n      if (!found) print key "=" value\n    }\n  \' "${file}" > "${tmp}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not rewrite ${key}" >&2\n    return 1\n  fi\n\n  if [ -s "${file}" ] && [ ! -s "${tmp}" ]; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: rewrite produced an empty file" >&2\n    return 1\n  fi\n\n  if cmp -s "${file}" "${tmp}"; then\n    rm -f "${tmp}"\n    return 0\n  fi\n\n  chmod --reference="${file}" "${tmp}" || chmod 600 "${tmp}"\n  if ! mv -f "${tmp}" "${file}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not replace it" >&2\n    return 1\n  fi\n  printf \'%s\\n\' "${key}=${value}"\n}\n\n# Print true or false. Only the exact string true enables X-Cache. Empty,\n# whitespace, and every other value are false. The raw value is not printed.\nnormalize_catalog_cache_header() {\n  local value\n  value="${CATALOG_CACHE_HEADER-}"\n  value="${value//$\'\\r\'/}"\n  value="${value#"${value%%[![:space:]]*}"}"\n  value="${value%"${value##*[![:space:]]}"}"\n  if [ "${value}" = "true" ]; then\n    printf \'%s\' "true"\n  else\n    printf \'%s\' "false"\n  fi\n}\n\n# Replace every CATALOG_CACHE_HEADER assignment, or append one. A line whose\n# name is `export CATALOG_CACHE_HEADER` is rewritten in place and keeps the\n# export prefix. The key is not appended again when a line already exists.\n# Comments and other keys are copied through and are not printed.\napply_catalog_cache_header() {\n  local file="$1"\n  local value key tmp\n  key="CATALOG_CACHE_HEADER"\n  value="$(normalize_catalog_cache_header)"\n  if [ ! -f "${file}" ]; then\n    echo "Missing env file: ${file}" >&2\n    return 1\n  fi\n\n  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1\n  chmod 600 "${tmp}"\n  if ! awk -v key="${key}" -v value="${value}" \'\n    function trim(s) {\n      gsub(/^[[:space:]]+|[[:space:]]+$/, "", s)\n      return s\n    }\n    function assignment_kind(raw,    eq, name, rest) {\n      eq = index(raw, "=")\n      if (eq == 0) return ""\n      name = trim(substr(raw, 1, eq - 1))\n      if (name == key) return "plain"\n      rest = name\n      if (sub(/^export[[:space:]]+/, "", rest)) {\n        rest = trim(rest)\n        if (rest == key) return "export"\n      }\n      return ""\n    }\n    BEGIN { found = 0 }\n    {\n      raw = $0\n      sub(/\\r$/, "", raw)\n      if (raw ~ /^[[:space:]]*#/ || raw ~ /^[[:space:]]*$/) {\n        print\n        next\n      }\n      kind = assignment_kind(raw)\n      if (kind == "plain") {\n        print key "=" value\n        found = 1\n        next\n      }\n      if (kind == "export") {\n        print "export " key "=" value\n        found = 1\n        next\n      }\n      print\n    }\n    END {\n      if (!found) print key "=" value\n    }\n  \' "${file}" > "${tmp}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not rewrite ${key}" >&2\n    return 1\n  fi\n\n  if [ -s "${file}" ] && [ ! -s "${tmp}" ]; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: rewrite produced an empty file" >&2\n    return 1\n  fi\n\n  if cmp -s "${file}" "${tmp}"; then\n    rm -f "${tmp}"\n    return 0\n  fi\n\n  chmod --reference="${file}" "${tmp}" || chmod 600 "${tmp}"\n  if ! mv -f "${tmp}" "${file}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not replace it" >&2\n    return 1\n  fi\n  printf \'%s\\n\' "${key}=${value}"\n}\n\n# Print the DSN, or nothing. Empty means the GitHub secret is unset and the\n# env file must be left alone. Anything else must be an http or https URL\n# with no whitespace, quotes, backslashes, or shell substitutions. The value\n# is written to stdout only so the caller can capture it. It is never logged.\nnormalize_web_sentry_dsn() {\n  local value\n  value="${WEB_SENTRY_DSN-}"\n  while [ -n "${value}" ] && { [ "${value: -1}" = $\'\\n\' ] || [ "${value: -1}" = $\'\\r\' ]; }; do\n    value="${value%?}"\n  done\n  case "${value}" in\n    *$\'\\n\'*|*$\'\\r\'*)\n      echo "WEB_SENTRY_DSN must be an http or https URL" >&2\n      return 64\n      ;;\n  esac\n  value="${value#"${value%%[![:space:]]*}"}"\n  value="${value%"${value##*[![:space:]]}"}"\n  if [ -z "${value}" ]; then\n    printf \'%s\' ""\n    return 0\n  fi\n  # Same shape the web entrypoint accepts, plus no $ or backtick: compose\n  # interpolates $ in the env file, and the value is placed in a shell\n  # assignment before that.\n  if printf \'%s\' "${value}" | grep -Eq \'^https?://[^[:space:]"\\\\$`]+$\'; then\n    printf \'%s\' "${value}"\n    return 0\n  fi\n  echo "WEB_SENTRY_DSN must be an http or https URL" >&2\n  return 64\n}\n\n# Replace every WEB_SENTRY_DSN assignment, including a line whose name has an\n# export prefix, or append one. Comments and other keys are copied through\n# and are not printed. Unset, empty, and whitespace leave the file untouched,\n# including its inode. Owner and mode are kept the same way as\n# PASSWORD_PREHASH_WRITE (env files are 600). The DSN is never printed.\napply_web_sentry_dsn() {\n  local file="$1"\n  local value key tmp\n  key="WEB_SENTRY_DSN"\n  value="$(normalize_web_sentry_dsn)" || return $?\n  if [ -z "${value}" ]; then\n    return 0\n  fi\n  if [ ! -f "${file}" ]; then\n    echo "Missing env file: ${file}" >&2\n    return 1\n  fi\n\n  tmp="$(mktemp "${file}.tmp.XXXXXX")" || return 1\n  chmod 600 "${tmp}"\n  if ! awk -v key="${key}" -v value="${value}" \'\n    function assignment_name(raw,    name, eq) {\n      eq = index(raw, "=")\n      if (eq == 0) return ""\n      name = substr(raw, 1, eq - 1)\n      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)\n      sub(/^export[[:space:]]+/, "", name)\n      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)\n      return name\n    }\n    BEGIN { found = 0 }\n    {\n      raw = $0\n      sub(/\\r$/, "", raw)\n      if (raw ~ /^[[:space:]]*#/ || raw ~ /^[[:space:]]*$/) {\n        print\n        next\n      }\n      if (assignment_name(raw) == key) {\n        print key "=" value\n        found = 1\n        next\n      }\n      print\n    }\n    END {\n      if (!found) print key "=" value\n    }\n  \' "${file}" > "${tmp}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not rewrite ${key}" >&2\n    return 1\n  fi\n\n  if [ -s "${file}" ] && [ ! -s "${tmp}" ]; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: rewrite produced an empty file" >&2\n    return 1\n  fi\n\n  if cmp -s "${file}" "${tmp}"; then\n    rm -f "${tmp}"\n    return 0\n  fi\n\n  if ! chown --reference="${file}" "${tmp}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not preserve owner" >&2\n    return 1\n  fi\n  chmod --reference="${file}" "${tmp}" || chmod 600 "${tmp}"\n  if ! mv -f "${tmp}" "${file}"; then\n    rm -f "${tmp}"\n    echo "Refusing to update ${file}: could not replace it" >&2\n    return 1\n  fi\n}\n\nmain() {\n  local environment image_tag expected_sha env_name project base_dir\n  environment="$1"\n  image_tag="$2"\n  expected_sha="$3"\n\n  case "${environment}" in\n    production)\n      env_name="prod"\n      project="cardhub-prod"\n      base_dir="${cardhub_root}/production"\n      ;;\n    staging)\n      env_name="staging"\n      project="cardhub-staging"\n      base_dir="${cardhub_root}/staging"\n      ;;\n    *)\n      usage\n      exit 64\n      ;;\n  esac\n\n  if [[ ! "${image_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then\n    echo "Invalid image tag: ${image_tag}" >&2\n    exit 64\n  fi\n\n  if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then\n    echo "Invalid expected SHA: ${expected_sha}" >&2\n    exit 64\n  fi\n\n  if [ "${image_tag#sha-}" != "${expected_sha}" ]; then\n    echo "Image tag and expected SHA disagree" >&2\n    exit 64\n  fi\n\n  local app_dir compose_file env_file active_image_tag\n  app_dir="${base_dir}/deploy"\n  compose_file="${app_dir}/docker-compose.yml"\n  env_file="${base_dir}/${environment}.env"\n  active_image_tag="${image_tag}"\n\n  if ! docker network inspect edge >/dev/null 2>&1; then\n    echo "Docker network \'edge\' does not exist. Start deploy/edge first." >&2\n    exit 1\n  fi\n\n  if [ ! -f "${env_file}" ]; then\n    echo "Missing env file: ${env_file}" >&2\n    exit 1\n  fi\n\n  local env_file_env_name\n  env_file_env_name="$(awk -F= \'$1 == "ENV_NAME" { print $2 }\' "${env_file}" | tail -n 1 | tr -d \'\\r\' | sed \'s/^"//; s/"$//\')"\n  if [ "${env_file_env_name}" != "${env_name}" ]; then\n    echo "ENV_NAME in ${env_file} must be \'${env_name}\', got \'${env_file_env_name:-<missing>}\'" >&2\n    exit 1\n  fi\n\n  # GitHub Environment variable, forwarded by deploy.yml. Unset or blank\n  # keeps the line already on disk (staging stays true until the variable\n  # is set). true and false are written before any container is replaced.\n  # Other lines in the env file are secrets and are not printed.\n  apply_password_prehash_write "${env_file}" || exit $?\n\n  # GitHub Environment secret WEB_SENTRY_DSN, forwarded by deploy.yml.\n  # Unset or blank keeps the line already on disk. An http(s) URL replaces\n  # every assignment of that key, including an export prefix, or appends\n  # one. The value is not printed.\n  apply_web_sentry_dsn "${env_file}" || exit $?\n\n  # GitHub Environment variable, forwarded by deploy.yml. Only the exact\n  # string true is kept; empty and every other value are written as false.\n  # Runs after the checks above so a rejected prehash or DSN does not\n  # rewrite this file. ENV_NAME is already staging or prod.\n  apply_catalog_cache_header "${env_file}" || exit $?\n\n  cd "${app_dir}"\n\n  local previous_api_image previous_web_image previous_tag previous_api_tag previous_web_tag\n  # Global so the EXIT trap can still see it after main returns.\n  tmp=""\n  cleanup() {\n    [ -z "${tmp:-}" ] || rm -f "${tmp}"\n  }\n  trap cleanup EXIT\n\n  # Last assignment wins. The value is not printed.\n  read_env_file_var() {\n    local file="$1"\n    local key="$2"\n    awk -v key="$key" \'\n      BEGIN { found = "" }\n      /^[[:space:]]*#/ { next }\n      /^[[:space:]]*$/ { next }\n      {\n        eq = index($0, "=")\n        if (eq == 0) next\n        name = substr($0, 1, eq - 1)\n        gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)\n        if (name != key) next\n        value = substr($0, eq + 1)\n        gsub(/\\r$/, "", value)\n        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)\n        if (length(value) >= 2 && substr(value, 1, 1) == "\\"" && substr(value, length(value), 1) == "\\"") {\n          value = substr(value, 2, length(value) - 2)\n        }\n        q = sprintf("%c", 39)\n        if (length(value) >= 2 && substr(value, 1, 1) == q && substr(value, length(value), 1) == q) {\n          value = substr(value, 2, length(value) - 2)\n        }\n        found = value\n      }\n      END { printf "%s", found }\n    \' "${file}"\n  }\n\n  # Status is the `docker run` status of the classification script.\n  # 0: both split entrypoints exist and are executable.\n  # 10: both files are absent, so the image is from before the split.\n  #     A dangling symlink counts as present (`! -e` is not enough).\n  # 3: at least one file exists, but the pair is incomplete (the other is\n  #    missing, or a file is present and not executable).\n  # Docker itself returns 1 for an attach or stream error, so 1 is not an\n  # old image. Any status other than 0, 10, or 3 aborts before a container\n  # changes.\n  probe_split_entrypoint() {\n    docker run --rm --network none --entrypoint sh "${api_image}" -c \'\n      api=/usr/local/bin/api-entrypoint.sh\n      mig=/usr/local/bin/migrate-entrypoint.sh\n      if [ ! -e "$api" ] && [ ! -L "$api" ] && [ ! -e "$mig" ] && [ ! -L "$mig" ]; then\n        exit 10\n      fi\n      test -x "$api" && test -x "$mig" || exit 3\n    \'\n  }\n\n  service_ids() {\n    compose ps -aq "$1" | awk \'NF\' | sort -u\n  }\n\n  # One rollout at a time on the shared 4G+2G host. Prod and staging must not\n  # each add an API or web replica together.\n  mkdir -p "${cardhub_root}"\n  if ! command -v flock >/dev/null 2>&1; then\n    echo "flock is required so prod and staging do not roll out together" >&2\n    exit 1\n  fi\n  exec 8>"${cardhub_root}/.rollout.lock"\n  if ! flock -w 900 8; then\n    echo "Timed out waiting for ${cardhub_root}/.rollout.lock; another rollout is still adding a replica" >&2\n    exit 1\n  fi\n\n  local svc id n\n  for svc in api web; do\n    id="$(service_ids "${svc}")"\n    n="$(count_lines "${id}")"\n    if [ "${n}" -gt 1 ]; then\n      echo "${svc} already has ${n} containers; refusing to add another replica" >&2\n      exit 1\n    fi\n  done\n\n  previous_api_image="$(read_previous_image api)"\n  previous_web_image="$(read_previous_image web)"\n  previous_tag=""\n  previous_api_tag=""\n  previous_web_tag=""\n  if [[ "${previous_api_image}" =~ :sha-[0-9a-f]{40}$ ]] && [[ "${previous_web_image}" =~ :sha-[0-9a-f]{40}$ ]]; then\n    previous_api_tag="${previous_api_image##*:}"\n    previous_web_tag="${previous_web_image##*:}"\n    if [ "${previous_api_tag}" = "${previous_web_tag}" ]; then\n      previous_tag="${previous_api_tag}"\n    else\n      echo "Previous api/web tags differ (${previous_api_tag} vs ${previous_web_tag}); automatic rollback requires matching immutable tags" >&2\n    fi\n  elif [[ "${previous_api_image}" =~ :sha-[0-9a-f]{40}$ ]]; then\n    previous_api_tag="${previous_api_image##*:}"\n    previous_tag="${previous_api_tag}"\n  elif [[ "${previous_web_image}" =~ :sha-[0-9a-f]{40}$ ]]; then\n    previous_web_tag="${previous_web_image##*:}"\n  fi\n\n  record_previous_images() {\n    local state_dir state_file tmp_state wrote\n    state_dir="${base_dir}/.deploy-state"\n    state_file="${state_dir}/previous-images.env"\n    wrote=0\n\n    if [[ ! "${previous_api_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [[ ! "${previous_web_tag}" =~ ^sha-[0-9a-f]{40}$ ]]; then\n      return 0\n    fi\n\n    mkdir -p "${state_dir}"\n    tmp_state="$(mktemp "${state_dir}/previous-images.env.XXXXXX")"\n    {\n      echo "# Generated by remote-deploy.sh after this environment switched successfully."\n      if [[ "${previous_api_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_api_tag}" != "${image_tag}" ]; then\n        echo "PREVIOUS_API_TAG=${previous_api_tag}"\n        wrote=1\n      fi\n      if [[ "${previous_web_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_web_tag}" != "${image_tag}" ]; then\n        echo "PREVIOUS_WEB_TAG=${previous_web_tag}"\n        wrote=1\n      fi\n    } > "${tmp_state}"\n\n    if [ "${wrote}" -eq 1 ]; then\n      mv "${tmp_state}" "${state_file}"\n    else\n      rm -f "${tmp_state}"\n    fi\n  }\n\n  cleanup_old_images() {\n    if [ ! -x "${app_dir}/image-cleanup.sh" ]; then\n      echo "Warning: ${app_dir}/image-cleanup.sh is missing or not executable; skipping image cleanup" >&2\n      return 0\n    fi\n\n    "${app_dir}/image-cleanup.sh" --root "${cardhub_root}" || echo "Warning: image cleanup failed; deploy continues" >&2\n  }\n\n  local rollback_armed rollback_in_progress\n  rollback_armed=0\n  rollback_in_progress=0\n\n  rollback() {\n    if [ "${rollback_armed}" -ne 1 ] || [ "${rollback_in_progress}" -eq 1 ]; then\n      return 0\n    fi\n    rollback_in_progress=1\n    trap - ERR\n    if [[ "${previous_tag}" =~ ^sha-[0-9a-f]{40}$ ]] && [ "${previous_tag}" != "${image_tag}" ]; then\n      echo "Rolling back ${environment} to ${previous_tag}" >&2\n      active_image_tag="${previous_tag}"\n      compose pull api web || true\n      # Keeps a replica already running previous_tag and drops a mismatched\n      # extra one. Recreates only a service that has already cut over.\n      compose up -d postgres redis api web || true\n    else\n      echo "No previous immutable sha tag available for automatic rollback" >&2\n    fi\n  }\n\n  on_error() {\n    local rc="$?"\n    rollback\n    exit "${rc}"\n  }\n\n  wait_for_container_healthy() {\n    local id="$1"\n    local label="$2"\n    local deadline previous_restart restart_count state health\n    deadline=$((SECONDS + health_timeout_seconds))\n    previous_restart=""\n\n    while [ "${SECONDS}" -lt "${deadline}" ]; do\n      state="$(docker inspect -f \'{{.State.Status}}\' "${id}")"\n      restart_count="$(docker inspect -f \'{{.RestartCount}}\' "${id}")"\n      health="$(docker inspect -f \'{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}\' "${id}")"\n\n      if [ -n "${previous_restart}" ] && [ "${restart_count}" -gt "${previous_restart}" ]; then\n        echo "${label} container restart count increased (${previous_restart} -> ${restart_count})" >&2\n        return 1\n      fi\n      previous_restart="${restart_count}"\n\n      if [ "${state}" != "running" ]; then\n        echo "${label} container state is ${state}" >&2\n        return 1\n      fi\n\n      case "${health}" in\n        healthy)\n          echo "Container ${label} ${id:0:12} is healthy"\n          return 0\n          ;;\n        unhealthy)\n          echo "${label} container is unhealthy" >&2\n          return 1\n          ;;\n        none)\n          echo "${label} container has no healthcheck" >&2\n          return 1\n          ;;\n      esac\n\n      sleep 5\n    done\n\n    echo "Timed out waiting for ${label} container to become healthy" >&2\n    return 1\n  }\n\n  discard_container() {\n    local id="$1"\n    local label="$2"\n    echo "Removing failed ${label} container ${id:0:12}; the previous container keeps serving" >&2\n    docker logs --tail 80 "${id}" >&2 || true\n    docker rm -f "${id}" >/dev/null\n  }\n\n  confirm_api() {\n    local id="$1"\n    local body sha\n    if ! body="$(docker exec "${id}" node -e \'fetch("http://127.0.0.1:4000/health").then(async (r) => { const t = await r.text(); if (!r.ok) { process.stderr.write(t); process.exit(1); } process.stdout.write(t); }).catch((err) => { process.stderr.write(String(err)); process.exit(1); })\')"; then\n      echo "api container ${id:0:12} /health probe failed" >&2\n      return 1\n    fi\n    sha="$(printf \'%s\\n\' "${body}" | sed -n \'s/.*"gitSha"[[:space:]]*:[[:space:]]*"\\([0-9a-f]\\{40\\}\\)".*/\\1/p\' | head -n 1)"\n    if [ "${sha}" != "${expected_sha}" ]; then\n      echo "api container ${id:0:12} gitSha=\'${sha}\' expected \'${expected_sha}\'. body=\'${body}\'" >&2\n      return 1\n    fi\n    echo "Verified new api container gitSha=${sha}"\n  }\n\n  confirm_web() {\n    local id="$1"\n    if ! docker exec "${id}" wget -qO- http://127.0.0.1:8080/healthz >/dev/null; then\n      echo "web container ${id:0:12} /healthz probe failed" >&2\n      return 1\n    fi\n    echo "Verified new web container /healthz"\n  }\n\n  confirm_new_container() {\n    local svc="$1"\n    local id="$2"\n    local image\n    image="$(docker inspect -f \'{{.Config.Image}}\' "${id}")"\n    case "${image}" in\n      *:"${image_tag}") ;;\n      *)\n        echo "new ${svc} container image is ${image}, expected tag ${image_tag}" >&2\n        return 1\n        ;;\n    esac\n    case "${svc}" in\n      api) confirm_api "${id}" ;;\n      web) confirm_web "${id}" ;;\n      *)\n        echo "unknown service ${svc}" >&2\n        return 1\n        ;;\n    esac\n  }\n\n  running_replica_count() {\n    local svc="$1"\n    local project_name id n\n    n=0\n    for project_name in cardhub-prod cardhub-staging; do\n      while IFS= read -r id; do\n        [ -n "${id}" ] || continue\n        n=$((n + 1))\n      done < <(docker ps -q --filter "label=com.docker.compose.project=${project_name}" --filter "label=com.docker.compose.service=${svc}" 2>/dev/null || true)\n    done\n    printf \'%s\\n\' "${n}"\n  }\n\n  # Scale to 2, wait until the new container is healthy, then stop the old\n  # one by ID. Docker DNS for the edge alias lists both containers until the\n  # old one is removed. A failed new container is deleted and the old one is\n  # left running.\n  rollout_service() {\n    local svc="$1"\n    local before after old_id new_ids new_id n state survivor\n    before="$(service_ids "${svc}")"\n    n="$(count_lines "${before}")"\n\n    if [ "${n}" -eq 0 ]; then\n      echo "Starting ${svc} (no previous container)"\n      compose up -d --no-deps "${svc}"\n      new_id="$(service_ids "${svc}")"\n      if [ "$(count_lines "${new_id}")" -ne 1 ]; then\n        echo "expected one ${svc} container after initial start" >&2\n        return 1\n      fi\n      if ! wait_for_container_healthy "${new_id}" "${svc}" || ! confirm_new_container "${svc}" "${new_id}"; then\n        discard_container "${new_id}" "${svc}" || true\n        return 1\n      fi\n      return 0\n    fi\n\n    if [ "${n}" -ne 1 ]; then\n      echo "${svc} has ${n} containers; refusing to scale" >&2\n      return 1\n    fi\n    old_id="${before}"\n\n    n="$(running_replica_count "${svc}")"\n    if [ "${n}" -gt 2 ]; then\n      echo "Refusing to start another ${svc}: ${n} already running across prod and staging" >&2\n      return 1\n    fi\n\n    echo "Starting new ${svc} beside ${old_id:0:12}"\n    compose up -d --no-deps --scale "${svc}=2" --no-recreate "${svc}"\n    after="$(service_ids "${svc}")"\n    if ! docker inspect "${old_id}" >/dev/null 2>&1; then\n      echo "old ${svc} container disappeared during scale-up" >&2\n      return 1\n    fi\n    state="$(docker inspect -f \'{{.State.Status}}\' "${old_id}")"\n    if [ "${state}" != "running" ]; then\n      echo "old ${svc} container is ${state} after scale-up" >&2\n      return 1\n    fi\n    new_ids="$(comm -13 <(printf \'%s\\n\' "${before}") <(printf \'%s\\n\' "${after}") | awk \'NF\')"\n    if [ "$(count_lines "${new_ids}")" -ne 1 ]; then\n      echo "expected one new ${svc} container, found $(count_lines "${new_ids}")" >&2\n      if [ -n "${new_ids}" ]; then\n        # shellcheck disable=SC2086\n        docker rm -f ${new_ids} >/dev/null || true\n      fi\n      return 1\n    fi\n    new_id="${new_ids}"\n\n    if ! wait_for_container_healthy "${new_id}" "${svc}" || ! confirm_new_container "${svc}" "${new_id}"; then\n      discard_container "${new_id}" "${svc}" || true\n      return 1\n    fi\n\n    echo "Stopping old ${svc} ${old_id:0:12} (grace ${stop_grace_seconds}s)"\n    docker stop -t "${stop_grace_seconds}" "${old_id}" >/dev/null\n    docker rm "${old_id}" >/dev/null\n    compose up -d --no-deps --scale "${svc}=1" --no-recreate "${svc}"\n    survivor="$(compose ps -q "${svc}" | awk \'NF\')"\n    if [ "$(count_lines "${survivor}")" -ne 1 ] || [ "${survivor}" != "${new_id}" ]; then\n      echo "scale-down did not keep the new ${svc} container (survivor=\'${survivor}\')" >&2\n      return 1\n    fi\n    echo "Cut ${svc} over to ${new_id:0:12}"\n  }\n\n  public_https_get() {\n    local domain path output\n    domain="$1"\n    path="$2"\n    output="$3"\n\n    "${CURL_BIN:-curl}" -fsS --resolve "${domain}:443:127.0.0.1" "https://${domain}${path}" -o "${output}"\n  }\n\n  verify_api_health() {\n    local domain expected response_file deadline last_body last_sha\n    domain="$1"\n    expected="$2"\n    response_file="$3"\n    deadline=$((SECONDS + health_timeout_seconds))\n    last_body=""\n    last_sha=""\n\n    while [ "${SECONDS}" -lt "${deadline}" ]; do\n      if public_https_get "${domain}" "/health" "${response_file}"; then\n        last_body="$(cat "${response_file}")"\n        last_sha="$(sed -n \'s/.*"gitSha"[[:space:]]*:[[:space:]]*"\\([0-9a-f]\\{40\\}\\)".*/\\1/p\' "${response_file}" | head -n 1)"\n        if [ "${last_sha}" = "${expected}" ]; then\n          echo "Verified ${domain} gitSha=${last_sha}"\n          return 0\n        fi\n      fi\n      sleep 5\n    done\n\n    echo "Timed out waiting for https://${domain}/health gitSha=${expected}. Last gitSha=\'${last_sha}\', body=\'${last_body}\'" >&2\n    return 1\n  }\n\n  # Classify the image before rollback is armed and before compose pull\n  # or compose up. Old means both split entrypoint files are absent.\n  # An incomplete pair is not an old image, even when MIGRATE_DATABASE_URL\n  # is empty. A daemon error must not skip migrations and roll the API forward.\n  local migrate_database_url api_image entrypoint_rc\n  migrate_database_url="$(read_env_file_var "${env_file}" MIGRATE_DATABASE_URL)"\n  api_image="ghcr.io/xv-jiaqi/cardhub-api:${image_tag}"\n  if ! docker pull "${api_image}"; then\n    echo "Failed to pull ${api_image}; the running API was not replaced" >&2\n    exit 1\n  fi\n  entrypoint_rc=0\n  probe_split_entrypoint || entrypoint_rc=$?\n  if [ "${entrypoint_rc}" -eq 3 ]; then\n    echo "Refusing deploy: ${image_tag} has an incomplete split entrypoint pair (one of /usr/local/bin/api-entrypoint.sh or /usr/local/bin/migrate-entrypoint.sh is missing or not executable). The running API was not replaced." >&2\n    exit 1\n  fi\n  if [ "${entrypoint_rc}" -ne 0 ] && [ "${entrypoint_rc}" -ne 10 ]; then\n    echo "Refusing deploy: entrypoint probe exited ${entrypoint_rc}, not 0 (both entrypoints executable), 10 (both absent), or 3 (incomplete pair). The running API was not replaced." >&2\n    exit 1\n  fi\n  if [ -n "${migrate_database_url}" ] && [ "${entrypoint_rc}" -eq 10 ]; then\n    echo "Refusing deploy: MIGRATE_DATABASE_URL is set, but ${image_tag} is an old image (both split entrypoints are absent)." >&2\n    echo "The running API was not replaced. Switch DATABASE_URL back to the admin superuser, clear MIGRATE_DATABASE_URL, then deploy an older image." >&2\n    exit 1\n  fi\n  unset migrate_database_url\n\n  trap on_error ERR\n  rollback_armed=1\n\n  compose pull api web\n  compose up -d postgres redis\n  wait_for_container_healthy "$(service_ids postgres | head -n 1)" postgres\n  wait_for_container_healthy "$(service_ids redis | head -n 1)" redis\n\n  # Migrations finish before the API swap. A failure here exits without\n  # calling rollback, so the container that is already serving stays up.\n  # Images from before the split migrate inside their own command instead.\n  if [ "${entrypoint_rc}" -eq 0 ]; then\n    echo "Running database migrations before the API rollout"\n    if ! compose run --rm -T --no-deps migrate; then\n      echo "Migrations failed; the running API was not replaced" >&2\n      exit 1\n    fi\n  else\n    echo "Target image has no migrate entrypoint; it migrates inside the API container"\n  fi\n\n  # One extra container at a time: finish API before web.\n  rollout_service api\n  rollout_service web\n\n  local api_domain catalog_seed_cmd\n  api_domain="$(awk -F= \'$1 == "API_DOMAIN" { print $2 }\' "${env_file}" | tail -n 1 | tr -d \'\\r\' | sed \'s/^"//; s/"$//\')"\n  if [ -z "${api_domain}" ]; then\n    echo "API_DOMAIN is missing from ${env_file}" >&2\n    exit 1\n  fi\n\n  tmp="$(mktemp)"\n\n  verify_api_health "${api_domain}" "${expected_sha}" "${tmp}"\n  catalog_seed_cmd="$(awk -F= \'$1 == "CATALOG_SEED_CMD" { print substr($0, index($0, "=") + 1) }\' "${env_file}" | tail -n 1 | tr -d \'\\r\')"\n  if [ -n "${catalog_seed_cmd}" ]; then\n    echo "Running catalog seed command"\n    compose exec -T api sh -c "${catalog_seed_cmd}"\n  fi\n  rollback_armed=0\n  # Only a finished switch may replace the rollback target. Writing this file\n  # before the switch made a failed deploy record the version just rolled\n  # back to, and the next cleanup then deleted the real previous image.\n  record_previous_images\n  cleanup_old_images || true\n}\n\nif [ "${BASH_SOURCE[0]}" = "$0" ]; then\n  main "$@"\nfi\n'
PRE_BACKUP = '#!/usr/bin/env bash\nset -euo pipefail\n\nPROJECT="${PROJECT:-cardhub-prod}"\nENV_FILE="${ENV_FILE:-/opt/cardhub/production/production.env}"\nCOMPOSE_FILE="${COMPOSE_FILE:-/opt/cardhub/production/deploy/docker-compose.yml}"\nBACKUP_DIR="${BACKUP_DIR:-/opt/cardhub/backups/${PROJECT}}"\nOFFSITE_ENV_FILE="${OFFSITE_ENV_FILE:-/opt/cardhub/backups/offsite.env}"\nRCLONE_IMAGE="rclone/rclone:1.75.2@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5"\nTIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"\nOUT="${BACKUP_DIR}/${PROJECT}-${TIMESTAMP}.sql.gz"\ntmp_sql=""\ntmp_gz=""\ntmp_rclone_env=""\nbackup_fail_reason=""\nrc=0\n\n# shellcheck disable=SC2317\nfinish_backup() {\n  # rc was captured by the EXIT trap before this function runs.\n  set +e\n  unset PGPASSWORD || true\n  [ -z "${tmp_sql}" ] || rm -f "${tmp_sql}"\n  [ -z "${tmp_gz}" ] || rm -f "${tmp_gz}"\n  [ -z "${tmp_rclone_env}" ] || rm -f "${tmp_rclone_env}"\n  local ts reason kind tail\n  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"\n  if [ "${rc}" -eq 0 ]; then\n    kind=ok\n    tail=" file=$(basename "${OUT}")"\n  else\n    reason="${backup_fail_reason:-command-failed}"\n    kind=fail\n    tail=" rc=${rc} reason=${reason}"\n  fi\n  # One printf, one write. Staging and prod append to the same backup.log;\n  # a separate newline write and result write can interleave.\n  printf \'\\nBACKUP_RESULT=%s project=%s ts=%s%s\\n\' \\\n    "${kind}" "${PROJECT}" "${ts}" "${tail}"\n  if [ -n "${BACKUP_PING_URL:-}" ]; then\n    if [ "${rc}" -eq 0 ]; then\n      curl -fsS -m 10 -- "${BACKUP_PING_URL}" >/dev/null || true\n    else\n      curl -fsS -m 10 -- "${BACKUP_PING_URL%/}/fail" >/dev/null || true\n    fi\n  fi\n  exit "${rc}"\n}\n\n# shellcheck disable=SC2317\non_term() {\n  backup_fail_reason=sigterm\n  exit 143\n}\n\n# shellcheck disable=SC2317\non_int() {\n  backup_fail_reason=sigint\n  exit 130\n}\n\n# The first statement has to be rc=$? . A command before it, including the\n# function call itself, would see status 0 and could record a false success\n# after set -e, pipefail, or a signal.\ntrap \'rc=$?; finish_backup\' EXIT\ntrap on_term TERM\ntrap on_int INT\n\n# Last assignment in the env file wins. Values are not printed.\nread_env_var() {\n  local file="$1"\n  local key="$2"\n  awk -v key="$key" \'\n    BEGIN { found = "" }\n    /^[[:space:]]*#/ { next }\n    /^[[:space:]]*$/ { next }\n    {\n      eq = index($0, "=")\n      if (eq == 0) next\n      name = substr($0, 1, eq - 1)\n      gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)\n      if (name != key) next\n      value = substr($0, eq + 1)\n      gsub(/\\r$/, "", value)\n      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)\n      if (length(value) >= 2 && substr(value, 1, 1) == "\\"" && substr(value, length(value), 1) == "\\"") {\n        value = substr(value, 2, length(value) - 2)\n      }\n      q = sprintf("%c", 39)\n      if (length(value) >= 2 && substr(value, 1, 1) == q && substr(value, length(value), 1) == q) {\n        value = substr(value, 2, length(value) - 2)\n      }\n      found = value\n    }\n    END { printf "%s", found }\n  \' "${file}"\n}\n\n# Prints the value. Returns 1 when the file cannot be read or sourced.\n# Callers run under if/||, which disables set -e, so a failing source must\n# exit explicitly. An empty value is success: the caller reports a missing key.\nread_offsite_var() {\n  local var_name="$1"\n  if [ ! -r "${OFFSITE_ENV_FILE}" ]; then\n    return 1\n  fi\n  (\n    set -u\n    # shellcheck source=/dev/null\n    . "${OFFSITE_ENV_FILE}" || exit 1\n    printf \'%s\' "${!var_name:-}"\n  )\n}\n\nload_offsite_var() {\n  local dest="$1"\n  local key="$2"\n  local value rc\n  rc=0\n  value="$(read_offsite_var "${key}")" || rc=$?\n  if [ "${rc}" -ne 0 ]; then\n    echo "Off-site backup env file is unreadable: ${OFFSITE_ENV_FILE}" >&2\n    backup_fail_reason=offsite-env-unreadable\n    return 1\n  fi\n  printf -v "${dest}" \'%s\' "${value}"\n}\n\npush_offsite() {\n  if [ ! -e "${OFFSITE_ENV_FILE}" ]; then\n    echo "Off-site backup env file is missing: ${OFFSITE_ENV_FILE}" >&2\n    backup_fail_reason=offsite-env-missing\n    return 1\n  fi\n  if [ ! -f "${OFFSITE_ENV_FILE}" ] || [ ! -r "${OFFSITE_ENV_FILE}" ]; then\n    echo "Off-site backup env file is unreadable: ${OFFSITE_ENV_FILE}" >&2\n    backup_fail_reason=offsite-env-unreadable\n    return 1\n  fi\n\n  local oss_access_key_id="" oss_access_key_secret="" oss_bucket="" oss_endpoint=""\n  load_offsite_var oss_access_key_id OSS_ACCESS_KEY_ID || return 1\n  load_offsite_var oss_access_key_secret OSS_ACCESS_KEY_SECRET || return 1\n  load_offsite_var oss_bucket OSS_BUCKET || return 1\n  load_offsite_var oss_endpoint OSS_ENDPOINT || return 1\n\n  local required_var required_value\n  for required_var in OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_BUCKET OSS_ENDPOINT; do\n    case "${required_var}" in\n      OSS_ACCESS_KEY_ID) required_value="${oss_access_key_id}" ;;\n      OSS_ACCESS_KEY_SECRET) required_value="${oss_access_key_secret}" ;;\n      OSS_BUCKET) required_value="${oss_bucket}" ;;\n      OSS_ENDPOINT) required_value="${oss_endpoint}" ;;\n    esac\n    if [ -z "${required_value}" ]; then\n      echo "Off-site backup env file is missing ${required_var}" >&2\n      backup_fail_reason="missing-${required_var}"\n      return 1\n    fi\n  done\n\n  tmp_rclone_env="$(mktemp)"\n  chmod 600 "${tmp_rclone_env}"\n  {\n    printf \'RCLONE_CONFIG_OSS_TYPE=s3\\n\'\n    printf \'RCLONE_CONFIG_OSS_PROVIDER=Alibaba\\n\'\n    printf \'RCLONE_CONFIG_OSS_ENDPOINT=%s\\n\' "${oss_endpoint}"\n    printf \'RCLONE_CONFIG_OSS_ACCESS_KEY_ID=%s\\n\' "${oss_access_key_id}"\n    printf \'RCLONE_CONFIG_OSS_SECRET_ACCESS_KEY=%s\\n\' "${oss_access_key_secret}"\n    printf \'RCLONE_CONFIG_OSS_ACL=private\\n\'\n  } > "${tmp_rclone_env}"\n\n  local backup_name\n  backup_name="$(basename "${OUT}")"\n  local remote_path="oss:${oss_bucket}/${PROJECT}/${backup_name}"\n  local remote_dir="oss:${oss_bucket}/${PROJECT}"\n  local container_backup="/backup/${backup_name}"\n\n  echo "Uploading ${backup_name} to off-site OSS bucket ${oss_bucket}/${PROJECT}"\n  if ! docker run --rm \\\n    --env-file "${tmp_rclone_env}" \\\n    -v "${BACKUP_DIR}:/backup:ro" \\\n    "${RCLONE_IMAGE}" \\\n    copyto "${container_backup}" "${remote_path}" --s3-no-check-bucket; then\n    echo "Off-site backup upload failed for ${backup_name}" >&2\n    backup_fail_reason=offsite-upload-failed\n    return 1\n  fi\n\n  echo "Verifying off-site backup ${backup_name}"\n  if ! docker run --rm \\\n    --env-file "${tmp_rclone_env}" \\\n    -v "${BACKUP_DIR}:/backup:ro" \\\n    "${RCLONE_IMAGE}" \\\n    check --one-way /backup "${remote_dir}" --include "/${backup_name}" --s3-no-check-bucket; then\n    echo "Off-site backup verification failed for ${backup_name}" >&2\n    backup_fail_reason=offsite-verify-failed\n    return 1\n  fi\n}\n\nmkdir -p "${BACKUP_DIR}"\n\ntmp_sql="$(mktemp "${BACKUP_DIR}/.${PROJECT}.${TIMESTAMP}.sql.XXXXXX")"\ntmp_gz="$(mktemp "${BACKUP_DIR}/.${PROJECT}.${TIMESTAMP}.sql.gz.XXXXXX")"\n\n# Prefer the read-only backup role. Fall back to the admin superuser when\n# PGDUMP_USER and PGDUMP_PASSWORD are both unset, so existing servers keep\n# dumping until the role split is applied. Never print these values.\ndump_user="$(read_env_var "${ENV_FILE}" PGDUMP_USER)"\ndump_password="$(read_env_var "${ENV_FILE}" PGDUMP_PASSWORD)"\nif [ -z "${dump_user}" ] && [ -z "${dump_password}" ]; then\n  dump_user="$(read_env_var "${ENV_FILE}" POSTGRES_USER)"\n  dump_password="$(read_env_var "${ENV_FILE}" POSTGRES_PASSWORD)"\nelif [ -z "${dump_user}" ] || [ -z "${dump_password}" ]; then\n  echo "Set both PGDUMP_USER and PGDUMP_PASSWORD, or leave both empty to use POSTGRES_USER" >&2\n  exit 1\nfi\nif [ -z "${dump_user}" ] || [ -z "${dump_password}" ]; then\n  echo "Backup credentials are missing from ${ENV_FILE}" >&2\n  exit 1\nfi\n\necho "Dumping ${PROJECT} as database role ${dump_user}"\n\n# pg_dump inside the postgres container uses the local socket. This image\'s\n# pg_hba trusts local and 127.0.0.1, so a wrong password would still succeed.\n# A second container on the compose network connects to host "postgres" over\n# TCP, which requires the password. Do not exec, and do not use --network host.\ndump_db="$(read_env_var "${ENV_FILE}" POSTGRES_DB)"\nif [ -z "${dump_db}" ]; then\n  echo "POSTGRES_DB is missing from ${ENV_FILE}" >&2\n  exit 1\nfi\npostgres_ids="$(\n  docker compose -p "${PROJECT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q postgres \\\n    | awk \'NF\'\n)" || {\n  echo "Could not list the postgres container; refusing to dump" >&2\n  exit 1\n}\npostgres_count="$(printf \'%s\\n\' "${postgres_ids}" | awk \'NF { n++ } END { print n + 0 }\')"\nif [ "${postgres_count}" -ne 1 ]; then\n  echo "Refusing to dump: expected exactly one postgres container, found ${postgres_count}" >&2\n  exit 1\nfi\npostgres_id="${postgres_ids}"\npostgres_image="$(docker inspect -f \'{{.Config.Image}}\' "${postgres_id}")" || {\n  echo "Could not read the postgres image; refusing to dump" >&2\n  exit 1\n}\npg_network="$(\n  docker inspect -f \'{{range $name, $conf := .NetworkSettings.Networks}}{{range $conf.Aliases}}{{if eq . "postgres"}}{{$name}}{{"\\n"}}{{end}}{{end}}{{end}}\' "${postgres_id}" \\\n    | awk \'NF\' | head -n 1\n)" || {\n  echo "Could not read the postgres network; refusing to dump" >&2\n  exit 1\n}\nif [ -z "${postgres_image}" ] || [ -z "${pg_network}" ]; then\n  echo "Could not find the postgres image or compose network; refusing to dump" >&2\n  exit 1\nfi\n\nexport PGDUMP_USER="${dump_user}"\nexport PGDUMP_DB="${dump_db}"\nexport PGPASSWORD="${dump_password}"\n# pg_dump is the left side of this pipe. With pipefail, its non-zero status\n# fails the script even when tee exits 0 and keeps a partial copy. The copy\n# is what the size check reads after a successful dump.\nbackup_fail_reason=pipefail\ndocker run --rm --network "${pg_network}" \\\n  -e PGPASSWORD \\\n  -e PGDUMP_USER \\\n  -e PGDUMP_DB \\\n  --entrypoint sh \\\n  "${postgres_image}" \\\n  -c \'pg_dump --no-password -h postgres -U "$PGDUMP_USER" -d "$PGDUMP_DB"\' \\\n  | tee "${tmp_sql}" >/dev/null\nbackup_fail_reason=""\nunset PGPASSWORD PGDUMP_USER PGDUMP_DB\ndump_password=""\n\nsql_size="$(wc -c < "${tmp_sql}")"\nif [ "${sql_size}" -lt 1024 ]; then\n  echo "Backup dump is unexpectedly small (${sql_size} bytes)" >&2\n  exit 1\nfi\n\ngzip -9 < "${tmp_sql}" > "${tmp_gz}"\ngzip -t "${tmp_gz}"\n\ngz_size="$(wc -c < "${tmp_gz}")"\nif [ "${gz_size}" -lt 128 ]; then\n  echo "Compressed backup is unexpectedly small (${gz_size} bytes)" >&2\n  exit 1\nfi\n\nmv "${tmp_gz}" "${OUT}"\ntmp_gz=""\n\noffsite_rc=0\npush_offsite || offsite_rc="$?"\n\nmapfile -t backups < <(ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null || true)\ndeclare -A keep=()\n\nif [ "${#backups[@]}" -gt 0 ]; then\n  keep["${backups[0]}"]=1\nfi\n\ndaily_count=0\nfor backup in "${backups[@]}"; do\n  if [ "${daily_count}" -lt 7 ]; then\n    keep["${backup}"]=1\n    daily_count=$((daily_count + 1))\n  fi\ndone\n\ndeclare -A seen_weeks=()\nweekly_count=0\nfor backup in "${backups[@]}"; do\n  if [ -n "${keep[${backup}]+x}" ]; then\n    continue\n  fi\n  week="$(date -u -r "${backup}" +%G-%V)"\n  if [ -z "${seen_weeks[${week}]+x}" ] && [ "${weekly_count}" -lt 4 ]; then\n    keep["${backup}"]=1\n    seen_weeks["${week}"]=1\n    weekly_count=$((weekly_count + 1))\n  fi\ndone\n\nfor backup in "${backups[@]}"; do\n  if [ -z "${keep[${backup}]+x}" ]; then\n    rm -f "${backup}"\n  fi\ndone\n\necho "Wrote ${OUT}"\nexit "${offsite_rc}"\n'

expect_remote = [103, 351, 751, 901, 947, 948]
expect_backup = [254]
remote_hits = scan_text("deploy/remote-deploy.sh", PRE_REMOTE)
backup_hits = scan_text("deploy/backup.sh", PRE_BACKUP)
remote_lines = hit_lines(remote_hits)
backup_lines = hit_lines(backup_hits)
if remote_lines != expect_remote:
    print(
        f"FAIL pre-fix remote-deploy.sh: expected {expect_remote} got {remote_lines}",
        file=sys.stderr,
    )
    for hit in remote_hits:
        print(hit, file=sys.stderr)
    sys.exit(1)
if backup_lines != expect_backup:
    print(
        f"FAIL pre-fix backup.sh: expected {expect_backup} got {backup_lines}",
        file=sys.stderr,
    )
    for hit in backup_hits:
        print(hit, file=sys.stderr)
    sys.exit(1)
print(
    f"OK pre-fix remote-deploy.sh reported {len(remote_lines)} early-exit pipes at {remote_lines}"
)
print(
    f"OK pre-fix backup.sh reported {len(backup_lines)} early-exit pipes at {backup_lines}"
)

hits = []
for path in sorted(root.rglob("*.sh")):
    if path.name == "no-early-pipe-exit.test.sh":
        continue
    hits.extend(scan_text(str(path.relative_to(root.parent)), path.read_text()))
if hits:
    print("FAIL early-exit pipe readers:", file=sys.stderr)
    for hit in hits:
        print(hit, file=sys.stderr)
    sys.exit(1)
print("OK deploy shell has no early-exit pipe readers")
PY
