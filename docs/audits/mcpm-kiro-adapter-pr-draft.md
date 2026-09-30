# Filed: upstream PR for `pathintegral-institute/mcpm.sh` — Kiro adapter

**Status:** FILED 2026-04-27 at [pathintegral-institute/mcpm.sh#328](https://github.com/pathintegral-institute/mcpm.sh/pull/328). This document remains as the implementation reference + post-merge follow-up checklist.

**Source:** part of the `delegate-mcp-to-mcpm` parent task (slice 6b of 6, shipped 2026-04-27). Slice 6a (opencode adapter) shipped 2026-04-27 as upstream PR [pathintegral-institute/mcpm.sh#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327) — same shape, this PR mirrors that pattern for Kiro.

When approved, the files below land on a feature branch in `fyodoriv/mcpm.sh` and the body below is what to paste into `gh pr create`.

---

## Title

`feat: add Kiro client manager`

## Body

[Kiro](https://kiro.dev) is a coding agent IDE. Its MCP configuration lives at `~/.kiro/settings/mcp.json` and uses the standard `mcpServers` top-level key — same JSON shape as Cursor, Cline, Claude Code, and Windsurf.

This PR adds a `KiroManager` extending `JSONClientManager` so `mcpm install <name>` and `mcpm client edit kiro --add-server <name>` work end-to-end against Kiro's config file. Net change: ~70 LOC of source + ~80 LOC of tests across 3 files.

### Why

Kiro is on agentbrew's [agent matrix](https://github.com/fyodoriv/agentbrew/blob/main/src/core/agents.yaml) (50+ AI coding agents tracked there) and one of the 9 strict-intersection clients in [agentbrew's MCP delegation evaluation](https://github.com/fyodoriv/agentbrew/blob/main/docs/competition/mcpm-sh-vs-agentbrew.md). Adding it here closes one of the 3 carve-outs (kiro, amp, opencode) called out in that doc — opencode landed via [#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327), this PR addresses kiro, and a sibling PR will address amp.

### Source-code references

- Adds: `src/mcpm/clients/managers/kiro.py` (new file)
- Modifies: `src/mcpm/clients/managers/__init__.py` (re-export `KiroManager`)
- Modifies: `src/mcpm/clients/client_registry.py` (register `"kiro": KiroManager`)
- Adds: `tests/test_clients/test_kiro.py` (new file, mirrors `tests/test_clients/test_qwen_cli.py` shape)

### Diff

#### `src/mcpm/clients/managers/kiro.py` (new)

```python
"""
Kiro IDE integration utilities for MCP
"""

import logging
import os
import shutil
from typing import Any, Dict

from mcpm.clients.base import JSONClientManager

logger = logging.getLogger(__name__)


class KiroManager(JSONClientManager):
    """Manages Kiro IDE MCP server configurations"""

    # Client information
    client_key = "kiro"
    display_name = "Kiro"
    download_url = "https://kiro.dev"

    def __init__(self, config_path_override: str | None = None):
        """Initialize the Kiro client manager

        Args:
            config_path_override: Optional path to override the default config file location
        """
        super().__init__(config_path_override=config_path_override)

        if config_path_override:
            self.config_path = config_path_override
        else:
            # Kiro stores its MCP settings in ~/.kiro/settings/mcp.json
            # across macOS, Linux, and Windows (per Kiro's docs at
            # https://kiro.dev/docs/mcp).
            self.config_path = os.path.expanduser("~/.kiro/settings/mcp.json")

    def _get_empty_config(self) -> Dict[str, Any]:
        """Get empty config structure for Kiro"""
        return {self.configure_key_name: {}}

    def is_client_installed(self) -> bool:
        """Check if Kiro is installed
        Returns:
            bool: True if kiro command is available, False otherwise
        """
        # shutil.which() handles Windows PATHEXT automatically (.cmd, .bat, .exe, etc.)
        return shutil.which("kiro") is not None

    def get_client_info(self) -> Dict[str, str]:
        """Get information about this client

        Returns:
            Dict: Information about the client including display name, download URL, and config path
        """
        return {
            "name": self.display_name,
            "download_url": self.download_url,
            "config_file": self.config_path,
            "description": "Kiro coding agent IDE",
        }
```

#### `src/mcpm/clients/managers/__init__.py` (diff)

```diff
 from mcpm.clients.managers.gemini_cli import GeminiCliManager
 from mcpm.clients.managers.goose import GooseClientManager
+from mcpm.clients.managers.kiro import KiroManager
 from mcpm.clients.managers.qwen_cli import QwenCliManager
 from mcpm.clients.managers.trae import TraeManager

 __all__ = [
     "ClaudeCodeManager",
     "ClaudeDesktopManager",
     "CursorManager",
     "WindsurfManager",
     "ClineManager",
     "ContinueManager",
     "FiveireManager",
     "GooseClientManager",
+    "KiroManager",
     "QwenCliManager",
     "TraeManager",
     "VSCodeManager",
     "GeminiCliManager",
     "CodexCliManager",
 ]
```

#### `src/mcpm/clients/client_registry.py` (diff)

```diff
 from mcpm.clients.managers.gemini_cli import GeminiCliManager
 from mcpm.clients.managers.goose import GooseClientManager
+from mcpm.clients.managers.kiro import KiroManager
 from mcpm.clients.managers.qwen_cli import QwenCliManager
 from mcpm.clients.managers.trae import TraeManager
@@ -49,6 +50,7 @@
         "vscode": VSCodeManager,
         "gemini-cli": GeminiCliManager,
         "codex-cli": CodexCliManager,
+        "kiro": KiroManager,
         "qwen-cli": QwenCliManager,
     }
```

#### `tests/test_clients/test_kiro.py` (new)

```python
"""Tests for the Kiro client manager."""

import json
import os
import tempfile
from unittest.mock import patch

import pytest

from mcpm.clients.managers.kiro import KiroManager


@pytest.fixture
def temp_json_config():
    with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json") as f:
        json.dump({"mcpServers": {}}, f)
        temp_path = f.name

    yield temp_path
    os.unlink(temp_path)


@pytest.fixture
def kiro_manager(temp_json_config):
    return KiroManager(config_path_override=temp_json_config)


def test_default_config_path():
    """Test that the default config path is ~/.kiro/settings/mcp.json"""
    with patch.dict(os.environ, {"HOME": "/home/user"}, clear=False):
        manager = KiroManager()
        assert manager.config_path.endswith(".kiro/settings/mcp.json")


def test_config_path_override(temp_json_config):
    """Test that config_path_override takes precedence over the default path"""
    manager = KiroManager(config_path_override=temp_json_config)
    assert manager.config_path == temp_json_config


def test_get_empty_config(kiro_manager):
    """Test that empty config returns the standard mcpServers shape"""
    empty = kiro_manager._get_empty_config()
    assert empty == {"mcpServers": {}}


def test_uses_standard_mcpServers_key():
    """Test that Kiro uses the standard 'mcpServers' key (no override)"""
    assert KiroManager.configure_key_name == "mcpServers"


def test_get_client_info(kiro_manager):
    info = kiro_manager.get_client_info()
    assert info["name"] == "Kiro"
    assert info["download_url"] == "https://kiro.dev"
    assert "kiro" in info["description"].lower()
    assert "config_file" in info


def test_is_client_installed_when_kiro_on_path(kiro_manager):
    """Test that is_client_installed returns True when kiro binary is on PATH"""
    with patch("mcpm.clients.managers.kiro.shutil.which", return_value="/usr/local/bin/kiro"):
        assert kiro_manager.is_client_installed() is True


def test_is_client_installed_when_kiro_missing(kiro_manager):
    """Test that is_client_installed returns False when kiro binary is missing"""
    with patch("mcpm.clients.managers.kiro.shutil.which", return_value=None):
        assert kiro_manager.is_client_installed() is False


def test_add_and_list_server(kiro_manager):
    """Test the add_server / list_servers / get_server lifecycle"""
    success = kiro_manager.add_server(
        {
            "name": "test-server",
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-test"],
        },
        "test-server",
    )
    assert success

    servers = kiro_manager.list_servers()
    assert "test-server" in servers

    server = kiro_manager.get_server("test-server")
    assert server is not None
    assert server.name == "test-server"


def test_remove_server(kiro_manager):
    """Test the remove_server lifecycle"""
    kiro_manager.add_server(
        {"name": "test-server", "type": "stdio", "command": "npx"},
        "test-server",
    )
    assert kiro_manager.remove_server("test-server") is True
    assert kiro_manager.get_server("test-server") is None


def test_load_config_returns_empty_when_file_missing():
    """Test that _load_config returns empty config shape when file doesn't exist"""
    with tempfile.TemporaryDirectory() as tmpdir:
        missing_path = os.path.join(tmpdir, "nonexistent.json")
        manager = KiroManager(config_path_override=missing_path)
        config = manager._load_config()
        assert config == {"mcpServers": {}}
```

### Why it matters

Once this lands, agentbrew (and any other downstream tool that delegates to mcpm) can call `mcpm install <server> --client kiro` and `mcpm client edit kiro --add-server <server>` end-to-end. Today agentbrew keeps a [native carve-out](https://github.com/fyodoriv/agentbrew/blob/main/src/core/mcp-agent-map.ts) for kiro because mcpm doesn't have an adapter — that ~80 LOC carve-out becomes deletable on merge.

The harm of not landing this is bounded (kiro can still be configured manually), but the fix is mechanical, the test surface is small, and it parallels the just-merged opencode adapter ([#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327)).

---

## Filing checklist (for the maintainer-approved publish step)

When the user approves the publish step:

1. **Confirm the source files match upstream main:**
   - `git -C /tmp/mcpm.sh pull origin main` — make sure I'm on the latest main.
   - Confirm `src/mcpm/clients/managers/__init__.py` and `src/mcpm/clients/client_registry.py` still have the same line numbers as the diffs above — if upstream refactored, regenerate the diffs.
2. **Push the feature branch to fyodoriv/mcpm.sh:**
   - `git -C /tmp/mcpm.sh remote add fork https://github.com/fyodoriv/mcpm.sh.git` (one-time)
   - `git -C /tmp/mcpm.sh checkout -b feat/kiro-adapter`
   - Apply the three file changes in `/tmp/mcpm.sh/src/mcpm/clients/managers/kiro.py`, `__init__.py`, `client_registry.py`, and `/tmp/mcpm.sh/tests/test_clients/test_kiro.py`.
   - `git -C /tmp/mcpm.sh add ...` + `git commit -m "feat: add Kiro client manager"`
   - `git -C /tmp/mcpm.sh push -u fork feat/kiro-adapter`
3. **Run the upstream test suite locally before pushing:**
   - `cd /tmp/mcpm.sh && uv run pytest tests/test_clients/test_kiro.py -v` (or whatever upstream uses)
   - All ≥10 tests should pass.
4. **File the PR:**
   - `gh pr create --repo pathintegral-institute/mcpm.sh --title "feat: add Kiro client manager" --body "$(cat docs/audits/mcpm-kiro-adapter-pr-draft.md | sed -n '/^## Body/,/^---$/{/^## Body/d; /^---$/d; p}')"`
5. **Record the resulting PR URL in `docs/competition/mcpm-sh-vs-agentbrew.md`** (look for the slice 6 row in the execution-path table).
6. **Mark the slice 6b checkbox in `delegate-mcp-to-mcpm` (parent task) as `[x]` with the PR# annotation**, mirroring the slice 6a annotation that's already there.
7. **If the PR merges**: open a follow-up agentbrew PR that deletes the kiro carve-out from `src/core/mcp-agent-map.ts` (`AGENTBREW_ONLY_MCP_RATIONALE.kiro` and the agent from `MCP_INTERSECTION_AGENTS` should grow by one).

## Why this doc lives in `docs/audits/`

Mirrors the [`bridle-opencode-issue-draft.md`](bridle-opencode-issue-draft.md) precedent — staging upstream-PR drafts in `docs/audits/` keeps the publish step gated by user approval while letting agents prepare the fully-shippable artifact in advance. The publish step expects to `cat` the body from a stable file path, which works only if the draft lives in a known location.

## Why slice 6c (amp adapter) is a separate draft

Per the parent task: amp's MCP config lives at `~/.config/amp/settings.json` under a deeper-nested `amp.mcpServers` key, so the adapter must handle the dotted-path. Different shape from kiro (which uses standard `mcpServers`), so it gets its own PR + its own draft file in this folder.
