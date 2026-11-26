# Count each follow-up once in case 384

- **Hypothesis:** Listing each action on a separate line lets independent
  readers count the same six follow-ups without guessing how to split a
  combined planning clause.
- **Measurement:** Give three readers only the two prompt variants. Record
  each reader's count and follow-up boundaries. Compare case 384 and the
  unchanged cases before running the normal hosted check.
- **Success:** All three readers identify the six distinct actions in the
  revised prompt. The expected baseline is six and the target is zero.
  Every other case stays byte-for-byte as it is.
- **Pivot:** If fewer than two readers agree on the revised prompt, split
  the scenario by expectation and verify the resulting counts separately.
- **Anchor:** Cohen 1960, *A coefficient of agreement for nominal scales*,
  and the original task `run-goal-eval-384-one-follow-up-per-line`.

The Promptfoo artifact workflow checks source patterns. It has no direct
case for this fixture and cannot measure agreement about its prompt. Use
this blinded count check for the ambiguity. A count check does not run
the complete goal workflow or prove any delivery behavior.
