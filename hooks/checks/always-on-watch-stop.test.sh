#!/bin/bash
set -euo pipefail
here="${BASH_SOURCE[0]%/*}"
python3 - "$here/always-on-watch-stop.sh" <<'PY'
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

hook = Path(sys.argv[1]).resolve()
marker = "SYNTHETIC_PRIVATE_WATCH_INPUT"
failure = "[hook always-on-watch-stop] This watcher session has no live watch. Verify the watch before ending this turn."
cases = [
    ("C01", 2, {}),
    ("C02", 0, {"watch": f"pid={os.getpid()}"}),
    ("C03", 2, {"watch": "pid=2147483647"}),
    ("C04", 0, {"watch": f"cron={marker}"}),
    ("C05", 2, {"watch": f"cron={marker}", "stamp_age": 120}),
    ("C06", 2, {"watch": f"cron={marker}", "stamp_age": -120}),
    ("C07", 0, {"wrapup": True}),
    ("C08", 0, {"request": "Please wrap up this turn."}),
    ("C09", 0, {"request": "Please stop this session now. Give me a summary."}),
    ("C10", 0, {"reentry": True}),
    ("C11", 0, {"disabled": True}),
    ("C12", 0, {"project": marker}),
    ("C13", 0, {"transcript_missing": True}),
    ("C14", 0, {"session": "../outside"}),
    ("C15", 0, {"symlink": True}),
    ("C16", 2, {"tool_imitation": True}),
    ("C17", 0, {"not_enrolled": True}),
    ("C18", 0, {"reentry_missing": True}),
    ("C19", 0, {"mixed_user_row": True}),
    ("C20", 0, {"request": ""}),
    ("C21", 2, {"request": "Do not wrap up. Continue watching."}),
    ("C22", 0, {"partial_row": True}),
    ("C25", 0, {"nonobject_row": True}),
    ("C26", 0, {"malformed_text": True}),
]


def snapshot(directory):
    result = {}
    for path in directory.iterdir():
        mode = path.lstat()
        value = os.readlink(path) if stat.S_ISLNK(mode.st_mode) else path.read_bytes()
        result[path.name] = (mode.st_mode, mode.st_mtime_ns, value)
    return result


def run_case(root, name, expected, options):
    case = root / name
    case.mkdir(mode=0o700)
    stamps = case / "stamps"
    stamps.mkdir(mode=0o700)
    (stamps / "session.project").write_text(options.get("project", "example-project"))
    if options.get("wrapup"):
        (stamps / "session.wrapup").write_text(marker)
    watch = stamps / "session.watch"
    if "watch" in options:
        watch.write_text(options["watch"])
        when = time.time() - options.get("stamp_age", 0)
        os.utime(watch, (when, when))
    if options.get("symlink"):
        watch.symlink_to(stamps / "session.project")

    transcript = case / "transcript.jsonl"
    if not options.get("transcript_missing"):
        message = options.get("request", f"Continue the watch. {marker}")
        rows = [{"type": "user", "message": {"content": message}}]
        if options.get("tool_imitation"):
            rows.append({"type": "user", "message": {"content": [{"type": "tool_result", "content": "wrap up"}]}})
        if options.get("mixed_user_row"):
            rows.append({"type": "user", "message": {"content": [
                {"type": "text", "text": "Stop now."},
                {"type": "tool_result", "content": "Continue"},
            ]}})
        if options.get("nonobject_row"):
            rows.append([])
        if options.get("malformed_text"):
            rows.append({"type": "user", "message": {"content": [
                {"type": "text", "text": "Keep watching."},
                {"type": "text", "text": 1},
            ]}})
        content = "\n".join(json.dumps(row) for row in rows) + "\n"
        transcript.write_text(content + ('{"type"' if options.get("partial_row") else ""))

    event = {"hook_event_name": "Stop", "session_id": options.get("session", "session"), "transcript_path": str(transcript)}
    if not options.get("reentry_missing"):
        event["stop_hook_active"] = options.get("reentry", False)
    environment = {
        "PATH": os.environ["PATH"],
        "HOME": str(case),
        "XDG_CACHE_HOME": str(case / "cache"),
        "HOOK_PYTHON": sys.executable,
        "ALWAYS_ON_CRON_MAX_AGE": "60",
    }
    if not options.get("not_enrolled"):
        environment.update(ALWAYS_ON_DIR=str(stamps), ALWAYS_ON_PROJECTS="example-project, second-example")
    if options.get("disabled"):
        environment["ALWAYS_ON_STOP_GUARD"] = "off"

    before = snapshot(stamps)
    completed = subprocess.run(["bash", str(hook)], input=json.dumps(event), env=environment,
                               capture_output=True, text=True, timeout=10)
    assert completed.returncode == expected, f"{name} returned exit {completed.returncode}, expected {expected}"
    assert completed.stdout == "", f"{name} returned unexpected stdout"
    assert completed.stderr.strip() == (failure if expected == 2 else ""), f"{name} returned unexpected stderr"
    assert marker not in completed.stdout + completed.stderr, f"{name} exposed input"
    assert snapshot(stamps) == before, f"{name} changed the stamps"


def run_concurrent_controls(root):
    module = runpy.run_path(str(hook.parent.parent / "lib" / "always-on-watch-stop.py"))
    decide = module["should_remind"]
    read_request = module["latest_user_request"]
    directory = root / "changes"
    directory.mkdir(mode=0o700)
    (directory / "session.project").write_text("example-project")
    transcript = directory / "transcript.jsonl"
    transcript.write_text(json.dumps({"type": "user", "message": {"content": "Keep watching."}}) + "\n")
    wrapup = directory / "session.wrapup"

    def publish_owner_stop(path):
        request = read_request(path)
        temporary = directory / "new-wrapup"
        temporary.write_text(marker)
        os.replace(temporary, wrapup)
        return request

    before = snapshot(directory)
    settings = {"ALWAYS_ON_DIR": str(directory), "ALWAYS_ON_PROJECTS": "example-project", "ALWAYS_ON_CRON_MAX_AGE": "60"}
    event = {"hook_event_name": "Stop", "session_id": "session", "transcript_path": str(transcript), "stop_hook_active": False}
    with patch.dict(os.environ, settings), patch.dict(decide.__globals__, {"latest_user_request": publish_owner_stop}):
        assert decide(event) is False, "C23 blocked after the injected owner stop"
    assert wrapup.read_text() == marker, "C23 did not publish the owner stop"
    assert {name: value for name, value in snapshot(directory).items() if name != wrapup.name} == before, "C23 changed another stamp"

    watch = directory / "session.watch"
    watch.write_text("cron=first")
    stream, info = module["trusted_file"](str(watch))
    with stream:
        replacement = directory / "new-watch"
        replacement.write_text("cron=second")
        os.replace(replacement, watch)
        stream.read()
        try:
            module["verify_current_file"](stream, info, str(watch))
        except OSError:
            pass
        else:
            raise AssertionError("C24 accepted a replaced watch as current")


with tempfile.TemporaryDirectory(prefix="always-on-watch-stop-") as temporary:
    root = Path(temporary)
    for name, expected, options in cases:
        run_case(root, name, expected, options)
    run_concurrent_controls(root)

blocks = sum(expected == 2 for _, expected, _ in cases)
print(f"{len(cases) + 2} cases passed: {blocks} reminders, {len(cases) + 2 - blocks} allowed or safely refused, 0 input disclosures")
PY
