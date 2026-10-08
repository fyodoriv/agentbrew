---
name: task-command-center
description: >
  End-to-end workflow for TASKS.md items, Jira epics/tickets, Slack threads, or multi-repo
  initiatives: intake → command-center docs worktree → implementation plan → dry-run spike
  worktree → execute. Also reconciles ongoing Google Doc comments and updates into a docs PR
  plus a Jira epic and children while separating immutable product contracts from dynamic
  engineering guidance. Use when starting or refreshing non-trivial work that spans docs,
  tickets, and code. Don't use for a single-ticket ship with no shared docs hub, pure planning
  without a docs hub (use writing-plans), throwaway design spikes without a command center (use
  prototype), or session entry alone (load-project-context).
---

# task-command-center

Orchestrates **command center + dry-run + execute** for initiative-scale product work: perpetual **docs hub worktree** (DO NOT MERGE draft PR), **dry-run worktree** for spikes, **main checkout** for shipped code.

## When to invoke

**Yes:** TASKS.md claim; Jira epic/tickets; Slack/Drive-driven multi-repo initiative; "command center" / "plan then dry run"; intake + docs + implementation.

**No:** read-only Q&A; single-ticket ship with no shared docs hub; planning only (`plan`); throwaway spike (`prototype`); session entry only (`load-project-context`).

## Related skills

| Phase | Skill |
|-------|-------|
| 0 | `load-project-context` |
| 1 | `markdown-for-gdoc`; Jira and Drive MCP tools |
| 3 | `writing-plans` |
| 4 | `prototype` |
| 5 | Repo delivery and verification skills |
| Browser | `sso-background-work`, `browser-tasks` |

---

## Phase 0 — Session entry and routing

1. **`load-project-context`** in every repo touched.
2. Identify code repo(s), docs anchor, siblings from imports/Slack/Jira.
3. Org-only MCPs → org overlay Agentfile; tickets → add the org ticket key only when the repo requires one; OSS TASKS use generic `PROJ-NNN`.
4. Task backend: `.tasksmd.json` → GitHub Issues; else `TASKS.md`. Command-center **`TASKS.md` at worktree root is gitignored** — local queue only.

## Phase 1 — Intake

| Source | Action |
|--------|--------|
| Slack | Attach-first browser (`9223`); digest → `{docs-root}/slack/CHANNEL-DIGEST.md` — no poll loops |
| Jira | Epic/tickets via MCP/browser → `{docs-root}/requirements/{TICKET}.md` |
| Drive | Browser → `{docs-root}/architecture/gdoc-*.md` |
| Repos | `git pull --rebase`; clone missing to `~/apps/` |

Update **`LINKS.md`** + **`SYNC-STATUS.md`**.

### Jira task quality gate

Before creating or substantially rewriting a Jira bug/task, write the shortest
delivery-ready description. Include only information a delivery agent cannot
get from Jira fields or linked work. Preserve evidence and separate it from
the proposed fix:

1. **Outcome and impact** — one sentence describing the broken behavior,
   affected user/system path, and why it matters.
2. **Evidence** — environment, reproduction or observation, expected versus
   actual behavior, and links or identifiers for logs, tests, browser state,
   or source when available.
3. **Root cause** — the confirmed causal chain and boundary at fault; label
   unverified hypotheses explicitly instead of presenting them as facts.
4. **Scope** — affected components and integration boundaries, including
   mirror/consumer repos when the delivery requires them. Do not substitute a
   file inventory for scope.
5. **Acceptance criteria** — independently verifiable outcomes covering the
   regression, behavior preservation, and any required failure/cleanup path.
6. **Validation and rollout** — only the test layers and rollout checks needed
   to prove the requested result. End-to-end coverage is not a default.
7. **Dependencies and links** — only real delivery blockers and deliberately
   excluded work.

