# Principal judge panel: blind expert review that scores by issues

Use this panel when the goal is "would principal UI engineers approve this page?". The design
panel ([design-panel.md](design-panel.md)) rates the look as award sites would; this panel rates
whether the page is ready to ship. Run both when a page is new; run this one each round.

## Why issues, not a free score

Free 0-10 scores from LLM judges stall. In one run (2026-11-08, sidequest Gifts) ten blind judges
gave 6 in four rounds out of five, through a full redesign. Each judge always named five issues,
and round to round they asked for opposite fixes (make row buttons primary, then make them quiet).
Research points the same way:

- **UICrit** (Duan et al., UIST 2024, arXiv 2407.08850): 3,059 critiques by seven designers on 983
  screens. A rubric turns critiques into scores; few-shot examples and visual prompting
  (pointing at the region) lifted LLM critique quality by 55%. Reused here: the score follows
  from the issue list by a fixed rubric, and each issue names its screenshot and element.
- **UIClip** (Wu et al., UIST 2024): a learned quality score agrees with designer rankings better
  than prompted LLMs. Learned: an LLM's number alone is weak evidence; keep the issue list.
- **PerceptUI** (2026, arXiv 2606.05697): human designer critiques score about twice as well as
  zero-shot frontier models on UICrit. Learned: a stalled panel is a reason to ask a human, not
  to polish more.
- **DesignPref** (2025, arXiv 2511.20513): designers disagree; majority votes hide personal taste.
  Reused: act on consensus only, and let the owner's settled decisions overrule a judge.
- **Nielsen 1994, heuristic evaluation**: several evaluators find more problems than one, with
  severity ratings. Reused: severity per issue, several lenses, one evaluator per lens.
- Multi-judge skills seen in the wild (neolabhq `critique`, camacho `plan` panels, madappgang
  `ui-design-review`): parallel reviewers and votes, but free-form scores. Learned from, not
  wrapped: none scores screenshots by a rubric.

## How to run a round

1. **Shots.** `rankings.cjs shots` (or the repo's script) for phone and desktop, light and dark,
   on realistic data. Look at every shot yourself first; fix a broken layout before you pay for
   judges.
2. **Context and decisions.** Write `context.txt` (what the page is for, who uses it, in 3-5
   lines) and `decisions.txt` (choices the owner settled, one per line, such as "row Keep stays
   quiet while the card is up"). Every judge gets both. A judge's fix that contradicts a decision
   is dropped, not done. Add a line to `decisions.txt` whenever you settle a split between judges.
3. **Judges.** One fresh subagent per lens (`node scripts/judge.mjs lenses`; 10 lenses), each
   given only `node scripts/judge.mjs prompt --lens <l> --shots <dir> --context context.txt
   --decisions decisions.txt`. Never name earlier scores, the target, or history. New judges every
   round. Save each reply to `<round>/<lens>.txt`. Start them in batches of 4-5 when the machine
   caps agent starts.
4. **Score.** `node scripts/judge.mjs score <round>`: per-judge score (10 minus 2.5 per blocker,
   1 per major, 0.3 per minor; a blocker caps the judge at 6), the mean, the minimum, how many
   judges reach the target, and the consensus list (issues two or more judges name). Exit 0 only
   when every judge reaches the target.
5. **Fix.** Fix consensus issues, worst weight first. A one-judge issue is taste unless it is a
   blocker you can see in the shot yourself. Re-shoot, then a new round.

## When it stalls

- Two rounds that gain less than 0.3 on the mean: stop polishing. Change the layout concept, or
  ask one human designer and add their points to `decisions.txt`.
- A mean within ±0.3 over three rounds is noise, not a gain or a regression. Stop polishing and
  stop judging: file the open notes as one checklist task with a numeric goal. (Held twice:
  cashcast and sidequest.)
- A guard test checks the state the user sees (scrolled, phone and desktop), and a layout change
  keeps the same content on desktop and phone. Tests copied from a judge's wording are easy to game.
- Judges flip on the same element: settle it in `decisions.txt` and keep it.
- Never report the target as met unless `score` printed it for this round's judges.

## Learn

After each run, add a dated line to [judge-learnings.md](judge-learnings.md): what moved the
score, what did not, and any prompt or rubric change. Read that file before the next run, and
fold a learning that holds twice into this file or the script, with a test.
