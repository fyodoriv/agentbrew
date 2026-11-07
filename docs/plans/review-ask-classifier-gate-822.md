# Reviewer classifier gate discovery

The ten synthetic classifier controls live outside `hooks/checks`, so the
existing hook-fixture gate does not discover them. Predict one discovered
wrapper, 10/10 named classifier passes and 6/6 synthetic wrapper controls,
with zero skips and nonzero propagation for failed or incomplete reports. The existing consumer
suite must still pass.

Commit this prediction before adding the wrapper. Confirm the current
`hooks/checks/review-request-classifier.test.sh` is absent; that is the
registered missing-discovery observation, not a classifier result. Add a
foreground Bash wrapper in that exact path. It must invoke the ten-control
Python test, propagate its exit, require every exact named `ok` line once,
require `Ran 10 tests` and `OK`, and reject skips or extra/missing cases.
Resolve the Python test from the wrapper's own location, not the caller's
working directory. Use Bash 3.2 and BSD tools; fail closed if Python, the test
file, or the report is unavailable. Reject duplicate, extra or conflicting
results and summaries. The existing `scripts/run-hook-fixtures.sh` discovers
`*.test.sh` files in that directory. Do not add a hook or contact a model,
GitHub or chat.

Add a second discovered synthetic wrapper-control script. Use a private
scratch PATH containing a fake `python3` that returns fixed test reports.
Require six distinct controls: valid report accepted; nonzero child exit,
missing case, skipped case, extra case and forged summary each refused.
The controls may not alter the real interpreter or owner environment.
They run the wrapper from a different scratch working directory to test its
path resolution. Both scripts use only Bash 3.2 and BSD tools.

Measurement:

```sh
JOBS=1 heavy-run bash hooks/checks/review-request-classifier.test.sh
JOBS=1 heavy-run bash hooks/checks/review-request-classifier-gate.test.sh
JOBS=1 heavy-run bash hooks/checks/a-pr-is-not-ready.test.sh
```

Then run `scripts/run-hook-fixtures.sh` and the ordinary full gate on the
final tree. Success is both discovered scripts, all 10 named classifier cases, all six
wrapper controls and the existing suite passing, and full-gate success. Any missing case, skip,
false success, undiscovered wrapper or existing-consumer regression rejects
the approach. The wrapper and tests use synthetic inputs only.

Anchor: `scripts/run-hook-fixtures.sh`; Basili, Caldiera and Rombach (1994),
Goal Question Metric; Munafò et al. (2017), preregistration.
