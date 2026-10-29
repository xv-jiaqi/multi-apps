#!/usr/bin/env bash
# Under set -o pipefail, a reader that exits before EOF delivers SIGPIPE
# (141) to the writer. deploy shell must not pipe into grep -q, head, or an
# awk that exits before END. Match a saved string, or read the whole stream.
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

def grep_is_quiet(args):
    for arg in args:
        if arg == "--":
            break
        if arg in ("--quiet", "--silent"):
            return True
        if arg.startswith("--"):
            continue
        if arg.startswith("-") and "q" in arg[1:]:
            return True
    return False

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

def classify(segment):
    toks = tokenize(segment.strip())
    while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
        toks.pop(0)
    if not toks:
        return None
    base = toks[0].rsplit("/", 1)[-1]
    if base == "grep" and grep_is_quiet(toks[1:]):
        return "grep -q closes the pipe on the first match"
    if base == "head":
        return "head closes the pipe before EOF"
    if base == "awk":
        program = awk_program(toks[1:])
        if program and re.search(r"\bexit\b", strip_end_blocks(program)):
            return "awk exit closes the pipe before EOF"
    return None

def scan_text(name, text):
    hits = []
    i = 0
    n = len(text)
    line = 1
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
        if c in ("'", '"'):
            quote = c
            i += 1
            continue
        if c == "#":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "\\" and i + 1 < n and text[i + 1] == "\n":
            i += 2
            line += 1
            continue
        if c == "|" and i + 1 < n and text[i + 1] == "|":
            i += 2
            continue
        if c == "\n":
            line += 1
            i += 1
            continue
        if c != "|":
            i += 1
            continue
        i += 1
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
            if c in ("'", '"'):
                seg_quote = c
                buf.append(c)
                i += 1
                continue
            if c == "\\" and i + 1 < n and text[i + 1] == "\n":
                i += 2
                line += 1
                continue
            if c in ";\n&|":
                break
            buf.append(c)
            i += 1
        reason = classify("".join(buf))
        if reason:
            preview = " ".join("".join(buf).split())
            if len(preview) > 120:
                preview = preview[:117] + "..."
            hits.append(f"{name}:{cmd_line}: {reason}: {preview}")
    return hits

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
