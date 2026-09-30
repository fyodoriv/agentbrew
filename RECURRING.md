# Recurring Tasks

Calendar-driven work that fires on a cadence — quarterly, monthly, weekly, or
on a specific date — instead of being claimable from the active queue.

This file is a sibling of `TASKS.md`. The next-task workflow consults BOTH
files: it skips a recurring task unless `now() >= last-fired + cadence` OR
`now() >= next`. When a recurring task ships, the implementor bumps the
`**Last-fired**:` timestamp here (and the `**Next**:` date when applicable)
in the same commit instead of removing the block.

The format mirrors the [tasks.md spec](https://github.com/tasksmd/tasks.md):

- Tasks live under priority sections (`## P0`, `## P1`, ...) just like
  TASKS.md, but P-level here drives "how soon does it fire when its window
  opens" rather than "is it claimable today."
- `**Cadence**:` is required and takes one of: `quarterly`, `monthly`,
  `weekly`, `bi-weekly`, or `next: YYYY-MM-DD` for a specific date.
- `**Next**:` is the next firing date (informational; computed from
  `Last-fired + Cadence` or set explicitly).
- `**Last-fired**:` is the most recent firing date (initially absent;
  added by the implementor when the task first ships).
- Everything else (ID, Tags, Details, Files, Acceptance) matches TASKS.md.

Recurring tasks never close. The work product of each firing is captured
in the linked artifact (e.g. a new file under `docs/competition/dissolution-
reviews/`), and the `**Last-fired**:` line is bumped.

<!-- policy: This file does NOT carry the publishing-policy header from TASKS.md.
             A recurring task that requires external publishing must include
             `**Human-approval-required**:` per the global policy, same as
             active tasks. The cadence trigger is necessary but not sufficient
             — every external publish action still needs explicit per-action
             approval at the moment of publishing. -->

## P1

- [ ] Deep re-research every competitor whose Freshness Tracker entry is older than 7 days (21 of 25 today).
  **ID**: re-research-stale-competitors
  **Tags**: competition-research, strategic-review, docs
  **Cadence**: weekly
  **Last-fired**: 2026-05-02
  **Next**: 2026-05-09
  **Output**: docs
  **Details**: As of 2026-04-19, only 4 of 25 tracked competitors (skills CLI, MCPM, Smithery CLI, anthropics/skills — all researched 2026-04-12) are within the 7-day freshness window. The other 21 are stale by 8 to 27 days: Compound Engineering, vsync, install-mcp, block/ai-rules, skillfile, ai-rules-sync, OpenViking, knowhub, Warden, Chops, GitAgent (2026-04-11, 8 days old); Skills Manager, MCP Dock, agent-config-sync, mdskills.ai, awesome-codex-subagents, claude-peers-mcp, Context Hub, React Doctor, OpenClaw / ClawHub, dotfiles pattern (2026-03-23, 27 days old).
    Stale data makes the Build-or-Contribute verdicts unreliable. A project that was "Keep separate (stagnant)" 27 days ago may have resumed activity (flipping to "Contribute" or "Complementary"); a project marked "404" (Compound Engineering) may be back; a tool that had 50 stars may now have 2K with new features (GitAgent went 1.1K → 2.6K between the last two refreshes). Every verdict in `docs/COMPETITION.md`'s Build or Contribute? Summary depends on facts no older than a week, and right now most of them are older than two.
    Outcome: every Freshness Tracker entry has `Last Researched` ≤ 7 days from the PR merge date. For each stale entry, pull current stars + fork count, last push date, last release, and any new features shipped since previous research. Re-assess the Build-or-Contribute verdict against the new data — if it changes, update the Verdict column in the tier tables, the deep-dive paragraph (if Tier 1), and the summary tally (currently 1 Contribute / 10 Keep separate / 21 Complementary). Any dead or 404 projects graduate to a "Removed" section or their best-fit tier. Any project that crossed a threshold (2x star growth, corporate adoption, sync + drift shipped) gets called out in "What to Watch For."
    Use the deep-research pipeline the Caliber and Bridle tasks describe: GitHub repo page, changelog / releases, project homepage or docs, one or two recent community posts if any. Bundle findings into a single COMPETITION.md + competition-snapshot.json PR so the freshness sync runs once.
    **Also refresh the skills CLI agent-compatibility matrix in `src/core/agents.yaml`.** The `supportedSkillFeatures` field on every agent entry is derived from the [vercel-labs/skills README compatibility table](https://github.com/vercel-labs/skills#compatibility). If upstream adds columns (e.g. a new feature), removes a "No" → "Yes" transition, or adds a new agent to the matrix, mirror that change in agents.yaml in the same PR. Validate by running `npm run verify` — new agents default to `["allowed-tools"]`, use an explicit subset when only some features are supported (Kiro supports hooks but not allowed-tools today), and only opt out via an explicit empty array when no advanced features are supported (Zencoder today).
  **Files**: docs/competition-snapshot.json (refresh every stale entry's stars + research date), docs/COMPETITION.md (Freshness Tracker table, any verdict / deep-dive updates triggered by new data, "What to Watch For" additions, Build or Contribute? summary tally if verdicts changed), README.md competition table (if any project graduates in or out), src/core/agents.yaml (refresh `supportedSkillFeatures` for any agent whose upstream compat row changed).
  **Acceptance**: (a) every row in the Freshness Tracker has `Last Researched` within 7 days of the PR merge date; (b) any Build-or-Contribute verdict that changed is reflected in the tier tables, the summary tally, and (if Tier 1) the deep-dive "Contribute vs Build" paragraph; (c) `npm run docs:competition` passes (no stale narrative counts left behind); (d) the PR description contains a "Strategic delta" section listing every competitor whose verdict, tier, or star count changed materially — one line each — so reviewers can scan the changes without reading the whole diff; (e) the `supportedSkillFeatures` matrix in `src/core/agents.yaml` matches the current vercel-labs/skills README compatibility table — any agent whose upstream row changed has been updated, any new agents have been added with default `["allowed-tools"]` (or explicit exception), and `npm run verify` passes.

## P2

- [ ] Quarterly dissolution + contribution-pulse re-evaluation — is agentbrew still the right answer, which contributions are stalling, what absorbs back.
  **ID**: quarterly-dissolution-reeval
  **Tags**: strategy, dissolution, delegate, contribute, docs
  **Cadence**: quarterly
  **Next**: 2026-07-01
  **Output**: docs
  **Details**: **Operationalizes the 90-day contribution window from VISION.md § "Delegate, contribute, absorb — in that order".** Each quarter, this task runs Check 1–3 below in one pass:

    **Check 1 — Upstream contribution pulse (90-day rule).** For every open agentbrew upstream contribution (currently: engagement on [PR #630](https://github.com/vercel-labs/skills/pull/630), [PR #509](https://github.com/vercel-labs/skills/pull/509), [issue #283](https://github.com/vercel-labs/skills/issues/283), [issue #268](https://github.com/vercel-labs/skills/issues/268), [issue #729](https://github.com/vercel-labs/skills/issues/729), and any new ones filed since last quarter) — has there been maintainer engagement in the last 90 days?
    - **Engaged** (maintainer comment, review, merge) → keep waiting, continue iterating
    - **Rejected explicitly** → absorb the capability into agentbrew permanently; add a line to VISION.md's "permanent agentbrew scope"
    - **Ignored 90+ days** → treat as rejection → absorb the capability into agentbrew permanently
    The 90-day rule is what keeps the strategy honest. Without a deadline, "we'll contribute it upstream" becomes "we'll build it here anyway."

    **Check 2 — Dissolution triggers (per docs/competition/vercel-skills-cli-vs-agentbrew.md § "Triggers that would flip the decision"):**
    1. **Skills CLI scope expansion** — does Vercel's skills CLI now cover MCP or rules? Fatal gap count drops → closer to dissolution.
    2. **A unified multi-surface tool reaches 5K+ stars** with drift detection + 20+ agent targets. Watch list: [Bridle](https://github.com/neiii/bridle), [Caliber](https://github.com/caliber-ai-org/ai-setup), [Ruler](https://github.com/intellectronica/ruler), [agent-switchboard](https://github.com/qyhfrank/agent-switchboard), [Cyncia](https://www.cyncia.net/), [agents_sync](https://github.com/CognitiveSand/agents_sync), **Cursor Team Marketplace** (orchestration-marketplace / control-plane pattern: "point at a git repo, auto-refresh" + one-click MCP catalogs; Cursor-only, IDE-only today — flip toward dissolution for the Cursor surface if CLI plugins ship), **[Runlayer](https://www.runlayer.com/)** (same pattern at enterprise scale: hosted MCP/skills/agents control plane, ToolGuard/AgentGuard governance — dissolution trigger for the MCP-catalog + install + governance surface if you go multi-user/enterprise). Also track **[Composio](https://composio.dev/)** as the connector-catalog delegation target (see TASKS.md `delegate-connectors-to-composio`). Source: 2026-07-06 landscape review (canvas: `canvases/agentic-tooling-vs-agentbrew.canvas.tsx`).
    3. **[PR #937 by Anthony Fu](https://github.com/vercel-labs/skills/pull/937)** — does the "config system for the CLI as a whole" mention materialize into multi-surface state? Would close the biggest fatal gap.
    4. **maintainer headcount drops below 0.5 FTE** on agentbrew maintenance.
    5. **Codebase grows past 30K LOC** without commensurate user-story gains (currently ~23K).
    6. **A Node.js port of mcpm or block/ai-rules emerges** — solves the ecosystem-mismatch problem.

    **Check 3 — Delegation re-run.** For any subsystem currently in terminal state "(b) Keep native, blocker X" from a prior delegation evaluation — has the blocker gone away? (e.g. corporate proxy policy changed, Python runtime stabilized, block/ai-rules got a Node port). If yes, re-run the delegation task.

    **Outcome** (each quarter): a short decision doc at `docs/competition/dissolution-reviews/<YYYY-QN>.md` with five sections:
    (a) **Contribution pulse** — per-upstream-thread status (engaged / rejected / ignored 90+ days); any capabilities absorbed this quarter.
    (b) **Dissolution triggers fired** — which of the 6 (or new ones added since) fired and what they mean.
    (c) **Delegation re-runs** — any "keep native, blocker X" slices whose blocker has gone away.
    (d) **Fatal-gap list** — updated count, updated list (currently 7, expected to shrink as ecosystem catches up).
    (e) **Recommendations** — stay course / accelerate a specific subsystem dissolution / retire agentbrew entirely. Every recommendation maps to a concrete task opened or closed in TASKS.md in the same PR.

    First cadence: 2026-07-01 (Q3 2026). Every quarter thereafter. Tied to the `re-research-stale-competitors` P1 rhythm.

    This task never closes — it's recurring. Each quarter is a single commit with one new file in `dissolution-reviews/` and any task deltas. Don't remove from this file; bump `**Last-fired**:` instead.
  **Files**: `docs/competition/dissolution-reviews/YYYY-QN.md` (new per quarter), `docs/competition/vercel-skills-cli-vs-agentbrew.md` (update triggers + 90-day-window status), TASKS.md (new/closed tasks from triggers that fired), docs/VISION.md (update permanent-scope list if capabilities got absorbed).
  **Acceptance**: Every quarter, a new `docs/competition/dissolution-reviews/YYYY-QN.md` file with all 5 sections. Every upstream contribution agentbrew has open is accounted for — engaged / rejected / absorbed. Every trigger in the 6-item list (plus new ones) is evaluated with a concrete answer. Every "keep native, blocker X" slice is re-measured. Any capability absorbed after a 90-day ignore gets a corresponding line added to VISION.md's "permanent agentbrew scope." If zero triggers fire and zero absorbs happen for 4 consecutive quarters, the trigger list is reviewed for staleness (maybe the triggers are wrong).

- [ ] Context budget weekly audit — refresh metrics, compare history, triage TASKS.md trim tasks.
  **ID**: context-budget-weekly-audit
  **Tags**: token-budget, metrics, context, ops
  **Cadence**: weekly
  **Next**: 2026-06-22
  **Output**: measurement
  **Details**: Run `agentbrew measure context` (or `bash ~/apps/tooling/agentbrew/scripts/measure-context-budget.sh` from dotfiles launchd if wired). Read `~/.config/agentbrew/metrics/latest.json`. Compare `projectedDeployedTokens` and `topSections` to prior `context-budget-*.json` files. Run `agentbrew lint` — every error is a P1/P2 fix or a new TASKS.md entry with quoted metrics. For Claude-heavy weeks, optionally run `bunx ccusage weekly` or invoke the `session-report` skill. Cursor ring: log manual readings to `metrics/manual-snapshots/` when IDE pressure is reported (no API).
  **Files**: `~/.config/agentbrew/metrics/latest.json`, `~/.config/agentbrew/metrics/context-budget-*.json`, TASKS.md (token/trim tasks)
  **Acceptance**: (a) `latest.json` refreshed within 7 days of merge; (b) PR or session note lists delta vs prior snapshot (tokens, top 3 sections, skill/MCP counts); (c) every lint error tied to an open TASKS.md task or fixed in the same firing; (d) no custom JSONL parsers or duplicate ccusage dashboards added.
