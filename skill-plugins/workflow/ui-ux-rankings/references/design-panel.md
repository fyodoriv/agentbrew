# Design panel: rate a page as ten design-award and gallery sites would

Rate from the `shots` screenshots (phone and desktop, light and dark), each judge by its own published
criteria. Score 0 to 10 with one decimal; the panel score is the plain mean. This is agents' judgment
against those criteria, never a jury's verdict: say so when you report it.

**The agent that changed the page never scores it.** Its own scores ran 1.5 to 2.5 points above
blind raters' on the same screenshots. Rate with three blind raters: fresh subagents that read only
this file and the screenshots (copy both to a new folder; name no earlier score, no history, no
target), each with a different reviewer stance (an independent critic, a strict Awwwards/CSSDA
juror, a Mobbin/Land-book/Webby curator). The panel score is the mean of their means; their
"top fixes" are the next round's work. Use new raters each round, so none anchors on its last score.

**Screenshots come from realistic data.** Raters judge what they see: three one-panel pages or one
item per group read as empty and broken. Build the fixture at real size (a full book, a day of
work, a long list) before rating.

| Judge | What it rewards | How to score |
|---|---|---|
| Awwwards | Design 40%, Usability 30%, Creativity 20%, Content 10% | weighted mean of the four |
| CSS Design Awards | UI, UX, Innovation, equal | mean of the three |
| The FWA | craft, innovation, motion, a memorable idea | one score; a plain static page sits near 5 |
| Webby Awards | content, structure and navigation, visual design, functionality, interactivity, overall experience | mean of the six |
| CSS Winner | clean layout, typography, color | one score |
| SiteInspire | restraint, craft, a clear system | one score |
| Godly | bold, current aesthetics, motion, a point of view | one score |
| Land-book | polish, hierarchy, whitespace | one score |
| Lapa Ninja | a consistent visual system, spacing, components | one score |
| Mobbin | app-UI patterns users already know, states, edge cases | one score |

**Pick the judges that fit the page.** The table suits marketing, portfolio and launch pages. A
work tool (an editor, a catalogue, a dashboard, a review queue) is not built to win The FWA or
Godly: those reward spectacle, so they hold a good tool near 6 and the mean near 7 forever. In one
run, thirty rounds on two tool pages stayed at 7.0-7.2 for this reason. For a tool page, swap The FWA,
Godly and CSS Winner for app judges with published criteria: Apple Design Awards (Interaction,
Delight, Inclusivity), Nielsen's ten heuristics, and Material/HIG component fit. Say which panel you
used in the report.

**Calibrate before you iterate.** Before round 1, the same blind raters rate one or two reference
pages of the same type that people call best in class (screenshots of a well-known product's
equivalent view, both themes). The reference's blind mean is the realistic ceiling: set the target at
the reference mean minus 0.3, not a fixed 8.0. If a reference scores 7.5, a target of 8 asks for
more than the best product in the field gets from these raters.

**Make each round count:**

- Ask raters for fixes with an expected gain ("+0.3 on Mobbin and Land-book") and build the largest
  first. Cap a round at one fix per element class (edges, chips, type), so raters do not later call
  the page "too much of X".
- After three rounds that each gain less than 0.15, stop CSS polish and run one structural round:
  build two real alternatives (a new layout, a new main motif, real motion), shoot both, and let
  new raters pick and score them side by side. Keep the winner, or stop.
- Budget: about 10 rounds per page. Past that, report the scores, the reference ceiling and the
  structural options instead of polishing.

Anchors, so the scale means the same each time:

- **5**: works and is clean, but generic: default controls, no identity, no state polish.
- **7**: a coherent system (one accent, consistent radius and spacing, real hierarchy), good states.
- **8**: the system plus identity (a mark, a motif that fits the content), considered motion that
  respects Reduce motion, and no rough edge in any of the four screenshots.
- **9+**: a memorable idea that serves the user, executed without a flaw. Rare; say why.

Rules:

- Rate what the screenshots show at both sizes and in both themes. A flaw in one of the four caps every
  judge at 7 (overlap, cut-off text, a broken phone layout).
- Ask each rater for the three changes that would lift the lowest scores most, naming screenshot
  and element. Fixes that two or three raters name come first. Make that change, re-shoot,
  re-rate. Stop at the target (default 8.0).
- Never raise the design score by lowering a measured ranking. Re-run `rankings.cjs all` after every
  look change; a measured ranking that drops below 100 is fixed before the next rating. An effect a
  checker cannot see (a pill painted behind a label, text in a pseudo-element) is a red flag: prefer
  one that keeps the measured rankings true.
- Keep scope: a look change adds no feature the product does not need.

Raters never contradict the panel's earlier decisions:

- Keep a **decision ledger** (`DECISIONS.md`) and copy it into every rater folder with the rubric. One
  line per decision: the round, what was built or removed, and how many raters asked (for example
  "R21: one failure tag per card; the extra 'No reason recorded' line removed (3 of 3)"). It holds
  decisions, never scores, so raters stay blind to the numbers.
