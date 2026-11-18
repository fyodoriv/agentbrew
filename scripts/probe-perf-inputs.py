from collections import Counter
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

checkout = Path.cwd().resolve()
strace = shutil.which("strace")
if not strace:
    raise SystemExit("trace tool unavailable")
categories = ("checkout", "scratch", "toolchain", "system", "unknown")
system = tuple(Path(prefix) for prefix in ("/usr", "/lib", "/lib64", "/etc", "/proc", "/dev", "/sys"))
toolchain = tuple(Path(p).resolve() for p in (os.environ.get("RUNNER_TOOL_CACHE"),) if p)
opened = re.compile(r"\bopen(?:at2?)?\(.*\bO_(?:RDONLY|PATH)\b.*\)\s+=\s+\d+<(/[^>]+)>")

def classify(path, scratch):
    for group, roots in (("checkout", (checkout,)), ("scratch", (scratch,)), ("toolchain", toolchain), ("system", system)):
        if any(path.is_relative_to(root) for root in roots):
            return group
    return "unknown"

def observe(name, argv, contents, scratch):
    home = scratch / name
    home.mkdir()
    trace = scratch / (name + ".trace")
    stdin = scratch / (name + ".stdin")
    stdin.write_bytes((contents + "\n").encode())
    env = {
        "PATH": os.environ["PATH"], "HOME": str(home), "TMPDIR": tempfile.gettempdir(),
        "AGENTBREW_EVENTS": "0", "AGENTBREW_TELEMETRY": "0", "DO_NOT_TRACK": "1",
        "AGENTBREW_EVENTS_FILE": str(home / "events.jsonl"),
    }
    with (stdin if contents else Path("/dev/null")).open("rb") as supplied:
        result = subprocess.run(
            [strace, "-f", "-qq", "-yy", "-e", "trace=%file", "-o", str(trace), *argv],
            cwd=checkout, env=env, stdin=supplied, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=45,
        )
    if result.returncode:
        raise SystemExit(f"{name}: exit {result.returncode}")
    return {Path(match) for match in opened.findall(trace.read_text(errors="replace"))}

rows = [line.split("\t", 3) for line in (checkout / "scripts/perf-budget.tsv").read_text().splitlines() if "\t" in line]
expected = ("cli-version", "cli-help", "cli-actions-json", "hook-perf-record", "hook-no-home-crawl", "hook-poll-loop-hint", "hook-pr-body-docs")
if tuple(row[0] for row in rows) != expected:
    raise SystemExit("command table changed; observation refused")
with tempfile.TemporaryDirectory(prefix="perf-gate-trace-") as workspace, tempfile.TemporaryDirectory(prefix="perf-gate-canary-") as outside:
    scratch = Path(workspace).resolve()
    canary = Path(outside).resolve() / "canary.txt"
    canary.write_text("synthetic trace control\n")
    counts = Counter()
    for name, _, command, *contents in rows:
        paths = observe(name, command.split(), contents[0] if contents else "", scratch)
        if not paths:
            raise SystemExit(f"{name}: no qualifying recorded opens")
        grouped = Counter(classify(path, scratch) for path in paths)
        counts.update(grouped)
        print(name, *(f"{category}={grouped[category]}" for category in categories))
    if not counts["toolchain"] + counts["system"] + counts["unknown"]:
        raise SystemExit("no outside opens observed")
    standard = observe("canary-baseline", ["/bin/cat", "/dev/null"], "", scratch)
    tested = observe("canary-candidate", ["/bin/cat", str(canary)], "", scratch)
    difference = {path for path in tested - standard if classify(path, scratch) == "unknown"}
    if difference != {canary}:
        raise SystemExit("the canary did not add exactly one unknown path")
    print("seven budget commands completed; canary added one unknown path")
