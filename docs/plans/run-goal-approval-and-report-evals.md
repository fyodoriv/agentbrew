# Run-goal evals for approvals and reports

- **Hypothesis**: Three separate eval cases cover a report reshaped into a scorecard, approval required before later steps, and a blocked external sink.
- **Measurement**: Check the eval catalog against `origin/main`. Run the repository's hosted verify checks on Linux and macOS. An independent reader maps each expectation to its issue.
- **Success**: 3 new case IDs, 0 changes to existing cases, 0 schema or prefix check failures, and 0 missing acceptance points.
- **Pivot**: If a fixture requires a live write or repeats an existing criterion, narrow it to a simulated decision or omit the duplicate.
- **Anchor**: [Scorecard sources (#914)](https://github.com/fyodoriv/agentbrew/issues/914), [Approval inside goal steps (#937)](https://github.com/fyodoriv/agentbrew/issues/937), and [Blocked external sink (#968)](https://github.com/fyodoriv/agentbrew/issues/968).

The cases use synthetic data. They check what the runner should do before a publish, send, or external write. They require no connection to a real report, workspace, or sink.
