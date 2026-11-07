# Chat schema runner: synthetic gate discovery

Goal: make the ordinary local gate reject missing or invalid evidence from
the 13 synthetic runner controls. Predict that four gate controls improve
from unsupported to 4/4, while the 13 runner, 10 schema and 16 receipt
controls remain passing. This is test-only preparation; it does not qualify
the caller-supplied transport or bindings for a live experiment.

Before editing the gate or TAP parser, add four tests named `runner gate
included`, `complete runner report accepted`, `missing duplicate or skipped
runner rejected`, and `forged runner summary rejected`. The first inspects
the real local gate and must fail with `missing runner gate step` before the
change. The other tests use synthetic TAP reports only. Extend the existing
strict named-TAP parser. Add a foreground gate step that checks exactly the
four gate controls and 13 named runner controls, including zero failures,
skips, cancellations and todos. Reject duplicate, missing, extra or forged
evidence. Preserve the existing schema and receipt gate contracts.

Measurement: run `JOBS=1 heavy-run bash scripts/run-chat-schema-runner-controls.sh`,
`JOBS=1 heavy-run bash scripts/run-chat-rule-schema-controls.sh`, and
`JOBS=1 heavy-run bash scripts/run-chat-rule-controls.sh`, then run the ordinary
unfiltered `NO_CACHE=1` full gate with `VERIFY_PLAN` unset. The expected gate
is 23 steps on a 22-step base. Success requires 4/4, 13/13, 10/10 and 16/16
controls and a passing full gate. Any accepted invalid report, missing test,
changed old contract or full-gate regression rejects this approach. Do not
call a model or read the sealed case artifact in these controls.

Anchors: the existing schema gate contract; Basili, Caldiera and Rombach
(1994), Goal Question Metric; Munafò et al. (2017), preregistration.
