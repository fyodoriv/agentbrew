# Comfort patterns: build to the budget from the start

Patterns that measurably raised the rankings on a real app (sidequest, 2026-10-22). On that app,
audit findings went from 60 to 0, small text from 207 to 0, and taps for the everyday jobs from 9
to 6. A blind judge preferred the new design on 16 of 17 screens. Use them while you build, not
only when you audit. Each pattern names the ranking it moves.

## The comfort budget

Pin it as a test in the repo's gate, on phone and desktop, light and dark:

| Check | Budget |
|---|---|
| Serious or critical axe problems, every view | 0 |
| Touch targets under 44 px on a phone | 0 |
| Text under 14 px | 0 (body 16 px) |
| Views that scroll sideways | 0 |
| Taps per everyday job | a number per job, asserted (for example rate 1, vote 1, add 2) |

## Layout and navigation

- **Home is what needs the user.** The first view opens on a short list of one-tap answers (rate,
  "did you go?", vote, approve). Cap it at about 4 rows plus one "N more" link, so a busy month
  never buries the view. Moves: task time, Nielsen (visibility, recognition).
- **Phones get a bottom tab bar** with 4 or 5 primary views. The rest go in a "More" sheet of
  tiles, plus a chip row of sibling views inside each More view, so siblings are one tap apart.
  **Desktop gets a sidebar** with every view. Drive both from one list.
- **One add button everywhere.** A "+" opens the main create sheet on every view but the one that
  already has an inline composer.
- **The view title sits in the top bar**, and the context switcher (who, which project) is a pill
  there too. Developer controls (fetch, pause, debug) move to their own view, out of the header.
- **Sheets for choices.** A bottom sheet on phones and a centered panel on desktop, with a
  labelled dialog, Escape to close, and focus on its first input.

## Content

- **Show only the controls the item's state needs.** For example: "how was it?" only for past
  items, votes only for open ideas. Put rare actions behind a "⋯" button. A card with every
  control on it was about 40% longer and lost every blind comparison.
- **Group repeats.** One card per place, listing the dates it fits, instead of the same place
  under every date.
- **Cap long lists** at the top 10 to 15 items, then a "Show N more" button. Real lists (100+
  items) hide this need from the demo data.
- **Friendly dates** ("Tue Mar 12", "Apr 5–7", "in 3 days"), never ISO strings in the UI. Read
  ISO dates as calendar days, not shifted by the browser's time zone.
- **Empty states shrink.** An empty month or section is one quiet dashed line, not a full card.
- **Tidy source text at intake.** For example, title-case shouting ALL-CAPS titles in one place,
  keyed so ids do not change.

## Touch, type and color

- **Inline links get an invisible tap area:** `display: inline-block; padding: 12px 0;
  margin: -12px 0`. The link reaches 44 px without moving the layout.
- **Icon-only buttons** are 44 × 44 px and carry an `aria-label`. Flex rows shrink small buttons:
  give them `flex: none`.
- **Tiles with a hint line** get `aria-label` (the name) plus `aria-describedby` (the hint), so the
  accessible name stays the short name that tests and screen readers expect.
- **Pick the accent by measured contrast:** white text on the accent, and the accent on the page
  background, both at least 4.5:1, in each theme. Bright orange and yellow fail; use a burnt or
  deep shade in light mode and a light shade in dark mode. Keep semantic colors (good, warning,
  bad) apart from the accent hue, each with its own soft background.
- **Line icons inline** (one small SVG map, 24 px grid, 2 px stroke), not emoji, in navigation.

## Motion

- Animate a view in from a visible resting state, and honor `prefers-reduced-motion`.

## Measuring right

- **Audit the settled screen.** Run axe with reduced motion on, after the view has loaded. A view
  that is still fading in reads as low contrast and fails at random.
- **Wait for the state, not for luck.** Playwright's `isVisible()` does not wait. Before a helper
  branches on "desktop or phone navigation", wait for the navigation to be visible, or the
  loading screen sends it down the wrong path.
- **Count taps in a test.** Wrap `click()` in a counter per job, and assert each job's budget.
  Run it first in the suite when it needs fresh demo state.
- **Judge pairwise and blind.** Give a fresh agent before and after screenshots as A/B pairs in
  random order. Keep the key in a folder it does not read, score its verdicts against the key, and
  report "preferred on N of M screens". Then fix the real issues it names.
- **Look at real data last,** read-only, on a scratch copy of the owner's data served locally. Never
  send it anywhere, and never commit its screenshots. Large real lists, ALL-CAPS titles and
  crowded "needs you" queues showed up only there.
- **Crop phone screenshots to the device viewport** (iPhone 13 = 390 × 664) for reports.
  Full-page shots put fixed bars mid-image.
