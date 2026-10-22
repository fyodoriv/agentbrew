---
description: Start agentbrew (agent config state, what needs you, next step) and walk the user through it
allowed-tools: Bash(agentbrew:*)
---

Run `agentbrew` with no arguments. If `agentbrew` is not on PATH, run `npx agentbrew`. It is safe and fast: it reads local files only, makes no network calls, and changes nothing. It prints the agents, MCP servers, skills, last sync, drift, and the drift-repair job, then a `Next:` line with the exact command and a `Then:` list.

Then, answer first:

1. One line: are this machine's agents in sync? Say "Nothing needs you now" when the screen says so.
2. Each `Next:` and `Then:` item: say in plain words what the command does and what changes for the user. Run it only after the user says yes:
   - `agentbrew init`: first setup. It detects agents, installs the recommended set (downloads), and schedules drift repair.
   - `agentbrew install --recommended`: installs the recommended skills and MCP servers (downloads).
   - `agentbrew sync`: deploys skills, MCP servers, rules, and commands to every agent and repairs drift. Show `agentbrew sync --dry-run` before you ask.
   - `agentbrew auto-sync install`: starts the background drift-repair job. If the user does not want it, run `agentbrew config set autoRepair off`, and nothing proposes it again.
   - `agentbrew status --fix`: repairs drift and reinstalls the drift-repair job when it points at an old path.
   - `agentbrew memory fix`: reinstalls the memory background service.
   - `agentbrew setup`: asks for MCP API keys. The user must run it in their own terminal (interactive prompts).
   - `agentbrew mcp probe --deep`: installs and calls each MCP server to find the failing one.
   - A `launchctl` command: give it to the user to run in their own terminal.
   - Any other fix (for drift that sync cannot repair): it is the fix `agentbrew status --ci` names for that drift. Explain it the same way.

To change a setting the user asks for, run `agentbrew config` (each setting, its value, its source, and the allowed values). Then run `agentbrew config set <key> <value>`: it checks the value and saves it. Never hand-edit `~/.config/agentbrew/state.yaml` or generated agent config under `~/.claude/`. If the user does not want this command, run `agentbrew config set builtinCommands off`.

Every other action: run `agentbrew actions --json`. It lists every command (generated from the CLI), its arguments, and three notes:

- `terminal_only`: only the user can run it. Give them the exact command for their own terminal.
- `confirm`: it is hard to undo. Say what it changes, and run it only after the user says yes.
- `agent_note`: what you must do differently, for example a `--dry-run` to show first.

If agentbrew fails, surprises you, or could clearly work better, offer once to report it (CONTRIBUTING.md "Report problems and ideas"). Show the user the exact text, and post only after they say yes.
