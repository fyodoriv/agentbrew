# Testing agent artifacts

Agent artifacts are prompt-like files that get synced into one or more agents:
skills, commands, hooks, instructions, rules, and MCP references. They need two
different test layers.

## Deterministic tests

Use Vitest or shell fixtures when the invariant is structural or pure:

- YAML/frontmatter parses.
- A command syncs to each supported agent path.
- A hook fixture accepts and rejects exact payloads.
- A helper returns deterministic diagnostics for known input text.

These tests should run inside `npm run verify`.

## Promptfoo behavioral evals

Use `npm run eval:agent-artifacts` when the artifact is prompt-like and the
important behavior is policy preservation rather than syntax:

- global instructions keep publication and destructive-operation guardrails;
- high-risk commands preserve the command shape and verification cues;
- unsafe fixtures prove the eval fails when guardrail text is removed.

The pilot suite is deterministic. It uses a local Promptfoo provider and does
not call a live LLM, require secrets, write cache files, or share results.

Run all deterministic artifact evals:

```bash
npm run eval:agent-artifacts
```

Run one artifact:

```bash
npm run eval:agent-artifacts -- --filter-metadata artifact=templates/AGENTS.md
```

Run a group:

```bash
npm run eval:agent-artifacts -- --filter-pattern Jenkins
```

## Exemptions

If a high-risk artifact cannot reasonably be covered by deterministic tests or
the Promptfoo pilot, add an explicit `agentbrew-artifact-exemption:` line in the
artifact and explain why. Exemptions are visible in `collectAgentArtifacts()`.
