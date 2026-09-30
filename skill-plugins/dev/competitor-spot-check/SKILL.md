---
name: competitor-spot-check
description: Search the current repo's `competitors/` and `docs/competition/` directories for prior art on a proposed feature, before filling the `Competitor prior art` field in a PR body or before proposing the feature at all. Use when about to propose a feature, when filling a PR's `## Vision trace` block, when reviewing a PR that lacks a citation, or when a user mentions "have competitors shipped this." Don't use for general competitive analysis (that's `strategic-review`) or for adding a new competitor to the corpus (that's `companion-competitor-watch`).
---

# competitor-spot-check

> The companion to the `pr-vision-trace` CI gate. Greps the repo's competitive corpus for a feature name and surfaces prior art so the agent / human filling the PR's `Competitor prior art` field has something concrete to cite.

## Why this exists

The `pr-vision-trace` gate (CI-enforced in adopting repos) requires every PR body to include a `Competitor prior art` line. Without this skill, the agent fills that line with `N/A — didn't check`, which defeats the point. This skill is the deterministic search step that produces a real citation.

It pairs with `companion-competitor-watch` (which authors new competitor entries) and `load-project-context` (which loads the corpus into session context on entry). Together: load competitors on session start → check prior art before proposing → cite the result in the PR body → CI verifies the citation exists.

## When to invoke

**Yes:**
- About to fill a PR's `## Vision trace` block's `Competitor prior art:` field
- Proposing a feature and want to check whether a competitor already ships it
- Reviewing someone's PR that has `N/A — didn't check` on the competitor line
- User asks "have competitors shipped X" / "is there prior art for Y"

**No:**
- General "what do competitors do" questions — use `strategic-review` for that
- Adding a new competitor doc — use `companion-competitor-watch`
- Reading the existing corpus end-to-end — just `cat docs/competition/*.md`

## How to invoke

Run from any repo root:

```bash
bash ~/.config/agentbrew/scripts/competitor-spot-check.sh "<feature description>"
```

The script:

1. Looks for canonical competitive corpus locations in the current repo:
   - `competitors/` (root) — minsky pattern
   - `docs/competitors/` — alt pattern
   - `docs/competition/` — agentbrew + others
   - `docs/competition.md` (single file) — variant
   - `COMPETITORS.md` (root single file) — variant
2. Greps each found location (case-insensitive) for the feature description's keywords (split on whitespace, ignore stopwords).
3. For each match: prints `[<competitor-name>] <line of context> (<path>:<line-no>)`.
4. If zero matches: prints `no prior art found in <N> competitor files scanned — safe to propose, but note in the PR body that you scanned and found nothing`.
5. If many matches: caps output at 20 and prints "+N more matches — refine search keywords".

Exit code 0 always (it's a research tool, not a gate).

## How to use the result

**If prior art found:** quote it in the PR body's `Competitor prior art` line:

```markdown
- **Competitor prior art**: skills-cli ships `skills add --from <url>` (docs/competition/vercel-skills-cli-vs-agentbrew.md:142); we delegate via `agentbrew install --from <url>` rather than reimplement
```

**If no prior art found:** still note the scan in the PR body:

```markdown
- **Competitor prior art**: N/A — scanned 4 competitor docs (skills-cli, mcpm-sh, block-ai-rules, organization catalogs), no comparable feature
```

The CI gate accepts both forms (≥3 chars of substantive text); the difference is honesty about whether the check happened.

## Edge cases

- **Repo has no competitive corpus**: the script reports `no competitive corpus in this repo`. The PR template's competitor line should then say `N/A — repo has no competitive corpus (deployment manifest / pure tooling)`. That's a legitimate opt-out.
- **Feature description has only stopwords**: the script asks for more specific terms.
- **Competitor docs are huge** (mcpm-sh-vs-agentbrew.md is 49 KB): the script greps with `-l` to surface file matches, then with `-n` to get line context. Hit count is meaningful even when content is too long to print.

## Relationship to the larger system

- The `load-project-context` rule + Claude Code SessionStart hook auto-load the competitive corpus into context at session start.
- `companion-competitor-watch` keeps the corpus refreshed (filed P3 tasks when a competitor ships something new).
- `competitor-spot-check` (this skill) is the query layer over the loaded corpus.
- `pr-vision-trace` CI gate enforces that every PR body cites the result.

The four together turn "I should check competitors" into "the CI fails if I didn't."
