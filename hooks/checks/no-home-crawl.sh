#!/bin/bash
# agentbrew/hooks/checks/no-home-crawl.sh
#
# **Hook**: no-home-crawl
# **Event**: PreToolUse on Bash
# **Verdict**: block
# **Source rule**: owner request 2026-10-25 (load 322: recursive agent
# searches over the home folder made Spotlight and file-provider importers
# re-read files for hours)
#
# Blocks a recursive search whose root is too broad: `rg`, `grep -r/-R`,
# `ag`, `fd`, and `find` when the effective search root is $HOME,
# ~/Library, ~/Library/Application Support, or /. The root is the path
# argument, or the session cwd when no path is given (so `rg foo` from
# $HOME and `rg foo .` from $HOME both block). A `cd <dir> &&` earlier in
# the same command moves the cwd.
#
# **Allowed**:
#   - any narrower path, such as ~/.claude/projects/<project> or ~/apps/<repo>
#   - a depth limit of 2 or less (`--max-depth`/`-d` for rg and fd,
#     `--depth` for ag, `-maxdepth` for find)
#
# **Opt-out**: `AGENTBREW_ALLOW_HOME_SEARCH=1`, in the agent's environment
# or as a prefix on the command itself. `HOOK_BYPASS_NO_HOME_CRAWL=1` works too.

set -euo pipefail

__HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$__HOOK_DIR/lib" ]; then __HOOK_LIB_DIR="$__HOOK_DIR/lib"; else __HOOK_LIB_DIR="$__HOOK_DIR/../lib"; fi
# shellcheck source=../lib/stdin-json.sh
source "$__HOOK_LIB_DIR/stdin-json.sh"
# shellcheck source=../lib/verdict.sh
source "$__HOOK_LIB_DIR/verdict.sh"

readonly HOOK_ID="no-home-crawl"

