# Decision: no offline probe or cache warm-up in `agentbrew init`

- **Task**: `first-run-offline-warmup`
- **Date**: 2026-10-16
- **Status**: decided — close the task; no code change

## Context

The README told users to run `npx --yes skills --version` before they go
offline, because a cold offline `agentbrew init` could fail with `ENOTCACHED`.
The task asked for a 2-second network probe in `init`, plus either an
automatic cache warm-up or an actionable error. Its acceptance said: first
retest a cold offline `init`; if a failed skills CLI call now falls back to
the native path, close the task.

## Retest (2026-10-16)

Setup: a new temporary `HOME` with only `~/.claude` and `~/.cursor`, an empty
npm cache (`npm_config_cache`), `npm_config_offline=true`, and HTTP(S) proxy
variables that point at a closed local port, so git and npm have no network.
Command: `tsx src/cli.ts init` from this repo.

Result:

- Agent detection, MCP config, the shell hook, and sync all ran.
- Each recommended skill source failed its `git clone` and printed one
  `⚠ <source>: N skill(s) skipped (source unreachable)` line.
- The skills CLI was never called, because no source was cloned. So
  `ENOTCACHED` cannot happen on a fully offline first run.
- `init` printed `✓ Recommended setup complete.` and `Done!`.

The `ENOTCACHED` path is still possible when git can reach the source but npm
cannot reach the registry. That path already falls back to the native
scanner and prints the README troubleshooting hint. `src/add-source.test.ts`
covers it ("points delegated install failures at networking and
offline-cache troubleshooting" and the fallback failure-mode matrix).

## Options

| Option | Result |
|---|---|
| A. Add a network probe and auto warm-up to `init` | Extra code and a network call on every `init`, for a failure that the retest did not show. |
| B. Add only an actionable error | Nothing fails, so there is nothing to attach the error to. |
| C. Close the task and fix the README | The README now describes what really happens. |

## Recommendation

**Option C.** The README paragraph now says that a cold offline `init`
finishes and skips unreachable sources, and to run `init` or `sync --pull`
again when online.

## Side finding

`agentbrew init` with a temporary `HOME` still calls `launchctl load` in the
real user GUI domain for the `com.agentbrew.check` label. Do not use a
temporary `HOME` to test `init` on a machine whose auto-repair job matters.
AGENTS.md `## Gotchas` records this.
