# Judging protocol: one set of rules for every judge panel

The design panel ([design-panel.md](design-panel.md)) and the principal judges
([design-judges.md](design-judges.md)) follow these rules. Those files say only what each panel
rates and how to score it. When they seem to disagree, this file wins.

## Why one protocol

Two panels with their own rules contradicted each other and themselves. In one 30-round run on two
tool pages, raters asked to remove a "No reason recorded" line in round 21 and asked for it back in
round 22. Toolbar shadows were asked heavier and lighter in turn. The two files also had three
different stop rules. Published practice for LLM judges points the same way:

- **LLM-as-a-judge** (Zheng et al., NeurIPS 2023, MT-Bench): judges show position, verbosity and
  self-preference bias. Use judges that did not build the work, keep them blind to earlier scores,
  and prefer pairwise comparison when absolute scores stop moving.
- **G-Eval** (Liu et al., EMNLP 2023): a fixed rubric and stated criteria make scores steadier than
  a free number.
- **UICrit** (Duan et al., UIST 2024): critiques that name a region and follow a rubric match
  designers better. Score from issues, not from a guess.
- **Heuristic evaluation** (Nielsen 1994): several independent evaluators with severity ratings,
  merged, find more problems than one.
- **Inter-rater agreement** (Krippendorff's α): when blind raters differ by about half a point, a
  change smaller than that is noise.

## The rules

1. **Blind and fresh.** The agent that changed the page never judges it. New judges every round.
   A judge sees the rubric, the screenshots, `context.txt` and `decisions.txt`, never scores,
   targets or history.
2. **One ledger: `decisions.txt`.** One line per settled decision: the round, then a direction
   verb, the element, and how many judges asked ("R21: removed the 'No reason recorded' line
   (3 of 3)", "R24: asked and declined: darken the toolbar shadow (1 of 3)").
   Add fixture facts the page cannot change ("the fixture has no written reasons"). It holds no
   scores. Every judge of every panel gets the same file.
3. **Fixes carry a direction.** Every fix starts with a direction verb (add, remove, show, hide,
   increase, reduce, enlarge, shrink, darken, lighten, emphasize, quiet, move, change).
   `judge.mjs prompt` asks for it, and design-panel raters use the same `ISSUE:` line.
4. **Check conflicts before you build.** Save each reply as `<round>/<judge>.txt`, then run
   `node scripts/judge.mjs conflicts <round>`. It exits 1 and lists every pair of opposite asks
   on one element in the round, and every ask that reverses a ledger line. Build none of them.
   Settle each one with a ledger line ("asked and declined: darken toolbar shadow; R24 split 1:1").
   Reverse a ledger line only for a hard flaw (overlap, cut-off or unreadable text, a broken phone
   layout) that you can see in the named screenshot yourself, and write a superseding line.
5. **Consensus only.** Build fixes that two or more judges name in the same round, worst first,
   at most one fix per element class (edges, chips, type) per round. One judge's ask is taste,
   unless it is a blocker you can see. A fix that asks only for different fixture content is a
   fixture fact, not a page change.
6. **Target from a reference.** Before round 1, the same kind of blind judges rate one or two
   best-in-class pages of the same type. The target is that reference mean minus 0.3 (or the
   owner's number, if lower). A fixed 8.0 can ask for more than the best product gets.
7. **One stop rule.** The noise band is ±0.3 on the panel mean.
   - After two rounds in a row inside the band, stop polishing. Run one structural round instead:
     build two real alternatives (layout, main motif, motion) and let new judges compare them
     side by side (pairwise). Keep the winner.
   - If the structural round also stays inside the band, stop. Report the scores, the reference
     ceiling, and the lever CSS cannot pull (content, motion, a new concept). File open notes as
     one task with a numeric goal.
   - Budget: 8 rounds per page, structural round included.
   - Never report a target as met unless this round's judges gave it.
8. **Cheap rounds.** Look at every shot yourself before you pay for judges: a broken layout
   wastes a round. Re-run `rankings.cjs all` after each look change; fix any measured ranking
   under 100 first. Give each judge agent at most five lenses, a 20 minute limit, and a watchdog.
   Make it read every shot and end with the count it read; rerun a reply whose count is short.
9. **Learn.** After each run, add a dated line to [judge-learnings.md](judge-learnings.md). A
   learning that holds twice goes into this file or `judge.mjs`, with a test.
