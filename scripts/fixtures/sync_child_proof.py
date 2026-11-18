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
        "TSX_DISABLE_CACHE": "1",
        "DO_NOT_TRACK": "1",
        "AGENTBREW_TELEMETRY": "0",
        "AGENTBREW_POSTHOG_KEY": "",
        "AGENTBREW_EVENTS": "1",
        "AGENTBREW_EVENTS_FILE": str(fixture / "events.jsonl"),
        "SYNC_CHILD_PRELOAD_RECEIPT": str(observer / "preload"),
        "SYNC_CHILD_ATTEMPT_RECEIPT": str(observer / "attempt"),
    }
