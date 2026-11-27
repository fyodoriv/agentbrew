# Keep the judge round cap across goal restarts

## Prediction

- **Hypothesis**: An unchanged contract keeps its judging budget across goal restarts. A fourth full panel after three failed panels goes from one accepted fixture to zero.
- **Measurement**: Run `heavy-run bash hooks/checks/goal-judges-before-stop.test.sh`. Check the same-contract restart, changed-contract, fresh-verdict, and owner-approval cases.
- **Success**: The same-contract fourth round blocks, the different-contract first round passes, and the hook suite reports zero failures.
- **Pivot**: If a different-contract fixture loses its fresh budget or the newest goal accepts an old verdict, withdraw the patch and correct the transcript scope before trying again.
- **Anchor**: `TASKS.md`, task `goal-judge-rounds-across-goals`.
