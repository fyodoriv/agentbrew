# Chat follow-up decision test with a verified service model

The first structured baseline stopped with an empty receipt. The running
local service uses a different model digest from the manifest on disk.
This separate cohort checks the model the service actually presents and
uses six other cases selected by an independent reviewer.

- **Hypothesis**: In the admitted six-case cohort, the no-rule baseline makes at least one error. A separately registered rule can reach 6 of 6, improve on the baseline by at least one decision, and respect both cases where the user must approve a change first.
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
