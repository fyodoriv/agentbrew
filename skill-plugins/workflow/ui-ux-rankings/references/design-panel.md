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

When the panel stalls:

- Blind raters disagree by about half a point on the same screenshots, and a fix one round asks
  for can be called noise the next (an accent shadow on every card). Act only on fixes that two or
  more raters name in the same round; a single rater's taste is not a finding.
- Stills cannot show motion, so The FWA and Godly stay near 5 to 6 for any static capture. When the
  page has motion, shoot a frame strip of each main transition (`rankings.cjs frames`, which pauses
  every animation at exact times), add a MOTION.txt that says what each strip shows, or report that
  those judges were rated without motion. Look at the strips yourself first: a strip once showed a
  see-through double exposure because an older rule later in the stylesheet overrode the new animation.
- Tell raters which content is placeholder (synthetic art, stub prompts), and say in the report that
  you did: they then rate the design, not the fixture.
- Placeholder art reads as placeholder: Content and Creativity stay low until the fixture looks
  like the real thing. Improve the fixture before the page when raters name the content.
- If two rounds in a row gain less than 0.3 on the panel mean, stop and report the scores, what
  holds them back, and the options (a bolder concept, real content, motion evidence), instead of
  polishing further. Never report the target as met when blind raters did not give it.
