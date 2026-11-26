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

The Promptfoo artifact workflow checks configured source patterns. The
independent reviews measure how readers turn this skill-level prompt into
individual actions.

## Observed agreement

The earlier prompt produced counts of 6, 4, and 4. Each reader identified
the last planning clause as the source of ambiguity. The revised prompt
produced counts of 6, 6, and 6 with the same action boundaries. The fixture
uses six open actions as the baseline and zero as the target.
