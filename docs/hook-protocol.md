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

The `no-destructive-commands` check reads the first direct Bash command
on the first line. It refuses `git stash drop`, `git stash clear`,
`gh repo delete`, and `gh pr merge` with the administrator option enabled.
Git shares stashes across linked worktrees. The check uses Python 3 to
read literal command words and arguments without executing them. Ordinary
merges and read-only GitHub operations stay available. Shell wrappers, expansions, and later commands are
outside this check. The GitHub CLI check also leaves shell redirections alone.

Use `npm pack --dry-run` to inspect the package. The hook refuses a
direct leading `npm publish`, including when it has a dry-run option.
The owner publishes through the [documented release process](ci.md).
The npm check applies when `publish` immediately follows the executable.

The same opt-in check covers direct recursive forced deletion. It
checks each destination at observation time and allows verified
descendants of system temporary folders or the owned session scratch
folder. Roots, relative paths, links and other unverified operands refuse.
This checks the named operand path. The recursive traversal itself
still depends on the filesystem at execution time. The plain
temporary-variable form assumes the hook and Bash tool share the
same verified `TMPDIR`. An absolute path does not depend on that variable.

Add `no-destructive-commands` to `enabled:` in the hooks overlay and run
`agentbrew sync` to turn on the check.

`pr-merge-preflight` is an opt-in Claude Code check for a direct Bash
merge on github.com. Put the PR number first and use
`--repo github.com/OWNER/REPO`, or put its full HTTPS PR URL first.
Supply the full head commit with
`--match-head-commit`. The check reads GitHub once and stops the merge
when the head changed, the PR is unready, or the checks are incomplete.
Add `pr-merge-preflight` to `enabled:` in the hooks overlay to include
it at the next sync. GitHub still enforces the repository's branch rules.

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

Use Bash parameter expansion for startup paths and `read_hook_stdin` for
the JSON payload. This saves external launches on hosts with slow process
startup. Run Python helpers through `hook_python` in `stdin-json.sh`.
It uses an explicit `HOOK_PYTHON` override first, then an installed macOS
developer toolchain, then Python on `PATH`. It passes `-I` in each case.
The task edit check uses system Python for executable filtering before it
accepts tools from `PATH`.
The managed command hook default is 15 seconds. Codex SessionEnd and
Interrupt keep their three-second limit.

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

## Home-folder searches

`no-home-crawl` (PreToolUse on Bash, Grep, and Glob; opt-in) blocks a
recursive search whose root is too broad. It checks `rg`, `grep -r`/`-R`,
`ag`, `ug`/`ugrep`, `fd`, `find`, the Grep tool, and the Glob tool with a
`**` pattern. It blocks these roots: `$HOME`, `~/Library`,
`~/Library/Application Support`, and `/`.

- Root: the path argument (or `--search-path`/`--base-directory`), else the
  session `cwd`. An earlier `cd <dir> &&` or `pushd <dir> &&` moves it.
- It sees through wrappers (`sudo -u`, `timeout`, `nice -n`, `stdbuf`,
  `caffeinate`, `env`) and checks `bash -c`/`zsh -lc` and `eval` strings.
- Why: a home-wide search runs for many minutes, and macOS Spotlight and
  the file-provider importers re-read every file it touches.
- Allowed: a narrower path (`~/.claude/projects/<project>`, `~/apps/<repo>`),
  a depth limit of 2 or less (`--max-depth 2`, `-d 2`, `-maxdepth 2`),
  `rg`/`grep` with no path after a pipe (they read stdin), a quoted `'~'`,
  and a Glob pattern without `**`.
- Not caught: roots built at run time, such as `"$(pwd)"` or `"$DIR"`. Only
  `$HOME`, `~`, `~user`, and `$USER` expand.
- Opt-out: prefix the command with `AGENTBREW_ALLOW_HOME_SEARCH=1`, or set
  it (or `HOOK_BYPASS_NO_HOME_CRAWL=1`) in the agent environment.
- It parses the command with `python3` only when a search tool name appears,
  and allows the call when `python3` is missing.
- Turn it on with `- no-home-crawl` under `enabled:` in
  `~/.config/agentbrew/hooks-overlay/manifest.yaml`.

## Next task: open work first

