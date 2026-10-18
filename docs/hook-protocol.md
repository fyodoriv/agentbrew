# Hook protocol

Agentbrew hooks are deterministic guardrails generated from `hooks/manifest.yaml`
and deployed by `agentbrew sync` to every detected agent with a native hook
surface.

## Source of truth

| Source | Purpose |
|---|---|
| `hooks/manifest.yaml` | Canonical hook IDs, descriptions, event/matcher mapping, script path, tier, verdict, bypass variable, source rule, and target agents. |
| `hooks/checks/` | Deterministic shell checks. |
| `hooks/lib/` | Shared shell helpers for parsing hook stdin and emitting verdicts. |
| `~/.config/agentbrew/hooks-overlay/manifest.yaml` | Optional per-machine overlay. Matching IDs replace canonical hooks; `disabled:` removes canonical hooks locally; `enabled:` turns on `defaultEnabled: false` hooks locally (`disabled:` wins when an ID is in both). |

The parser rejects malformed manifests during sync so a broken guardrail fails
before it can silently disappear from an agent.

Sync finds `hooks/` in this order: `AGENTBREW_REPO_ROOT`, then the nearest
ancestor of the running CLI that has an `agentbrew` `package.json` and
`hooks/manifest.yaml`, then the current directory. A clone matches at the repo
root. An `npm i -g agentbrew` install matches at the package root, because the
package ships `hooks/` (without the `.test.sh` fixtures) and `templates/rules/`
through the `files` list in `package.json`. The real-e2e scenario
`real-e2e/scenarios/us01-us21-npm-package-hooks.test.ts` packs the repo, installs the
tarball globally into a scratch prefix, and checks that the hook entries and
catalog `.mdc` rules match a clone. `scripts/install-e2e-if-needed.sh` runs it
when `package.json`, the manifest, or the template rules change.

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
- `event`: one Claude Code lifecycle event name. A script that serves several
  events gets one entry per event, each with its own ID (the `perf-record`
  hooks do this).
- `script`: path relative to `hooks/`.
- `tier`: `deterministic`. The LLM verifier tier was retired because `claude --print` takes about 10 seconds per call, far past a hook budget, and every verifier failed open.
- `verdict`: `allow`, `block`, `warn`, or `mutate`. Use `allow` for a hook that only records or schedules work and never warns, such as `perf-record`.

Optional fields:

- `matcher`: agent-native matcher for the event.
- `bypassEnvVar`: emergency escape hatch. Hook scripts must honor it.
- `sourceRule`: advisory rule that the hook enforces.
- `agents`: target agent names. Omit or use an empty list to deploy to every
  detected hook-capable target.
- `async`: set `true` to let Claude Code run the hook in the background, so
  the tool call does not wait for it. Use it only for hooks that record data
  and never block, such as `perf-record`.
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

Agentbrew tracks managed hook keys per agent in `manifest.json` so stale managed
entries can be pruned without deleting user-authored hooks in another agent's
format.

Sync copies each hook script to `~/.claude/codeassist/hooks-scripts/<id>.sh`.
It lists the IDs it copied in `.agentbrew-deployed-hooks.json` in that
directory. On the next sync it deletes a listed script that no manifest entry
references any more. It also deletes old copies of the retired verifier
scripts.

A `*.sh` file in that directory that agentbrew did not deploy is an orphan
when no agent hook config (for example `~/.claude/settings.json`) and no state
hook command names it. Such files come from setups older than the tracking
file. `agentbrew sync` deletes orphans; `sync --no-prune` and the quiet
auto-sync only warn. A script that an agent config still names is never
deleted.

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

Hooks that check `gh pr` commands use `hooks/lib/gh-pr-body-from-command.sh`.
`gh_in_command_position` matches `gh pr create` only where a command starts
(line start, after `;`, `&`, `|`, `(`, or `$(`, with optional `VAR=value`
prefixes). An `echo` or a Python string that mentions `gh pr create` does not
match. Every `gh-pr-*` hook reads the body through this file; do not copy a
`--body-file` parser into a hook. `gh_pr_body_file` finds a readable
`--body-file` (quoted, unquoted, or `=`). `gh_pr_body_or_file` returns that
file, else the inline `--body` with `\n` expanded. `gh_pr_body_text` returns
the file, else the raw inline body. For a multi-line `--body` such as a heredoc,
both return the whole command.

## Verdict contract

| Verdict | Exit / stdout / stderr |
|---|---|
| Allow | Exit `0` with empty stdout. |
| Warn | Exit `0` and print a concise warning to stderr. |
| Block | Exit `2` and print a concise, actionable explanation to stderr. |
| Mutate | Exit `0` with agent-supported rewrite JSON on stdout. Only use on events whose host supports mutation. |

The manifest `verdict` names what the script itself emits. A hook that only
detects text that another tool rewrites later declares `warn`, not `mutate`.
The attribution hooks work this way: the dotfiles `gh` wrapper and
`commit-msg` hook do the strip. The shared helper
`hooks/lib/strip-agent-attribution.sh` puts the agent footer before a
trailing git trailer block (`Task:`, `Signed-off-by:`), because git reads
trailers only from the last paragraph. To check trailers like `git log` does,
run `git interpret-trailers --parse --no-divider`: without the flag, git
stops at the footer's `---` line and misses them. `src/hooks/manifest.test.ts` checks that each
script can emit its declared verdict: `block` needs `verdict_block` or a
`"decision":"block"` line, `warn` needs `verdict_warn` or added context,
`mutate` needs `verdict_mutate`, and an `allow` script calls none of them.

