# Hook protocol

Agentbrew hooks are deterministic guardrails generated from `hooks/manifest.yaml`
and deployed by `agentbrew sync` to every detected agent with a native hook
surface.

## Source of truth

| Source | Purpose |
|---|---|
| `hooks/manifest.yaml` | Canonical hook IDs, descriptions, event/matcher mapping, script path, tier, verdict, bypass variable, source rule, and target agents. |
| `hooks/checks/` | Deterministic shell checks. |
| `hooks/verifiers/` | LLM-backed verifiers. Verifiers must default to allow on timeout or model failure. |
| `hooks/lib/` | Shared shell helpers for parsing hook stdin and emitting verdicts. |
| `~/.config/agentbrew/hooks-overlay/manifest.yaml` | Optional per-machine overlay. Matching IDs replace canonical hooks; `disabled:` removes canonical hooks locally; `enabled:` turns on `defaultEnabled: false` hooks locally (`disabled:` wins when an ID is in both). |

The parser rejects malformed manifests during sync so a broken guardrail fails
before it can silently disappear from an agent.

## Manifest schema

```yaml
version: 1
disabled:
  - optional-canonical-hook-id
enabled:
  - optional-opt-in-hook-id
hooks:
  - id: code-no-timestamps
    description: Reject timestamp comments in source code
    event: PreToolUse
    matcher: Write|Edit
    script: checks/code-no-timestamps.sh
    tier: deterministic
    verdict: block
    bypassEnvVar: HOOK_BYPASS_CODE_NO_TIMESTAMPS
    sourceRule: shared-rules.md#code-has-no-time-stamps
    agents: [claude-code]
```

Required fields per hook:

- `id`: stable kebab-case hook ID. Also names the deployed script copy.
- `description`: human-readable summary for review/debugging.
- `event`: one Claude Code lifecycle event name.
- `script`: path relative to `hooks/`.
- `tier`: `deterministic` or `verifier`.
- `verdict`: `block`, `warn`, or `mutate`.

Optional fields:

- `matcher`: agent-native matcher for the event.
- `bypassEnvVar`: emergency escape hatch. Hook scripts must honor it.
- `model` / `promptVersion`: verifier metadata.
- `sourceRule`: advisory rule that the hook enforces.
- `agents`: target agent names. Omit or use an empty list to deploy to every
  detected hook-capable target.
- `defaultEnabled`: set `false` to make the hook opt-in. Its script still
  deploys, but sync wires it into agent hooks files only on machines whose
  overlay lists the ID under `enabled:`. The PreToolUse:Bash hooks and
  `context-budget-measure` ship this way.

State hooks (from `state.yaml` / Agentfile) and manifest hooks merge per hook,
not per group. Hooks that share an event and matcher land in one group, with
state hooks first. A manifest hook is dropped only when a state hook has the
same event, matcher, and command.

## Sync targets

`agentbrew sync` writes only to detected agents. The current Phase 0 targets are:

| Agent | Output path | Format |
|---|---|---|
| Claude Code | `~/.claude/settings.json` under the `hooks` key | Claude settings wrapper |
| Cursor | `~/.cursor/hooks.json` | `{ version: 1, hooks: … }` with native camelCase event names |
| Devin | `.devin/hooks.v1.json` in the current project | Direct Claude-compatible hooks object |

Agentbrew tracks managed hook keys per agent in `manifest.json` so stale managed
entries can be pruned without deleting user-authored hooks in another agent's
format.

## Runtime contract

Hook scripts read the agent's hook payload from stdin as JSON. The common Claude
Code shape is:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "tool_name": "Edit",
  "tool_input": {
    "file_path": "/path/to/file",
    "old_string": "...",
    "new_string": "..."
  },
  "hook_event_name": "PreToolUse"
}
```

Scripts must tolerate missing fields and unknown extra fields because agent hook
schemas evolve independently.

## Verdict contract

| Verdict | Exit / stdout / stderr |
|---|---|
| Allow | Exit `0` with empty stdout. |
| Warn | Exit `0` and print a concise warning to stderr. |
| Block | Exit `2` and print a concise, actionable explanation to stderr. |
| Mutate | Exit `0` with agent-supported rewrite JSON on stdout. Only use on events whose host supports mutation. |

Blocking messages must tell the agent exactly how to retry successfully. Do not
print secrets, full environment dumps, or unrelated transcript contents.

## Timing and safety

- Deterministic hooks should complete in under 2 seconds.
- Verifier hooks must wrap model calls in a short timeout and default to allow on
  timeout or malformed model output.
- Scripts must not mutate the repository unless their manifest verdict is
  `mutate` and the target event supports mutation.
- Every deterministic hook must have at least one adjacent `.test.sh` fixture
  and be covered by `scripts/run-hook-fixtures.sh`.
- Every bypass must be discoverable from the script header and the manifest's
  `bypassEnvVar`.
- PRs that change high-impact agent artifacts must include same-PR deterministic
  tests, behavioral evals, or `Agent artifact test exemption: <reason>` in the
  PR body. `gh-pr-agent-artifacts-require-tests` enforces this for `gh pr
  create` / `gh pr edit`.

## Adding a hook

1. Add or update the script under `hooks/checks/` or `hooks/verifiers/`.
2. Add an adjacent `.test.sh` fixture that proves the intended verdict.
3. Add the manifest entry with explicit `agents:` if the hook is not portable to
   every hook-capable target.
4. Run:

   ```bash
   bash scripts/run-hook-fixtures.sh
   tsc --noEmit
   npm run test:all
   ```

5. If the hook replaces an advisory rule, file or update the follow-up task that
   removes the now-deterministic prose rule after the hook has been stable.
