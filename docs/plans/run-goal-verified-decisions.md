# Run-goal decision case checks

Register the four cases before adding them to the test set.

- **Hypothesis:** Add cases for four reported decisions so a grader can check whether the agent uses real evidence, respects approval, and verifies the result.
- **Measurement:** Run `jq -se '.[0].evals as $base | .[1].evals as $head | $head[0:($base|length)]==$base and ($head|length)==(($base|length)+4) and ($head|map(.id)|unique|length)==($head|length) and all($head[($base|length):][]; (.expectations|length)==4 and .files==[])' <(git show b4e105f5:skill-plugins/workflow/run-goal/evals/evals.json) skill-plugins/workflow/run-goal/evals/evals.json` with Bash. Compare the expectations against the source issues and run the hosted checks.
- **Success:** Each of the four decisions has one case with four checkable expectations. All earlier cases match the base. There are zero duplicate IDs and zero live actions.
- **Pivot:** If 1 or more cases allow a wrong decision or change earlier cases, revise the fixture and keep the affected issue open.
- **Anchor:** [Authorized signed-in source](https://github.com/fyodoriv/agentbrew/issues/988), [scheduler and CLI behavior](https://github.com/fyodoriv/agentbrew/issues/961), [peer policy conflict](https://github.com/fyodoriv/agentbrew/issues/941), and [support channel tags](https://github.com/fyodoriv/agentbrew/issues/971).

The checks use synthetic prompts and compare the written expectations. The test set requires no real account, private data, running scheduler, or outgoing message.
