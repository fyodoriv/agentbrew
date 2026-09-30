# Devin marathon-session hooks (example)

An opt-in pattern for Devin CLI users who want to run a long autonomous session against `TASKS.md`. **These files live in each developer's personal `~/apps/agentbrew/.devin/` directory, which is [gitignored](../.gitignore).** They are not shared repo content — every contributor decides whether to install them. This document exists so interested contributors can copy the pattern, not so it's forced on anyone.

The canonical decision about `.devin/` lives in [`AGENTS.md`](../AGENTS.md) — `.devin/` is per-developer Devin CLI config (hooks, local permissions). Shared content belongs in `skill-plugins/dev/` or elsewhere under version control.

## What the hooks do

Two Devin CLI lifecycle events are wired:

- **SessionStart** writes the current timestamp to `/tmp/devin-session-start` so a subsequent Stop hook can compute elapsed time.
- **Stop** runs a Python script that blocks graceful stop until the requested marathon duration has elapsed, nudging the agent back toward `TASKS.md`.

The guard is opt-in via a `MARATHON=<hours>` environment variable. Without the variable the Stop hook approves every stop immediately — no behavior change from the Devin CLI default.

```bash
devin "next task"                # normal run — hooks are a no-op
MARATHON=3 devin "next task"     # 3-hour marathon — Stop hook blocks stops until 3h elapsed
MARATHON=8 devin "next task"     # 8-hour marathon
```

## Files

### `~/apps/agentbrew/.devin/hooks.json`

```json
{
  "SessionStart": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "date +%s > /tmp/devin-session-start",
          "timeout": 2
        }
      ]
    }
  ],
  "Stop": [
    {
      "matcher": "",
      "hooks": [
        {
          "type": "command",
          "command": "python3 .devin/stop-guard.py",
          "timeout": 5
        }
      ]
    }
  ]
}
```

### `~/apps/agentbrew/.devin/stop-guard.py`

```python
#!/usr/bin/env python3
"""Stop hook: keep Devin working for N hours, then let it stop.

Opt-in via env var:
  MARATHON=3 devin "next task"     # 3-hour session
  MARATHON=8 devin "next task"     # 8-hour session
  devin "next task"                # normal (no guard)
"""
import json
import os
import time
import sys
from pathlib import Path

marathon = os.environ.get("MARATHON", "")
if not marathon:
    # Not opted in — let the agent stop normally
    print(json.dumps({"decision": "approve"}))
    sys.exit(0)

HOURS = float(marathon)
STAMP = Path("/tmp/devin-session-start")
data = json.load(sys.stdin)

# Don't block recursively — if a stop hook is already active, approve
if data.get("stop_hook_active"):
    print(json.dumps({"decision": "approve"}))
    sys.exit(0)

# Read start time
if not STAMP.exists():
    # No stamp = first stop attempt, record now and block
    STAMP.write_text(str(int(time.time())))

start = int(STAMP.read_text().strip())
elapsed_h = (time.time() - start) / 3600

if elapsed_h >= HOURS:
    print(json.dumps({"decision": "approve"}))
else:
    remaining = HOURS - elapsed_h
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"Only {elapsed_h:.1f}h of {HOURS}h elapsed ({remaining:.1f}h remaining). "
            "Pick the next unblocked task from TASKS.md and keep working. "
            "If TASKS.md is empty, run the sweep skill to generate new tasks."
        ),
    }))
```

## Trade-offs

The pattern is **opinionated** — blocking a graceful stop with "keep working on TASKS.md" is a deliberate choice to prefer autonomous task drain over responsive interruption. It's a fit for people who want to run agentbrew's queue to empty on a cadence. It's **not** a fit for interactive debugging sessions or quick one-off tasks; in those contexts the guard just gets in the way.

`/tmp/devin-session-start` is ephemeral state — it resets on reboot (or `tmpwatch`), which means a marathon started before a reboot loses its elapsed counter. Acceptable for the intended "run to empty in one session" use case; not acceptable for spanning reboots.

## How to install

1. Copy the two files above into `~/apps/agentbrew/.devin/` on your machine (or wherever your Devin CLI resolves `.devin/` for this repo).
2. Run `MARATHON=<hours> devin "next task"` to opt in, or omit the variable to leave behavior unchanged.
3. Remove the files at any time — they're per-developer and gitignored, so deletion only affects you.

## How to uninstall

```bash
rm -f ~/apps/agentbrew/.devin/hooks.json ~/apps/agentbrew/.devin/stop-guard.py /tmp/devin-session-start
```
