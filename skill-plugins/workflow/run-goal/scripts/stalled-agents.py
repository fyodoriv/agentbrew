#!/usr/bin/env python3
"""List workers of a Claude Code session that stopped making progress.

A background subagent that waits for a background shell's completion notice
waits forever when that shell is killed: no notice ever comes, and nothing
looks wrong from outside. This script finds that state from the files on
disk, so the lead agent can resume the worker at once.

It reads, for one session:

- `<projects>/<project>/<session>/subagents/agent-<id>.meta.json` and
  `.jsonl`: a worker whose meta has no `"finished": true` and whose
  transcript has not changed for `--minutes` is STALLED. A worker stopped
  on purpose (`"stoppedByUser": true`) is never STALLED.
- `<tmp>/claude-<uid>/<project>/<session>/tasks/<id>.output` (plain files,
  not the agent symlinks): a background shell whose output ends with
  `[killed]` is KILLED. These lines show only next to a STALLED one, and
  only for shells killed after that worker last wrote: an expired Monitor
  ends `[killed]` too, and alone it is no problem.

Output: one line per finding, `STALLED <agent id> <minutes>m <description>`
or `KILLED <task id>`. It only reads files. Exit code: 0 with no finding,
1 with findings, 2 when the session is not found.

With `--watch SECONDS` it never exits: it checks every SECONDS and prints
each finding once (a worker that writes again and later stalls again is
printed again). Run it as a Monitor for the whole goal.

Usage: stalled-agents.py --session ID [--minutes 20] [--watch SECONDS]
       stalled-agents.py --session-dir DIR --tasks-dir DIR [...]
Defaults: --projects ~/.claude/projects, --tmp /private/tmp (then /tmp).
"""

import argparse
import glob
import json
import os
import sys
import time
from pathlib import Path


def find_dirs(args):
    """Return (session dir or None, list of tasks dirs) for the arguments."""
    if args.session_dir:
        return Path(args.session_dir), [Path(args.tasks_dir)] if args.tasks_dir else []
    projects = os.path.expanduser(args.projects)
    hits = glob.glob(os.path.join(projects, "*", args.session))
    if not hits:
        return None, []
    # The newest folder is the live one when the id shows up under several slugs.
    session_dir = Path(max(hits, key=os.path.getmtime))
    # The same session id can have a tasks folder under several project
    # slugs (a spare checkout, for one); prefer the session's own project.
    found = []
    for root in (args.tmp, "/private/tmp", "/tmp"):
        # /tmp links to /private/tmp on macOS: keep each folder once.
        found += [
            os.path.realpath(f)
            for f in glob.glob(os.path.join(root, "claude-*", "*", args.session, "tasks"))
        ]
    own = [f for f in found if Path(f).parent.parent.name == session_dir.parent.name]
    tasks = [Path(f) for f in dict.fromkeys(own or found)]
    return session_dir, tasks


def stalled(session_dir, minutes, now):
    """Yield (agent id, silent minutes, description, last write) for each stalled worker."""
    for meta_path in sorted((session_dir / "subagents").glob("agent-*.meta.json")):
        try:
            meta = json.loads(meta_path.read_text())
        except (OSError, ValueError):
            continue
        if meta.get("finished") is True or meta.get("stoppedByUser") is True:
            continue
        agent_id = meta_path.name[len("agent-") : -len(".meta.json")]
        transcript = meta_path.with_name(f"agent-{agent_id}.jsonl")
        try:
            last = transcript.stat().st_mtime
        except OSError:
            last = meta_path.stat().st_mtime
        silent = int((now - last) // 60)
        if silent >= minutes:
            yield agent_id, silent, meta.get("description", ""), last


def killed(tasks_dirs, since=0.0):
    """Yield the task id of each background shell whose output ends killed at or after `since`."""
    outs = sorted(o for d in tasks_dirs if d.is_dir() for o in d.glob("*.output"))
    for out in outs:
        if out.is_symlink():
            continue
        try:
            st = out.stat()
            if st.st_mtime < since:
                continue
            size = st.st_size
            with out.open("rb") as fh:
                fh.seek(max(0, size - 64))
                tail = fh.read().decode("utf-8", "replace").strip()
        except OSError:
            continue
        if tail.endswith("[killed]"):
            yield out.name[: -len(".output")]


def findings(session_dir, tasks_dirs, minutes, now):
    lines, since = [], now
    for agent_id, silent, desc, last in stalled(session_dir, minutes, now):
        lines.append((("STALLED", agent_id, silent), f"STALLED {agent_id} {silent}m {desc}".rstrip()))
        since = min(since, last)
    # A killed shell alone is no problem: an expired Monitor also ends
    # "[killed]". It only explains a stalled worker, so list it only then,
    # and only when it was killed after that worker last wrote.
    if not lines:
        return lines
    for task_id in killed(tasks_dirs, since - 60):
        lines.append((("KILLED", task_id), f"KILLED {task_id}"))
    return lines


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--session", help="session id")
    p.add_argument("--session-dir", help="the session's folder (holds subagents/)")
    p.add_argument("--tasks-dir", help="the session's tasks folder")
    p.add_argument("--projects", default="~/.claude/projects")
    p.add_argument("--tmp", default=os.environ.get("TMPDIR_ROOT", "/private/tmp"))
    p.add_argument("--minutes", type=int, default=20)
    p.add_argument("--watch", type=int, default=0, help="check every N seconds, never exit")
    p.add_argument("--now", type=float, help=argparse.SUPPRESS)
    args = p.parse_args(argv)
    if not args.session and not args.session_dir:
        p.error("give --session or --session-dir")

    session_dir, tasks_dir = find_dirs(args)
    if session_dir is None or not session_dir.is_dir():
        print(f"session not found: {args.session or args.session_dir}", file=sys.stderr)
        return 2

    if not args.watch:
        lines = findings(session_dir, tasks_dir, args.minutes, args.now or time.time())
        for _, text in lines:
            print(text)
        return 1 if lines else 0

    seen = set()
    while True:
        current = findings(session_dir, tasks_dir, args.minutes, time.time())
        # A stalled worker is keyed without its minutes, so it prints once per stall.
        keys = {(k[0], k[1]) for k, _ in current}
        for key, text in current:
            if (key[0], key[1]) not in seen:
                print(text, flush=True)
        seen = keys | {k for k in seen if k[0] == "KILLED"}
        time.sleep(args.watch)


if __name__ == "__main__":
    sys.exit(main())
