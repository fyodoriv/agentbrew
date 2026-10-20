# Global Agent Context

Agentbrew manages skills, MCP servers, rules, commands, hooks, and agent definitions for this machine. Generated agent files under `~/.claude/`, `~/.cursor/`, `~/.codex/`, and similar agent dirs are outputs; edit the source repo or `~/.config/agentbrew/` source, then run `agentbrew sync`.

## Installed skills

Skills are symlinks to source repos. Edit the source, not the installed mirror. Use `agentbrew status --verbose` to inspect sources.

## Source routing

Keep always-loaded instructions small. Put global rules in
`~/.config/agentbrew/shared-rules.md`, recurring workflows in skills, team
content in overlays, repo rules in `AGENTS.md`, and file patterns in per-file
rules.

Before creating a new skill, search existing skill sources and extend the closest fit when possible.

## Project entry

For non-trivial repo work, run `bash ~/.config/agentbrew/scripts/load-project-context.sh` from the repo root. Read its files and follow links/imports to depth 2. If no `Agentfile.yaml` exists, use `agentfile-init`. Preview with `agentbrew sync --dry-run`; deploy with `agentbrew sync`.

### Task command center workflow (IRON LAW)

When work starts from **TASKS.md**, a **Jira epic/ticket**, a **Slack thread**, or a **multi-repo initiative**, read **`task-command-center`** before coding. It owns intake, docs worktrees, plans, dry runs, shipping, and Google Docs reconciliation.

## Task backend

Pending work lives in the repo-declared backend. Detect it from `Agentfile.yaml` first, then `.agents/tasks.config.yaml`, then default to `TASKS.md`.

- Use the declared issue/task CLI for `task_backend: github-issues`; do not recreate `TASKS.md`.
- For `TASKS.md`, keep the tasks.md shape and validate it with the repo's task linter. Remove completed blocks.
- If `.minsky/repo.yaml` exists, keep its required P0/P1 evidence fields.

## Critical rules

Shared-rules holds git/PR/browser/security detail — load it via session entry. This section is the bootstrap subset agents need before skills load.

### User-facing language

**Attention-friendly default:** Write agent-authored natural-language text so a
reader with little time or attention can scan it. This is the default style.
Follow a user's explicit request for another style.

Use ASD-STE100-style plain English.

Apply it to all agent-authored prose, including user-facing output and code
comments. Put the answer first. Use short paragraphs, short, direct sentences,
and active voice. Keep one idea per sentence or bullet. Use headings, bullets,
or numbered steps when they improve scanning. Surface blockers and the next
action. Preserve required formats and verbatim code, commands, logs, JSON, or
user text. Add a code comment only when it clarifies the code; do not add one
only for this rule.

### Ambition with models

Aim past the literal task on three axes. **Altitude**: ask for the goal
beyond the goal. **Depth**: use an expert's raw data, tools, and methods.
**Range**: borrow methods from other fields. Prove results with an outside
judge, not self-review. Details: shared-rules **## Ambition with models**.

### Reuse before implementation

GET → WRAP → CONTRIBUTE → ABSORB. Keep new code behind adapters when upstream may replace it.

### Local autonomy + git salvage

For current-repo work, make reasonable local edits without routine confirmation. Salvage-first git hygiene: inventory, classify, preserve useful work, and remove only known current-session trash. Ask for explicit confirmation before destructive operations or irreversible cuts (`reset --hard`, `clean -fd`, force-push, protected-branch push, cross-workspace publish, or public comments/reviews).

### Cross-workspace publishing

No push/PR/issue/release/comment outside the current repo unless the user requested that target or **Standing approvals** below cover it. Standing approvals never replace approval for a destructive operation outside the current repo.

### Pipeline-managed repos

When `.worktrees/` or orchestration session state is active, do not commit source code unless you are the orchestrator or the commit carries the expected `pipeline-token` trailer. Docs/task queues may still be edited.

### Public impersonation ban

Never publish under the user's identity without explicit approval for the exact action in the current session. Standing `/ship-it` pre-approves tooling/oncall-family PR push/create — see shared-rules **## Git and delivery**. PR bodies must open with `## Summary` and two or three plain-language sentences giving the why-needed rationale: why the change is needed and what it delivers, followed by a `## Details` bullet list and a `## Docs` section. Add the PR validation block and attribution footer when posting is approved.

### Browser work

Use browser automation — never ask the user to click. SSO: use attach-first with purpose Chrome (`9223`/`9224`/`9225`), poll up to 120s, then background per `sso-background-work`. Details: shared-rules **## Browser and web UI work**.

### Verification + security

No completion claims without fresh evidence. Agent-artifact changes need same-PR tests/evals or `Agent artifact test exemption: <reason>`. Defensive security only; never expose or commit secrets.

### Cloud sessions

A cloud session cannot reach the user's machine, local data or signed-in apps. When the rest of a goal needs them, do not wait or keep asking. Push the work branch, write each unfinished item as a task in the repo's task backend on the default branch (with the steps to run locally), and stop with one short message naming the task ids.

### Open work first

Before you start a task (`next-task` included), list the repo's open work: your open PRs, unmerged branches, uncommitted files (`wrap-up` skill, `scripts/open-work.sh`). Continue an open draft PR from its `## Pending` list before claiming new work. To end a session, run `wrap-up`: deliver what is ready, and put the rest in a leak-checked draft PR plus a task.

### Docs with every change

Every change updates its docs in the same PR. User-facing behavior goes in the README or how-to; agent workflow and any gotcha that cost time go in the repo's `AGENTS.md`. Every PR body has `## Docs` (docs changed, or `Docs: none — <reason>`); hook `gh-pr-body-requires-docs` enforces it. Repo guides follow agentbrew `docs/agent-guide-baseline.md`.

## When you need detail

This file is a compact bootstrap. Load the matching skill or repo-local guide
for chat/token limits (`cursor-token-playbook`, `context-budget`), agentbrew
sync (`agentbrew-status`, `sync-agent-config`), delivery/testing/debugging,
browser work (`agent-browser`, `sso-browser-isolation`,
`sso-background-work`, `page-zero-errors`), skill authoring, and UI work.
