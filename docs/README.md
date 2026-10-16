# Documentation map

Find the doc that answers your question. Rows are grouped by type
([Diátaxis](https://diataxis.fr/)): tutorials teach, how-to guides solve one
task, reference states facts, and explanation gives the why.

Audience: **human** = people who use or review agentbrew; **agent** = coding
agents that change this repo; **both** = either.

New top-level `docs/*.md` file? Add a row here in the same PR.
`src/docs/agent-guide-contract.test.ts` fails when a doc is missing from this map.

## Start

| Doc | Answers | Audience |
|---|---|---|
| [`../README.md`](../README.md) | What is agentbrew, how do I install it, which commands exist? | human |
| [`../AGENTS.md`](../AGENTS.md) | How do I change this repo fast and safely? Commands, routing table, gotchas. | agent |
| [`user-stories/`](user-stories/) | What should a user be able to do, step by step? | both |

## How-to guides

| Doc | Answers | Audience |
|---|---|---|
| [`measure-context-budget.md`](measure-context-budget.md) | How do I measure how much context agentbrew adds to each session? | both |
| [`agent-perf.md`](agent-perf.md) | Which agent steps take the longest? The perf log, its privacy rules, and `agent-perf.mjs`. | both |
| [`learn-project.md`](learn-project.md) | How do I use the `learn-project` skill to study a codebase? | human |
| [`testing-agent-artifacts.md`](testing-agent-artifacts.md) | How do I test skills, commands, hooks, and rules? | agent |
| [`agent-guide-baseline.md`](agent-guide-baseline.md) | How do I write an `AGENTS.md` for any repo? The cross-repo contract. | both |

## Reference

| Doc | Answers | Audience |
|---|---|---|
| [`editing-rules.md`](editing-rules.md) | What is the full text of each numbered editing rule? | agent |
| [`repo-map.md`](repo-map.md) | Where does each file live, and which sync engine writes which target? | agent |
| [`hook-protocol.md`](hook-protocol.md) | How do deterministic hooks receive input and return a verdict? | agent |
| [`task-backend-contract.md`](task-backend-contract.md) | Where does a repo keep its tasks (TASKS.md or GitHub Issues)? | both |
| [`agent-bloat-lint.md`](agent-bloat-lint.md) | Which size and bloat checks does `agentbrew lint` run? | agent |
| [`cli-flags-audit.md`](cli-flags-audit.md) | Why is each CLI flag opt-in instead of the default (rule 16)? | agent |
| [`shared-rules.md`](shared-rules.md) | What is the baseline shared rules file that sync deploys? | agent |
| [`code-style-comment-examples.md`](code-style-comment-examples.md) | What do good and bad code comments look like? | agent |
| [`skill-routing-policy.md`](skill-routing-policy.md) | Where does a new rule belong: shared rules, a skill, or a repo guide? | agent |

## Explanation

| Doc | Answers | Audience |
|---|---|---|
| [`VISION.md`](VISION.md) | Why does agentbrew exist, and what will it never do? (Symlink to `../VISION.md`.) | both |
| [`COMPETITION.md`](COMPETITION.md) | How does agentbrew compare with other tools, and what do we delegate? | both |
| [`competition/`](competition/) | Detailed comparisons with single tools (mcpm, ai-rules, skills CLI). | both |
| [`instructions-analysis.md`](instructions-analysis.md) | What do the deployed instruction files cost and buy? | both |
| [`research/`](research/) | Spikes and research notes behind past decisions. | agent |
| [`decisions/`](decisions/) | Which design choices were made, why, and when do we review them? | agent |

## Work in progress and records

| Doc | Answers | Audience |
|---|---|---|
| [`plans/`](plans/) | Plans for non-trivial tasks, one file per task ID. | agent |
| [`audits/`](audits/) | Drafts and audits for upstream contributions. | agent |
| [`specs/`](specs/) | Proposed cross-tool conventions, such as managed-section markers. | both |
| [`human-blocked-actions/`](human-blocked-actions/) | Steps that need a human (logins, approvals). | human |
