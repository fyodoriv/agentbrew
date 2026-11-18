from base64 import b64encode
import json
import os
from pathlib import Path
import re
from secrets import token_hex
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

binary = Path(sys.argv[1]).resolve(strict=True)
identifier = "agentbrew.loader-control"
plugin = """import { appendFileSync } from "node:fs";
export default {
  id: "agentbrew.loader-control",
  setup(ctx) {
    const controller = new AbortController();
    const types = ["session.created", "session.deleted"];
    const events = ctx.event.subscribe({ types, signal: controller.signal })[Symbol.asyncIterator]();
    const first = events.next();
    const path = process.env.AGENTBREW_OC_EVENTS;
    void (async () => {
      for (let current = await first; !current.done; current = await events.next()) {
        const event = current.value;
        appendFileSync(path, JSON.stringify({ type: event.type, id: event.data?.sessionID }) + "\\n");
      }
    })().catch(() => {
      if (!controller.signal.aborted) appendFileSync(path, '{"type":"error"}\\n');
    });
    appendFileSync(process.env.AGENTBREW_OC_LOADER_MARKER, "setup\\n");
    return () => controller.abort();
  },
};
"""

with tempfile.TemporaryDirectory(prefix="agentbrew-opencode-loader-") as directory:
    root = Path(directory)
    home, workspace = root / "home", root / "workspace"
    workspace.mkdir()
    marker = root / "setup.marker"
    event_log = root / "events.jsonl"
    config = home / ".config/opencode"
    plugins = config / "loader-fixture"
    plugins.mkdir(parents=True)
    document = config / "opencode.json"
    target = "./loader-fixture"
    document.write_text(json.dumps({"plugins": [target]}))
    (plugins / "index.js").write_text(plugin)
    password = token_hex(24)
    environment = {
        "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(root),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "XDG_CACHE_HOME": str(home / ".cache"),
        "AGENTBREW_OC_LOADER_MARKER": str(marker), "AGENTBREW_OC_EVENTS": str(event_log),
        "DO_NOT_TRACK": "1", "CI": "1",
        "OPENCODE_PASSWORD": password, "OPENCODE_DISABLE_MODELS_FETCH": "1",
    }
    common = {"cwd": workspace, "env": environment, "stdin": subprocess.DEVNULL}

    version = subprocess.run([str(binary), "--version"], **common, capture_output=True, timeout=10)
    parsed = re.fullmatch(r"(?:opencode v)?(\d+\.\d+\.\d+)", version.stdout.decode(errors="replace").strip())
    if version.returncode or not parsed or parsed.group(1) != "2.3.0":
        raise SystemExit("OpenCode 2.3.0 not verified")

    with socket.socket() as allocation:
        allocation.bind(("127.0.0.1", 0))
        port = allocation.getsockname()[1]
    endpoint = f"http://127.0.0.1:{port}"
    socket_ready = False
    source_count = 0
    target_count = 0
    anonymous = "unavailable"
    authenticated = "unavailable"
    config_exit = "unavailable"
    inventory_exit = "unavailable"
    listed = 0
    marker_lines = []
    json_ok = False
    lifecycle = "unavailable"
    created = deleted = other = 0

    def values(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for item in value.values():
                yield from values(item)
        elif isinstance(value, list):
            for item in value:
                yield from values(item)

    with (root / "server.log").open("wb") as log:
        process = subprocess.Popen(
            [str(binary), "serve", "--hostname", "127.0.0.1", "--port", str(port)],
            **common, stdout=log, stderr=log, start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 10
            while process.poll() is None and time.monotonic() < deadline:
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                        socket_ready = True
                    break
                except OSError:
                    time.sleep(0.2)
            if socket_ready:
                opener = build_opener(ProxyHandler({}))
                address = endpoint + "/api/info"

                def health(headers):
                    try:
                        with opener.open(Request(address, headers=headers), timeout=2) as response:
                            return response.status
                    except HTTPError as error:
                        return error.code
                    except (URLError, TimeoutError):
                        return "transport"

                anonymous = health({})
                header = b64encode(f"opencode:{password}".encode()).decode()
                authenticated = health({"Authorization": f"Basic {header}"})

                def client(*arguments, timeout=10):
                    try:
                        return subprocess.run(
                            [str(binary), "--server", endpoint, *arguments],
                            **common, capture_output=True, timeout=timeout,
                        )
                    except subprocess.TimeoutExpired:
                        return None

                result = client("debug", "config")
                config_exit = result.returncode if result else "deadline"
                if config_exit == 0:
                    try:
                        payload = json.loads(result.stdout)
                        strings = list(values(payload))
                        source_count = sum(item == str(document) for item in strings)
                        target_count = sum(item in (target, str(plugins), plugins.as_uri()) for item in strings)
                        json_ok = True
                    except (ValueError, UnicodeError):
                        pass
                if config_exit == 0 and json_ok and source_count == target_count == 1:
                    deadline = time.monotonic() + 30
                    while process.poll() is None and time.monotonic() < deadline:
                        remaining = deadline - time.monotonic()
                        inventory = client("plugin", "list", timeout=min(3, max(0.001, remaining)))
                        inventory_exit = inventory.returncode if inventory else "deadline"
                        listed = inventory.stdout.decode(errors="replace").count(identifier) if inventory_exit == 0 else 0
                        marker_lines = marker.read_text().splitlines() if marker.is_file() else []
                        if listed == 1 and marker_lines == ["setup"]:
                            break
                        time.sleep(min(0.5, max(0, deadline - time.monotonic())))

                def observed():
                    if not event_log.is_file():
                        return []
                    return [json.loads(line) for line in event_log.read_text().splitlines()]

                def await_count(expected):
                    deadline = time.monotonic() + 4
                    items = observed()
                    while len(items) < expected and time.monotonic() < deadline:
                        time.sleep(0.1)
                        items = observed()
                    return items

                if listed == 1 and marker_lines == ["setup"]:
                    request_headers = {"Authorization": f"Basic {header}", "Content-Type": "application/json"}
                    try:
                        create = Request(
                            endpoint + "/api/session",
                            data=json.dumps({"title": "Synthetic lifecycle control", "location": {"directory": str(workspace)}}).encode(),
                            headers=request_headers, method="POST",
                        )
                        with opener.open(create, timeout=5) as response:
                            session = json.loads(response.read())["data"]["id"]
                        if not isinstance(session, str) or not re.fullmatch(r"ses_[a-zA-Z0-9]+", session):
                            raise ValueError("unexpected fixture session identity")
                        await_count(1)
                        remove = Request(endpoint + "/api/session/" + session, headers=request_headers, method="DELETE")
                        with opener.open(remove, timeout=5) as response:
                            if response.status != 204:
                                raise ValueError("fixture session removal failed")
                        items = await_count(2)
                        created = items.count({"type": "session.created", "id": session})
                        deleted = items.count({"type": "session.deleted", "id": session})
                        other = len(items) - created - deleted
                        lifecycle = "observed"
                    except (KeyError, ValueError, OSError):
                        lifecycle = "read-failed"
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)

    print(
        f"version=2.3.0 socket={int(socket_ready)} anonymous={anonymous} authenticated={authenticated} "
        f"config-exit={config_exit} json={int(json_ok)} document={source_count} target={target_count} "
        f"inventory-exit={inventory_exit} listed={listed} setup={len(marker_lines)} reaped=1 "
        f"lifecycle={lifecycle} created={created} deleted={deleted} other={other}"
    )
    if (
        anonymous != 401 or authenticated != 200 or config_exit != 0 or not json_ok
        or source_count != 1 or target_count != 1 or inventory_exit != 0
        or listed != 1 or marker_lines != ["setup"] or created != 1 or deleted != 1 or other != 0
    ):
        raise SystemExit("the V2 session lifecycle control was not verified")
