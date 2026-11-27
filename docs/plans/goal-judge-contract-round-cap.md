# Keep the judge round cap across goal restarts

## Prediction

- **Hypothesis**: An unchanged contract keeps its judging budget across goal restarts. A fourth full panel after three failed panels goes from one accepted fixture to zero.
- **Measurement**: Run `heavy-run bash hooks/checks/goal-judges-before-stop.test.sh`. Check the same-contract restart, changed-contract, fresh-verdict, and owner-approval cases.
- **Success**: The same-contract fourth round blocks, the different-contract first round passes, and the hook suite reports zero failures.
- **Pivot**: If a different-contract fixture loses its fresh budget or the newest goal accepts an old verdict, withdraw the patch and correct the transcript scope before trying again.
- **Anchor**: `TASKS.md`, task `goal-judge-rounds-across-goals`.

## Focused evidence

The baseline returned exit 0 for the fourth round after a restart. The
expected exit was 2, and the round-count message was missing. The other
three controls passed.

On the fixed hook, all five controls passed. The restarted contract reported
four full rounds even with a partial earlier panel that included an unrelated
judge. A changed contract received a fresh budget. An owner approval after
restart allowed round four, and the restarted goal still needed new verdicts.
