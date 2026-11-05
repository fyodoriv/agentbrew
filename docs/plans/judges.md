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

The runner requires Ollama 0.40.14 on loopback port 11434. Set
`AGENTBREW_PROMPTFOO_PACKAGE` to the absolute path of a trusted
`promptfoo@0.124.1` package directory. The normal Agentbrew install does
not install Promptfoo. The runner uses a private scratch directory and
passes no credentials from the agent environment. The grader uses a closed
JSON response schema and temperature zero. Each reason must contain the
critique, binary verdict, and evidence array. The normalizer still checks
score consistency and that evidence names the designated sources.

Before each engine invocation, a direct `/api/version` request verifies that
server version without the parent process's proxy settings. Its owned
request, response and Agent are cleaned up on completion. Metadata has a
two-second total deadline and a 4096-byte retained body limit. Unknown or
unsupported versions stop before grading. The separate engine deadline is
120 seconds.

The provider requests a 4096-token context, with input truncation and context
shifting disabled. It sends the full reader input or refuses; the 128 KiB
reader limit does not promise that every model can grade that much text.
A context or provider failure cannot produce a verdict receipt. Calibrate
the selected model before enabling delivery hooks; example declarations are
not proof that a model meets the required agreement rates.

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

### Portable npm package experiment

Goal: give every supported npm install the native reader from the same release.
Question: can one publishable archive carry the reader for Apple Silicon,
Linux x64, and Linux ARM64 without an install-time build?
Metric: run the locked Rust build for `aarch64-apple-darwin`,
`x86_64-unknown-linux-musl`, and `aarch64-unknown-linux-musl`, inspect the
actual archive with `tar -tvzf`, and run the installed reader's accept/refuse
fixture on each target. The current host build supplies one of three readers.
Keep a release path only when all three executable entries match their target
and pass the fixture, and when any missing entry prevents publication. Reject
the path if any target needs a compiler at npm install time or a partial archive
can reach the registry. Static Linux binaries are the first build candidate.
See [Rust platform support](https://doc.rust-lang.org/rustc/platform-support.html).

### Hook command parity

The action catalog must account for all CLI commands. Judge run and eval
are public actions. The three gate commands consume hook-specific payloads
on stdin and enforce delivery inside the hook lifecycle.

Run `./node_modules/.bin/vitest run src/action-parity.test.ts`. Predict
three unexplained hidden commands on the baseline and zero with explicit
hook-only reasons. Keep the change only if all parity tests pass. Reject it
if a gate becomes an advertised action or any existing parity case fails.
Measurement framing: Basili, Caldiera, and Rombach (1994), Goal Question Metric.

### Codex hook policy coverage

Codex supports MCP tool names in PreToolUse and provides the last assistant
message to Stop. The [Codex hook contract](https://developers.openai.com/codex/hooks)
documents those inputs. Keep the default Codex catalog restricted to Bash.
Require exact opt-in manifest entries for the draft tool and report events.

Run `./node_modules/.bin/vitest run src/sync/codex-support.test.ts`. Expect
one policy-test failure before the explicit exceptions and zero after.
Reject any additional exception, an enabled-by-default judge hook, or a
policy regression. This check does not qualify a live draft connector.

### Engine failure diagnostics

Run `./node_modules/.bin/vitest run src/judges/promptfoo-dispatch.test.ts`.
The dispatch boundary currently reports one generic error for a timeout, a
failed engine process, and an unreadable report. Keep three distinct fixed
messages with zero disclosures of engine error text. Keep successful and
completed failing assertions on their existing paths. Any lost case or
diagnostic disclosure rejects the change. This check uses synthetic engine
results and does not attribute a previous calibration failure.

### Structured grader reason

The pinned live engine returned a structured reason object. The binary
score was consistent, and the rendered prompt retained both examples and
the target position. The normalizer rejected the reason before calibration
could score it.

Run `./node_modules/.bin/vitest run src/judges/verdict.test.ts`. Expect
two valid structured verdict cases to fail before the change and pass
after it. Keep all malformed and inconsistent verdicts refused in both
representations. Retain the 8192-byte reason limit. Then run
`heavy-run --exclusive bash scripts/check-judge-calibration.sh` with the
pinned local model. Keep the approach only at full agreement in both
orders and zero unsafe verdicts accepted. Any lower agreement or weakened
refusal rejects it. Anchor: Basili, Caldiera and Rombach (1994), GQM.

### Typed engine-error receipt experiment

Goal: prevent engine errors from producing delivery receipts. Question: does
the result reader distinguish Promptfoo ERROR (2) from a completed ASSERTION
failure (1), including its derived row error summary? The private experiment
found that valid-looking rubric components can accompany an engine error.

Measurement: `./node_modules/.bin/vitest run src/judges/engine-error.test.ts`.
Predict twelve error-marked synthetic reports produce receipts on the draft
baseline and zero after the fix. Keep only zero error receipts and all three
completed PASS/FAIL controls, including an assertion summary, accepted with
the correct verdict. Reject any accepted engine error, leaked diagnostic,
or lost completed verdict. Source classification is Promptfoo 0.124.1
`ResultFailureReason`: NONE=0, ASSERT=1, ERROR=2. Metric anchor: Basili,
Caldiera, and Rombach (1994), Goal Question Metric.

This repair does not qualify model quality, full-context handling, or hosted
calibration. Those claims remain open; no default model or context limit
changes in this experiment.

Observed on the draft candidate: the focused reproduction failed all twelve
error cases while the three completed verdict controls passed. The typed
reader then passed all fifteen cases. The judge, action-parity and Codex
policy cohort passed with zero failures; TypeScript checking passed.
This is deterministic error-classification evidence, not a model-capacity
or calibration claim. Ordinary assertion summaries remain accepted.

### Direct version and full-input policy adoption

Register this source transfer before new source edits. Preserve the pending
closed-response-schema files and their earlier private measurements. The
published typed-error repair stays unchanged: ERROR reports must not mint
receipts, and ordinary ASSERTION summaries remain valid.

Goal: use the qualified local server with a complete input or refuse the
request. Question: do unsupported metadata and proxy routing ever reach the
grader, and does the fixed provider retain the whole input? Transfer the
private, reviewed direct HTTP version check and closed provider with
`num_ctx: 4096`, `truncate: false`, and `shift: false`. Keep the existing
128KiB input reader. This does not promise successful grading of every input
within that reader limit; a model-context refusal must produce no receipt.

Use a fresh explicit Node HTTP Agent for fixed
`127.0.0.1:11434/api/version`, with no proxy settings, caller URL, headers,
auth or redirect following. Require exact Ollama0.40.14 before each default
engine invocation. Bound the metadata header/body phase to2000ms and retained
body to4096bytes; destroy the owned request, response and Agent on every
completion and clear its timer. Preserve the existing120000ms engine timeout.
The metadata check adds its separate bounded overhead.

Measurement from the repo root with qualified Node/npm and normal owner PATH:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/judges/ollama-version.test.ts src/judges/engine-error.test.ts src/judges/promptfoo-config.test.ts src/judges/promptfoo-dispatch.test.ts --maxWorkers=1
JOBS=1 heavy-run npm run typecheck
JOBS=1 heavy-run npm run lint:changed
```

Keep the frozen twelve version decisions and two boundary decisions. Port
only their test HTTP event adapter; preserve expected grader/receipt outcomes
and original assertions. Before the new source guard, predict twelve wrong
negative dispatches and two accepted positives. After it, require all fourteen
to pass with zero grader calls/receipts on negatives. Keep all twelve typed
engine-error negatives and three completed verdict positives passing. The
existing dispatch tests must await the async API without weakening assertions.

The separately registered private native routing controls measured two
metadata requests reaching a disposable wrong proxy before the direct client
and zero afterward; both candidate metadata reads completed. This is endpoint
alignment evidence, not a fabricated old-server or model-capacity case.
The private fixed-provider experiments retained the same four labeled samples
and thresholds. This transfer makes no new model-quality measurement.

Success: all frozen version, typed-error and existing focused checks pass,
with no diagnostic leakage, relaxed input/schema guard or changed receipt
fields. Pivot on any wrong dispatch, lost valid result, routing discrepancy,
cleanup failure or skipped input evidence. Preserve model/frontmatter/receipt
contracts and default model/example/hosted CI configuration. No model calls,
package pin or observer-engine patch are part of this source step.

G01 remains inconclusive. G02 observed generation and a backend error with
zero receipts but did not qualify the exact context-capacity category; do not
relabel that research result. Hosted resource and capacity claims stay open.
Obtain independent source review, merge current main, and run the required
full gate only after the focused transfer is reviewed. Anchor: Basili,
Caldiera and Rombach(1994), GQM; Munafò etal.(2017), preregistration; qualified
Ollama0.40.14 and Node24.21.0 primary implementation contracts.

Source-transfer evidence: the fresh sealed source baseline had twelve wrong
version-negative dispatches and two accepted positives. Its separate fixed
provider-policy assertion failed while the existing configuration cases
passed. After transfer, the focused version, policy, typed-error and dispatch
cohort passed all forty-seven cases. This is deterministic source-boundary
evidence; no model was called. Type/lint, current-main integration and the
final full gate remain separate checks before delivery.
