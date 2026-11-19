# Chat follow-up decision test with a verified service model

The first structured baseline stopped with an empty receipt. The running
local service uses a different model digest from the manifest on disk.
This separate cohort checks the model the service actually presents and
uses six other cases selected by an independent reviewer.

- **Hypothesis**: In the admitted six-case cohort, the no-rule baseline makes at least one error. A separately registered rule can reach 6 of 6, improve on the baseline by at least one decision, and respect both cases where the allowed action is HOLD.
- **Measurement**: Freeze the fixture, both protocol dependencies, runner, and the digest from the loopback service before requesting a decision. Reserve one unused private receipt. Request each of six actions in fixture order with the same no-rule prompt. Check the model digest immediately before and after generation.
- **Success**: Six valid scores and zero model drift qualify the baseline. A result below 6 of 6 permits one registered candidate. The candidate must reach 6 of 6 and improve by at least one.
- **Pivot**: A baseline of 6 of 6 permits no candidate because there is no gain to measure. Any incomplete or invalid run ends this cohort. Preserve the receipt. Do not retry this cohort or either earlier cohort. Any candidate error rejects the rule.
- **Anchor**: [Issue #821](https://github.com/fyodoriv/agentbrew/issues/821), [the retired baseline receipt](chat-followup-local-measurement-821.md#recorded-result), and [schema preparation](chat-rule-schema-pivot-821.md).

The running loopback service reported exactly one qwen3:4b tag with SHA-256
359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7.
No generation request was part of that metadata check. The schema and
metadata helper are unchanged. Keep the same two metadata, six generation,
10-second metadata, 60-second generation and 390-second run limits. Record
only the enum action, case ID and digests on success. Record only a fixed
failure stage when a request cannot be accepted. No real chat is read or sent.

The frozen independent fixture has SHA-256 27f3e62c1c74606dbdca3131035ceb3900c9f3bc9058b61cfec28916e4daceba.

## Baseline invocation

Use a new predesignated file in a private output folder and leave the other
receipts in place. The rule is absent from the prompt.

```sh
HEAVY_RUN_EXCLUSIVE_WAIT=2400 heavy-run --exclusive gtimeout 390 node \
  scripts/eval-chat-followup-821.mjs "$CHAT_FOLLOWUP_SERVED_RECEIPT" \
  105c568b5da28f1fe751c0877930631d85236633b104d5ba8eed8e42baabef1d
```

The frozen runner reports only one of six failure stages. It retains the
exclusive receipt after any admitted abort. The prior code remains available
at the recorded first-cohort commit.

## Baseline result

The run at c32748c7 exited 0 with four correct decisions out of six. The
served model digest matched before and after. Keep the private receipt with
SHA-256 4f3a3c464d94def699321c526fed2e98f8b78000dfe25c1e11a1df0f9f3e42e1.
The prior incomplete receipt stays closed.

## Candidate registration

The existing opt-in chat-merge-recent-message catalog rule covers recent
messages. The candidate clarifies destination, action permission and the
case where editing is unavailable. It uses the existing issue policy.
The text in scripts/chat-followup-candidate-821.txt was selected before
looking at per-case errors. Add this text to the existing prompt without
changing the six cases, grading, model, limits or response format.

- **Hypothesis**: The clarified rule raises the result from 4 of 6 to 6 of 6 and does not act in either HOLD case.
- **Measurement**: Reuse the exact cases and stable served model. Verify the complete baseline receipt against its hash before making a request. Reserve one new candidate receipt. Record only enums and score.
- **Success**: 6 of 6, at least one more correct than the frozen baseline, and zero wrong actions in HOLD cases.
- **Pivot**: Any wrong choice, invalid result, model drift or incomplete run rejects the candidate. Keep the current rule and both receipts. Do not retry the cohort.
- **Anchor**: Issue #821, the frozen served-model baseline and the existing opt-in rule in src/catalog.yaml.

Candidate text SHA-256 5ac5ea01fb2390374abd4a2cd605c6fef2022a51f69a13a8d8c218f0b1b2856b.

## Candidate invocation

Set `CHAT_FOLLOWUP_SERVED_RECEIPT` to the verified baseline file. Set
`CHAT_FOLLOWUP_CANDIDATE_RECEIPT` to the unused candidate file in a different
private output folder. The runner strips the final newline from the fixed
rule text and adds it before the unchanged baseline prompt.

```sh
HEAVY_RUN_EXCLUSIVE_WAIT=2400 heavy-run --exclusive gtimeout 390 node \
  scripts/eval-chat-followup-821.mjs --candidate "$CHAT_FOLLOWUP_SERVED_RECEIPT" \
  "$CHAT_FOLLOWUP_CANDIDATE_RECEIPT" \
  32914849e64f0f1f61fa7d368b3d63ea76f44a653345f7768a3edf4b3c995693
```

The runner rejects a changed baseline or rule before it reserves the
candidate. It preserves a complete candidate receipt even if the score
misses the threshold. Trial results use fictional inputs and do not
establish performance in a real workspace.

## Candidate result

The run at `00f40276` completed all six cases and kept the served model
digest stable. It scored 3 of 6 against the 4 of 6 baseline. It also
missed one of the two HOLD cases. The runner exited 1 under the
registered score rule. The baseline receipt still matches its recorded
hash. The separate completed candidate receipt has SHA-256
`bba0863683bbcde9b92fe05e3f878007365f41798a1fd1a5ea74af7e8de7a0bd`.

The candidate failed the registered threshold. Keep the existing opt-in
rule, keep both receipts, and close this experiment. It sent no chat
messages and did not measure real-workspace behavior.
