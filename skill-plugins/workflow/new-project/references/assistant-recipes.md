# Assistant recipes

Fill the assistant profile for a specific kind of assistant. The runtime is a
coding agent (Claude Code, Codex) reading this repo: skills are the features,
markdown is the database, and `private/` holds the user's data.

## Contents

1. Rules for every assistant
2. Tutor or coach (for example interview prep)
3. Career helper
4. Business helper

## 1. Rules for every assistant

- **One skill per feature**, each with a should-act and a should-refrain case in `evals/cases/`.
- **Session ritual**: the `start-session` skill loads the profile, the memory
  index, and what is due, then proposes one step.
- **Write back durable facts** to `private/memory/MEMORY.md`, one line each.
  Update an entry; never add a duplicate.
- **Tools**: few and consolidated, clear parameter names, error messages that
  say how to fix the call.
- **Risk**: anything that sends, pays, posts, or deletes asks the user first.
- **Data exits**: list every path data can leave by (git, logs, hosted
  models, backups, sync between machines, and the agent's own transcript,
  since stdout goes to the model provider) with one guard and one canary test
  each, in `docs/privacy.md`. Prefer an allowlist `.gitignore` for `private/`
  repos.
- **Simple first**: one prompt plus files before an agent loop; cap loop iterations.
- **Weekly gardening**: a skill proposes memory and knowledge clean-ups for the
  user to approve. It never rewrites them silently.

## 2. Tutor or coach (for example interview prep)

The gap in open-source tutors is a durable learner model with scheduling.
Most coach only inside one chat. Build that first.

| Piece | File | Notes |
|---|---|---|
| Learner model | `private/learner.sqlite` (or JSONL) | per topic: mastery, misconceptions, FSRS card state, attempt history |
| Review skill | `skills/review/SKILL.md` | due items first (retrieval practice), then new material |
| Mock skill | `skills/mock/SKILL.md` | pick by weakness and due date; timed; think aloud; tiered hints (nudge, approach, solution) |
| Rubrics | `evals/rubric.md`, one section per round: coding, system design, behavioral | binary sub-criteria; the same rubric drives feedback and the judge |
| Grade to schedule | code in the review skill's script | rubric score → FSRS rating (Again, Hard, Good, Easy) via `fsrs` or `ts-fsrs` |
| Question bank | `knowledge/question-bank.md` | topic taxonomy with links to public curricula; note each license; do not copy |
| Progress | `skills/progress/SKILL.md` | weak topics, due count, trend per rubric dimension |

Tutor evals to write first:

1. It withholds the solution until the user has tried.
2. It finds the planted bug in a synthetic answer.
3. Its rubric grade agrees with your own labels on a small set.
4. It refrains from starting a mock when the user asks a quick factual question.

Learning-science anchors: retrieval practice (Roediger and Karpicke 2006),
spacing (Cepeda et al. 2006), and the two "high utility" techniques in
Dunlosky et al. 2013 (practice testing, distributed practice). Scheduler:
[FSRS](https://github.com/open-spaced-repetition).

Curricula to link: [tech-interview-handbook](https://github.com/yangshun/tech-interview-handbook),
[coding-interview-university](https://github.com/jwasham/coding-interview-university),
[system-design-primer](https://github.com/donnemartin/system-design-primer),
and the NeetCode 150 topic list.

## 3. Career helper

- Skills: `resume-review`, `job-match` (job post vs profile), `outreach-draft`, `weekly-retro`.
- `private/`: resume versions, applications log, contacts. Never commit them.
- Drafts only: the assistant never sends a message; the user sends it.
- Evals: it refuses to invent experience; it cites the profile for each claim.

## 4. Business helper

- Skills: `weekly-review` (metrics vs goals), `decision-log`, `customer-notes`, `pricing-check`.
- `knowledge/`: market notes with sources. `private/`: numbers, customers, contracts.
- Any money or legal step is a checklist for the user, not an action.
- Evals: every number in an answer traces to a file in `private/` or `knowledge/`.
