#!/bin/bash

set -euo pipefail

tool_path="${PATH:-}"
export PATH=/usr/bin:/bin
unset DOTFILES_DIR DOTFILES_JQ

hook_dir="${BASH_SOURCE[0]%/*}"
[[ "${BASH_SOURCE[0]}" == */* ]] || hook_dir=.
hook_dir="$(CDPATH='' cd -- "${hook_dir:-/}" && pwd)"
if [ -d "$hook_dir/lib" ]; then hook_lib="$hook_dir/lib"; else hook_lib="$hook_dir/../lib"; fi
source "$hook_lib/stdin-json.sh"
source "$hook_lib/verdict.sh"

readonly HOOK_ID=tasks-md-lint-on-edit
INPUT="$(read_hook_stdin)"

status=0
tool=$(/usr/bin/python3 -I -S - "$tool_path:$PATH" 3<<<"$INPUT" 2>/dev/null <<'PY'
from pathlib import Path
import json
import os
import shutil
import signal
import subprocess
import sys

try:
    with os.fdopen(3) as stream:
        event = json.load(stream)
    if event["hook_event_name"] != "PostToolUse":
        sys.exit(14)
    tool = event["tool_name"]
    if tool not in ("Edit", "Write"):
        sys.exit(14)
    file = Path(event["tool_input"]["file_path"])
    if file.name != "TASKS.md":
        sys.exit(14)
    working_dir = Path(event.get("cwd") or os.getcwd()).resolve()
except (KeyError, TypeError, ValueError):
    sys.exit(14)
print(tool)

if not file.is_absolute():
    file = working_dir / file
project = file.parent.resolve()
file = project / "TASKS.md"
if file.is_symlink() or not file.is_file() or not (project / ".git").exists():
    sys.exit(10)

session_project = next(
    (parent for parent in (working_dir, *working_dir.parents) if (parent / ".git").exists()),
    working_dir,
)

def within_project(path):
    return any(path == root or root in path.parents for root in (project, session_project))

# The edit can supply a project path. The linter comes from the tool PATH.
directories = []
for part in sys.argv[1].split(os.pathsep):
    item = Path(part)
    if item.is_absolute() and not within_project(item.resolve()):
        directories.append(part)
tool_path = os.pathsep.join(directories)
candidate = shutil.which("tasks-lint", path=tool_path) if directories else None
if not candidate or within_project(Path(candidate).resolve()):
    sys.exit(12)

node = shutil.which("node", path=tool_path)
if node and within_project(Path(node).resolve()):
    sys.exit(12)
runner_path = "/usr/bin:/bin"
if node:
    runner_path = f"{Path(node).parent}{os.pathsep}{runner_path}"
environment = {"PATH": runner_path}
for name in ("HOME", "LANG", "LC_ALL", "TMPDIR"):
    if name in os.environ:
        environment[name] = os.environ[name]
try:
    process = subprocess.Popen(
        [candidate, "--require-prereg", str(file)],
        cwd=Path(candidate).resolve().parent,
        env=environment,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    result = process.wait(timeout=1.25)
except subprocess.TimeoutExpired:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()
    sys.exit(13)
except OSError:
    sys.exit(12)
sys.exit({0: 0, 1: 11}.get(result, 12))
PY
) || status=$?

if [[ -n "$tool" ]]; then
  export HOOK_EVENT_NAME=PostToolUse HOOK_TOOL_NAME="$tool"
fi

case "$status" in
  0) verdict_allow "$HOOK_ID" "task file passed validation" ;;
  10) verdict_bypass "$HOOK_ID" "not a root task file" ;;
  11) verdict_block "$HOOK_ID" 'TASKS.md failed validation. Run tasks-lint --require-prereg TASKS.md and fix the reported fields.' ;;
  13) verdict_warn "$HOOK_ID" "The task edit check reached its time limit. Run the task linter directly." ;;
  14) verdict_bypass "$HOOK_ID" "outside task file edit events" ;;
  *) verdict_warn "$HOOK_ID" "The task edit check needs a working tasks-lint installation outside the project." ;;
esac
