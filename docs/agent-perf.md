# Agent time measurement

agentbrew records how long each agent tool call takes, so you and your
agents can see which steps are slow and which slow steps repeat.

## What runs

| Part | What it does |
|---|---|
| Hook `perf-record` (PostToolUse) | Appends one row per tool call. |
| Hook `perf-record-failure` (PostToolUseFailure) | Appends one row per failed tool call (`ok: false`). |
| Hook `perf-record-turn` (UserPromptSubmit) | Appends a turn boundary row. It does not store the prompt. |
| Hook `perf-record-attempt` (PreToolUse, all tools) | Appends an attempt row before each tool call, so a call that never runs still counts. |
| Hook `perf-record-denied` (PermissionDenied) | Appends a denied row when the auto mode classifier denies a call. |
| `~/.config/agentbrew/scripts/agent-perf.mjs` | Reads the log: `report`, `brief`, `statusline`, `turn`. |
| Hook `perf-brief` (SessionStart) | Gives the agent the project's 7-day brief as context. |
| Hook `perf-task-review` (Stop) | Asks for a "Time review" after a long turn. |
| Claude Code `statusLine` | Shows session time, tool time, and the slowest step. |
| Skill `perf-review` | Tells an agent how to read the report and when to file a speedup task. |

The hooks are on by default for Claude Code. They run with `async: true`, so
Claude Code does not wait for them. They never block and never print. The
time comes from the `duration_ms` field that Claude Code puts in the
PostToolUse and PostToolUseFailure payloads.

