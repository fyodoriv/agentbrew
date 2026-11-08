# Judge learnings

Read before a judge run; add one dated line after it. Fold a learning that holds twice into
[design-judges.md](design-judges.md) or `scripts/judge.mjs`, with a test.

| Date | Page | What happened | Learning |
|---|---|---|---|
| 2026-11-08 | sidequest Gifts | Free 0-10 scores from 10 blind judges: 5.0, 6.0, 6.0, 6.2, 6.25 over five rounds, through a structural redesign; 0 judges at 8 | Free scores stall near 6 and every judge names exactly the asked-for 5 issues. Score by issues with a rubric, ask for "at most 8, or NONE", and pass settled decisions |
| 2026-11-08 | sidequest Gifts | Round 5 asked for a filled Keep on every row; round 6 called the same filled Keeps too loud | Judges flip on one element between rounds. Settle splits in `decisions.txt` and pass it to every judge |
| 2026-11-08 | sidequest Gifts | Judges flagged an icon-only button as "unlabeled" though it had an aria-label and a title | Screenshots hide labels and tooltips: say in `context.txt` which icon buttons carry a label, or show a visible word |
| 2026-11-08 | sidequest Gifts | Issue-scored panel, round 1: mean 8.15, 9/10 at 8+; the product lens alone gave 5.8 (3 majors: no visible outcome of Keep, no in-time delivery cue, taste contradicting history) | The product lens finds goal-level gaps the visual lenses miss; fix its majors first. Check each new layout on the phone shots yourself: a nowrap fix pushed the subtitle off screen |