Use headings such as `## Evidence`, `## Root cause`, `## Scope`,
`## Acceptance criteria`, and `## Validation`. A task is not ready to create
from an investigation until another engineer can reproduce the problem,
understand why the proposed change targets the right boundary, and verify it
without rediscovering the diagnosis.

### Jira scope and delivery discipline

- Jira already renders the parent, epic, initiative, type, status, assignee,
  estimate, priority, sprint, and linked development metadata. Do not repeat
  those fields in the description.
- Do not put PR state, branch state, or a delivery-status snapshot in a task
  description.
- A user-requested single task or single PR is a hard scope limit. Consolidate
  related work into one canonical ticket. Link and close redundant tickets as
  duplicates. Do not invent prerequisite tickets, a PR chain, or companion
  work unless the user asks or a proven repository constraint requires it.
- Treat explicit non-goals as excluded. Do not promote adjacent cleanup,
  dependency decoupling, research, onboarding, context aliases, event work,
  RFC work, or end-to-end tests into scope, risks, acceptance criteria, or
  validation unless they are requested or required for the stated outcome.
- Deliver required behavior before optional structural cleanup. Use the
  smallest test layers that prove the requested behavior.
- A working integration is a baseline, not a new deliverable. Do not recast it
  as missing work without source evidence and a user request.

### Recurring GDoc ↔ PR ↔ Jira reconciliation

Whenever an initiative update touches a Google Doc and either a docs PR or
Jira, follow [`references/reconciliation-protocol.md`](references/reconciliation-protocol.md)
before any write. The protocol is required on every refresh, not only initial
intake.

Its durable boundary is:

- **Product contract (immutable):** exact user outcome, behavior, acceptance
  criteria, and boundaries backed by stable source citations. Change it only
  when a cited product source explicitly revises it; preserve the revision
  trail.
- **Engineering guidance (dynamic):** current architecture, ownership, files,
  sequencing, dependencies, open decisions, and validation. Refresh this as
  implementation reality changes.

Every Jira child description uses those two labeled sections separated by
`---`. Transient status, lane, assignee, scheduling, and deferral updates use
Jira fields or dated comments; they do not rewrite the product contract.

## Phase 2 — Command center worktree

| Item | Convention |
|------|------------|
| Path | `~/apps/{repo}-command-center` |
| Branch | `docs/{project}-command-center` |
| Docs | `docs/{project}-command-center/` |
| Shipped code | `~/apps/{repo}` feature branches only |

```bash
cd ~/apps/{repo} && git fetch origin
git worktree add ../{repo}-command-center -b docs/{project}-command-center origin/master
```

Gitignore worktree-root **`TASKS.md`**. Layout: `README.md`, `AGENTS.md`, `SYNC-STATUS.md`, `LINKS.md`, `plans/implementation-plan.md`, `plans/dry-run-log.md`, `requirements/`, `architecture/`, `slack/CHANNEL-DIGEST.md`.

**Draft PR (DO NOT MERGE):** `gh pr create --draft --title "docs: {project} command center [DO NOT MERGE]"` — hub only; link in `SYNC-STATUS.md` / `LINKS.md`.

## Phase 3 — Plan

Before authoring, read **`writing-plans`** and
[`references/implementation-plan-template.md`](references/implementation-plan-template.md).
Assigned tickets → **`plans/implementation-plan.md`**. Start with the overall
goal, vision, and why the work matters; then record the decision and
alternatives, a fact-versus-proposal evidence ledger, and a numbered task
series. Every task states **Why**, dependency or parallelism, owner/boundary,
acceptance evidence, and an exact verification step.

For host, state, or cross-platform work, define the explicit boundary contract
before proposing implementation. A shared store does not make the host's
domain slices authoritative; document store ownership separately from state
provenance. Use the `HostBootstrapPayload` pattern in the reference for
versioned host-to-surface context, validation, and refresh behavior.

## Phase 4 — Dry run

