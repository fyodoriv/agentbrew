"""Verify unchanged OpenCode 1 hooks with a private scratch home."""
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

binary = str(Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory(prefix="agentbrew-opencode-v1-") as tmp:
    root = Path(tmp)
    home, workspace = root / "home", root / "workspace"
    workspace.mkdir()
    config = home / ".config/opencode"
    plugins = config / "plugin"
    plugins.mkdir(parents=True)
    shutil.copyfile("templates/opencode/claude-hooks.js", plugins / "claude-hooks.js")
    marker, hook, settings = (root / name for name in ("events", "hook.cjs", "hooks.json"))
    hook.write_text("""
const fs = require("node:fs");
const input = JSON.parse(fs.readFileSync(0,"utf8"));
if (input.cwd !== process.env.FIXTURE_WORKSPACE || !/^ses_[a-zA-Z0-9]+$/.test(input.session_id)) process.exit(2);
fs.appendFileSync(process.env.FIXTURE_MARKER, JSON.stringify([input.hook_event_name, input.session_id]) + "\\n");
""")
    command = {"type": "command", "command": "node " + shlex.quote(str(hook))}
    settings.write_text(json.dumps({"hooks": {event: [{"hooks": [command]}] for event in ("SessionStart", "SessionEnd")}}))
    env = {
        "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(root),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "XDG_CACHE_HOME": str(home / ".cache"),
        "FIXTURE_WORKSPACE": str(workspace), "FIXTURE_MARKER": str(marker),
        "CLAUDE_HOOKS_SETTINGS": str(settings), "OPENCODE_DISABLE_MODELS_FETCH": "1", "DO_NOT_TRACK": "1", "CI": "1",
    }
    common = {"cwd": workspace, "env": env, "stdin": subprocess.DEVNULL}
    version = subprocess.run([binary, "--version"], **common, capture_output=True, timeout=10)
    if version.returncode or version.stdout.decode().strip() != "1.19.5":
        raise SystemExit("OpenCode 1.19.5 was not verified")
    with socket.socket() as socket_slot:
        socket_slot.bind(("127.0.0.1", 0))
        port = socket_slot.getsockname()[1]
    base = f"http://127.0.0.1:{port}"

    def call(path, method="GET", body=None):
        request = Request(base + path, method=method, data=body, headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=2) as response:
            return json.load(response)

    def events():
        return [json.loads(row) for row in marker.read_text().splitlines()] if marker.exists() else []

    def wait_until(predicate, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                if predicate():
                    return True
            except (URLError, TimeoutError):
                pass
            time.sleep(0.1)
        return False

    with (root / "server.log").open("wb") as log:
        server = subprocess.Popen(
            [binary, "serve", "--hostname", "127.0.0.1", "--port", str(port)],
            **common, stdout=log, stderr=log, start_new_session=True,
        )
        ready = created = removed = started = ended = False
        try:
            ready = wait_until(lambda: call("/global/health").get("healthy") is True, 10)
            if ready:
                session = call("/session", "POST", b"{}").get("id")
                created = isinstance(session, str) and session.startswith("ses_")
                if created:
                    started = wait_until(lambda: events() == [["SessionStart", session]], 4)
                    removed = call("/session/" + session, "DELETE") is True
                    ended = wait_until(lambda: events() == [["SessionStart", session], ["SessionEnd", session]], 4)
        except HTTPError as error:
            print(f"v1-session-http={error.code}")
        finally:
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGTERM)
            try:
                server.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait(timeout=3)
    print(f"v1=1.19.5 healthy={int(ready)} created={int(created)} removed={int(removed)} "
          f"start={int(started)} end={int(ended)} records={len(events())} reaped=1")
    if not all((ready, created, removed, started, ended)) or len(events()) != 2:
        raise SystemExit("the installed legacy bridge did not meet the V1 lifecycle control")
