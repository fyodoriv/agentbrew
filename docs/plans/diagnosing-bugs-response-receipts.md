# Verify local debugging-skill comparison receipts

An earlier pinned comparison stopped on a combined model and completion
check. It retained no exact cause and no scored response. Keep that
attempt incomplete. This plan admits one new comparison with separate
provider receipts and a short answer limit.

- **Hypothesis**: The local model completes all 5 requests, including
  setup. The pinned diagnosing-bugs skill passes both synthetic decisions.
  The current systematic-debugging comparison passes at most 1 of 2.
- **Measurement**: Run the local comparison driver under `heavy-run`
  with Python. First request the single word READY and verify one complete
  receipt. Then run the two cases once per pinned skill. Use a blind
  review and the existing skill-creator aggregate.
- **Success**: 5 complete provider receipts on the pinned model identity.
  The candidate passes 2 of 2 full rubrics and the comparison passes at
  most 1 of 2. There are 0 unsupported execution claims.
- **Pivot**: Stop at the first incomplete receipt, unknown model, wrong
  candidate decision or tie. Preserve the first attempt and this result.
  Do not repeat a comparison to reach the threshold.
- **Anchor**: [Pinned upstream diagnosing-bugs skill](https://github.com/mattpocock/skills/blob/abeeaf95660ba9e8b7c753eb38f441ca707a8823/skills/engineering/diagnosing-bugs/SKILL.md)
  and Zeller 2009, *Why Programs Fail*.

## Fixed inputs

| Input | SHA-256 |
| --- | --- |
| Local qwen3:4b model | `359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7` |
| Installed systematic-debugging body | `51c6435d98c83c42c96ba7c35725a0b2c376cd487fb1a4e6bd0ddbe7e33ef202` |
| Pinned upstream diagnosing-bugs body | `849198df88cdb65fd0d97236604c1fca7ff2f22d2f705f9724a800d0266b118d` |

Use the localhost Ollama endpoint. Disable streaming and thinking. Set
temperature 0, seed 37582, context 8192 and output limit 1200 tokens
for the four responses. Request a short answer with at most 250 words.
Cap the setup response at 64 tokens. Require the exact model ID, a
finished request, stop reason and nonempty answer separately. Recheck
the digest after setup and after the final response.

Case A supplies two identical seeded failures at a cache TTL boundary.
Require exact repeated evidence and three to five ranked falsifiable
hypotheses with observable predictions before any edit. Case B starts
with an intermittent report and an unrun CLI fixture. Require the
specified command, precise failure condition, a plan for repetition,
no premature hypothesis or edit claim, and no claim of executing it.
Use the same case text, prompt limits and runtime settings for both
skills. The private review file gives the reviewer anonymous responses
grouped by case. Reveal the variants only after scoring.
