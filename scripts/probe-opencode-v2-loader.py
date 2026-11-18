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
  setup() {
    appendFileSync(process.env.AGENTBREW_OC_LOADER_MARKER, "setup\\n");
  },
};
"""

with tempfile.TemporaryDirectory(prefix="agentbrew-opencode-loader-") as directory:
    root = Path(directory)
    home, workspace = root / "home", root / "workspace"
    workspace.mkdir()
    marker = root / "setup.marker"
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
        "AGENTBREW_OC_LOADER_MARKER": str(marker), "DO_NOT_TRACK": "1", "CI": "1",
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
        f"inventory-exit={inventory_exit} listed={listed} setup={len(marker_lines)} reaped=1"
    )
    if (
        anonymous != 401 or authenticated != 200 or config_exit != 0 or not json_ok
        or source_count != 1 or target_count != 1 or inventory_exit != 0
        or listed != 1 or marker_lines != ["setup"]
    ):
        raise SystemExit("the authenticated V2 startup was not verified")
