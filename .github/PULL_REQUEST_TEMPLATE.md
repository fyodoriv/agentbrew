<!-- Replace the placeholders below. The `pr-vision-trace` CI gate parses
this file's structure — keep the section headers and bullet shapes intact. -->

## Why needed

<one-paragraph explanation of motivation; what user or operator problem this solves>

## What changed

<bullet list of the substantive deltas; group by file area>

## Vision trace

- **Vision goal**: <e.g. "G1 — Curator not host (VISION.md § 'Strategy: delegate, contribute, absorb')" or `N/A — <reason ≥3 chars>`>
- **User story**: <e.g. "US-04 — Switch profiles and customize" or `N/A — <reason ≥3 chars>`>
- **Competitor prior art**: <e.g. "skills-cli ships `skills add`; we delegate (see docs/competition/vercel-skills-cli-vs-agentbrew.md)" or `N/A — <reason ≥3 chars>`>

<!--
  Opt-out (for release-bot / lockfile auto-commits):
  <!-- vision-trace: not-applicable — <reason ≥3 chars> -->
-->

## How to test manually

```bash
<commands a reviewer can run locally>
```

## Verification

- `npm run verify` — <pass/fail; if fail, why>
- <other gates the PR exercises>

## Rollback

```bash
git revert <merge-commit>
```

<one line on whether revert is safe; mention any state migrations to undo>

## Linked

- Ticket: PROJ-XXX (optional; only when a real ticket exists, per agentbrew rule #12)
- Sibling PRs / dependent work / TASKS.md ids