if [ "${HOOK_BYPASS_NO_HOME_CRAWL:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "HOOK_BYPASS_NO_HOME_CRAWL=1"
fi
if [ "${AGENTBREW_ALLOW_HOME_SEARCH:-0}" = "1" ]; then
  verdict_bypass "$HOOK_ID" "AGENTBREW_ALLOW_HOME_SEARCH=1"
fi

INPUT="$(read_hook_stdin)"
HOOK_TOOL_NAME="$(json_get "$INPUT" '.tool_name')"
if [ "$HOOK_TOOL_NAME" != "Bash" ]; then
  verdict_bypass "$HOOK_ID" "tool $HOOK_TOOL_NAME is not Bash"
fi

COMMAND="$(json_get "$INPUT" '.tool_input.command')"
if [ -z "$COMMAND" ]; then
  verdict_bypass "$HOOK_ID" "no command to check"
fi

# Cheap pre-filter keeps python3 off the hot path for most Bash calls.
if ! grep -qE '(^|[^[:alnum:]_-])(rg|grep|ag|fd|find)([[:space:]]|$)' <<<"$COMMAND"; then
  verdict_allow "$HOOK_ID" "no search command"
fi

if ! command -v python3 >/dev/null 2>&1; then
  verdict_bypass "$HOOK_ID" "python3 not found"
fi

CWD="$(json_get "$INPUT" '.cwd')"
[ -n "$CWD" ] || CWD="$PWD"

# Prints "<tool>\t<root>" for the first too-broad search, or nothing.
FINDING="$(NHC_COMMAND="$COMMAND" NHC_CWD="$CWD" NHC_HOME="${HOME:-}" python3 - <<'PY' 2>/dev/null || true
import os, re, shlex

cmd = os.environ["NHC_COMMAND"]
cwd = os.environ["NHC_CWD"]
home = os.path.normpath(os.environ["NHC_HOME"] or "/")
broad = {"/", home, os.path.join(home, "Library"), os.path.join(home, "Library", "Application Support")}

# Options that take a value as the next word, per tool.
VALUE_OPTS = {
    "rg": {"-e", "-f", "-g", "--glob", "--iglob", "-t", "--type", "-T", "--type-not", "-m", "--max-count",
           "-A", "-B", "-C", "-j", "--threads", "-M", "--max-columns", "-d", "--max-depth", "-r", "--replace",
           "--sort", "--sortr", "-E", "--encoding", "--type-add", "--ignore-file", "--pre", "--max-filesize"},
    "grep": {"-e", "-f", "-m", "-A", "-B", "-C", "--include", "--exclude", "--exclude-dir", "-d", "-D"},
    "ag": {"-G", "--file-search-regex", "--depth", "-m", "--max-count", "-A", "-B", "-C", "--ignore", "-p", "--path-to-ignore"},
    "fd": {"-e", "--extension", "-t", "--type", "-E", "--exclude", "-d", "--max-depth", "--min-depth", "--exact-depth",
           "-S", "--size", "--changed-within", "--changed-before", "-o", "--owner", "-j", "--threads", "--base-directory",
           "--search-path", "-c", "--color", "--ignore-file"},
}
DEPTH_OPTS = {"rg": {"-d", "--max-depth"}, "ag": {"--depth"}, "fd": {"-d", "--max-depth", "--exact-depth"}}
WRAPPERS = {"sudo", "nice", "time", "command", "exec", "nohup", "env", "xargs"}

def expand(p):
    p = p.replace("${HOME}", home).replace("$HOME", home)
    if p == "~" or p.startswith("~/"):
        p = home + p[1:]
    return os.path.normpath(os.path.join(cwd_now, p))

def depth_ok(v):
    try:
        return int(v) <= 2
    except ValueError:
        return False

lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()\n")
lex.whitespace_split = True
try:
    words = list(lex)
except ValueError:
    raise SystemExit(0)

segments, cur = [], []
for w in words:
    if w and set(w) <= set(";&|()\n"):
        if cur:
            segments.append(cur)
        cur = []
    else:
        cur.append(w)
if cur:
    segments.append(cur)

cwd_now = cwd
for seg in segments:
    allow_env = False
    while seg and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", seg[0]) or seg[0] in WRAPPERS or (seg[0].startswith("-") and len(seg) > 1) or seg[0].isdigit()):
        if seg[0] == "AGENTBREW_ALLOW_HOME_SEARCH=1":
            allow_env = True
        seg = seg[1:]
    if not seg:
        continue
    tool = os.path.basename(seg[0])
    args = seg[1:]
    if tool == "cd":
        cwd_now = expand(args[0]) if args else home
        continue
    if allow_env or tool not in ("rg", "grep", "ag", "fd", "find"):
        continue

    paths, deep_ok = [], False
    if tool == "find":
        i = 0
        while i < len(args) and args[i] in ("-H", "-L", "-P", "-E", "-X", "-s", "-x", "-d"):
            i += 1
        while i < len(args) and not args[i].startswith("-") and args[i] not in ("(", "!"):
            paths.append(args[i]); i += 1
        for j, a in enumerate(args):
            if a == "-maxdepth" and j + 1 < len(args) and depth_ok(args[j + 1]):
                deep_ok = True
        if not paths:
            paths = ["."]
    else:
        recursive = tool != "grep"
        explicit_pattern = files_mode = False
        positionals = []
        i = 0
        while i < len(args):
            a = args[i]
            if a == "--":
                positionals.extend(args[i + 1:]); break
            if tool == "fd" and a in ("-x", "--exec", "-X", "--exec-batch"):
                break
            if a.startswith("--") and "=" in a:
                name, val = a.split("=", 1)
                if name in DEPTH_OPTS.get(tool, ()) and depth_ok(val):
                    deep_ok = True
                if name in ("--regexp", "--file"):
                    explicit_pattern = True
                if name == "--search-path":
                    paths.append(val)
                i += 1; continue
            if a.startswith("-") and a != "-":
                if tool == "grep" and not a.startswith("--") and re.search(r"[rR]", a):
                    recursive = True
                if a in ("--recursive", "--dereference-recursive"):
                    recursive = True
                if a in ("-e", "-f", "--regexp", "--file"):
                    explicit_pattern = True
                if a == "--files":
                    files_mode = True
                if a in VALUE_OPTS.get(tool, ()) or a in ("--regexp", "--file"):
                    val = args[i + 1] if i + 1 < len(args) else ""
                    if a in DEPTH_OPTS.get(tool, ()) and depth_ok(val):
                        deep_ok = True
                    if a == "--search-path":
                        paths.append(val)
                    i += 2; continue
                i += 1; continue
            positionals.append(a); i += 1
        if not recursive:
            continue
        if not (explicit_pattern or files_mode) and positionals:
            positionals = positionals[1:]
        paths.extend(positionals)
        if not paths:
            paths = ["."]
    if deep_ok:
        continue
    for p in paths:
        root = expand(p)
        if root in broad:
            print(f"{tool}\t{root}")
            raise SystemExit(0)
PY
)"

if [ -n "$FINDING" ]; then
  TOOL="${FINDING%%$'\t'*}"
  ROOT="${FINDING#*$'\t'}"
  verdict_block "$HOOK_ID" "\`$TOOL\` would search all of $ROOT. Crawls this wide run for many minutes and make Spotlight and the Apple file importers re-read files, so the whole Mac slows down. Search a narrower path instead, such as ~/.claude/projects/<project> for session logs or ~/apps/<repo> for code, or add a depth limit of 2 or less (--max-depth 2, -maxdepth 2). If you really need the wide search, prefix the command with AGENTBREW_ALLOW_HOME_SEARCH=1."
fi

verdict_allow "$HOOK_ID" "search root is narrow enough"
