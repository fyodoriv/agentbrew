# Verify the build in screenshot proof

- **Hypothesis**: Reading the loaded build from the page and requiring a fresh capture changes the number of correctly rejected false screenshot receipts from zero or more to three of three, while a valid before/after pair still passes.
- **Measurement**: Use the run-goal eval for issue #1181. Ask a fresh reviewer to apply the skill to one valid pair, a pair with a wrong loaded build, a failed capture that leaves an old file, and a capture after an automatic flow advances. Run `npm run --silent skills:coverage` to check the eval format.
- **Success**: The reviewer keeps all three false receipts open and accepts the one valid pair. The built-in workflow eval coverage remains at 100%.
- **Pivot**: If the reviewer accepts one false receipt, rejects the valid pair, or the eval fails coverage, clarify the evidence rule before shipping.
- **Anchor**: [Agentbrew issue #1181](https://github.com/fyodoriv/agentbrew/issues/1181) and Basili, Caldiera, and Rombach (1994), Goal Question Metric.