`next-task` ships from tasksmd/tasks.md, so agentbrew adds its pre-task step
from outside. When a prompt starts with `/next-task` (or "next task"),
`next-task-open-work-first` (UserPromptSubmit) runs the `wrap-up` skill's
`scripts/open-work.sh` on the session's `cwd`. When that lists open work
(your PRs, unmerged branches, uncommitted files), the hook adds the list to
the context with the order to continue it first, from a draft PR's
`## Pending` list. It skips `git fetch` to stay fast (`OPEN_WORK_NO_FETCH=0`
turns it back on). It stays silent for other prompts, for a repo with no open
work, and on machines without `wrap-up`. Installing `wrap-up` is the opt-in.

## Goal setting

Claude Code's built-in `/goal <condition>` fires `UserPromptSubmit`, and the
`prompt` field holds the raw `/goal …` text. The hook
`goal-set-loads-run-goal` matches it and adds context that tells the agent to
load the `run-goal` skill. It stays silent for `/goal`, `/goal clear` and the
other clear aliases, and on machines where `run-goal` is not installed. So
installing the skill (`agentbrew install run-goal`) is the only opt-in step.
New to goals? The skill opens with a "Quick start" (see
`skill-plugins/workflow/run-goal/SKILL.md`).
The context also says that a read-only skill source gets a task in a
writable repo for its retro update, not an edit.
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

