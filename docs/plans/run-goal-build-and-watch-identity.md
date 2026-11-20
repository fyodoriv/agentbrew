# Verify a judge build and a watch target

- **Hypothesis**: An explicit preflight prevents two false review or wait events that general completion checks cannot catch at entry. The wrong commit stays out of review and a different job's result leaves the wait open.
- **Measurement**: Apply the new run-goal eval for #1180 to four scenarios. Compare the current and revised guidance for an old release, a wrong resolved watch target, a matching release, and a matching watch. Run `npm run --silent skills:coverage` to validate the eval.
- **Success**: Hold both mismatches before the first judge handoff or accepted completion notice. Allow both exact matches to reach the existing next step. Retain 100% workflow eval coverage.
- **Pivot**: One false acceptance, one blocked exact match, or a coverage failure rejects the change. Clarify whether a receipt proves the intended release or the actual observed watch target.
- **Anchor**: [Agentbrew issue #1180](https://github.com/fyodoriv/agentbrew/issues/1180) and Basili, Caldiera, and Rombach (1994), Goal Question Metric.
