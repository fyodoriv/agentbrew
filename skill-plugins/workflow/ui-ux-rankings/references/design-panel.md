# Design panel: rate a page as ten design-award and gallery sites would

Rate from the `shots` screenshots (phone and desktop, light and dark), each judge by its own published
criteria. Score 0 to 10 with one decimal; the panel score is the plain mean. This is one agent's
judgment against those criteria, never a jury's verdict: say so when you report it.

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
- Name the two lowest judges and the one change that would lift each. Make that change, re-shoot,
  re-rate. Stop at the target (default 8.0).
- Never raise the design score by lowering a measured ranking. Re-run `rankings.cjs all` after every
  look change; a measured ranking that drops below 100 is fixed before the next rating. An effect a
  checker cannot see (a pill painted behind a label, text in a pseudo-element) is a red flag: prefer
  one that keeps the measured rankings true.
- Keep scope: a look change adds no feature the product does not need.