`goal-judges-before-stop` (Stop) is success-gated. While a goal contract
exists, Stop passes only with a judge consensus or a retro whose every
`Goal result` line (after list, heading, quote, or bold marks) says partly
met, not met, in progress, blocked, impossible, or pending. No retro, no
result line, or any other form is a claim. After that word, only a
bracketed reason, a count (`3/5 met`, `3 of 5 criteria met`), or one
`on|by|until|for <what>` tail may follow, and a success word in that tail
is a claim: `partly met, ready to merge` and `blocked on 2FA and done` are
claims. An overseer ruling that raises a score needs a reason of 20 or
more characters. The hook blocks Stop until each judge on the
contract's `Judges:` line has exactly one `GOAL-JUDGE-VERDICT` block (Judge,
Score N/10, Cache, State) whose `State:` equals the token
`hooks/lib/goal-state.sh <contract>` prints now. The token hashes the
contract, each judge's rubric (its file up to `## Calibration`), and the
`Judged paths:` (each tracked and untracked file's path and content, with
LF line endings and trailing spaces and end-of-file blank lines cut), so any
other edit by any tool, a space inside a line included, makes the verdicts
stale, while a trailing-space edit or a commit keeps the state (judging it
again is a re-roll). Each judge call's prompt must equal the
output of `hooks/lib/goal-judge-prompt.sh <contract> <id>` (no added text)
and must leave `subagent_type` out or set it to `general-purpose` (no
fork, no custom agent type); the prompt embeds the rubric, so judges never read the
runner-written calibration notes. A missing contract during an active goal
(read from the transcript's last `/goal` command) blocks. The hook rewrites
`<session>.owner.md` from that command, so the prompt carries the owner's
own words. A judge that got a SendMessage does not count. Any unofficial
judge run (an Agent call without the header, or `claude -p`, `codex exec`,
`ollama run`, `llm`, or an Ollama HTTP call in command position in Bash,
whose result holds a filled-in verdict block) uses up one round of the cap. A
review that only quotes the template returns no verdict, so it is free.
The block message lists `Next step:`, the numbered problems, the honest
exit, and each judge's pass rate from `<state dir>/goal-judge-history.tsv`
(one line per counted verdict). Each judge prompt carries a review role
(refuter, spec auditor, or first-time user) picked from the state token and
the judge's place on the `Judges:` line. The history keeps every official
verdict of the goal, failing rounds included. `goal-state.sh` refuses a
contract that steers the judges or quotes earlier scores, and a rubric changed
after scored rounds whose `Rubric <sha>:` line cites none of their states. A
block counter that cannot be written falls back to `$TMPDIR`, then gives up
at once (partly met); a wait counter that cannot be written never excuses a
met claim. A give-up that cannot rewrite a met retro blocks instead of
allowing. The judge
set, rubric hashes, and the contract hash freeze at the goal's first round
(read from earlier judge prompts after the last `/goal` command), only
the latest round can pass, and a goal gets `RUN_GOAL_JUDGE_ROUNDS` (3) rounds; the owner raises the cap for one goal by typing a message that starts with "approve round N" or "approve N more rounds" (tool results, hook feedback and the runner's own text never count). Only `Agent`
or `Task` results and their background notifications (user, `attachment`,
or `queue-operation` rows) count. A result with two verdict blocks counts
for none; two launches of one judge on one state are a re-roll, even when
the first run was stopped before its verdict. The prompt drops contract lines
about judge scores and the contract's `## After judging` section, so a target
cannot anchor a judge and no judge scores a step that can only follow its
verdict. After the judges, one overseer Agent call per state must run, on a
family other than the runner's, with the exact output of
`goal-overseer-prompt.sh` (it quotes each judge's report from the
transcript). Its `Ruling <judge>: N/10` lines set each effective score,
clamped to 2 points from the judge's own; each ruling needs a one-line
reason, and the verdict's `State:` must be the current token. A second
overseer on one state is a re-roll. Judges and the overseer work to a
budget stated in their prompts: about 10 minutes and about 20 tool calls. The state token also covers file modes and ignored files (an
ignored folder by name only). Each score
is 0-10 and at least `RUN_GOAL_JUDGE_MIN` (8); the cache must be
`<judge dir>/<id>.md`; the judges use at least `RUN_GOAL_JUDGE_MODELS` (3)
model families, and none runs the runner's own model family (a call with no `model` or `model: inherit` counts as the
runner's); each
judge's `## Calibration` has a line with the session id, the token, and the
score. Judge files must meet a rubric floor (`Field:`, `Applies:`,
`Scale:`, three "capped at" lines, every cap below the passing bar, no line
that steers the judge, and a `Rubric <sha>: <defect>` calibration line for
the current rubric once the file has notes; after a scored round that line
must cite the state token of an earlier score line). Each Stop parses the
transcript once with jq (the `/goal` row comes from grep-selected lines). While a judge with its exact official prompt
runs in the background it allows up to 10 times and rewrites a met result
line to `in progress (waiting on N judge(s) ...)`; if it cannot rewrite it,
it blocks. A failed counter write never turns a block into an allow. After five blocks it rewrites the result to
`partly met (judge consensus not reached: ...)`, resets its counters, and
allows. `goal-contract-before-edit` pre-approves Write and Edit of judge
files and of `<session>.answer.md` while a contract exists.
Procedure: `skill-plugins/workflow/run-goal/references/goal-judges.md`.

`goal-retro-before-stop` (Stop) closes the goal. While the session's
contract file exists, it blocks Stop until `<session_id>.retro.md` has one
line per skill used (each `Skill` call, plus each `skills/<name>/SKILL.md`
read, plus `run-goal`) with a commit SHA, a PR, an issue, or `task`.
PRs and issues can use `#123` or their numeric `/pull/123` and `/issues/123`
URLs. This checks evidence syntax, not remote existence. A skill the host
app serves (for example `artifact-design` from the Claude app) has no
source on the machine, so no update is possible. Its line
`<skill>: host-served, no source` passes only when no `<skill>/SKILL.md`
exists in any skills folder (`~/.*/skills`, `~/.config/*/skills`, the
Claude app's skills folder, agentbrew's installed skills, plugin skills
under `~/.claude/plugins`, and the session folder's `.claude/skills` and
`.agents/skills`; `RUN_GOAL_SKILL_DIRS` replaces this list). An owned
slash command is a source too: `<skill>.md` in `~/.*/commands`,
`~/.config/*/commands`, the session folder's `.claude/commands`, or a
plugin's `commands/` under `~/.claude/plugins` (for example `ship-it`).
Command folders are searched at any depth, so `commands/team/deploy.md`
counts for `team:deploy`. Symlinked plugin folders are followed. So
is any `SKILL.md` the session read that exists, wherever it is. Before this,
such a goal blocked three Stops and then gave up. A line that says
no update was made ("no new edit", "already covers", and similar) does not
count, even when it cites an old commit. A rule that also required a merged
`run-goal` PR was removed: goal sessions in other folders cannot write the
agentbrew repo through the sandbox, so the gate blocked three times and gave
up. Such runs file a task and cite its id instead. It gives up after
three blocks, so a goal can always end. It never deletes the contract: a
retro often passes mid-goal (an earlier version deleted it on the first
passing Stop, so a goal lost its contract four times in one run and a skill
used later was no longer checked). The next `/goal` replaces the contract,
and files older than seven days are removed.
It also allows, without counting a block, while the goal waits on
background work: a launch in the transcript ("Async agent launched" or
"running in background with ID") with no `<tool-use-id>` completion
notification yet. The retro belongs at the end of the goal, not at each
turn that only waits on workers.

An earlier version read the transcript instead. Claude Code writes the
transcript in batches, so a contract printed 6 to 8 seconds earlier was
often not on disk yet, and real contracts were blocked. A hook cannot wait
that long (the hook timeout is 5 s).

## Guard Git calls from scripts

Add `git-script-guard` to the machine overlay's `enabled:` list for
Claude Code Bash sessions. Preview with `agentbrew sync --dry-run`, run
`agentbrew sync`, then start a new session. The session adds the managed
Git wrapper to PATH. On a machine with Dotfiles, use a version that
keeps the [session guard first](https://github.com/fyodoriv/dotfiles/blob/feat/chezmoi/docs/agent-hooks.md).
The session also exports the exact managed guard path so the Dotfiles
Git wrapper can check the arguments when the Claude command hook rewrites
PATH. Dotfiles runs the allowed Git command.

The wrapper checks recognized destructive Git arguments, including calls
from a script. A branch creation or whole-tree operation needs a verified
linked checkout. The same check applies to a direct `git checkout` or
`git switch` with an existing local branch name that contains a slash.
This shorthand uses Git 2.43 or later to check whether the local
reference exists. It refuses a lookup error before forwarding the command.
When the local branch is absent, the wrapper requires a linked checkout
before Git can guess a branch from a remote-tracking reference. The file
shorthand stays available for a path that exists in the effective checkout.
Use `git checkout -- path` to select a file explicitly. Stashes are shared
across linked checkouts. Ordinary commands keep their arguments and use
the existing Git command on PATH.
The wrapper refuses a command-line replacement of the commit hook path.
The commit hooks and remote protections also apply.

## Check task files after an edit

To check a project's root `TASKS.md` after Claude Code writes or edits it,
include `tasks-md-lint-on-edit` in the machine overlay's `enabled:` list.
Use system Python and install `tasks-lint` in a tool directory outside the
session and edited projects.
Preview with `agentbrew sync --dry-run`, then run `agentbrew sync`.

A valid file stays quiet. A validation error asks the agent to run
`tasks-lint --require-prereg TASKS.md` and fix the reported fields.
A missing tool or timeout appears in hook diagnostics. The check keeps task
text out of its output and logs. Use the project's commit check to enforce
the task rules at delivery.


## Check for a live watch before stop

`always-on-watch-stop` is an opt-in Claude Code Stop hook. It reminds a
configured watcher session once when the session would end with no live
watch. Enable it through the hook overlay's `enabled:` list. The hook
reads stamps written by the watcher session. It takes no action on the
watcher.

Set `ALWAYS_ON_DIR` to an absolute user-owned directory. Set
`ALWAYS_ON_PROJECTS` to a comma-separated list of project IDs. Keep the
directory and stamps free of group and other-user write permission.
For each enrolled session, use its native session ID as the filename
prefix and these suffixes.

| File | What the writer records |
| --- | --- |
| `<session_id>.project` | One project ID from the configured list |
| `<session_id>.watch` | `pid=<number>` for an active watcher process, or `cron=<id>` after confirming the schedule exists |
| `<session_id>.wrapup` | A regular file when the owner wants to stop |

Write each stamp to a temporary file and rename it into place. Write a
new watch stamp after confirming the watch. A cron stamp remains
valid for `ALWAYS_ON_CRON_MAX_AGE` seconds, which defaults to 300. A PID
stamp checks for a process at that PID. Refresh it if the watcher restarts.

A wrap-up stamp, an explicit stop in the latest user text,
`ALWAYS_ON_STOP_GUARD=off`, or the native second Stop event allows the turn
to end. The hook allows the stop when the transcript or stamp identity
cannot be verified. It publishes no transcript or stamp contents.

See [registered watch-stop cases](plans/always-on-watch-stop.md).

## Retry failed calls before stop

`retry-failed-before-stop` (Stop, opt-in) checks the current user turn
for unresolved tool failures. A later success or explicit user denial
resolves an attempt when both calls have the same valid tool name and
structured input. Each failure needs a unique call and result ID. A
service or file permission error stays unresolved. Without a
known user turn, the hook allows the stop. It shows validated tool names
and prompts the agent to
verify uncertain outcomes before repeating an authorized, safe action.
The reminder runs once. `stop_hook_active` allows the next stop.
Use `HOOK_BYPASS_RETRY_FAILED_BEFORE_STOP=1` to bypass this reminder.
Enable it in the hooks overlay `enabled:` list.

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
- The runner runs each fixture the way a stock Mac runs hooks: `/bin/bash`
  (3.2 on macOS), `PATH` of only `/usr/bin:/bin` plus a shim dir with that
  bash, the real `node`, and `/usr/bin/jq` (Apple's jq 1.7) when present, an
  empty `HOME`, and no other environment. So GNU tools, a newer jq, or the
  owner's dotfiles cannot hide a bash 3.2 or BSD bug. `HOOK_FIXTURES_HOST_ENV=1`
  runs with your own shell instead; `HOOK_FIXTURE_BASH` picks another bash.
- Bash 3.2 traps that fixtures hit: a `case` pattern inside `"$(...)"` needs
  the leading `(` (`case "$x" in (*a*) ...`); a `{"a","b"}` JSON literal inside
  `"$(...)"` brace-expands, so build JSON with `jq -n --arg`; jq 1.7 cannot
  parse `capture(...)?.n`, write `(capture(...).n)?`. A test that sets `HOME`
  must first link the real `node` (`node -p process.execPath`) onto `PATH`,
  because Volta and asdf shims look for node under `HOME`.
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

## PR readiness lookup

The Claude `a-pr-is-not-ready` transcript hook resolves a simple numbered
`gh pr view`, `ready`, `merge`, or `edit` command with Python's standard
shell-word parser. Quoted body text is an opaque argument; repository flags
must be real argument words. Supported flags are bounded to the known CLI
forms. Unknown flags, shell expansions, compound commands, missing Python,
or an unresolved target produce a warning without a guessed status query.
Comment-looking words and expansion-looking text are also conservative
warning cases, including ambiguous quoted forms.
A standalone literal echo, fixed-format print, commit message, or quoted
text heredoc leaves the prior target in place. The whole command must match.
An executable suffix, uncertain syntax, or expandable heredoc still follows
the conservative path.
The selected target exists only for that hook invocation. Merged or closed
PRs pass the readiness check. This is a best-effort status guard, not proof
that a goal's delivery criteria are met.

## Codex hooks

Codex reads the wrapped `hooks` object in `~/.codex/hooks.json`. Sync preserves
user hook entries and top-level metadata. Managed hook ownership is recorded
per agent in agentbrew's manifest; removing a managed hook does not remove a
user hook that shares its event and matcher. An exact desired hook already
present on first sync is adopted once; unrelated commands stay in place.

The audited command-policy hooks with matcher `Bash` also target Codex. Codex
normalizes shell calls to `tool_name: "Bash"` and `tool_input.command`, which
these scripts already consume. `poll-loop-hint` remains Claude-only because
it reads Claude's `run_in_background` argument. File-edit hooks remain
Claude-only: Codex sends patches in `tool_input.command`, not `file_path` and
`content`. Goal and transcript hooks also remain Claude-only; copying their
config would not enforce their checks in Codex.

For user-declared hooks, Codex sync accepts command handlers on supported
Codex events. It skips prompt handlers, unsupported events such as
`Notification` and `PostToolUseFailure`, and handlers that depend on `if`,
`once`, or `asyncRewake`. `SessionEnd` and `Interrupt` timeout values are
limited to the Codex maximum. A hook that targets only Claude stays there.
Codex skills do not gain Claude skill-frontmatter `allowed-tools`, `hooks`,
or `context: fork` behavior from this runtime hook support.

New or changed Codex hook definitions require review and trust through
`/hooks` before Codex runs them. Sync reports that requirement and does not
change the trust store. See [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks).

Codex stores individual hook enable/disable preferences separately from the
generated hook definitions. Sync must preserve these preferences and existing
trust choices. Disable an incompatible legacy hook through Codex's native
hook settings; do not trust it only to remove a review warning.

## OpenCode hooks

OpenCode has no hooks file. When `~/.config/opencode` exists, `agentbrew sync`
asks the `opencode` command on PATH for its version. It installs the matching
V1 or V2 bridge at `~/.config/opencode/plugin/claude-hooks.js`. Sync keeps
existing bytes when the version is unavailable or unsupported. It also keeps
unowned files and user edits. The plugin runs the Claude Code hooks from
`settings.json` with the same stdin JSON and verdict rules. The event map and
limits are in
[support-matrix.md](support-matrix.md#opencode-boundaries). A hook can check
`CLAUDE_HOOKS_HOST=opencode` when it needs to act differently there. Tests:
`src/opencode-hooks/claude-hooks.test.ts`.


Keep the V1 template usable on its own. Sync appends the V2 adapter to it.
Test the installed CLI in a scratch home. A V2 server can return 503
before authenticated health, then admit sessions before the plugin appears
in its inventory. Wait for the plugin ID before testing SessionStart.

`opencode.json` rejects unknown keys. The bootstrap fixture at
`src/mcp/fixtures/opencode-config-schema.trimmed.json` pins its shape.
Refresh it from the [OpenCode schema](https://opencode.ai/config.json).
