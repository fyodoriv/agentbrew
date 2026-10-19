---
name: ui-ux-rankings
description: >
  Measure and improve a web page's UI and UX with many rankings at once, one round per ranking:
  axe-core WCAG 2.2, the Vercel Web Interface Guidelines, target size, text and state contrast,
  keyboard, Reduce motion and dark scheme, readability, Nielsen's heuristics, task time (KLM),
  Lighthouse, performance at real scale, and a design panel that rates the look as ten design-award
  sites would. Use for "rate my UI", "UX audit", "make it look modern", "iterate on the UI until it
  scores N", or before shipping a page. Don't use for one Lighthouse run alone (use
  web-quality-audit) or for creative direction from scratch (use frontend-design).
---

# UI and UX rankings

Turn "is this page good?" into numbers, fix the worst ranking, re-measure, repeat. Built on the
third-party audits it wraps (axe-core, Lighthouse via `web-quality-audit`, the Vercel guidelines via
`web-design-guidelines`) and adds what they miss: touch targets and selected-state contrast in both
themes, focus hidden under sticky bars, Reduce motion, phone readability, task time, behavior at
real scale, and a design rating.

## 0. Serve the page with realistic, synthetic data

Rankings lie on toy data. Build the page from a fixture as large as real use (a long list, a full
book, a thousand items) and serve it on 127.0.0.1. Never point the tools at private user data.

## 1. Set up the tools once

```bash
T=$(mktemp -d) && npm i --prefix "$T" --silent playwright axe-core
S=<this skill's folder>/scripts
export NODE_PATH="$T/node_modules"   # rankings.cjs requires playwright and axe-core from here
# CHROME_PATH=/path/to/chrome when Playwright has no browser of its own (do not download one in CI)
```

## 2. Measure everything first (the baseline)

```bash
node $S/rankings.cjs all http://127.0.0.1:8000/page.html "http://127.0.0.1:8000/page.html#other-view" --min 95
npx -y lighthouse@13 http://127.0.0.1:8000/page.html --only-categories=performance,accessibility,best-practices \
  --output=json --output-path=lh.json --quiet      # mobile; add --preset=desktop for desktop
node $S/rankings.cjs shots http://127.0.0.1:8000/page.html --out ui-shots
node $S/rankings.cjs frames http://127.0.0.1:8000/page.html --click '.card' --at 40,140,460 --out ui-shots  # a motion strip
```

List every view a user reaches (modes, tabs, dev or admin views, dialogs opened by a hash) as its own
URL. `--min` makes the run exit 1 when a measured ranking is below it, so it can gate a commit.

The expert rankings have no script. Score them by hand and write the numbers down:

| Ranking | How |
|---|---|
| Vercel Web Interface Guidelines | fetch `https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`; count the rules the page breaks. Note any rule you skip on purpose (for example Title Case when the product writes sentence case) |
| Nielsen's 10 heuristics | severity 0-4 per problem; report the total. A modal with no visible way out is a 3 |
| Task time (KLM) | K .28 s, P 1.1 s, B .1 s, M 1.35 s per step; time the 4 to 8 most common tasks; report the sum |
| Scale | bytes and time a phone loads for the largest realistic data set (Playwright `response` sizes, or Lighthouse LCP and total byte weight) |
| Design panel | three blind rater subagents, [references/design-panel.md](references/design-panel.md), from the `shots` screenshots; never self-scored |

## 3. One round per ranking

Take the rankings worst first. Per round:

1. Fix what that ranking names, nothing else. Keep every id, class and attribute that tests or
   scripts use.
2. Re-run that ranking, then `rankings.cjs all` (a fix for one can break another: a pill painted
   behind a label passes the eye and fails contrast).
3. Verify any finding you call a false positive in a real browser, then fix the checker or say why.
4. Commit with the ranking, before → after, and what changed in the message.

Stop when every measured ranking is at least 95 (target 100), Lighthouse accessibility is 100, the
expert rankings meet their targets, and the design panel reaches its target (default 8.0).

## 4. Keep it

Add one regression test that pins what each round fixed (the markup and CSS hooks), and a table in
the project's agent guide: ranking, before → after. Name what was tried and dropped, and why.

## Rules

- Measure before and after every change; never report a score you did not re-run.
- A ranking you cannot run here (no Chrome, no network for the guidelines) is reported as not run,
  with the next step, never as passed.
- Report the design panel as blind agents' judgment against public criteria, not as an award; never
  report a score the changing agent gave its own work.
- Add no feature the product does not need; a look change keeps every measured ranking where it was.
