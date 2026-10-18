# Observability

How to see what agentbrew did on this machine, what failed, and how to fix it.
Everything stays on the machine. agentbrew has no telemetry and no external
error reporter ([`VISION.md`](VISION.md) § Non-goals).

## Logs

| Log | Path | Written by | Content |
|---|---|---|---|
| Event log | `~/.local/share/agentbrew/logs/events.jsonl` (or `AGENTBREW_EVENTS_FILE`) | `src/core/events.ts` | Content-free JSON lines: one per sync, scheduled repair, and error. See [Events](#events). |
| Repair log | `~/.config/agentbrew/repair-log.json` | `src/repair-log.ts` | What the scheduled repair fixed since you last ran a command. `agentbrew status` prints a summary and clears it. |
| Sync errors | `~/.config/agentbrew/sync-errors.json` | `src/core/errors.ts` | The errors of the last sync, with messages. Stays local. |
| Scheduler output | `~/.local/share/agentbrew/logs/launchagent.log`, `launchagent.err`, `cron.log`, `auto-sync.log` | the LaunchAgent, cron, systemd timer, or watcher | Raw output of `agentbrew fix`, trimmed to the newest lines past 1 MB. |
| Agent step timings | see [`agent-perf.md`](agent-perf.md) | perf hooks | Per-step tool time for agent sessions. |

The event log is content-free by construction. `sanitizeEvent` keeps only
allow-listed fields. A string field must match an enum-like pattern (a story
ID, a lower-case module or drift type, an upper-case error code), so a path,
server name, or error message can never reach the file.

Turn it off with `AGENTBREW_EVENTS=0`. Every test runs with it off
(`vitest.config.ts`), and `src/core/events.test.ts` asserts that.

## Events

| Event | When | Fields | Story |
|---|---|---|---|
| `sync` | each `agentbrew sync` that is not `--dry-run` | `ms`, `ok` (no error and exit code 0) | US08 |
| `repair` | each scheduled or manual `agentbrew fix` | `ms`, `ok` (no drift left), `driftBefore`, `repaired`, `remaining`, `types` (drift types left) | US06 |
| `error` | each sync module error, and a repair that throws | `ok: false`, `code`, `module` | from the map below |

Every event also has `ts` (ISO time) and `story`. `scripts/metrics.sh` turns
the events into the rates in [`metrics.md`](metrics.md).

## Errors

Errors are captured locally: the message goes to `sync-errors.json`, and a
content-free `error` event goes to the event log. Each error event names the
user story it breaks, so `story_fail_rate` shows which story to fix first.

| Source | Story |
|---|---|
| `mcp` sync module | US03 Add an MCP server |
| `skills` sync module | US02 Install a skill |
| `rules` and `instructions` sync modules | US04 Share rules |
| `commands` sync module | US05 Cross-agent commands |
| `agents` sync module | US20 Agent definitions |
| `hooks` sync module | US21 Completions and hooks |
| `models` sync module | US16 Agentfile and project config |
| any other sync error | US08 Update everything |
| a scheduled repair that throws | US06 Drift detection |

The map lives in `storyForModule` in `src/core/events.ts`.

## Health check

`agentbrew status --ci` is the doctor (accepted push back: no
`scripts/doctor.sh` alias for a CLI command). It prints no color and exits 1
on drift. `agentbrew status` is the same check for people, and
`agentbrew status --fix` repairs what it can.

Every drift item ends with its fix, for example:

```text
drift=1 status=failed
  kiro [mcp] missing server: srv1 — fix: agentbrew sync --only mcp
```

The fixes live in `DRIFT_FIXES` in `src/drift-fixes.ts`. Its type is a record
over every `DriftItem` type, so a new drift type without a fix fails `tsc`.