Blocking messages must tell the agent exactly how to retry successfully. Do not
print secrets, full environment dumps, or unrelated transcript contents.

A `warn` hook on `UserPromptSubmit` can add context instead of a stderr line.
It prints `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…"}}`
on stdout and exits `0`. Claude Code ignores a top-level `additionalContext`.
A `PreToolUse` hint works the same way with `"hookEventName":"PreToolUse"`
and no `permissionDecision`, so the call still runs; `poll-loop-hint` does
this. Claude Code does not show the agent stderr from a hook that exits `0`.

## Decision log

Each verdict helper calls `log_decision` in `hooks/lib/log-decision.sh`. It
appends one JSON line to `~/.cache/agentbrew/hook-decisions.jsonl`.

- `HOOK_DECISIONS_LOG` overrides the log path.
  `scripts/run-hook-fixtures.sh` and `scripts/verify-changed.sh` point it
  at a temp file, so fixture runs never touch the real log.
- A row gets `sessionId` from `HOOK_SESSION_ID`, or from `.session_id` in
  the hook's `INPUT` variable. Name the stdin variable `INPUT` in new hooks.
- `agentbrew metrics` counts only rows with a `sessionId`. Rows from older
  hooks or fixture runs without one are skipped.
- A hook test that runs a check script directly should export
  `HOOK_DECISIONS_LOG` to a temp file too.

## Goal setting

Claude Code's built-in `/goal <condition>` fires `UserPromptSubmit`, and the
`prompt` field holds the raw `/goal …` text. The hook
`goal-set-loads-run-goal` matches it and adds context that tells the agent to
load the `run-goal` skill. It stays silent for `/goal`, `/goal clear` and the
other clear aliases, and on machines where `run-goal` is not installed. So
installing the skill (`agentbrew install run-goal`) is the only opt-in step.
New to goals? The skill opens with a "Quick start" (see
`skill-plugins/workflow/run-goal/SKILL.md`).
In real `claude -p` sessions, `/goal <condition>` made the agent call the
`run-goal` skill as its first tool in 3 of 3 runs. With
`HOOK_BYPASS_GOAL_SET_LOADS_RUN_GOAL=1`, and for `/goal clear`, it did not.

Skill text alone did not stop a one-line bugfix goal from editing before its
goal contract. So `goal-set-loads-run-goal` also writes a per-session marker
(`~/.cache/agentbrew/run-goal/<session_id>.pending`) and names a contract
file (`<session_id>.contract.md` in the same folder) in its context. The
agent saves its contract there with Write. `goal-contract-before-edit`
(PreToolUse on Write, Edit, MultiEdit, NotebookEdit) approves that one write
when it has "Done when", "Metric", and "Pivot", and blocks other file edits
until it exists. A valid contract file, `/goal clear`, or a marker older
than one day ends the block.

`goal-retro-before-stop` (Stop) closes the goal. While the session's
contract file exists, it blocks Stop until `<session_id>.retro.md` has one
line per skill used (each `Skill` call, plus each `skills/<name>/SKILL.md`
read, plus `run-goal`) with a commit SHA, a PR, or `task`. A line that says
no update was made ("no new edit", "already covers", and similar) does not
count, even when it cites an old commit. A rule that also required a merged
`run-goal` PR was removed: goal sessions in other folders cannot write the
agentbrew repo through the sandbox, so the gate blocked three times and gave
up. Such runs file a task and cite its id instead. It gives up after
three blocks, so a goal can always end. On success it deletes the contract.

An earlier version read the transcript instead. Claude Code writes the
transcript in batches, so a contract printed 6 to 8 seconds earlier was
often not on disk yet, and real contracts were blocked. A hook cannot wait
that long (the hook timeout is 5 s).

## Cross-workspace publishing

The opt-in hook `no-cross-workspace-publish` blocks three commands before the
shell runs them: `gh pr create` to another repo, `gh repo fork`, and
`git push` to a remote that is not the pushed repo's `origin`. It also blocks
`gh pr create` and `git push` from a directory outside the workspace root
(`$CLAUDE_PROJECT_DIR`, else the payload `cwd`).

To publish after the user approves the target in the current session, set
`AGENT_PUBLIC_WRITE_APPROVAL` to a value that includes `repo=<owner/repo>`.
Set it in the agent's environment or as a prefix on the command. The dotfiles
`gh` wrapper reads the same variable and stays as the shell backstop. Repos
listed in `~/.config/agent-gh-allowlist.txt` pass `gh pr create` and
`git push` without approval. They do not pass `gh repo fork`.

## Timing and safety

- Deterministic hooks should complete in under 2 seconds.
- Hooks must not call a model. A blocking hook that waits on an LLM stalls the tool loop.
- Scripts must not mutate the repository unless their manifest verdict is
  `mutate` and the target event supports mutation.
- Every deterministic hook must have at least one adjacent `.test.sh` fixture
  and be covered by `scripts/run-hook-fixtures.sh`. That script (part of
  `npm run verify`) fails and names the missing file when a
  `hooks/checks/<id>.sh` has no `<id>.test.sh`.
- Every bypass must be discoverable from the script header and the manifest's
  `bypassEnvVar`.
- PRs that change high-impact agent artifacts must include same-PR deterministic
  tests, behavioral evals, or `Agent artifact test exemption: <reason>` in the
  PR body. `gh-pr-agent-artifacts-require-tests` enforces this for `gh pr
  create` / `gh pr edit`.

## Adding a hook

1. Add or update the script under `hooks/checks/`.
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
