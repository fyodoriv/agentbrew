---
name: git-diagnose-codebase
description: >
  Reads any unfamiliar codebase's git history in 5 minutes — without opening a single file. Runs
  five `git log` commands (churn, bus factor, bug clusters, velocity, firefighting), then
  cross-references the top-churn list with the bug-keyword list to surface the highest-risk
  files first. Use at the start of any audit, sweep, strategic review, or onboarding session.
  Don't use for code review (use `review`), implementing fixes (use `plan`), or visual UX audit
  (use `design-review`).
---

## When to use this skill

- **Onboarding to an unfamiliar repo** — produces a 5-minute high-signal map of where the bugs live, who owns the code, and whether the team is in firefighting mode.
- **Before any audit / sweep / strategic review** — `project-audit`, `sweep`, and `strategic-review` invoke this skill as Step 0 so they spend their reading budget on the highest-risk files instead of arbitrary ones.
- **When asked "where do we have the most pain?"** — the churn × bug-keyword cross-reference is the most actionable single artifact a 5-minute git read can produce.

## When NOT to use this skill

- **You're reviewing one PR** — use `review`. The single-PR diff is the right surface; history is noise.
- **You already know the file** — go read it. Don't run the diagnostic for a one-line change.
- **You're tied to a flaky test or a specific exception** — use `debug`. History is the wrong tool for "why does THIS test fail right now?".
- **The repo has < 50 commits** — the signal floor is too high. Just read the code.

## Background

