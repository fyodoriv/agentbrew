# Practices from the owner's repos

Surveyed 2026-10-16: minsky, agentbrew, dotfiles, taskgrind, tasks.md (all
public on github.com/fyodoriv), plus two private personal apps, cited here
only as "a private app". Each adopted rule names the file that proved it and
where the template enforces it. `check-setup.sh` tags each check with its
area in brackets.

## Contents

1. Required areas
2. Other adopted rules
3. Rejected, and why

## 1. Required areas

| Area | Rule in the template | Proven in | Enforced by |
|---|---|---|---|
| Vision | One-screen VISION with Problem, Success, Non-goals, Kill criteria, Prior art | agentbrew `docs/agent-guide-baseline.md`, `skill-plugins/dev/write-vision` | `[vision]` |
| Metrics | Each metric has a goal, a pivot, and a command; missing data shows `(stub)`, never 0 | minsky `docs/METRICS.md`, `docs/metrics-discipline.md` | `[metrics]` |
| Observability | Content-free JSONL events with an event table; errors name the story they break; external reporter behind one adapter, off by default | minsky `scripts/lib/error-reporter.mjs`; private app event ledger and flow mapping | `[observability]` |
| Health check | `scripts/doctor.sh`: one `ok`/`FAIL` line per check, each with its fix | dotfiles `bin/dotfiles-doctor`, minsky `doctor`, private app `doctor` | `[observability]` |
| User stories | Each story names its metric and has an e2e test per case (happy, loading, error); a check fails on drift | minsky `user-stories/001-coverage-manifest.test.ts`; private app `tests/test_user_stories.py` | `[user-stories]`, `scripts/check-docs.sh` |
| One-line setup | `scripts/setup.sh`: idempotent, no sudo, ends with the doctor; first line of the README quickstart | agentbrew `scripts/install.sh`, minsky `setup.sh`, dotfiles quickstart | `[setup]` |
| E2E | One file per story case in `tests/e2e/`, isolated in a scratch copy; US-01 is a stranger-install test | agentbrew `real-e2e/scenarios/us24-one-step-install.test.ts`, dotfiles `tests/stranger-readiness.bats` | `[e2e]` |
| Self-improving speed | Gate steps timed into `.metrics/`; weekly speed review in `RECURRING.md`; append-only `docs/learnings.md` (predicted vs observed) | agentbrew `docs/agent-perf.md` and `perf-review`; minsky `docs/validated-learnings.md`, `RECURRING.md`; private app timings report | `[self-improving]` |
| Tasks | tasks.md queue; every task has Hypothesis, Measurement, Success, Pivot, Anchor; delete the block when done | tasks.md `spec.md`; minsky rule #9; agentbrew `scripts/lint-tasks-stability.mjs` | `[tasks]`, the tasks lint in `scripts/check.sh` |

## 2. Other adopted rules

| Rule | Proven in | Where |
|---|---|---|
| `AGENTS.md` router: fixed sections, under 10 KB, `CLAUDE.md` symlink | agentbrew `src/docs/agent-guide-contract.test.ts` | `[agents]` |
| Every `docs/*.md` has a row in the docs map | agentbrew docs map test; private app `tests/test_docs.py` | `scripts/check-docs.sh` |
| Fast gate per commit, full gate (with e2e) once per PR | agentbrew `verify:changed` vs `verify`; private app per-commit vs per-PR gates | `scripts/check.sh fast` |
| Cheap and security checks first; pre-push kept short | minsky `lefthook.yml` and its pre-push budget | `lefthook.yml` |
| Secret scan on staged files and in the gate | dotfiles `git-hooks/pre-commit`, minsky `scripts/scan-secrets.mjs` | `lefthook.yml`, `scripts/check.sh` |
| A dated traps table for anything that cost time | private app agent guide "Traps"; agentbrew `## Gotchas` | `AGENTS.md` Gotchas |
| A machine-checkable rule becomes a check, not prose | minsky vision §10 (every rule has a lint and a test) | `AGENTS.md` rule 9 |
| Key costly outputs by a hash of their inputs | private app build cache | `AGENTS.md` rule 10 |
| Canary strings in synthetic fixtures; assert they never leave | private app `tests/test_privacy_guard.py` | `docs/privacy.md` |
| PR body: Summary, Details, Docs, Predicted / Observed / Lesson | agentbrew PR hooks; minsky `scripts/check-pr-self-grade.mjs` | `AGENTS.md` Delivery |
| Weekly checkup that ends with at most three questions for the owner | private app checkup skill | `RECURRING.md` |
| Conventional commits | dotfiles `git-hooks/commit-msg` | `AGENTS.md` Delivery |

## 3. Rejected, and why

| Practice | Why not in a new repo |
|---|---|
| Hundreds of per-rule lint scripts and a very large vision file (minsky) | Overgrowth; slows every change. Add a lint only when a rule is broken twice. |
| Daemons, supervisors, and scheduled self-repair jobs | Too much for a new repo; add when the app runs unattended. |
| A citation in every code comment | Fragile; the citation lives in the task's Anchor. |
| PR-body checks that need a CI rerun after an edit | Friction with little gain for solo repos. |
| Backup and auto-restore installer (agentbrew `install.sh`) | Right for a `tool` that writes to user machines; overkill otherwise. Note it in the tool's ADR when it applies. |
| Machine-specific shims, chezmoi templates, LaunchAgents | Owner-machine details, not project practice. |
| Test-result caches by recorded inputs (a private app's trace cache) | Worth it once the suite is slow; `scripts/metrics.sh` shows when. |
