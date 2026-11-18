import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time

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
    environment = {
        "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(root),
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_STATE_HOME": str(home / ".local/state"), "XDG_CACHE_HOME": str(home / ".cache"),
        "AGENTBREW_OC_LOADER_MARKER": str(marker), "DO_NOT_TRACK": "1", "CI": "1",
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
    config_exit = "unavailable"
    inventory_exit = "unavailable"
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
                try:
                    result = subprocess.run(
                        [str(binary), "debug", "config", "--server", endpoint],
                        **common, capture_output=True, timeout=10,
                    )
                    config_exit = result.returncode
                    if config_exit == 0:
                        try:
                            payload = json.loads(result.stdout)
                            json_ok = True
                            strings = list(values(payload))
                            source_count = sum(item == str(document) for item in strings)
                            target_count = sum(item in (target, str(plugins), plugins.as_uri()) for item in strings)
                        except (ValueError, UnicodeError):
                            pass
                except subprocess.TimeoutExpired:
                    config_exit = "deadline"
                try:
                    inventory = subprocess.run(
                        [str(binary), "plugin", "list", "--server", endpoint],
                        **common, capture_output=True, timeout=10,
                    )
                    inventory_exit = inventory.returncode
                except subprocess.TimeoutExpired:
                    inventory_exit = "deadline"
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)

    print(
        f"version=2.3.0 socket={int(socket_ready)} config-exit={config_exit} json={int(json_ok)} "
        f"document={source_count} target={target_count} inventory-exit={inventory_exit} reaped=1"
    )
    if not socket_ready or config_exit != 0 or not json_ok or source_count != 1 or target_count != 1 or inventory_exit != 0:
        raise SystemExit("the server configuration route could not be verified")