This skill packages [Ally Piechowski's "The Git Commands I Run Before Reading Any Code"](https://piechowski.io/post/git-commands-before-reading-code/) (2026-04-08) into a reusable diagnostic. The signal is real and well-cited — Piechowski draws on the [2005 Microsoft Research churn-defect study](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/) (relative code churn predicts defect density) and Adam Tornhill's _Your Code as a Crime Scene_.

The article's most-actionable claim, which the rest of this skill operationalizes:

> Take the top 5 from churn and intersect with the top 20 from bug clusters. Files on **both** lists are the highest-risk code in the repo — they keep breaking and keep getting patched.

That intersection is the single most useful output of a 5-minute git read. Every other audit / sweep / strategic-review skill in this repo references this skill's output as their starting point.

## Step 0 — Determine the working directory

**Run from `app/` or `src/`, never the repo root.** Repo-root runs are dominated by lockfile churn, changelog churn, and config churn — none of which reflect application risk. The article calls this out explicitly.

```bash
# If the repo has a clear src/ or app/ subdir:
cd src/   # or cd app/

# If everything is at root, scope the queries with `-- 'src/'` or your equivalent:
git log -- 'src/' …
```

The commands below all use `-- 'src/'` as a default scope. Adjust to your repo shape (e.g. `lib/`, `pkg/`, `services/<name>/`).

## The commands (run in order)

### 1. Churn — what changes the most

```bash
# Top 20 most-edited files in src/ in the last year.
git log --format=format: --name-only --since="1 year ago" -- 'src/' \
  | sort | uniq -c | sort -nr | head -20
```

Read the output as a frequency histogram. Files with > 30 edits in a year are hot spots. The top 5 will feed step 6's cross-reference.

### 2. Bus factor — who built this

```bash
# All-time contributors, ranked.
git shortlog --summary --numbered --no-merges HEAD

# Cross-check: are the top contributors still active in the last 6 months?
git shortlog --summary --numbered --no-merges --since="6 months ago" HEAD
```

A 1-2 person repo with a recent gap signals owner-leaving risk. Compare the two lists: if the all-time #1 isn't in the 6-month list, that knowledge is walking out the door.

### 3. Bug clusters — where bugs live

```bash
# Files touched by commits whose message matches "fix" / "bug" / "broken".
git log -i -E --grep="fix|bug|broken" --name-only --format='' --since="1 year ago" -- 'src/' \
  | sort | uniq -c | sort -nr | head -20
```

The list is files-by-bug-frequency. Adjust the keyword regex if your team uses different conventions (`-i -E --grep="fix|bug|broken|defect|hotfix|patch"` for verbose teams; `-i -E --grep="bug:|fix:"` for prefix-only conventions).

### 4. Velocity over time — acceleration vs decline

```bash
# Commits per month, last 24 months.
git log --format='%ad' --date=format:'%Y-%m' --since="2 years ago" \
  | sort | uniq -c
```

A monotonically climbing line means active development. A flat line means maintenance. A declining line means the team is leaving / pivoting / busy elsewhere. Read the trend, not the absolute count.

### 5. Firefighting frequency — reverts / hotfixes / rollbacks

```bash
# Recent emergency commits.
git log --oneline --since="1 year ago" | grep -iE 'revert|hotfix|emergency|rollback'
```

Count the matches. > 12/year = team is firefighting. 0 hits is ambiguous (stable, OR no descriptive messages — see caveats below).

## Step 6 — Cross-reference (the actual deliverable)

This is what the article actually sells:

> Files in the **top 5 of churn** AND the **top 20 of bug clusters** are the highest-risk code in the repo.

Compute by hand or with a one-liner. Bash version:

```bash
# Top-5 churn files, last year, src/ only:
churn_top5=$(git log --format=format: --name-only --since="1 year ago" -- 'src/' \
  | sort | uniq -c | sort -nr | head -5 | awk '{print $2}')

# Top-20 bug-cluster files, last year, src/ only:
bug_top20=$(git log -i -E --grep="fix|bug|broken" --name-only --format='' --since="1 year ago" -- 'src/' \
  | sort | uniq -c | sort -nr | head -20 | awk '{print $2}')

# Intersection — files on BOTH lists.
comm -12 <(echo "$churn_top5" | sort) <(echo "$bug_top20" | sort)
```

This output is the seed for `project-audit` Step 1, `sweep` Step 0.5, and `strategic-review` Phase 1.1.

## Caveats — read these before trusting the output

The signal is high but not perfect. The article calls these out and they're easy to miss; address every one in your written output (or your `project-audit` / `sweep` / `strategic-review` deliverable):

1. **Squash-merge compresses authorship.** If the repo merges via squash, `git shortlog` reflects the **merger** of each PR, not the actual author. A 1-name shortlog could be 1 person OR 50 contributors all being squash-merged by one maintainer. **Ask before drawing conclusions.** Indicators: `.github/PULL_REQUEST_TEMPLATE.md` mentions squash; `gh pr list --state merged --limit 10 --json headRefName,mergeCommit` shows single-commit merges; `git log --oneline | head -20` shows messages of the form `fix: X (#123)` with no Co-Authored-By line.

2. **Commit-message discipline determines bug-keyword recall.** If the team writes `update stuff` instead of `fix: parse error in <file>`, the bug-cluster query catches nothing. Sample 20 recent commit messages — if they're descriptive, trust the bug-cluster list. If they're noise, the list undercounts. Compensate by also grepping diffs for keywords: `git log -p -i -E --grep="" --since="1 year ago" -- 'src/' | grep -iE "bug|fixme|hack" | head`.

3. **Zero firefighting hits is ambiguous.** Could mean (a) genuinely stable team, (b) no descriptive messages for incidents, (c) emergencies handled out-of-band (force-push to main, hotfix branch deleted before a tag). Disambiguate by asking the maintainer or by checking the team's incident-tracker for the same period.

## Smoke test — applied to `~/apps/agentbrew` (2026-04-26)

Numbers below are the actual output of running this skill on `agentbrew/src/`. They serve double duty: regression evidence the commands work, and a worked example for first-time readers.

**1. Churn (top 5):**

| File | Edits in last year |
|---|---:|
| `src/cli.ts` | 136 |
| `src/catalog.yaml` | 60 |
| `src/types.ts` | 55 |
| `src/health.ts` | 52 |
| `src/integration.test.ts` | 50 |

**2. Bus factor:**

```
1220	Fyodor Ivanischev
   1	svc-semgrep-prd
```

Caveat applied: agentbrew uses squash-merge for every PR (every recent commit ends in `(#NNN)`), so `git shortlog` collapses authorship onto the merger. With one user today (per [`docs/VISION.md` § "Today's user base: one"](../../docs/VISION.md)), this is correct, not a bus-factor crisis.

**3. Bug clusters (top 5):**

| File | Bug-keyword commits in last year |
|---|---:|
| `src/cli.ts` | 50 |
| `src/health.ts` | 32 |
| `src/sync/skills-sync.ts` | 30 |
| `src/catalog.yaml` | 30 |
| `src/sync/mcp-sync.ts` | 29 |

Caveat applied: commit messages are conventional-commits-disciplined (`feat:`, `fix:`, `chore:` + a project ticket prefix like `PROJ-123`) — bug-keyword recall is high, so the list is trustworthy.

**4. Velocity:**

| Month | Commits |
|---|---:|
| 2026-03 | 566 |
| 2026-04 | 670 |

Trend: rapid acceleration. Repo is < 2 months old (per the empty pre-March history) — every observation here is provisional and worth re-running in Q3 once the trend has more months to settle.

**5. Firefighting:** 2 hits, but both are feature commits about a `rollback` command, not incident commits. Real firefighting count is **0**. Caveat applied: with only 2 months of history, "0 firefights" is ambiguous between "stable" and "no descriptive incident messages" — but the maintainer is the only user (`docs/VISION.md`), so out-of-band incidents would still go through git, making "0" the trustworthy reading.

**6. Cross-reference (the deliverable):**

Top 5 churn ∩ top 20 bug clusters: `src/cli.ts`, `src/catalog.yaml`, `src/health.ts`, `src/integration.test.ts`. **These are the files agentbrew's audits should look at first.**

(`src/types.ts` is in top-5 churn but only 16 bug-keyword commits — not in top 20 bug-clusters. Read this as: high churn is structural, not bug-driven; type evolution is healthy.)

This intersection is exactly what `project-audit` Step 1, `sweep` Step 0.5, and `strategic-review` Phase 1.1 use as their starting context. See those skills' Step 0 / Phase 1.1 sections for how the output flows into the rest of an audit.

## What to do with the output

You're a Distinguished Staff Engineer reading a codebase for the first time. You have 5 minutes of git history before you have to decide where to spend the next hour reading source. Use it like this:

- **Files in the cross-reference (churn × bug clusters)** — read first. These are the highest-leverage files. Your audit / fix / review attention belongs here.
- **High-churn but low-bug files** — read second. Probably actively-evolving features (good); confirm there's a test suite tracking them.
- **High-bug but low-churn files** — read third. These are stable-but-leaky modules. Likely under-tested, possibly skipped during refactors.
- **Bus-factor 1 with a 6-month gap** — flag, don't read. Surface in your audit as a strategic risk, not a code-level finding.
- **Velocity declining + firefighting > 12/year** — flag as a project-health issue, not a code issue. Different escalation path.

This skill produces signal. It doesn't produce decisions — those are still the calling skill's job.

## See also

- [`project-audit`](../project-audit/SKILL.md) — the first step of that audit reads this skill's output.
- [`sweep`](../sweep/SKILL.md) — Step 0.5 (Diagnostic snapshot) calls this skill.
- [`strategic-review`](../strategic-review/SKILL.md) — Phase 1.1 (Project Identity) extends with the velocity + firefighting signals.
- Source article: [The Git Commands I Run Before Reading Any Code](https://piechowski.io/post/git-commands-before-reading-code/) (Ally Piechowski, 2026-04-08).
- Background research: [_Use of Relative Code Churn Measures to Predict System Defect Density_](https://www.microsoft.com/en-us/research/publication/use-of-relative-code-churn-measures-to-predict-system-defect-density/) (Microsoft Research, 2005); _Your Code as a Crime Scene_ (Adam Tornhill, 2015).
