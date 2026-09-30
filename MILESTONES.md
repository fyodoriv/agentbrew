# Milestones

> Roadmap-shaped view of where agentbrew is and what comes next. See [`VISION.md`](VISION.md) for the strategic frame and [`docs/user-stories/`](docs/user-stories/) for per-feature acceptance criteria.

This file is the root-level milestone summary that the `load-project-context` rule expects. The detailed state is tracked in [`TASKS.md`](TASKS.md) (work queue) and [`RECURRING.md`](RECURRING.md) (calendar-driven sweeps).

## Strategic milestone tracker

Following VISION.md's "delegate, contribute, absorb" framework, agentbrew's roadmap is structured around shrinking surface area, not growing it.

| Milestone | Status | Captured by |
|---|---|---|
| **M0 — Single-user dogfood** | ✅ Done (2026-Q1) | The author's machine runs agentbrew daily across every supported agent. Pre-v1, no internal distribution. |
| **M1 — Delegate to skills CLI** | ✅ Done (2026-04-28) | Parent task closed; residual sandbox/proxy/offline gate closed 2026-05-02. `npx skills add` is the primary path for delegated targets. |
| **M2 — Delegate to mcpm.sh** | ✅ Done (2026-04-27) | The client intersection delegates to `mcpm install` + `mcpm client edit`; compatibility exceptions stay native. Upstream adapter PRs are filed. |
| **M3 — Delegate to block/ai-rules** | ✅ Done (2026-04-28) | Supported intersections delegate to `ai-rules generate`; native exceptions stay documented by the routing matrices. |
| **M4 — team overlay extraction** | 🟡 In progress | Catalog overlay extracted to `agentbrew-<org>` repo (2026-05). Legacy `src/commands/cli-team.ts` + `src/core/team-detect.ts` pending full extraction (tracked in TASKS.md). |
| **M5 — Auto-load project context** | 🟢 Active | Catalog rule `load-project-context` + Claude Code SessionStart hook + `project-context-loader` skill ship together. Every agent session, every repo: VISION/ARCHITECTURE/MILESTONES/user-stories/competitors load into context. |
| **M6 — Public OSS release** | ⏸️ Deferred | Triggers when delete-rate stays flat for 3 months (codebase has stopped shrinking). Until then, single-user discipline applies: breaking changes ship in one commit, no migration paths. |

## Active focus

The current operating mode is **"delete before add"**. Non-test source line target is **<20K lines**. Shrinking the codebase is always a valid PR. Every new-feature PR must answer: *"Why is this in agentbrew instead of skills CLI / mcpm.sh / block-ai-rules?"*

Valid answers (from VISION.md § "Strategy: delegate, contribute, absorb"):
- (a) Delegation blocked by a named constraint
- (b) We contributed and upstream rejected or ignored for 90+ days
- (c) team overlay content
- (d) Multi-surface glue no upstream tool has

## Where work happens

| Surface | Authoritative file | Cadence |
|---|---|---|
| Open tasks | [`TASKS.md`](TASKS.md) (P0–P3) | Continuous; agents claim with `(@agent-id)` |
| Recurring sweeps | [`RECURRING.md`](RECURRING.md) | Quarterly competitor review, weekly health audits |
| User stories (acceptance criteria) | [`docs/user-stories/`](docs/user-stories/) | New US per feature; numbered |
| Competitive landscape | [`docs/COMPETITION.md`](docs/COMPETITION.md) + [`docs/competition/`](docs/competition/) | Refreshed when a competitor ships a relevant change |
| Architecture | [`ARCHITECTURE.md`](ARCHITECTURE.md) + [`AGENTS.md`](AGENTS.md) | Updated in same commit as behavior changes |

## Decision log

Cross-cutting strategic decisions that affect more than one milestone:

- **2026-04-26 — Delegate-first for skills CLI**: shrink rather than reimplement. Triggered by skills CLI ergonomics matching agentbrew's UX target.
- **2026-04-27 — Selective delegation for mcpm + ai-rules**: split-intersection model preserves 2–3 carve-outs that upstream tools don't cover.
- **2026-05 — team overlay extraction**: moved org-specific content into separate overlay repos to make agentbrew org-neutral.
- **2026-05-23 — Auto-load project context**: codified "agent must load canonical project docs on session entry" as catalog rule + Claude Code hook (this milestone).