| Item | Convention |
|------|------------|
| Path | `~/apps/{repo}-dry-run` |
| Branch | `spike/{project}-dry-run` |

Loop: spike (`prototype`) → verify → update `plans/dry-run-log.md` + plan. **Do not** merge spikes to `master` or ship product code from command-center branch. When the dry-run worktree needs the main checkout's dependencies: `ln -sf ../{repo}/node_modules node_modules`.

## Phase 5 — Execute

Main checkout on `feat/{description}-{TICKET}`; use the repo's delivery and verification skills; update **`SYNC-STATUS.md`**. Every mergeable PR: **PR validation block** + **`## Merge / deployment order`** for chains — detail in `references/pr-validation.md` and `references/merge-deployment-order.md`.

---

## PR review feedback protocol (IRON LAW)

On PR review feedback — **encode standards in agentbrew first** (separate commit): this SKILL, the matching repo rule, evals/contracts; repo `.agents/skills/*` = pointers only. Push agentbrew before product code. Reference rule sections in PR body. Re-verify. Refresh **every** chain PR **`## Merge / deployment order`** when order changes.

**Anti-patterns:** fix-then-backfill rules; edit `~/.cursor/skills/` mirrors; skip eval updates on new IRON LAW; deploy-order table lists only current repo.

## Merge / deployment order (cross-repo chains)

Every chain PR: one **`## Merge / deployment order`** table (Order \| Repo \| PR \| Description \| Deploy alone safe?) + hard errors, soft misses, flag gating, cross-links. Full example: `references/merge-deployment-order.md`.

## PR validation block (IRON LAW)

Required trio: **## Requirements checklist**, **## Previous state**, **## Validation steps** — templates + stacked carve-out in `references/pr-validation.md`.

### Stacked skill carve-out (IRON LAW)

Greenfield skill stacks: **## Summary**, **## Delivery plan**, **## Test plan** only. Phase-delta branches: one commit, paths from `git diff prev..child` only; `check-stack-pr-overlap.sh` before `[#A, #B]`. Refresh delivery plan on every chain merge (same session).

## Accessible links in PR bodies and published docs (IRON LAW)

PR/docs links must work without local checkout — rules in `references/accessible-links.md`.

## Repo-type variations

| Repo | Verify | Notes |
|------|--------|-------|
| agentbrew | `npm run verify` | `skill-plugins/dev/` |
| dotfiles | `make check` | chezmoi |
| Other repos | per repo AGENTS.md | Use the repo's own verify command |

## Efficiency rules

SSO: attach-first `9223`; background per `sso-background-work`. Slack: one digest per milestone. Fork push when origin denies. Yarn 1: `COREPACK_ENABLE=0`. Parallel repos: `load-project-context` each. GDoc/Jira/PR refreshes: always run the reconciliation protocol. Config: edit agentbrew/dotfiles → **`agentbrew sync`**.

## Anti-patterns (Do NOT)

- **Do NOT** implement product code on `docs/*-command-center` branches.
- **Do NOT** commit worktree-root **`TASKS.md`** (gitignored).
- **Do NOT** merge command-center/dry-run to `master` without explicit request.
- **Do NOT** skip dry-run worktree for multi-ticket initiatives.
- **Do NOT** duplicate `plan` / `load-project-context` — invoke those skills.
- **Do NOT** mix implementation assumptions into the immutable product contract.
- **Do NOT** replace Jira descriptions for transient status or lane changes.
- **Do NOT** edit `~/.cursor/` / `~/.claude/` mirrors — source + sync.

## Execution and verification safety

No intake claim without **`SYNC-STATUS.md`** + **`LINKS.md`**. No plan claim without **`plans/implementation-plan.md`**. No dry-run claim without **`plans/dry-run-log.md`** + quoted verify from dry-run worktree. No production PRs from command-center checkout. Draft docs PR stays draft unless user converts hub to mergeable deliverable.
