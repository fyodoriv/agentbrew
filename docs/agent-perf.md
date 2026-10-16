# Agent time measurement

agentbrew records how long each agent tool call takes, so you and your
agents can see which steps are slow and which slow steps repeat.

## What runs

| Part | What it does |
|---|---|
| Hook `perf-record` (PostToolUse) | Appends one row per tool call. |
| Hook `perf-record-failure` (PostToolUseFailure) | Appends one row per failed tool call (`ok: false`). |
| Hook `perf-record-turn` (UserPromptSubmit) | Appends a turn boundary row. It does not store the prompt. |
| `~/.config/agentbrew/scripts/agent-perf.mjs` | Reads the log: `report`, `brief`, `statusline`, `turn`. |

The hooks are on by default for Claude Code. They run with `async: true`, so
Claude Code does not wait for them. They never block and never print. The
time comes from the `duration_ms` field that Claude Code puts in the
PostToolUse and PostToolUseFailure payloads.

To turn them off on one machine, list the IDs under `disabled:` in
`~/.config/agentbrew/hooks-overlay/manifest.yaml`, or set
`HOOK_BYPASS_PERF_RECORD=1` in the agent environment.

## Perf log

Path: `${XDG_STATE_HOME:-~/.local/state}/agentbrew/perf/YYYY-MM.jsonl`. One
file per UTC month, append-only, mode `600`. When a new month file starts, the
hook deletes month files older than 180 days.

Tool row:

```json
{"project":"agentbrew","ts":"2026-10-15T12:00:00Z","sid":"<session id>","tool":"Bash","ms":61234,"ok":true,"key":"npm run verify","agent":null}
```

Turn row:

```json
{"project":"agentbrew","ts":"2026-10-15T12:00:00Z","sid":"<session id>","ev":"turn"}
```

| Field | Meaning |
|---|---|
| `project` | Name of the git repo of the session `cwd`. A linked worktree maps to its main repo. Outside git: the `cwd` folder name. |
| `ts` | UTC time when the hook ran, to the second. |
| `sid` | Claude Code `session_id`. |
| `tool` | Tool name (`Bash`, `Edit`, an MCP tool name, …). |
| `ms` | `duration_ms` from Claude Code: tool run time, not model time. `null` when absent. |
| `ok` | `false` for PostToolUseFailure rows. |
| `key` | The step key (below). |
| `agent` | `agent_type` when a subagent ran the call, else `null`. |

### Step key and privacy

The log never holds prompts, full commands, file paths, file contents, or
secrets. It holds only a short step key:

| Tool | Key |
|---|---|
| Bash | First two words of the command, plus the third when the second is `run` (`npm run verify`). |
| Edit, Write, Read, MultiEdit, NotebookEdit | `<tool>:<file extension>` (`Edit:ts`). |
| Agent / Task | `agent:<subagent_type>`. |
| Skill | `skill:<name>`. |
| Other tools, MCP tools | The tool name. |

For Bash, the hook first drops `cd X &&`, `VAR=value`, `(`, and the `env`,
`nice`, `time`, `nohup`, `command`, `exec`, and `timeout` wrappers with their
flags. Then it checks each kept word:

- A path keeps only a script file name (`bash scripts/run-hook-fixtures.sh` → `bash run-hook-fixtures.sh`). Other paths become `<path>`.
- A `NAME=value` word keeps only `NAME=`.
- A word of 20 or more characters with a digit, or a known token prefix (`ghp_`, `sk-`, `AKIA`, …), becomes `<redacted>`.
- Any other word that is not a plain word or flag becomes `<arg>`.

The rules live in `hooks/lib/perf-row.jq`. `hooks/checks/perf-record.test.sh`
and `src/scripts/agent-perf.test.ts` prove that a token-like argument and a
path never reach the log.

## Read the log

Run every command with `node ~/.config/agentbrew/scripts/agent-perf.mjs`.

| Command | Output |
|---|---|
| `report [--project NAME \| --all] [--days N] [--json]` | Total tool time and calls, then per-step count, total, p50, p95, and max; the 10 slowest calls; the top 5 steps by total time; failures by step; and the change against the previous window of the same length. Default: the current project, 7 days. |
| `report --session ID\|latest [--project NAME \| --all] [--json]` | The same for one session. `latest` is the session of the newest row in scope. |
| `brief [--project NAME]` | At most 5 lines: 7-day tool time, the top 3 steps with p50, the slowest single step, and one speedup candidate (a step that ran 3 or more times and cost at least a minute). Empty when there is no data. |
| `statusline` | Reads Claude Code status-line JSON on stdin and prints one line, for example `Opus 5.5 · 42m (api 18m · tools 15m) · slowest: npm run verify 6m12s · ctx 38%`. |
| `turn --session ID [--json]` | Tool time, call count, the 3 slowest calls, and the top 3 steps since the last turn row of that session. |

`--cwd DIR` picks the project for `report` and `brief` when you run them from
another folder.

### Counting rules

- Totals (`toolMs`, `calls`, `failures`) count only main-thread rows (`agent: null`). A subagent's calls run inside its Agent call, so adding them would count the time twice. `subagentCalls` reports them.
- Per-step stats (`keys`, `topKeys`, `slowest`) count every row.
- Percentiles use the nearest-rank method.
- A row without a number in `ms` does not count.

### report --json shape

```json
{
  "scope": { "project": "agentbrew", "session": null, "days": 7, "since": "…" },
  "toolMs": 0, "calls": 0, "subagentCalls": 0, "failures": 0,
  "keys": [{ "key": "npm run verify", "count": 0, "sumMs": 0, "p50Ms": 0, "p95Ms": 0, "maxMs": 0, "failures": 0 }],
  "topKeys": [{ "key": "…", "sumMs": 0, "previousSumMs": 0, "sumChangePct": null }],
  "slowest": [{ "ts": "…", "key": "…", "ms": 0, "project": "…", "sid": "…", "ok": true }],
  "failuresByKey": [{ "key": "…", "failures": 0, "count": 0 }],
  "previous": { "toolMs": 0, "calls": 0, "toolMsChangePct": null, "callsChangePct": null }
}
```

`*ChangePct` is `null` when the previous window had no time for that value.
`--session` reports have no `previous` and no `previousSumMs`.

## Speed

`statusline` keeps a small per-session cache under `perf/.cache/`. Each
refresh reads only the bytes appended since the last refresh.

## Why not OpenTelemetry

Claude Code can export OpenTelemetry events with `tool_result.duration_ms`
(`CLAUDE_CODE_ENABLE_TELEMETRY`), but that needs a collector. The hooks need
nothing extra. If hook capture misses more than 20% of tool calls, or the
hook costs more than 50 ms at p95, switch to the OpenTelemetry path.
