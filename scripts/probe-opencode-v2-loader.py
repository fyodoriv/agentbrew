import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

binary = Path(sys.argv[1]).resolve(strict=True)
legacy = Path("templates/opencode/claude-hooks.js").resolve(strict=True)
identifier = "agentbrew.loader-control"
plugin = """import { appendFileSync } from "node:fs";
import { Plugin } from "@opencode/plugin";
export default Plugin.define({
  id: "agentbrew.loader-control",
  setup() {
    appendFileSync(process.env.AGENTBREW_OC_LOADER_MARKER, "setup\\n");
  },
});
"""
with tempfile.TemporaryDirectory(prefix="agentbrew-opencode-loader-") as directory:
    parent = Path(directory)
    for control in ("legacy", "v2"):
        root = parent / control
        home, workspace = root / "home", root / "workspace"
        workspace.mkdir(parents=True)
        home.mkdir()
        marker = root / "setup.marker"
        config = home / ".config/opencode"
        if control == "legacy":
            plugins = config / "plugin"
            plugins.mkdir(parents=True)
            shutil.copyfile(legacy, plugins / "claude-hooks.js")
        else:
            plugins = config / "plugins/agentbrew-loader-control"
            plugins.mkdir(parents=True)
            (plugins / "index.ts").write_text(plugin)
        environment = {
            "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": str(root),
            "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
            "XDG_STATE_HOME": str(home / ".local/state"), "XDG_CACHE_HOME": str(home / ".cache"),
            "AGENTBREW_OC_LOADER_MARKER": str(marker), "DO_NOT_TRACK": "1", "CI": "1",
        }
        def cli(*args):
            return subprocess.run(
                [str(binary), *args], cwd=workspace, env=environment,
                stdin=subprocess.DEVNULL, capture_output=True, timeout=60,
            )
        version = cli("--version")
        if version.returncode or version.stdout.decode(errors="replace").strip() != "2.3.0":
            raise SystemExit("OpenCode 2.3.0 not verified")
        result = cli("plugin", "list", "--standalone")
        stdout = result.stdout.decode(errors="replace")
        diagnostics = [result.stderr.decode(errors="replace")]
        for file in (home / ".local/share/opencode/log").glob("*.log"):
            diagnostics.append(file.read_text(errors="replace"))
        rejected = any(
            "claude-hooks" in line and re.search(r"reject|unsupported|invalid|default export|setup|v1|load failed", line, re.I)
            for line in "\n".join(diagnostics).splitlines()
        )
        observed = marker.read_text().splitlines() if marker.is_file() else []
        admitted = identifier in stdout
        print(f"{control}: version=2.3.0 exit={result.returncode} rejected={int(rejected)} listed={int(admitted)} setup={len(observed)}")
        if result.returncode:
            raise SystemExit(f"{control} plugin list failed")
        if control == "legacy" and (not rejected or admitted or observed):
            raise SystemExit("legacy rejection could not be classified")
        if control == "v2" and (rejected or not admitted or observed != ["setup"]):
            raise SystemExit("V2 admission or setup count was not verified")
