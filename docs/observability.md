# Observability

How to see what agentbrew did on this machine, what failed, and how to fix it.
Logs and error messages stay on the machine. agentbrew has no external error
reporter ([`VISION.md`](VISION.md) § Non-goals). Two things can leave it, each
only after you say yes: [field telemetry](#field-telemetry) (anonymous
performance numbers) and the [weekly metrics share](#weekly-metrics-share-opt-in).

## Field telemetry

agentbrew can send the content-free event log to PostHog EU as anonymous
performance numbers (decided 2026-11-09, [`VISION.md`](VISION.md)). It is
asked at install; on only after you say yes (Enter counts as yes). The numbers
from all installs feed a public speed dashboard (p50 and p95 per command,
version, and runtime) and a regression gate.

### The consent question

The stored answer is `unset`, `yes`, or `no`. Nothing is sent unless it is `yes`.

| When | What happens |
|---|---|
| Install in a terminal (`scripts/install.sh run`) | The last step asks, after a banner: what is sent, one real event as JSON, the privacy promise, where the numbers go, how to change the answer, then `Share anonymous performance numbers? [Y/n]`. Enter or `y` records `yes`; `n` records `no`. One line confirms the result. |
| Install with no terminal, or with `CI` set | No question. The answer stays `unset`. Nothing is sent. |
| Install with `--no-telemetry`, `AGENTBREW_TELEMETRY=0`, or `DO_NOT_TRACK=1` | Records `no` without a question, and says so in one line. This also holds at a re-install with a stored `yes`: an explicit opt-out always wins. |
| Re-install or update | Never asks again. Never changes a stored answer, except for the opt-out above. Nothing ever turns a stored `no` into a `yes` but you. |
| A command in a terminal while the answer is `unset` | Asks the same question on stderr, at most once a day, as `[y/n]`: only a typed `y` or `n` counts, and Enter alone leaves the answer `unset`. It needs a terminal on stdin, stdout, and stderr, so a pipe, hook, scheduler, or agent run stays silent. `AGENTBREW_TELEMETRY_ASK=0` skips it (the installer sets it for its own commands). |
| Keys typed before the question shows | Thrown away. A stray Enter is never an answer. |
| The answer becomes `yes` | The cursor moves to the end of the event log. Only events recorded after the yes are sent. |
| `agentbrew telemetry on` / `off` | Records `yes` / `no` at any time. `on` prints the example and the promise. |
| A state file that cannot be read | Counts as `unset`, never `yes`. A readable `no` is kept. |
| A state file from before the question | Has no answer: `unset`. An earlier `telemetry off` counts as `no`. |

An agent that installs for you has no terminal. `INSTALL.md` tells it to show
you the question and run `agentbrew telemetry on` or pass `--no-telemetry`.

### What is sent

The command name, its duration, ok or error, counts, the agentbrew version,
your OS and CPU type, and a random install id. One item per line of the
[event log](#events):

```json
{
  "event": "agentbrew.command",
  "distinct_id": "<random install id>",
  "timestamp": "2026-11-09T11:00:00.000Z",
  "properties": {
    "ok": true,
    "command": "sync",
    "ms": 1840,
    "app_version": "1.0.0",
    "os": "darwin",
    "arch": "arm64",
    "runtime": "ts",
    "$geoip_disable": true,
    "$process_person_profile": false
  }
}
```

| Field | Values |
|---|---|
| `event` | `agentbrew.` plus `command`, `sync`, `repair`, or `error` |
| `distinct_id` | A random id made on this machine. Delete `telemetry.json` to get a new one (the answer is then `unset`). |
| `timestamp` | When the event happened (UTC) |
| `command` | The top-level command, only when it is in `COMMAND_NAMES` (`src/core/events.ts`) |
| `ok`, `ms` | Did it work, and the wall time in ms |
| `story`, `code`, `module`, `types` | A story ID (`US06`), an error code, a sync module, drift types. Each name comes from a fixed list in `src/core/events.ts`; any other word is dropped |
| `driftBefore`, `repaired`, `remaining` | Counts |
| `app_version`, `os`, `arch`, `runtime` | The agentbrew version; `darwin`, `linux`, or `other`; `arm64`, `x64`, or `other`; and `ts` |

### The privacy promise

Never a path, file name, host name, user name, argument, message, or content. No IP-based location. No person profile.
PostHog sees the IP address of each request, like any web server. The location lookup (GeoIP) is off, and no location is stored.
The code that enforces this is `src/core/events.ts` (`sanitizeEvent`) and
`src/core/telemetry.ts` (`buildBatch`). Each line is checked against the
allowlist again at send time, so an edited or older log line cannot send a
path, name, email, URL, or token. A canary test in
`src/core/telemetry.test.ts` pins this.

### Off switches

Nothing is sent when any of these is true, whatever the stored answer is:

| Switch | Effect |
|---|---|
| The answer is `no` or `unset` | `agentbrew telemetry off` records `no`; `agentbrew telemetry on` records `yes` |
| `DO_NOT_TRACK` | Any value except empty or `0` |
| `AGENTBREW_TELEMETRY=0` | Blocks every send; at install it also records `no` |
| `CI` | Any value |
| No project key | See the key order below |

### Inspect it

`agentbrew telemetry status` shows on or off, the reason, the consent answer
and when it was given, the key source (never the key), the pending count, and
the last send. `agentbrew telemetry send --dry-run` prints the exact next
request body with the key shown as `<posthog_key>`, and sends nothing.

### The key

A PostHog project key can only write events; it is public by design.
agentbrew reads it in this order: `AGENTBREW_POSTHOG_KEY`, then the owner's
Keychain item `agentbrew` / `posthog_key`, then the committed file
`src/core/telemetry-default-key.txt` (shipped as `dist/telemetry-default-key.txt`).
An empty file means no key, and nothing is sent. A set but empty
`AGENTBREW_POSTHOG_KEY` also means no key. A value from any source that is
not one `phc_` key (letters and digits) is no key. The question path reads the
env var and the file first, and asks the Keychain at most once a day when
both are empty.

### Reliable

A send never fails a command.

- `agentbrew sync` sends at most once a day, and one try counts even when it fails.
- The automatic send stops after 3 seconds in total. `agentbrew telemetry send` allows 10 seconds per request.
- One request holds at most 500 events. The cursor moves only after a 2xx answer.
- A send skips everything but the newest 2,000 events of the last 30 days, so a first send never uploads an old history.
- The state file (`~/.local/share/agentbrew/logs/telemetry.json`, or `AGENTBREW_TELEMETRY_STATE`; mode 600) is written with a temp file and a rename. The installer's backup and restore do not touch it.
- A state file that cannot be read starts again at the end of the log. A shorter log moves the cursor to its end.
- A hung server cannot hold the process open: the answer body is cancelled, and a real-socket test pins the exit time and the exit code.
- Each save re-reads the state file and changes only the cursor and the send times, so a `telemetry off` given during a send is kept. The send stops before its next request.
- One send runs at a time on a machine (a lock file beside the state; a lock older than 60 seconds is ignored).
- Errors are swallowed; `AGENTBREW_DEBUG=1` prints them.

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
| Event log | `~/.local/share/agentbrew/logs/events.jsonl` (or `AGENTBREW_EVENTS_FILE`) | `src/core/events.ts` | Content-free JSON lines: one per command run, sync, scheduled repair, and error. See [Events](#events). |
| Repair log | `~/.config/agentbrew/repair-log.json` | `src/repair-log.ts` | What the scheduled repair fixed since you last ran a command. `agentbrew status` prints a summary and clears it. |
| Sync errors | `~/.config/agentbrew/sync-errors.json` | `src/core/errors.ts` | The errors of the last sync, with messages. Stays local. |
| Scheduler output | `~/.local/share/agentbrew/logs/launchagent.log`, `launchagent.err`, `cron.log`, `auto-sync.log` | the LaunchAgent, cron, systemd timer, or watcher | Raw output of `agentbrew fix`, trimmed to the newest lines past 1 MB. |
| Agent step timings | see [`agent-perf.md`](agent-perf.md) | perf hooks | Per-step tool time for agent sessions. |

The event log is content-free by construction. `sanitizeEvent` keeps only
allow-listed fields. A string field is kept only when its value is in a fixed list
(command names, sync modules, drift types, error codes) or is a story ID, so
a path, server name, token, plain word, or error message can never reach the file.

Turn it off with `AGENTBREW_EVENTS=0`. Every test runs with it off
(`vitest.config.ts`), and `src/core/events.test.ts` asserts that.

## Events

| Event | When | Fields | Story |
|---|---|---|---|
| `sync` | each `agentbrew sync` that is not `--dry-run` | `ms`, `ok` (no error and exit code 0) | US08; `--rollback` US26, `--pull` US13, `--agentfile` US23, `--discover` US11 |
| `command` | each command run, `sync` and `fix` too | `command` (the top-level name from `COMMAND_NAMES`, never an argument), `ms`, `ok` (exit code 0) | `storyForCommand` in `src/core/events.ts`; none for a command that serves no story |
| `repair` | each scheduled or manual `agentbrew fix` | `ms`, `ok` (no drift left), `driftBefore`, `repaired`, `remaining`, `types` (drift types left) | US06 |
| `error` | each sync module error, and a repair that throws | `ok: false`, `code`, `module` | from the map below |

Every event also has `ts` (ISO time), and `story` unless it is a `command` with none.
A command that throws or exits early records no `command` event. `scripts/metrics.sh` turns
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