Some calls never run, so they fire no PostToolUse or PostToolUseFailure
event: a permission prompt that nobody answers (for example "This Bash
command contains multiple operations"), a PreToolUse block by another hook,
or an auto mode denial. PreToolUse fires before the permission check and
before the other hooks decide, so the attempt row records these calls too.
The `id` field pairs each attempt with its completion row.

Claude Code 2.1.301 limits, from captured payloads:

- An input-validation error (`<tool_use_error>File does not exist` from
  Edit) fires no hook at all, not even PreToolUse. The log cannot see it.
- `PermissionDenied` fires only for auto mode classifier denials. A prompt
  that is refused in `claude -p` default mode fires `PermissionRequest`
  (without a `tool_use_id`) and then nothing. The attempt row still covers it.

To turn them off on one machine, list the IDs under `disabled:` in
`~/.config/agentbrew/hooks-overlay/manifest.yaml`, or set
`HOOK_BYPASS_PERF_RECORD=1` in the agent environment.

## Perf log

Path: `${XDG_STATE_HOME:-~/.local/state}/agentbrew/perf/YYYY-MM.jsonl`. One
file per UTC month, append-only, mode `600`. When a new month file starts, the
hook deletes month files older than 180 days.

Tool row:

```json
{"project":"agentbrew","ts":"2026-10-15T12:00:00Z","sid":"<session id>","tool":"Bash","ms":61234,"ok":true,"key":"npm run verify","id":"toolu_01…","agent":null}
```

Attempt row (PreToolUse) and denied row (PermissionDenied, `"ev":"denied"`):

```json
{"project":"agentbrew","ts":"2026-10-15T12:00:00Z","sid":"<session id>","ev":"attempt","tool":"Bash","key":"npm run verify","id":"toolu_01…","agent":null}
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
| `ev` | `attempt`, `denied`, or `turn`. Absent on tool (completion) rows. |
| `key` | The step key (below). |
| `id` | Claude Code `tool_use_id`, kept only as an opaque pairing key (`[A-Za-z0-9_-]`). Rows written before this field existed have none. |
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
| `brief [--project NAME]` | At most 5 lines: 7-day tool time, the top 3 steps with p50, the slowest single step, the blocked calls (when there are any), and one speedup candidate (a step that ran 3 or more times and cost at least a minute). Empty when there is no data. |
| `statusline` | Reads Claude Code status-line JSON on stdin and prints one line, for example `Opus 5.5 · 42m (api 18m · tools 15m) · slowest: npm run verify 6m12s · ctx 38%`. |
| `turn --session ID [--json]` | Tool time, call count, the 3 slowest calls, the top 3 steps, and `attempts`, `blocked`, and `blockedKeys` (top 5) since the last turn row of that session. |

`--cwd DIR` picks the project for `report` and `brief` when you run them from
another folder.

### Counting rules

- Totals (`toolMs`, `calls`, `failures`) count only main-thread rows (`agent: null`). A subagent's calls run inside its Agent call, so adding them would count the time twice. `subagentCalls` reports them.
- Per-step stats (`keys`, `topKeys`, `slowest`) count every row.
- Percentiles use the nearest-rank method.
- A row without a number in `ms` does not count toward time. Attempt and denied rows have no `ms`.

### Attempts, blocked calls, and capture rate

Pairing uses `sid` plus `id`. Rows without an `id` take no part.

| Field | Meaning |
|---|---|
| `attempts` | Calls with an attempt or denied row. |
| `blocked` | Attempts with no completion row (PostToolUse or PostToolUseFailure) of the same `sid` and `id`. The call never ran: a permission prompt, a hook block, or a denial. A call that is still running also counts until it ends. |
| `blockedKeys` | `blocked` by step key, most first: `[{ "key", "count" }]`. |
| `callsWithId` | Calls with any row that has an `id`. |
| `captureRate` | Calls with an attempt row ÷ `callsWithId`. `1` means every call that reached the log has its attempt recorded. `null` without `id` rows. |

`captureRate` checks the hooks against each other. The outside check
compares the log with the session transcript: attempt rows for a session ÷
`tool_use` blocks in `~/.claude/projects/*/<sid>.jsonl`. Only an
input-validation error (above) can make that ratio miss.

### report --json shape

```json
{
  "scope": { "project": "agentbrew", "session": null, "days": 7, "since": "…" },
  "toolMs": 0, "calls": 0, "subagentCalls": 0, "failures": 0,
  "keys": [{ "key": "npm run verify", "count": 0, "sumMs": 0, "p50Ms": 0, "p95Ms": 0, "maxMs": 0, "failures": 0 }],
  "topKeys": [{ "key": "…", "sumMs": 0, "previousSumMs": 0, "sumChangePct": null }],
  "slowest": [{ "ts": "…", "key": "…", "ms": 0, "project": "…", "sid": "…", "ok": true }],
  "failuresByKey": [{ "key": "…", "failures": 0, "count": 0 }],
  "attempts": 0, "callsWithId": 0, "blocked": 0, "captureRate": null,
  "blockedKeys": [{ "key": "…", "count": 0 }],
  "previous": { "toolMs": 0, "calls": 0, "toolMsChangePct": null, "callsChangePct": null }
}
```

`*ChangePct` is `null` when the previous window had no time for that value.
`--session` reports have no `previous` and no `previousSumMs`.
`--session` reports set `scope.days` to `null`. When `--session latest` finds no
row in scope, `scope.session` is `null` and the text header says
`session latest (none found)`.

## Hooks that use the log

Both hooks are on by default for Claude Code and need `node` on the hook
`PATH`. Without `node` or the helper, they stay silent.

- `perf-brief` (SessionStart) runs `agent-perf.mjs brief --cwd <session cwd>`
  and adds its output (at most 5 lines) as `additionalContext`. It prints
  nothing when the project has no rows. Bypass: `HOOK_BYPASS_PERF_BRIEF=1`.
- `perf-task-review` (Stop) runs `agent-perf.mjs turn --session <id>`. When
  the turn spent at least `AGENTBREW_PERF_REVIEW_MIN_SECS` seconds (default
  300) in tools, or had at least `AGENTBREW_PERF_REVIEW_MIN_BLOCKED` blocked
  calls (default 3), it blocks the stop once with
  `{"decision":"block","reason":…}`. The reason lists the turn's 3 slowest
  steps (long turn) and the blocked calls by step key (blocked turn). A
  blocked call wastes a model round trip, so the reason suggests splitting
  compound Bash commands and meeting hook gates first. It asks for a Time review of at most 5 lines: what took longest, one
  concrete speedup, and a task when a speedup saves a minute or more and
  recurs. The next stop has `stop_hook_active: true`, so the hook stays
  silent and cannot loop. Bypass: `HOOK_BYPASS_PERF_TASK_REVIEW=1`;
  `MINSKY_PIPELINE=1` also skips it.

## Status line

`agentbrew sync` sets the Claude Code `statusLine` in
`~/.claude/settings.json`:

```json
{"type": "command", "command": "node ~/.config/agentbrew/scripts/agent-perf.mjs statusline", "refreshInterval": 5}
```

The command holds the absolute path. Sync writes the setting only when it is
absent or still equals the value that agentbrew wrote last time (kept in
`~/.config/agentbrew/manifest.json` as `managedStatusLine`). A status line
that you set yourself is never changed, and `agentbrew status` lists it under
"User additions". To opt out, set your own `statusLine`.

## Tokens, cost, and hours

The perf log has no token data. For tokens, cache hits, cost, and active
hours per project, use the official `session-report` skill (catalog,
`recommended: true`). Its analyzer prints JSON:

```bash
node ~/.claude/skills/session-report/analyze-sessions.mjs --json --since 7d
```

A machine with an Agentfile installs only the skills that the Agentfile
lists, so add `session-report` (and `perf-review`) to its `skills:`.

## Speed

`statusline` keeps a small per-session cache under `perf/.cache/`. Each
refresh reads only the bytes appended since the last refresh.

## Why not OpenTelemetry

Claude Code can export OpenTelemetry events with `tool_result.duration_ms`
(`CLAUDE_CODE_ENABLE_TELEMETRY`), but that needs a collector. The hooks need
nothing extra. If hook capture misses more than 20% of tool calls, or the
hook costs more than 50 ms at p95, switch to the OpenTelemetry path.
