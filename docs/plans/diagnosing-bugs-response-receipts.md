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

## Observed setup result

The setup request reported the matching model, a finished response and
stop reason. It returned 40 words when the plan required the single
word READY. The driver exited 1 at the setup check. No comparison
response was requested and there is no behavior score. The catalog
decision remains open.

## Check structured setup, then compare the untouched cases

The earlier setup checked literal prose even though the transport
and model identity were correct. Resume the comparison from setup.
The two original cases and both skill bodies stay pinned.

- **Hypothesis**: A fixed JSON schema gives one exact setup receipt.
  The original four scored requests can then run once each.
- **Measurement**: Run the previous local driver under `heavy-run`.
  For setup only, use the Ollama chat `format` schema with one field
  and allowed value `{"status":"READY"}`. Check that exact object
  and the existing provider/model receipt. Keep the original two
  cases, model digest, seed, prompt, options and blind rubric.
- **Success**: 1 structured setup object and 4 complete case receipts.
  The original rubric still requires 2 of 2 candidate passes, at most
  1 of 2 comparison passes, and 0 unsupported execution claims.
- **Pivot**: Stop on 1 failed setup result or incomplete case receipt.
  Once both groups run, a tie or any wrong candidate decision keeps
  the catalog task open.
- **Anchor**: [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
  and the preserved setup receipt above.

## Structured receipt result

Setup returned the exact JSON object from the matching model and
reported a normal stop. The first comparison request reached its
1,200-token limit after returning 959 words despite the 250-word
instruction. The driver stopped and produced no graded response in
either group. Preserve the result as incomplete.

## Check the same comparison on a plain-answer local model

Use installed Llama 3.1 8B as an independent transport and runtime
control for the incomplete Qwen responses. Do not change either case
or grading threshold.

- **Hypothesis**: A local model without a separate reasoning-response
  mode completes 1 structured setup and all 4 bounded case replies.
- **Measurement**: Pin the installed `llama3.1:8b` model digest from
  the local tags endpoint. Use the structured driver, the same skill
  inputs, cases, prompt, seed, temperature and limits. Omit the think
  setting for this model. Grade all complete case pairs against the
  same blind rubric.
- **Success**: 5 complete matching receipts in 1 comparison. Apply
  the existing 2-of-2 candidate and at-most-1-of-2 comparison
  thresholds, with 0 unsupported execution claims.
- **Pivot**: One incomplete case or one unsupported claim leaves the
  task unqualified. A tie at the end also leaves it unqualified.
- **Anchor**: [Ollama chat response fields](https://docs.ollama.com/api/chat)
  and both preserved local Qwen receipts above.
