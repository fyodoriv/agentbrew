# Observability

How to see what agentbrew did on this machine, what failed, and how to fix it.
Everything stays on the machine by default. agentbrew has no external error
reporter ([`VISION.md`](VISION.md) § Non-goals). It has two opt-in exits: the
[weekly metrics share](#weekly-metrics-share-opt-in), and field telemetry.

Field telemetry sends the content-free event log to PostHog EU once a day, as
anonymous counts under a random install id (no person profile, no GeoIP). It
sends nothing until you set a project key (`AGENTBREW_POSTHOG_KEY`, or the
Keychain item `agentbrew` / `posthog_key`). `agentbrew telemetry status` shows
its state, `agentbrew telemetry send --dry-run` prints the exact body, and
`agentbrew telemetry off` or `DO_NOT_TRACK=1` stops it. Each line is checked
against the event allowlist again at send time, so an edited or older log line
cannot send a path or name; a canary test in `src/core/telemetry.test.ts` pins this.

`npm run docs:proof` reads the per-install totals back for the README Proof
section when a personal PostHog query key and project id are set
(`AGENTBREW_POSTHOG_QUERY_KEY` and `AGENTBREW_POSTHOG_PROJECT`, or the
Keychain items `agentbrew` / `posthog_query_key` and `posthog_project_id`;
never commit them). It queries the PostHog EU query API
(`AGENTBREW_POSTHOG_QUERY_URL` overrides the host) and keys each install by a
salted hash, never the install id. With no key or no network it prints one
`note:` line and keeps the local aggregate (`src/docs/proof-posthog.ts`).

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
| `sync` | each `agentbrew sync` that is not `--dry-run` | `ms`, `ok` (no error and exit code 0) | US08; `--rollback` US26, `--pull` US13, `--agentfile` US23, `--discover` US11 |
| `command` | each other top-level command that serves a story (`init`, `install`, `status`, `team`, ...) | `ms`, `ok` (exit code 0) | `storyForCommand` in `src/core/events.ts` |
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
It runs one sync pass and prints the time of each step. The MCP heal runs
the MCP sync at most once. Drift that the pass did not change is listed as
"cannot fix automatically", each item with its fix.

Every drift item ends with its fix, for example:

```text
drift=1 status=failed
  kiro [mcp] missing server: srv1 — fix: agentbrew sync --only mcp
```

The fixes live in `DRIFT_FIXES` in `src/drift-fixes.ts`. Its type is a record
over every `DriftItem` type, so a new drift type without a fix fails `tsc`.

## Weekly metrics share (opt-in)

The only data that can leave the machine. It is off by default, and it
carries numbers only: never content, paths, or names.

**Provider contract.** Each tool writes one file per ISO week to
`~/.local/share/<tool>/metrics/weekly-<YYYY-Www>.json`. The file matches
[`src/metrics/weekly-metrics.schema.json`](../src/metrics/weekly-metrics.schema.json):

```json
{ "tool": "agentbrew", "version": "0.4.0", "week": "2026-W43",
  "machine_id": "<32 hex chars>", "metrics": { "sync_runs": 12, "sync_ok_rate": 1 } }
```

Only `tool`, `version`, `week`, and `machine_id` are strings, and each must
match a strict pattern. Every metric is a number. `machine_id` is random and
made on this machine (`~/.local/share/agentbrew/metrics/machine-id`, mode
600). A sibling tool copies the schema file as is. A file that fails the
schema is never sent; `share` names it and skips it.

**agentbrew metrics.** From the last 7 days of the event log: `sync_runs`,
`sync_ok_rate`, `sync_p95_ms`, `repair_runs`, `drift_repaired`,
`commands_run`, `errors_total`, and `errors_usNN` per user story.

**Command.** `agentbrew metrics share` writes agentbrew's provider file,
collects every valid provider file, and prints the exact payload.

| Step | What happens |
|---|---|
| First run | Dry run: prints the payload, sends nothing. |
| Later runs | Sends to the sink. `--dry-run` always previews; `--send` skips the preview. |
| `--sink <spec>` | `dir:<path>` copies files to `<path>/<tool>/<machine_id>/`. `git:<path>` does the same in a git checkout and commits (you push). `none` sends nothing. Saved. |
| `--schedule weekly` | The scheduled `agentbrew fix` sends once per ISO week. `--schedule off` stops it. Saved. |

The base repo sets no sink. An org overlay or plugin sets
`AGENTBREW_METRICS_SINK` (same spec). A saved `--sink` wins over it. The
config lives in `~/.config/agentbrew/metrics-share.json`.

`AGENTBREW_EVENTS=0` turns off the event log, the provider file, the share,
and the schedule. Tests: `src/metrics/weekly.test.ts` (including the "no
strings except the four" check).
