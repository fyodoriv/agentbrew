# Judge definitions and delivery gates

[Issue #752](https://github.com/fyodoriv/agentbrew/issues/752) tracks the
implementation. The schema below describes the planned configuration.

## Declare a judge

List each judge file in the Agentfile that owns it.

```yaml
judges:
  - judges/clarity.md
```

An overlay can declare its own judges. Resolve each path from the directory
of its owning Agentfile. Validate every declaration before applying it. Refuse
ambiguous names so an overlay cannot silently replace a judge's rubric.
Generated Agentfiles retain the original owner with each relative path.
Treat that list as machine-local merge output. Edit the owning Agentfile to
change the declarations.

```markdown
---
on: [pr-create, pr-ready]
sees: artifact
rubric:
  - id: plain-language
    check: Does the draft use plain language?
pass_bar: 1
model: ollama:chat:llama3.2:3b
max_rounds: 2
calibration:
  cases: [golden/clarity.md]
  min_true_positive_rate: 0.9
  min_true_negative_rate: 0.8
---
Review the artifact against each check.
```

- `on` lists the delivery events that require the judge. The supported events
  are `pr-create`, `pr-ready`, `draft-save`, `dashboard-present`, and
  `report-final`.
- `sees: artifact` gives the judge only the artifact under review.
  `sees: artifact+sources` also gives it the original request and designated
  evidence. Each check in that mode must cite its evidence.
- `rubric` lists binary checks with stable, unique IDs.
- `pass_bar` is the required fraction of passing checks and must be greater
  than zero. `max_rounds` caps attempts before escalation.
- `model` names the local Ollama chat model. `calibration` declares labeled
  case files and minimum true-positive and true-negative rates, each from
  zero through one. Case paths are relative to the same Agentfile owner.
  Each Markdown file has YAML frontmatter with a `cases` list containing
  one `PASS` case and one `FAIL` case. Give each case a unique `id`,
  `expected` label and `artifact` text. A source-aware case also needs
  `context.request` and `context.sources` with `id` and `text` fields.

For a complete example, see the [clarity judge](../examples/judges/clarity.md)
and its [labeled cases](../examples/judges/golden/clarity.md). Add
`docs/examples/judges/clarity.md` to an Agentfile at the repository root
to try it. The example is opt-in.

## Verify before delivery

Add a plain-language entry in the `/agentbrew` command and its start skill.
When someone asks Claude to review an artifact before delivery, route the
request to `agentbrew judge run <name> --event <event> --artifact <file>`.
Omit the name to run every judge for the event. A judge that declares just
one event can run by name alone. The command prints a flat JSON list of
checks and adds the judge name to each check when multiple judges ran.
Route requests to check a rubric against labeled examples to
`agentbrew judge eval`.

Use the existing Claude Code and Codex subagent renderers. Run labeled pass
and fail examples in both orders. Store the verdict locally and tie it to
the exact artifact bytes, event, rubric, model, and supplied sources.

Use one [Promptfoo rubric assertion](https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/llm-rubric/)
per binary check. Set the grader explicitly for each assertion. Promptfoo
returns a score, a pass flag, and a reason. Validate these fields before
turning the reason into critique and evidence. Refuse an incomplete result
or a citation that does not match the sources supplied to that check.

The runner uses Ollama on loopback port 11434. Set
`AGENTBREW_PROMPTFOO_PACKAGE` to the absolute path of a trusted
`promptfoo@0.124.1` package directory. The normal Agentbrew install does
not install Promptfoo. The runner uses a private scratch directory and
passes no credentials from the agent environment.

Build from source with Rust 1.97 or later on Apple Silicon or Linux
x64/ARM64 to include the reader for that host. A package built on one
host includes that host's reader. Verify the reader in the package
before installing it on a different platform.

Each run reserves one attempt for its judge, event, and artifact path before
grading. Use `--review-id <id>` to share the same cap across revisions saved
under different paths. Reserved attempts persist locally, including attempts
interrupted before a verdict. At the cap, ask the user to review the artifact
before starting a new review.

The source reader opens each path component relative to its held parent
directory. It refuses symlinks, multiply linked files, and reads over 128 KiB.
Hash and parse the bytes from the same read. A held directory protects path
resolution from replacement. The receipt still needs the byte hash because
the owner can edit an open file.

Enable the hooks on the machine where you use the judges. Add these IDs to
the existing `enabled` list in
`~/.config/agentbrew/hooks-overlay/manifest.yaml`:

```yaml
version: 1
enabled: [judge-pr-delivery, judge-report-final]
```

Run `agentbrew sync --dry-run` to preview deployment, then
`agentbrew sync` to deploy the hooks to Claude Code and Codex. Use
`agentbrew judge run --event pr-create --artifact <body-file>` before
creating a PR with the same body file. For `pr-ready`, the hook reads the
current body from GitHub using the explicit PR number. A pass is valid
for 15 minutes. The Stop hook checks the exact final message and warns
when its verdict is missing.

The PR hook covers supported literal shell commands. Direct API calls and
unrecognized wrappers bypass it. Keep the body stable between the hook
check and delivery.

For source-aware delivery, set `AGENTBREW_JUDGE_CONTEXT_FILE` in the
hook's environment to an absolute path to a local JSON manifest. Keep it
outside the checkout and configure it before starting the agent. The gate
reads the original request and source files again at delivery. Paths are
relative to the manifest. For example:

```json
{"reality":{"request":"request.txt","sources":[{"id":"fact","file":"evidence.txt"}]}}
```

Use the same original request and named evidence when running the judge.
A missing or changed source requires a new verdict.

For a chat connector with a verified text-only draft-save tool, also enable
`judge-draft-save`. Set `AGENTBREW_JUDGE_DRAFT_TOOL` to its exact MCP tool
name and `AGENTBREW_JUDGE_DRAFT_FIELD` to the top-level field that contains
the whole draft. Set both in the hook environment before starting the agent.
Grade that exact text with `agentbrew judge run --event draft-save --artifact <file>`.
The hook checks only the configured tool and field. A tool with rich blocks
or additional message-bearing fields needs its own adapter.

To check the shipped clarity rubric in CI, build Agentbrew and run
`bash scripts/check-judge-calibration.sh` with its declared model
available on local Ollama. The script uses an isolated Agentbrew home.
It exits nonzero if either order falls below the declared agreement
threshold across all fixture pairs. The hosted calibration job verifies
the model digest before it runs the script.

### Source installer prerequisite experiment

Goal: stop source setup before backup when its native build needs Cargo.
Question: does preflight catch missing Cargo on both supported Linux architectures?
Metric: run `./node_modules/.bin/vitest run src/install-script.test.ts` against
stubbed Linux x64, Linux arm64, and Apple Silicon hosts with no Cargo on PATH.
Expect two missed diagnoses on the draft baseline and zero after the change.
Keep the fix only if all three report the missing tool before backup and all
existing installer checks pass. Any missed diagnosis or existing-case regression
rejects this approach. Measurement framing: Basili, Caldiera, and Rombach (1994),
Goal Question Metric.
