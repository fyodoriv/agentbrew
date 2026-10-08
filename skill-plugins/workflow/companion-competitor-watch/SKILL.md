---
name: companion-competitor-watch
description: >
  Read-only companion lane — refresh competitor research for a project.
  Identifies competitors from VISION.md / docs/competitors/, checks their
  latest releases, scans recent blog posts and changelogs, and updates
  `docs/competitors/<NAME>.md` with new findings. Files P3 TASKS.md
  entries for "competitor X now has feature Y we don't". Use when called
  by `companion-researcher` or when the user asks "what are competitors
  doing", "refresh competitor research", or "scan the market". Don't use
  to propose features (use `strategic-review`) or rewrite VISION.md (use
  `write-vision`).
argument-hint: "[--repo path] [--competitors comma,separated] [--max-age-days 30]"
triggers:
  - user
  - model
---

## Role

You are the **competitor-watch lane** of the companion workflow. You
identify the project's competitors, check what they've shipped recently,
and surface diffs that the worker (or a strategic-review session) can
act on. You never propose pivots or rewrites — you just refresh facts.

## Safety Rules

Inherit the [companion-researcher safety rules](../companion-researcher/SKILL.md#safety-rules--do-not-skip).
Highlights:

- Write only to `docs/competitors/<NAME>.md` (existing competitor docs
  may be whole-file-rewritten — they're owned by this lane), new files
  under `docs/research/`, and `TASKS.md` (atomic append).
- Never edit `VISION.md`, `README.md`, or `docs/strategy/`. Those are
  owned by strategic-review and humans.
- Web searches and webfetch are pre-approved. No credentials needed.

## Task Backend

Detect the repo's task backend by checking for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, file findings as GitHub Issues via `tasks create` instead of appending to TASKS.md. Otherwise, append to TASKS.md as usual.

## Process

### Step 1: Identify competitors

Read in priority order:

1. `docs/VISION.md` — most projects list competitors in a "Competition"
   or "Alternatives" section. Extract their names and URLs.
2. `docs/competitors/` directory — each `<NAME>.md` is a tracked
   competitor.
3. `README.md` — sometimes the README mentions "alternatives" or "vs."
   in the intro.
4. `--competitors` flag — manual override / addition.

If you find zero competitors, file a P3 task: "Project has no
documented competitors — strategic-review should run". Exit the lane.

For each competitor, also gather:
- Their GitHub repo (if any)
- Their changelog URL
- Their primary marketing site
- The last time `docs/competitors/<NAME>.md` was modified (if it exists)

### Step 2: Decide which competitors to refresh

Refresh a competitor doc when:
- Last modified > `--max-age-days` (default 30) ago
- It doesn't exist yet
- The user explicitly named it via `--competitors`

Skip otherwise (the data is fresh enough).

### Step 3: For each competitor, gather fresh data

Use these sources (in order of signal-to-noise):

**Their GitHub repo:**
```bash
# Recent releases
gh release list -R <owner>/<repo> --limit 5

# Last 20 commits to main
gh api repos/<owner>/<repo>/commits --paginate --jq '.[].commit | {date: .author.date, message: .message}' \
  | head -50

# Last 10 closed PRs (lets you see what they shipped)
gh pr list -R <owner>/<repo> --state merged --limit 10
```

**Their changelog (if external):**
```bash
webfetch <changelog-url>
```

**Their blog / docs:**
```bash
# Look for a /blog or /changelog page; fetch recent posts
webfetch <blog-url>

# Web search for very recent activity
web_search "<competitor-name> release 2026"
web_search "<competitor-name> changelog"
```

**Their package registry** (npm, crates.io, PyPI):
```bash
npm view <package-name> versions --json | jq '.[-5:]'
# or
cargo search <crate-name>
```

Collect 5–15 concrete data points per competitor. Skip if you find
fewer than 2 — the competitor may have gone dormant; note this fact.

### Step 4: Identify novel features (vs. last refresh)

Read the existing `docs/competitors/<NAME>.md` if present. Compare:

- Features mentioned in the new data but not in the existing doc
- Release dates that are newer than the last "Last updated" stamp
- Pricing / positioning changes
- Repo activity that suggests pivot (e.g. they renamed, archived, or
  shifted scope)

These are the **deltas** — the lane's primary output.

### Step 5: Rewrite `docs/competitors/<NAME>.md`

Use this structure:

```markdown
# <Competitor Name>

> One-line positioning, in their words if you can quote it.

**Last refreshed**: <YYYY-MM-DD> by `companion-competitor-watch`.

## What they are

<2–4 sentences describing what they do, current scope, who uses them>

## Where they live

- **Repo**: <github URL>
- **Site**: <marketing URL>
- **Package**: <npm / crates.io / PyPI URL>
- **Changelog**: <URL>

## Recent activity (since last refresh)

| Date | Item | Source |
|------|------|--------|
| 2026-05-12 | Released v2.4 with X | <release URL> |
| 2026-05-08 | Blog post "How we Y" | <blog URL> |
| ... | ... | ... |

## Features they have, we don't

- <feature> — <one-line description>. See <source>.
- ...

## Features we have, they don't

- <feature> — <one-line description from our VISION.md or README>.
- ...

## Strategic notes (read-only — no decisions made here)

- <observation>: <signal>. Implication: <one sentence>.
- ...

## Sources consulted this refresh

- <URL 1>
- <URL 2>
- ...
```

The "Strategic notes" section observes; it does not decide. Decisions
go to a `strategic-review` session, not here.

### Step 6: File P3 TASKS.md entries for actionable diffs

For each "Features they have, we don't" item that looks user-visible
and shippable, append a P3 task:

```markdown
- [ ] Consider matching <competitor>'s <feature> (companion competitor-watch)
  - **ID**: competitor-<competitor-slug>-<feature-slug>
  - **Tags**: research, competitor, companion
  - **Details**: <competitor> shipped <feature> on <date>. Their
    pitch: <quoted positioning>. Our equivalent would be <one
    paragraph of how we'd do it, in our codebase's terms>. See
    [`docs/competitors/<NAME>.md`](docs/competitors/<NAME>.md) for
    the full context.
  - **Files**: docs/competitors/<NAME>.md, docs/VISION.md (may need
    update if we decide to act)
  - **Acceptance**: Decision recorded — either matched in code or
    rejected in VISION.md as out-of-scope with rationale.
```

Cap at 5 P3 tasks per lane invocation. If you find more, list them in
the competitor doc but don't file extra TASKS.md entries — let the
human decide.

### Step 7: Validate

```bash
npx -y @tasks-md/lint TASKS.md
```

### Step 8: Summary

```
lane=competitors repo=<name>
competitors-refreshed=<list>
competitors-skipped-fresh=<list>
deltas-found=<count>
docs-written=<files>
tasks-filed=<count>
```

## Patterns That Pay Off

- **Quote rather than paraphrase positioning.** "What they say" beats
  "what I think they say" — and dated quotes show recency.
- **Look at their closed PRs, not just releases.** Shows what they're
  working on between releases.
- **GitHub topics / stars / forks tell you trajectory.** A competitor
  going from 200→5000 stars in 6 months is a different threat than
  one stuck at 200 for 3 years.
- **Their issue tracker is gold.** The features users are *asking*
  them for are often the features we should also expect to be asked
  for soon.
- **Don't fabricate features.** If you can't find concrete evidence
  for a claim about a competitor, leave it out. The PR shouldn't
  contain "I think they might have X" — only verified items.

## Cool-down

After running once per competitor, that competitor is cooled for
`--max-age-days` (default 30 days). The lane will skip them until
fresh.
