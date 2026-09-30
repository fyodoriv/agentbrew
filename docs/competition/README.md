# Competition — Detailed Comparisons

This folder holds long-form, feature-by-feature comparisons between agentbrew and specific competitors. Each doc is self-contained and should answer three questions:

1. **Does this tool do 80%+ of what agentbrew does?** (Yes → candidate for "Contribute" or delegation)
2. **What does each tool do that the other doesn't?** (The honest differentiation zone)
3. **What's the concrete next action for agentbrew?** (Delegate, contribute upstream, or keep separate with a documented reason)

## Index

| Doc | Competitor | Verdict | Status |
|---|---|---|---|
| [vercel-skills-cli-vs-agentbrew.md](vercel-skills-cli-vs-agentbrew.md) | Vercel Labs `skills` CLI (`npx skills`) | **Contribute** | Delegation shipped (split: 51 exact-name agents + 3 rename pairs → `npx skills add`, 2 carve-outs → native). Hardware-bound sandbox/proxy/offline measurement passed 2026-05-02. |
| [mcpm-sh-vs-agentbrew.md](mcpm-sh-vs-agentbrew.md) | Path Integral Institute `mcpm.sh` (`pipx install mcpm`) | **Contribute** | All 4 slices DONE 2026-04-27. Verdict: selective delegation (split-intersection model). 9 strict client-intersection delegate / 3 small adapters as upstream contribution candidates / 2 hard carve-outs. Delegation shipped 2026-04-27 (parent task `delegate-mcp-to-mcpm` removed from queue; mcpm PRs #326–329). |
| [block-ai-rules-vs-agentbrew.md](block-ai-rules-vs-agentbrew.md) | Block / Square / Cash App `ai-rules` (Rust binary, `~/.local/bin/ai-rules`) | **Contribute** | All 4 slices DONE 2026-04-27. Verdict: selective delegation (wrapper-around-output model). 4 strict intersection + 7 free-capability gains delegate / 3 carve-outs stay native. Wrapper preserves user data per VISION.md. Execution path: now-retired `delegate-rules-to-ai-rules` parent task (retired 2026-04-28); residual slice 6a publish in [`delegate-rules-to-ai-rules-slice-6a-followup`](../../TASKS.md). |

## When to add a doc here

Add a detailed doc here when:
- The competitor has **80%+ feature overlap** with agentbrew on at least one slice (skills, MCP, rules, commands, drift), AND
- The high-level entry in [`../COMPETITION.md`](../COMPETITION.md) (Verdict column + deep-dive paragraph) isn't enough to resolve the strategic question, AND
- Someone needs the full comparison to make a "Contribute vs Build" decision with confidence.

Do **not** duplicate the full COMPETITION.md entry. The main file stays the overview + summary + per-competitor verdict table. Detailed docs here go deeper than that — architecture walk-throughs, LOC breakdowns, agent-by-agent parity, explicit delegation/contribution plans.

## Conventions

- **File name**: `<competitor-slug>-vs-agentbrew.md`
- **First section**: "TL;DR" box with the strategic answer and the concrete next action
- **Cite facts**: link to source files, README lines, GitHub issues, and `src/...` paths. Claims without citations are fair game for reviewers to challenge.
- **Mark inflated claims honestly**: when the main COMPETITION.md or VISION.md has exaggerated a gap or feature, surface it here and link the correction.
- **Update cadence**: these docs get re-visited when the P0 task `re-research-stale-competitors` touches the relevant entry, or when the linked competitor ships a major release.