- Add **fixture facts** to it: what the raters cannot change and keep asking about (for example "the
  check names are the judge's own names; a take fails when any one check fails, whatever its total
  score; the test fixture has no written reasons").
- The rater prompt says: "Read DECISIONS.md. Do not ask to reverse a decision in it. You may name a
  decision only when it causes a hard flaw (overlap, cut-off text, unreadable text, a broken phone
  layout) and you name the screenshot and element. Do not mark the page down for a fixture fact."
- **Fix the judges every round, before you build.** Check each top fix against the ledger and the
  other raters. A fix that reverses a ledger line without a named hard flaw, or that two raters ask
  for in opposite directions in the same round, is not built: log it in the ledger as "asked and
  declined (reason)", and sharpen the prompt or the fixture facts so the next raters do not ask it.
  A fix that asks only for different fixture content is a fixture fact, not a page change.
- Then build the remaining fixes that two or more raters name, add each one to the ledger, re-shoot,
  and rate with new raters. A round counts toward the stop rule only when it built its shared fixes.

When the panel stalls:

- Blind raters disagree by about half a point on the same screenshots, and a fix one round asks
  for can be called noise the next (an accent shadow on every card). Act only on fixes that two or
  more raters name in the same round; a single rater's taste is not a finding.
- Without a ledger, raters flip at the plateau: in one 22-round run, round 21 asked to remove a
  "No reason recorded" line and round 22 asked for it back, and the toolbar shadows were asked
  heavier and lighter in turn. Nine rounds of built fixes stayed near 7.0. The ledger above stops that.
- A ledger stops reversals, not the plateau. In the same run, rounds 23-30 kept the judges consistent and
  built every shared fix, yet means stayed within 0.1 (about 7.1 and 7.0). Then raters began to
  oppose whole classes of fix ("every box has an ink edge, too busy" next to "add the ink edge here").
  Five flat rounds with a consistent ledger is a real stall: stop and report it, and name the
  lever CSS cannot pull (the content, the motion idea, a new layout).
- When a ledger decision leaves a new flaw that 3 of 3 raters name (a card cut to fit its content left a
  dead band beside it), write a superseding ledger line that settles both asks. Do not flip back.
- Check each fix in the shot before you spend raters: in one run, an older rule with higher specificity
  silently beat three new blocks (`.tile.tile:has()` at 0,5,0), and a parent's `flex-basis:100%` kept
  a "fit to content" card full width.
- Stills cannot show motion, so The FWA and Godly stay near 5 to 6 for any static capture. When the
  page has motion, shoot a frame strip of each main transition (`rankings.cjs frames`, which pauses
  every animation at exact times), add a MOTION.txt that says what each strip shows, or report that
  those judges were rated without motion. Look at the strips yourself first: a strip once showed a
  see-through double exposure because an older rule later in the stylesheet overrode the new animation.
- Tell raters which content is placeholder (synthetic art, stub prompts), and say in the report that
  you did: they then rate the design, not the fixture.
- Placeholder art reads as placeholder: Content and Creativity stay low until the fixture looks
  like the real thing. Improve the fixture before the page when raters name the content.
- A realistic fixture can lower the score. After 17 rounds near 7 on placeholder art, a model-drawn
  realistic fixture moved two pages down (7.2 to 6.7, 6.8 to 6.2): Content and Creativity rose from
  about 5 to 6.5-7, but with real art the raters looked at the layout and capped every judge at 7
  for flaws the placeholder had hidden (a phone spread that used half the width, cut-off captions).
  Treat that drop as a list of findings, not a regression of the page. Re-baseline on the new
  fixture, and compare later rounds only with that new baseline.
- Rate every view mode, not only the default. Stills of one view hid that Page and Grid views filled only
  the top 60% of each page; a motion strip per mode showed it, and all three raters named it at once.
- Raters cap every judge at 7 for a flaw inside the content too (a doubled frame or stray balloon tail in a
  drawn picture). Page CSS cannot fix that, so a fixture with such flaws holds the panel near 7. Clean the
  fixture before you chase the last point.
- A state the page shows only for judged data needs judged data in the fixture. When most items carry no
  verdict, raters ask for verdicts on every card; check the fixture's pipeline ran before you redesign.
- Serve the shots from a threaded server with a large backlog on a free port. Python's `http.server`
  drops requests under parallel shots (broken pictures read as flaws), and a port already in use serves
  another app's page. `rankings.cjs` waits for on-screen pictures and reloads broken ones, bypasses the
  page's CSP so axe can run, and skips items in a closed `<details>`.
- If two rounds in a row gain less than 0.3 on the panel mean, stop and report the scores, what
  holds them back, and the options (a bolder concept, real content, motion evidence), instead of
  polishing further. Never report the target as met when blind raters did not give it.
