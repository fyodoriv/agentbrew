# Skill provenance

This directory is the single source for the owner's methodology skills that do
not currently have a suitable standalone upstream source. They moved here from
the former `fyodoriv/dev-skills` repository on 2026-10-07. The policy is:

1. Install a third-party skill directly when it covers the use case.
2. Fork or adapt that skill here only when a required local contract is
   missing, and keep the upstream reference plus the local delta explicit.
3. Create a skill here only when the use case has no suitable third-party
   implementation.
4. Re-check each local skill against upstream alternatives during the quarterly
   tooling review. A local skill moves out when upstream closes the gap.

## Upstream-derived skills

| Skill | Upstream reference | Local delta |
| --- | --- | --- |
| `writing-plans` | [`obra/superpowers`](https://github.com/obra/superpowers/tree/main/skills/writing-plans) | Adds source-backed evidence ledgers, cross-repository task contracts, and the versioned `HostBootstrapPayload` rules required by the local `/ship-it` workflow. |
| `iterate` | [`karpathy/autoresearch`](https://github.com/karpathy/autoresearch), [`leo-lilinxiao/codex-autoresearch`](https://github.com/leo-lilinxiao/codex-autoresearch) | Consolidates the former `iterate` and `autoresearch` workflows into one canonical loop with rollback, stuck recovery, lessons, and parallel experiments. |
| `review-pr` | [`obra/superpowers`](https://github.com/obra/superpowers/tree/main/skills/requesting-code-review) (`requesting-code-review`, `receiving-code-review`) | Reuses their severity tiers and the fresh-reviewer pattern, and routes your own work to them. Adds the review of someone's PR end to end: a per-run folder that scripts require, a correctness checklist, a verify pass that drops unproven findings, re-review of earlier threads, CI and merge triage, a fresh judge on every draft before it is shown, posting only on the user's yes, and team checklists added by path. |
| `new-project` | [`agentsmd/agents.md`](https://github.com/agentsmd/agents.md), [`anthropics/skills`](https://github.com/anthropics/skills), [`obra/superpowers`](https://github.com/obra/superpowers), [`github/spec-kit`](https://github.com/github/spec-kit) | Combines their repo conventions into three profiles (tool, assistant, side project) with a never-overwrite scaffolder and a deterministic `check-setup.sh` score. Sources: `new-project/references/research.md`. |
| `modern-web-guidance` | [Chrome Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) | Routes one Agentbrew install to the pinned Chrome CLI and Manifest V3 guides. Keeps the project's browser policy and existing design and audit routes. |

The following catalog entries use upstream implementations directly and are
not duplicated here: `grill-with-docs`, `improve-codebase-architecture`,
`doubt-driven-development`, `spec-driven-development`, and `prototype`.

## Local-only skills

The following skills are personal workflow glue with no verified standalone
third-party equivalent in the current source inventory:

`analyze`, `browser-forms`, `caveman`, `cli-design`, `companion-competitor-watch`,
`companion-docs-sync`, `companion-researcher`, `companion-skill-curate`,
`companion-task-groom`, `companion-test-gaps`, `confirm-setup-works`, `failure-modes`, `git-diagnose-codebase`,
`grind`, `handoff`, `karpathy-disciplines`, `markdown-for-gdoc`, `perf-review`, `pre-register`, `project-audit`, `readme`,
`report-upstream`, `rfc`, `rule-to-lint`, `run-goal`, `sourced-calculations`, `split-roles`, `strategic-review`, `sweep`, `task-command-center`,
`to-issues`, `ubiquitous-language`, `watch-issues`, and `wrap-up`.

`pre-register`, `split-roles`, `failure-modes`, and `rule-to-lint` adapt rules that the
archived minsky runner enforced on every repo it worked on (vision rules #7, #9, and #10,
and its developer, QA, and reviewer personas).

## Built on third-party audits

`ui-ux-rankings` wraps axe-core (Deque, MPL-2.0), Lighthouse, the Vercel Web Interface
Guidelines (`vercel-labs/web-interface-guidelines`, fetched at run time) and points to the
`web-quality-audit` skill (`addyosmani/web-quality-skills`) for single Lighthouse runs. Local
delta: one script (`scripts/rankings.cjs`) for the rankings those leave out (touch targets,
selected-state contrast and readability in both themes, focus under sticky bars, Reduce motion),
the round-per-ranking loop, KLM task time, scale checks, and a design-panel rubric, plus a whole-site usefulness audit mode (`scripts/site-report.mjs`
merges three blind panels into a private report).
AgentBrew installs a skill from this directory only when it is selected by name
(catalog entry with `source: fyodoriv/agentbrew`, or an Agentfile `skills:` list).
Nothing here is deployed by default.
