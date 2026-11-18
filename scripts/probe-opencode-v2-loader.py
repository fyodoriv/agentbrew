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
    plugins = config / "plugin"
    plugins.mkdir(parents=True)
    (plugins / "agentbrew-loader-control.js").write_text(plugin)
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
    listed = False
    observed = []
    queries = 0
    with (root / "server.log").open("w+b") as log:
        process = subprocess.Popen(
            [str(binary), "serve", "--hostname", "127.0.0.1", "--port", str(port)],
            **common, stdout=log, stderr=log, start_new_session=True,
        )
        started = time.monotonic()
        deadline = started + 30
        try:
            while process.poll() is None and time.monotonic() < deadline:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                queries += 1
                try:
                    result = subprocess.run(
                        [str(binary), "plugin", "list", "--server", endpoint],
                        **common, capture_output=True, timeout=min(3, remaining),
                    )
                    listed = result.returncode == 0 and identifier in result.stdout.decode(errors="replace")
                except subprocess.TimeoutExpired:
                    listed = False
                observed = marker.read_text().splitlines() if marker.is_file() else []
                if listed and observed == ["setup"]:
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
        log.seek(0)
        details = log.read().decode(errors="replace").lower()
    diagnostic = "none"
    if "failed to load plugin" in details or "invalid plugin" in details:
        diagnostic = "admission"
    if "cannot find module" in details or "cannot resolve" in details:
        diagnostic = "module"
    print(f"version=2.3.0 queries={queries} listed={int(listed)} setup={len(observed)} reaped=1 diagnostic={diagnostic}")
    if not listed or observed != ["setup"]:
        raise SystemExit("persistent server did not verify V2 activation")
