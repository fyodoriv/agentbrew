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

## Plain-language output evals

The global plain-language rule has deployment tests. These evals check
behavior: does agent output follow the rule?

The evaluator is `agent-artifact-evals/plain-language.cjs`. It is
deterministic and uses no model. It checks five surfaces:

| Surface | Checks |
|---|---|
| `chat` | answer first, sentence length, active voice, paragraph length |
| `docs` | answer first, sentence length, active voice, paragraph length |
| `pr` | body opens with `## Summary`, sentence length, active voice, paragraph length |
| `code-comment` | comment blocks of 3 lines or fewer, sentence length, active voice |
| `skill-wrapper` | sentence length, active voice, paragraph length (frontmatter skipped) |

Limits: 25 words per sentence (ASD-STE100), 4 sentences per prose paragraph,
and passive voice in at most 1 of 5 sentences. Bullets and fenced code are
not counted as long paragraphs. Each diagnostic names the rule text it
enforces, so a failure shows the rule gap.

Sampled outputs for Claude Code and Codex live in
`agent-artifact-evals/plain-language/samples/<agent>/<surface>.<ext>`. Known
bad outputs live in `agent-artifact-evals/plain-language/failing/`. The
Promptfoo cases in `agent-artifact-evals/cases/plain-language.yaml` run both
sets inside `npm run eval:agent-artifacts`, so `npm run verify` stays
deterministic.

Print the report for every agent and surface:

```bash
npm run eval:plain-language
```

Score your own captured output (opt-in). Save the agent's reply to a file,
then run:

```bash
npm run eval:plain-language -- --surface chat path/to/reply.md
```

The command exits 1 when an output fails. To add a sample from a live
agent, save it under `samples/<agent>/<surface>.<ext>` and add a case.

## Skill eval pressure cases

Each skill's `evals/evals.json` should hold a few pressure cases next to its
happy paths. A pressure case pushes the agent toward a wrong move and checks
that the skill holds. Use these categories; each links to one existing case.

| Category | The prompt pushes the agent to… | The expectations check that it… | Example |
|---|---|---|---|
| Wrong-tool routing | use this skill for a job another skill owns | names the owning skill and does not do that job | [competitor-spot-check #8](../skill-plugins/dev/competitor-spot-check/evals/evals.json) (refresh competitor docs → `companion-competitor-watch`) |
| Read-only boundary | change state during a check | runs only read commands (`status --ci`, not `status --fix`) | [agentbrew-status #5](../skill-plugins/dev/agentbrew-status/evals/evals.json) |
| Approval gate | act on many or large targets at once | shows a shortlist and asks before it acts | [learn-project #16](../skill-plugins/dev/learn-project/evals/evals.json) (scan `~/apps`) |
| Refusal of fabrication | claim a result without evidence | runs the command or says what is missing, and invents no counts or citations | [agentbrew-status #4](../skill-plugins/dev/agentbrew-status/evals/evals.json) ("tell me it is green"), [competitor-spot-check #7](../skill-plugins/dev/competitor-spot-check/evals/evals.json) |
| Missing dependency or input | go on when a tool, file, or directory is absent | reports the gap with the exact fix command, then stops or degrades as the skill says | [learn-project #5](../skill-plugins/dev/learn-project/evals/evals.json) (`tutor-setup` not installed) |
| Conflicting sources | trust the wrong source of truth | follows the declared config over a stale file | [detect-task-backend #7](../skill-plugins/dev/detect-task-backend/evals/evals.json) (a declared GitHub Issues backend next to an old `TASKS.md`) |

Write each expectation as one checkable behavior, not a mood ("does not run
`--fix`", not "is careful"). A pressure case needs at least one "does not…"
expectation.

## Exemptions

If a high-risk artifact cannot reasonably be covered by deterministic tests or
the Promptfoo pilot, add an explicit `agentbrew-artifact-exemption:` line in the
artifact and explain why. Exemptions are visible in `collectAgentArtifacts()`.
