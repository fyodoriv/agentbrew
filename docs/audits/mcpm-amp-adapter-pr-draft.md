# Filed: upstream PR for `pathintegral-institute/mcpm.sh` — Amp adapter

**Status:** FILED 2026-04-27 at [pathintegral-institute/mcpm.sh#329](https://github.com/pathintegral-institute/mcpm.sh/pull/329). This document remains as the implementation reference + post-merge follow-up checklist.

**Source:** part of the `delegate-mcp-to-mcpm` parent task (slice 6c of 6, shipped 2026-04-27). Slice 6a (opencode adapter) shipped as upstream PR [pathintegral-institute/mcpm.sh#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327) on 2026-04-27 and slice 6b (kiro adapter) shipped as [pathintegral-institute/mcpm.sh#328](https://github.com/pathintegral-institute/mcpm.sh/pull/328). This PR follows the same shape for Sourcegraph Amp.

When approved, the files below land on a feature branch in `fyodoriv/mcpm.sh` and the body below is what to paste into `gh pr create`.

---

## Title

`feat: add Sourcegraph Amp client manager`

## Body

[Sourcegraph Amp](https://ampcode.com) is a coding agent CLI. Its MCP configuration lives at `~/.config/amp/settings.json` under the `amp.mcpServers` key — a flat top-level key with a literal dot (matching how Amp's settings file groups its keys, parallel to `amp.theme`, `amp.modelOverrides`, etc.).

This PR adds an `AmpManager` extending `JSONClientManager` with `configure_key_name = "amp.mcpServers"` so `mcpm install <name>` and `mcpm client edit amp --add-server <name>` work end-to-end against Amp's settings file. Net change: ~70 LOC of source + ~80 LOC of tests across 3 files.

### Why

Amp is on agentbrew's [agent matrix](https://github.com/fyodoriv/agentbrew/blob/main/src/core/agents.yaml) (50+ AI coding agents tracked there) and one of the 3 small-adapter contribute candidates called out in [agentbrew's MCP delegation evaluation](https://github.com/fyodoriv/agentbrew/blob/main/docs/competition/mcpm-sh-vs-agentbrew.md) (the other two being opencode and kiro). Adding it here closes the third of the three carve-outs — opencode landed via [#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327), kiro is in a sibling PR, this PR addresses amp.

### Source-code references

- Adds: `src/mcpm/clients/managers/amp.py` (new file)
- Modifies: `src/mcpm/clients/managers/__init__.py` (re-export `AmpManager`)
- Modifies: `src/mcpm/clients/client_registry.py` (register `"amp": AmpManager`)
- Adds: `tests/test_clients/test_amp.py` (new file, mirrors `tests/test_clients/test_qwen_cli.py` shape)

### Diff

#### `src/mcpm/clients/managers/amp.py` (new)

```python
"""
Sourcegraph Amp integration utilities for MCP
"""

import logging
import os
import shutil
from typing import Any, Dict

from mcpm.clients.base import JSONClientManager

logger = logging.getLogger(__name__)


class AmpManager(JSONClientManager):
    """Manages Sourcegraph Amp MCP server configurations"""

    # Client information
    client_key = "amp"
    display_name = "Sourcegraph Amp"
    download_url = "https://ampcode.com"
    # Amp groups its settings under flat dotted keys (amp.theme,
    # amp.modelOverrides, amp.mcpServers, etc.) rather than nesting them
    # under a top-level "amp" object. Python's dict access handles the
    # dot in the key name without special-casing — `config["amp.mcpServers"]`
    # works the same as `config["servers"]` for VSCode.
    configure_key_name = "amp.mcpServers"

    def __init__(self, config_path_override: str | None = None):
        """Initialize the Sourcegraph Amp client manager

        Args:
            config_path_override: Optional path to override the default config file location
        """
        super().__init__(config_path_override=config_path_override)

        if config_path_override:
            self.config_path = config_path_override
        else:
            # Amp stores its settings in ~/.config/amp/settings.json on
            # macOS, Linux, and Windows (per Amp's docs at
            # https://ampcode.com/manual).
            self.config_path = os.path.expanduser("~/.config/amp/settings.json")

    def _get_empty_config(self) -> Dict[str, Any]:
        """Get empty config structure for Sourcegraph Amp"""
        return {self.configure_key_name: {}}

    def is_client_installed(self) -> bool:
        """Check if Sourcegraph Amp is installed
        Returns:
            bool: True if amp command is available, False otherwise
        """
        # shutil.which() handles Windows PATHEXT automatically (.cmd, .bat, .exe, etc.)
        return shutil.which("amp") is not None

    def get_client_info(self) -> Dict[str, str]:
        """Get information about this client

        Returns:
            Dict: Information about the client including display name, download URL, and config path
        """
        return {
            "name": self.display_name,
            "download_url": self.download_url,
            "config_file": self.config_path,
            "description": "Sourcegraph's Amp coding agent CLI",
        }
```

#### `src/mcpm/clients/managers/__init__.py` (diff)

```diff
+from mcpm.clients.managers.amp import AmpManager
 from mcpm.clients.managers.claude_code import ClaudeCodeManager
 from mcpm.clients.managers.claude_desktop import ClaudeDesktopManager
 from mcpm.clients.managers.cline import ClineManager
@@ -16,6 +17,7 @@
 from mcpm.clients.managers.windsurf import WindsurfManager

 __all__ = [
+    "AmpManager",
     "ClaudeCodeManager",
     "ClaudeDesktopManager",
     "CursorManager",
```

#### `src/mcpm/clients/client_registry.py` (diff)

```diff
+from mcpm.clients.managers.amp import AmpManager
 from mcpm.clients.managers.claude_code import ClaudeCodeManager
 from mcpm.clients.managers.claude_desktop import ClaudeDesktopManager
 from mcpm.clients.managers.cline import ClineManager, RooCodeManager
@@ -41,6 +42,7 @@
     # Dictionary mapping client keys to manager classes
     _CLIENT_MANAGERS = {
+        "amp": AmpManager,
         "claude-code": ClaudeCodeManager,
         "claude-desktop": ClaudeDesktopManager,
         "windsurf": WindsurfManager,
```

#### `tests/test_clients/test_amp.py` (new)

```python
"""Tests for the Sourcegraph Amp client manager."""

import json
import os
import tempfile
from unittest.mock import patch

import pytest

from mcpm.clients.managers.amp import AmpManager


@pytest.fixture
def temp_json_config():
    with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json") as f:
        json.dump({"amp.mcpServers": {}}, f)
        temp_path = f.name

    yield temp_path
    os.unlink(temp_path)


@pytest.fixture
def amp_manager(temp_json_config):
    return AmpManager(config_path_override=temp_json_config)


def test_default_config_path():
    """Test that the default config path is ~/.config/amp/settings.json"""
    manager = AmpManager()
    assert manager.config_path.endswith(".config/amp/settings.json")


def test_config_path_override(temp_json_config):
    """Test that config_path_override takes precedence over the default path"""
    manager = AmpManager(config_path_override=temp_json_config)
    assert manager.config_path == temp_json_config


def test_uses_dotted_amp_mcpServers_key():
    """Test that Amp uses the literal `amp.mcpServers` key (not nested)"""
    assert AmpManager.configure_key_name == "amp.mcpServers"


def test_get_empty_config(amp_manager):
    """Test that empty config returns the dotted-key shape"""
    empty = amp_manager._get_empty_config()
    assert empty == {"amp.mcpServers": {}}


def test_get_client_info(amp_manager):
    info = amp_manager.get_client_info()
    assert info["name"] == "Sourcegraph Amp"
    assert info["download_url"] == "https://ampcode.com"
    assert "amp" in info["description"].lower()
    assert "config_file" in info


def test_is_client_installed_when_amp_on_path(amp_manager):
    """Test that is_client_installed returns True when amp binary is on PATH"""
    with patch("mcpm.clients.managers.amp.shutil.which", return_value="/usr/local/bin/amp"):
        assert amp_manager.is_client_installed() is True


def test_is_client_installed_when_amp_missing(amp_manager):
    """Test that is_client_installed returns False when amp binary is missing"""
    with patch("mcpm.clients.managers.amp.shutil.which", return_value=None):
        assert amp_manager.is_client_installed() is False


def test_add_and_list_server(amp_manager):
    """Test the add_server / list_servers / get_server lifecycle"""
    success = amp_manager.add_server(
        {
            "name": "test-server",
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-test"],
        },
        "test-server",
    )
    assert success

    servers = amp_manager.list_servers()
    assert "test-server" in servers

    server = amp_manager.get_server("test-server")
    assert server is not None
    assert server.name == "test-server"


def test_remove_server(amp_manager):
    """Test the remove_server lifecycle"""
    amp_manager.add_server(
        {"name": "test-server", "type": "stdio", "command": "npx"},
        "test-server",
    )
    assert amp_manager.remove_server("test-server") is True
    assert amp_manager.get_server("test-server") is None


def test_load_config_returns_empty_when_file_missing():
    """Test that _load_config returns empty config shape when file doesn't exist"""
    with tempfile.TemporaryDirectory() as tmpdir:
        missing_path = os.path.join(tmpdir, "nonexistent.json")
        manager = AmpManager(config_path_override=missing_path)
        config = manager._load_config()
        assert config == {"amp.mcpServers": {}}


def test_preserves_other_keys_when_adding_server():
    """Test that adding a server preserves unrelated top-level keys
    (e.g. amp.theme, amp.modelOverrides) so we don't clobber Amp settings."""
    with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".json") as f:
        json.dump({"amp.mcpServers": {}, "amp.theme": "dark", "amp.foo": "bar"}, f)
        temp_path = f.name

    try:
        manager = AmpManager(config_path_override=temp_path)
        manager.add_server(
            {"name": "test-server", "type": "stdio", "command": "npx"},
            "test-server",
        )
        with open(temp_path) as f:
            config = json.load(f)
        # amp.mcpServers got the new server
        assert "test-server" in config["amp.mcpServers"]
        # Unrelated keys survived
        assert config["amp.theme"] == "dark"
        assert config["amp.foo"] == "bar"
    finally:
        os.unlink(temp_path)
```

### Why it matters

Once this lands, agentbrew (and any other downstream tool that delegates to mcpm) can call `mcpm install <server> --client amp` and `mcpm client edit amp --add-server <server>` end-to-end. Today agentbrew keeps a [native carve-out](https://github.com/fyodoriv/agentbrew/blob/main/src/core/mcp-agent-map.ts) for amp because mcpm doesn't have an adapter — that ~80 LOC carve-out becomes deletable on merge.

### Note on the dotted key name

Amp groups its settings file under flat keys with literal dots — `amp.mcpServers`, `amp.theme`, `amp.modelOverrides`, etc. This is NOT a nested object structure: the JSON file is `{"amp.mcpServers": {...}, "amp.theme": "dark", ...}`, not `{"amp": {"mcpServers": {...}, "theme": "dark"}}`. Python's dict access (`config["amp.mcpServers"]`) handles the dotted key without any special-casing — same as VSCode's `"servers"` and OpenCode's `"mcp"` key in the existing adapters. The `configure_key_name = "amp.mcpServers"` override on `JSONClientManager` is all that's needed.

The harm of not landing this is bounded (amp users can configure MCP manually), but the fix is mechanical, the test surface mirrors the slice 6a opencode adapter ([#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327)), and it parallels the just-staged kiro adapter draft.

---

## Filing checklist (for the maintainer-approved publish step)

When the user approves the publish step:

1. **Confirm the source files match upstream main:**
   - `git -C /tmp/mcpm.sh pull origin main` — make sure I'm on the latest main.
   - Confirm `src/mcpm/clients/managers/__init__.py` and `src/mcpm/clients/client_registry.py` still have the same line numbers as the diffs above — if upstream refactored, regenerate the diffs.
2. **Push the feature branch to fyodoriv/mcpm.sh:**
   - `git -C /tmp/mcpm.sh remote add fork https://github.com/fyodoriv/mcpm.sh.git` (one-time)
   - `git -C /tmp/mcpm.sh checkout -b feat/amp-adapter`
   - Apply the four file changes (`src/mcpm/clients/managers/amp.py`, `__init__.py`, `client_registry.py`, `tests/test_clients/test_amp.py`).
   - `git -C /tmp/mcpm.sh add ...` + `git commit -m "feat: add Sourcegraph Amp client manager"`
   - `git -C /tmp/mcpm.sh push -u fork feat/amp-adapter`
3. **Run the upstream test suite locally before pushing:**
   - `cd /tmp/mcpm.sh && uv run pytest tests/test_clients/test_amp.py -v` (or whatever upstream uses)
   - All ≥10 tests should pass.
4. **File the PR:**
   - `gh pr create --repo pathintegral-institute/mcpm.sh --title "feat: add Sourcegraph Amp client manager" --body "$(cat docs/audits/mcpm-amp-adapter-pr-draft.md | sed -n '/^## Body/,/^---$/{/^## Body/d; /^---$/d; p}')"`
5. **Record the resulting PR URL in `docs/competition/mcpm-sh-vs-agentbrew.md`** (look for the slice 6 row in the execution-path table).
6. **Mark the slice 6c checkbox in `delegate-mcp-to-mcpm` (parent task) as `[x]` with the PR# annotation**, mirroring the slice 6a annotation.
7. **If the PR merges**: open a follow-up agentbrew PR that deletes the amp carve-out from `src/core/mcp-agent-map.ts` (`AGENTBREW_ONLY_MCP_RATIONALE.amp` and the agent from `MCP_INTERSECTION_AGENTS` should grow by one).

## Why this doc lives in `docs/audits/`

Mirrors the [`bridle-opencode-issue-draft.md`](bridle-opencode-issue-draft.md) and [`mcpm-kiro-adapter-pr-draft.md`](mcpm-kiro-adapter-pr-draft.md) precedents — staging upstream-PR drafts in `docs/audits/` keeps the publish step gated by user approval while letting agents prepare the fully-shippable artifact in advance. The publish step expects to `cat` the body from a stable file path, which works only if the draft lives in a known location.
