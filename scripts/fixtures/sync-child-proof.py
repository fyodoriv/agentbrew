import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile


def require(condition, reason):
    if not condition:
        raise SystemExit(reason)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(root):
    result = {}
    for path in [root, *root.rglob("*")]:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode):
            content = os.readlink(path)
        elif stat.S_ISREG(info.st_mode):
            content = digest(path)
        else:
            require(stat.S_ISDIR(info.st_mode), "Unexpected scratch entry kind")
            content = None
        result[path.relative_to(root)] = (info.st_mode, info.st_mtime_ns, content)
    return result


def fixture_env(fixture, observer):
    home = fixture / "home"
    workspace = fixture / "workspace"
    config = home / ".config" / "agentbrew"
    marketplace = home / ".local" / "share" / "agentbrew" / "claude-marketplace"
    for directory in (
        config, marketplace, workspace, fixture / "tmp",
        home / ".cache", home / ".local" / "share",
    ):
        directory.mkdir(parents=True, exist_ok=True)
    files = {
        config / "state.yaml": "schemaVersion: 1\nagents: []\ncatalogVersion: 0.1.0\n",
        config / "last-seen.json": "{}\n",
        config / "sync-errors.json": "{}\n",
        fixture / "events.jsonl": "",
        marketplace / "fixture-marker.txt": "synthetic marketplace marker\n",
    }
    for path, contents in files.items():
        path.write_text(contents)
    return workspace, {
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_DATA_HOME": str(home / ".local" / "share"),
        "TMPDIR": str(fixture / "tmp"),
        "NO_COLOR": "1",
        "DO_NOT_TRACK": "1",
        "AGENTBREW_TELEMETRY": "0",
        "AGENTBREW_POSTHOG_KEY": "",
        "AGENTBREW_EVENTS": "1",
        "AGENTBREW_EVENTS_FILE": str(fixture / "events.jsonl"),
        "SYNC_CHILD_PRELOAD_RECEIPT": str(observer / "preload"),
        "SYNC_CHILD_ATTEMPT_RECEIPT": str(observer / "attempt"),
    }


def execute(node, preload, observer, cwd, env, args):
    observer.mkdir()
    result = subprocess.run(
        [node, "--import", str(preload), *args],
        cwd=cwd, env=env, capture_output=True, timeout=30, check=False,
    )
    receipt = observer / "preload"
    require(receipt.exists() and receipt.read_bytes() == b"loaded\n", "Subprocess observer missing or duplicated")
    return result


def main():
    node, repository, outside_net, runner_uid, revision, candidate, scratch = sys.argv[1:]
    require(os.getuid() == int(runner_uid) and os.getuid() != 0, "Wrong fixture user")
    require(os.readlink("/proc/self/ns/net") != outside_net, "Network namespace was not isolated")
    interfaces = {line.split(":", 1)[0].strip() for line in Path("/proc/net/dev").read_text().splitlines()[2:]}
    require(interfaces == {"lo"}, "Unexpected network interface")
    repo = Path(repository)
    bundle = repo / "dist" / "cli.js"
    preload = repo / "scripts" / "fixtures" / "sync-child-deny.mjs"
    build_info = json.loads((bundle.parent / "build-info.json").read_text())
    require(build_info["commit"] == revision, "Wrong revision in the build receipt")
    built_sha = digest(bundle)
    print(f"Built revision {revision} candidate {candidate} sha256 {built_sha}", flush=True)

    with tempfile.TemporaryDirectory(dir=scratch) as tmp:
        root = Path(tmp)
        observer = root / "canary-observer"
        work, env = fixture_env(root / "canary", observer)
        result = execute(node, preload, observer, work, env, [
            "--input-type=module", "-e",
            "import { spawnSync } from 'node:child_process'; spawnSync('/bin/true');",
        ])
        require(result.returncode == 1, "Subprocess canary did not refuse the call")
        attempt = observer / "attempt"
        require(attempt.exists() and attempt.read_bytes() == b"denied\n", "Subprocess canary did not record one denial")
        print("Canary: exit 1, blocked subprocess attempts 1", flush=True)

        loader = repo / "node_modules" / "tsx" / "dist" / "loader.mjs"
        update_child = repo / "scripts" / "fixtures" / "sync-update-child.mts"
        require(loader.is_file() and update_child.is_file(), "Direct update runtime missing")
        marker = b"synthetic-invalid-input-canary"
        for label, args in [
            ("empty pull", [str(bundle), "sync", "--pull", "--only", ""]),
            ("plain unknown", [str(bundle), "sync", "--only", marker.decode()]),
            ("direct empty update", ["--import", str(loader), str(update_child)]),
        ]:
            fixture = root / label
            observer = root / f"{label}-observer"
            work, env = fixture_env(fixture, observer)
            before = manifest(fixture)
            result = execute(node, preload, observer, work, env, args)
            combined = result.stdout + result.stderr
            after = manifest(fixture)
            changed = sum(before.get(key) != after.get(key) for key in before.keys() | after.keys())
            attempts = (observer / "attempt").exists()
            hint = b"Valid modules:" in combined
            bad_markers = combined.count(marker)
            print(
                f"{label}: exit {result.returncode}, changed entries {changed}, "
                f"subprocess attempted {attempts}, valid-module hint {hint}, "
                f"rejected markers {bad_markers}", flush=True,
            )
            require(
                result.returncode == 1 and changed == 0 and not attempts and hint and bad_markers == 0,
                "Physical scratch-file proof failed",
            )
    require(digest(bundle) == built_sha, "CLI bundle changed during proof")


if __name__ == "__main__":
    main()
