# Settle scaffold fixtures before synchronous checks

## Baseline and cause hypothesis

On unchanged source, the filled-tool scorer took 13.486 seconds with the Copier suite selected and 3.096 seconds without it: 4.36 times as long. Copying took 0.200 seconds and replacing fill markers took 0.768 seconds. Copier fixture processes remained active while ordinary checks ran. The earlier full suite reported the strict-tool case at 35.710 seconds against its unchanged 30-second limit; the controlled probes did not reproduce that timeout.

## Registered prediction

- **Hypothesis (GQM):** awaiting the selected file-scoped Copier fixture promise in the file setup hook removes overlap before ordinary synchronous checks. Scorer time with Copier selected falls from 13.486 seconds to at most 5 seconds, without changing scores, selected fixtures, or deadlines.
- **Measurement:** first add a regression that detects an unsettled selected fixture before ordinary checks and confirm it fails on the current setup. Then run `heavy-run npx vitest run src/skills/new-project-contract.test.ts -t 'settles selected Copier fixtures|strict mode fails a fresh.*tool.*scaffold|with Copier' --reporter=verbose`. Use the same metadata-only diagnostic profiler for the scorer boundary. Run the complete file and `heavy-run npm run verify` after the focused proof.
- **Success:** the new readiness regression changes from failure to pass; no selected Copier work remains pending when ordinary checks start; scorer time is at most 5 seconds and strict-tool body time is at most 6 seconds. Every existing scaffold case remains covered and the complete required gate passes.
- **Pivot:** abandon this approach if scorer time exceeds 6.743 seconds, overlap remains, any score changes, or existing coverage is lost. Results between the success and pivot thresholds are inconclusive and do not justify a full gate or a relaxed target.
- **Constraints:** preserve the 300-second file-setup budget, existing 30-second test defaults, explicit MCP limits, real Copier coverage, and all baseline gates. Do not skip tests, change limits, or alter production scaffold behavior.
- **Anchor:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric; Kohavi, Tang and Xu (2020), controlled conditions.

## State owner

The test file owns its shared scaffold and Copier fixture promises for one file run. Setup must settle selected fixture work before ordinary test bodies; cleanup still waits for owned work before deleting scratch files.
