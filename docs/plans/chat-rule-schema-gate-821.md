# Chat schema controls: local gate registration

The ten schema controls are Node tests. The current ordinary gate does not
discover that file, so a future broken parser could pass the gate. Goal: make
the local gate reject missing or invalid schema-control evidence. Predict the
four fixed gate controls go from unsupported to 4/4, while all ten protocol
controls and all sixteen existing receipt controls remain passing.

Before editing the gate or its TAP parser, add `scripts/chat-rule-schema-gate.test.mjs`
with these four ordered names: `schema gate included`, `complete schema report
accepted`, `missing duplicate or skipped schema rejected`, and `forged schema
summary rejected`. The first reads the real local gate definition. Reproduce
the first failure with the fixed diagnostic `missing schema gate step`:

```sh
bash <<'BASH'
log=$(mktemp) || exit 2
trap 'rm -f "$log"' EXIT
heavy-run node --test --test-reporter=tap --test-name-pattern='^schema gate included$' scripts/chat-rule-schema-gate.test.mjs >"$log" 2>&1
status=$?
[ "$status" -ne 0 ] && grep -Fxq 'not ok 1 - schema gate included' "$log" && grep -Fq 'missing schema gate step' "$log"
BASH
```

Extend the existing strict named-TAP parser rather than replacing receipt
validation. Add one uncached local gate step and a foreground runner. The
runner must check four unique gate passes and exactly ten ordered protocol
passes, with zero failures, skips, cancellations or todos. Missing, duplicate,
forged, skipped or extra evidence must refuse. The original sixteen receipt
controls and their existing gate remain unchanged. Preserve the original
16-case parser export and CLI semantics. The runner uses pipefail, propagates
Node, parser and tee failures, and stops on the first mismatch. Both reports
must have exact plans, counts and unique named results; reject duplicate,
extra or conflicting summaries. Gate tests inspect synthetic reports and the
gate source only; they never recursively invoke the runner. Protocol tests
retain their network sentinels. No model or network call is permitted by these
controls. Hosted CI is a separate unqualified route.

Measurement after implementation:

```sh
JOBS=1 heavy-run bash scripts/run-chat-rule-schema-controls.sh
JOBS=1 heavy-run bash scripts/run-chat-rule-controls.sh
```

The first runner must independently require each of the four named controls
and each of the ten protocol controls; a mere zero Node exit is insufficient.
Then run the ordinary full gate with `VERIFY_PLAN` unset on the final tree.
Success requires 4/4 gate controls, 10/10 protocol controls, 16/16 existing
receipt controls, and a 22-step full gate. Any accepted incomplete or forged
report, undiscovered test, changed receipt control or gate regression rejects
this approach. No live model result follows from it.

The predicted base is Agentbrew `8ae30923e6d2c564a3ba8f98c86bfed54d25f318`,
whose local gate has 21 steps. Recheck the step count after a base change;
register a new prediction if that count changes.

Anchors: existing `scripts/chat-rule-tap.mjs` gate contract; Basili, Caldiera
and Rombach (1994), Goal Question Metric; Munafò et al. (2017), preregistration.

The named missing-gate control failed before the change. The dedicated runner
passed four gate controls and ten protocol controls; the existing sixteen
receipt controls also passed. The full 22-step gate remains required.
