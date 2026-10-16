# Decision: replace the ask-human MCP with mcp-feedback-enhanced

- **Task**: `re-promote-ask-human-mcp-after-stdio-fix`
- **Date**: 2026-10-16
- **Status**: decided — replace; catalog swap filed as
  `swap-ask-human-mcp-for-mcp-feedback-enhanced`

## Context

The catalog entry `ask-human` (`src/catalog.yaml`) runs
`pipx run ask-human-mcp`. It was demoted to `recommended: false` because
releases 0.1.0 and 0.1.1 fail in stdio mode before MCP `initialize`. The
task: re-check upstream, test any new release, then re-promote the entry
or replace it with a maintained human-in-the-loop MCP.

## Options

| Option | Result |
|---|---|
| A. Wait for an upstream release | No change. The entry stays broken. |
| B. Pin the entry to the upstream git commit that has the fix | Works today. Pins an unmaintained project with floating dependencies. |
| C. Replace the entry with a maintained human-in-the-loop MCP | Works today. Different interaction model (see below). |

## Evidence (2026-10-16)

### Upstream ask-human-mcp

- **No new release.** `https://pypi.org/pypi/ask-human-mcp/json`: latest
  `0.1.1`, uploaded 2025-06-08. Releases: `0.1.0`, `0.1.1`.
- **Issue still open.** Masony817/ask-human-mcp#3 ("Running 0.1.1, but
  still getting asyncio error") is `OPEN`. Last update 2025-07-24.
- **The fix is on `main` but not released.** PR #4 "Fix nested asyncio"
  merged 2025-07-05. That is the last push to the repo. `main` is at
  `24793b6362e000c12418cae7be5b8caa93cd371a`.
- **0.1.1 now fails in a second way.** `pipx run ask-human-mcp` (the
  catalog command) installs `mcp` 2.x and exits at import:
  `ModuleNotFoundError: No module named 'mcp.server.fastmcp'`. The package
  does not pin `mcp<2`.
- **0.1.1 with `mcp<2` still has the original bug.**
  `uvx --from ask-human-mcp==0.1.1 --with 'mcp<2' ask-human-mcp` logs
  `RuntimeError: Already running asyncio in this thread` and exits 1. No
  `initialize` response.
- **`main` passes the smoke test.**
  `uvx --from git+https://github.com/Masony817/ask-human-mcp ask-human-mcp`:
  `initialize` returns `serverInfo.name: "ask-human"`; `tools/list` returns
  `ask_human`, `list_pending_questions`, `get_qa_stats`; `tools/call
  list_pending_questions` returns `"No pending questions."` with
  `isError: false`.

### Replacement candidates

The official MCP registry
(`https://registry.modelcontextprotocol.io/v0/servers?search=...`, queries
"human", "human-in-the-loop", "feedback", "ask-human", "interactive",
"approval") returns mostly hosted commercial services and no clear local
stdio match. Known packages, checked on PyPI and GitHub:

| Package | Latest release | Repo state |
|---|---|---|
| `mcp-feedback-enhanced` (Minidoracat) | 2.8.1, 2026-09-07 | pushed 2026-10-13, not archived, MIT |
| `interactive-feedback-mcp` (noopstudios) | 0.1.2, 2025-06-09 | last push 2025-05-26 |
| `human-in-the-loop-mcp-server` (GongRzhe) | 1.0.2, 2026-02-18 (fork package) | upstream repo archived |
| KOBA789 `human-in-the-loop` | — | last push 2025-07-02; needs Discord |

Only `mcp-feedback-enhanced` is clearly maintained. Live stdio smoke test
in an empty temp folder, `uvx mcp-feedback-enhanced@2.8.1 server`:

- `initialize` returns protocol `2025-06-18` and a server name;
- `tools/list` returns `interactive_feedback`, `get_system_info`;
- `tools/call get_system_info` returns a JSON system report with
  `isError: false`. The server logs "Starting MCP server ... with transport
  'stdio'". The interface type it reports is "Web UI".

It pins its dependencies to ranges (`mcp>=2.1.1,<3`,
`fastmcp>=4.0.3,<5`), so the `mcp` 2.x break above does not apply.

Smoke method: a small Python client sends `initialize`,
`notifications/initialized`, `tools/list`, and one `tools/call` as JSON-RPC
lines on stdin and reads stdout with a 90 s timeout per reply.

### Catalog drift found on the way

- The entry's `rationale` cites a shared-rules rule "Async human comms —
  ask_human.md". `docs/shared-rules.md` no longer has that rule. Only
  `docs/research/hooks-over-agents-md.md` still names it.
- The entry's `note` names only the asyncio error. It misses the newer
  `mcp` 2.x import error.

## Recommendation

**Option C: replace `ask-human` with `mcp-feedback-enhanced`, and keep
`recommended: false`.**

- Option A is not real: no release in over a year, and the last push was
  2025-07-05.
- Option B pins a project with no maintainer activity and unpinned
  dependencies. The next `fastmcp` or `mcp` major can break it again.
- `mcp-feedback-enhanced` is maintained, MIT, pins its dependencies, and
  passed the live smoke test today.

Keep it opt-in. Its model differs: `interactive_feedback` blocks the agent
and opens a web UI for the answer. `ask-human-mcp` used an async
`ask_human.md` file. That file convention is no longer in shared rules, so
nothing in agentbrew depends on it. A web UI that opens for every user is
not a safe default.

## Follow-up

`swap-ask-human-mcp-for-mcp-feedback-enhanced` in `TASKS.md`. It swaps the
catalog entry, sets the deep smoke tool to `get_system_info`, drops the
`probeSuppression` block and the stale rationale, and keeps the mcpm
cleanup for old `ask-human` installs. It is filed separately because
another session owns `src/catalog.yaml` today.
