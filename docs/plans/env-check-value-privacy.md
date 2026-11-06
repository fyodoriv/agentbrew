# Environment-check value privacy

Registered preparation: 2026-11-06, from main `7fa37f620c88734b76d0e2c9aa6fdfa9a057fab9`.
Task: `env-check-value-privacy`. This plan contains no target measurements or runtime change.
Commit this prediction before adding regression assertions or changing the formatter.

## Source and scope

The reviewed environment-check source is unchanged from revision
`81cb2f1b557bd25e67d848b0ffd1740eba8d9643` at the registered base.

- `src/core/env-sanitize.ts:58–71`: `displayEnvCheck` prints short values in
  full and long values as their first 37 characters plus an ellipsis.
- `src/commands/cli-env.ts:11–21`: actual `env check` calls the default
  checker, displays the results, and returns exit one when a variable is set.
- `src/core/env-sanitize.test.ts`: helper checks retain internal values and
  test unset commands. Its old long-value test treats truncation as safe.
- `src/env-sanitize-cli.test.ts`: existing full-source-CLI harness uses a
  scratch HOME, an allowlisted child environment and an npm-prefix-only stub.
- `src/status.ts` and `src/drift-checks/env.ts`: other uses of the helper
  print variable names, rather than `warning.value`.
- `src/core/redact-output.ts`: CLI output redaction covers URL credentials;
  it does not make arbitrary non-URL environment values safe to print.

Fix the display boundary by deleting value rendering. Preserve
`checkEnvHygiene`'s internal `{variable, value}` result, `generateSanitizeCommands`,
CLI exit behavior, the ordinary check banner stream and sanitize stdout.
No new command, flag, setting, dependency or model call is required.

Important correction to the older private task draft: the actual CLI has no
custom-variable option. Qualify the custom case through the existing helper
API. Do not claim it is a ninth full-CLI case or add a flag for this fix.

## Frozen proposed matrix

For each row, define `marker = SYNTHETIC_VALUE_<ID>_`. A long value is exactly
that marker followed by 64 ASCII `Z` characters. A short value is exactly
the marker. These are synthetic data, without provider-token syntax.

| ID | Variable | Value | Display boundary | Actual CLI |
| --- | --- | --- | --- | --- |
| C01 | ANTHROPIC_MODEL | long | required | required |
| C02 | OPENAI_MODEL | long | required | required |
| C03 | CLAUDE_MODEL | long | required | required |
| C04 | CLAUDECODE | short | required | required |
| C05 | CLAUDE_CODE_USE_BEDROCK | long | required | required |
| C06 | CLAUDE_CODE_USE_VERTEX | long | required | required |
| C07 | OPENAI_API_KEY | short | required | required |
| C08 | ANTHROPIC_API_KEY | long | required | required |
| C09 | CUSTOM_PRIVACY_VAR | long | required | helper API only |

Freeze the source default-variable list with these identities. The custom
case calls `checkEnvHygiene(["CUSTOM_PRIVACY_VAR"])`, then `displayEnvCheck`.
It also checks `generateSanitizeCommands(["CUSTOM_PRIVACY_VAR"])`.

Each warning line, after ANSI normalization, must be exactly
`  <VARIABLE> is set`. Require the variable name once in its warning line.
Combined stdout and stderr must contain no marker, full value or
`SYNTHETIC_` value prefix. Exact line matching prevents an implementation
that prints a shorter prefix from passing a marker-only assertion.

Add a formatter getter tripwire: the synthetic warning's `value` property
counts reads or throws on access. Require zero value-property reads and
the same exact name-only warning line. The display does not need a value
to state that the variable is set.

## Isolation and preserved contracts

Do not spread `process.env` into any new child. Reuse the existing CLI
fixture's allowlist, with these explicit runner values:

- HOME and USERPROFILE: per-case scratch directory.
- PATH: scratch bin, the resolved Node executable directory, `/usr/bin`, `/bin`.
- AGENTBREW_NO_AUTO_INIT=1, AGENTBREW_EVENTS=0, NO_COLOR=1.
- Only the row's synthetic environment variable, when that case needs it.

Omit BASH_ENV, ENV, NODE_OPTIONS, authentication variables, proxy settings,
provider configuration and session markers not explicitly under test. Use
`process.execPath` and the repo's absolute tsx loader path. Do not run init,
sync, doctor, a scheduler, a provider client or a browser.

Seed the existing fixture state and a fresh upgrade cache using the repo
version. Preserve the npm stub that accepts only `prefix -g` and refuses
other work. The exact source-CLI argv remains:

```text
<resolved-node> --import <repo>/node_modules/tsx/dist/loader.mjs <repo>/src/cli.ts env check
```

Capture `stdout`, `stderr`, terminal code and signal without replacing a
nonzero result with success. Each set-variable check requires exit one,
no terminating signal, its name-only warning and the ordinary stdout banner.
The empty environment check still returns zero and its existing clean message.

Run the targeted Vitest process itself under an outer `env -i` allowlist
inside `heavy-run`. Legacy unit tests currently snapshot `{...process.env}`
at module load; an isolated outer runner keeps those snapshots synthetic.
Do not claim that the normal full repository gate has no owner-environment
reads globally. The privacy measurement and its child processes must have
no inherited credentials.

Keep existing sanitize controls: clean stdout is empty; set variables produce
only the exact unset command; banners and repair/upgrade information stay on
stderr for sanitize; shell consumption clears the variable without evaluating
its synthetic value. Preserve the custom helper's exact unset output.

## Prospective experiment

GQM: users need useful environment diagnostics without value disclosure.
Does the display emit only the variable identity, across the sealed matrix,
while retaining the command's existing warning and sanitize contracts?

Prediction: observed display-marker disclosures fall from nine of nine to
zero. The eight default actual-CLI cases also have zero disclosures. Variable
identity preservation remains nine of nine; set-variable CLI exits remain
one; the getter tripwire records zero reads; sanitize contracts remain green.
These outcomes are proposed, not measurements from this review.

Success requires every matrix row, the full-CLI controls and all preservation
guards. Any marker/prefix disclosure, lost identity, value-property read,
changed exit/stream contract or owner-data dependency rejects the fix.
Do not relabel truncation as redaction or weaken the planted values.

Anchor: Basili, Caldiera and Rombach (1994), GQM;
[Munafò et al. (2017)](https://doi.org/10.1038/s41562-016-0021), preregistration;
[OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude),
excluding authentication material from logs. This deletes local value rendering;
it needs no upstream library or new abstraction.

## Execution order and commands

1. Reuse an owned, completed checkout. Add the task and a source plan with
   this matrix and fixture definitions. Pass the docs gate and commit the
   prediction before regression code or measurements.
2. Add the new privacy assertions. Prospectively replace the old truncation
   expectation with the registered zero-disclosure contract. Capture RED
   against unchanged formatter code. Preserve original source/receipt proof.
3. Delete value rendering only. Confirm GREEN without changing the sealed
   matrix, exact warning-line oracle or existing command contracts.
4. Run independent review and the normal required repository gates. Publish
   only after green gates; update README's environment command paragraph in
   the same PR. Do not grow the nearly full always-loaded AGENTS guide.

The target command runs Vitest directly through the installed Node executable.
Resolve these paths without inspecting environment values, then record their
resolved paths, the source tree and the real terminal code in the private receipt:

```sh
repo="$PWD"
node_path="$(command -v node)"
node_dir="$(dirname "$node_path")"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/agentbrew-env-privacy.XXXXXX")"
JOBS=1 heavy-run /usr/bin/env -i \
  HOME="$scratch" USERPROFILE="$scratch" \
  PATH="$node_dir:/usr/bin:/bin" \
  AGENTBREW_NO_AUTO_INIT=1 AGENTBREW_EVENTS=0 NO_COLOR=1 \
  "$node_path" "$repo/node_modules/vitest/vitest.mjs" run \
  src/core/env-sanitize.test.ts src/env-sanitize-cli.test.ts --maxWorkers=1
```

The explicit outer environment is lifecycle-scoped to this targeted runner;
per-case scratch child environments belong to each CLI fixture. The runner
must not pass shell startup, Node option, authentication, proxy or provider
variables. The queue wrapper may inspect its ordinary settings; it must not
forward owner credentials to the runner. Record cleanup of the task-created
scratch directory after the run. Never snapshot the owner's environment.

These test files exist; the future privacy cases do not exist yet. Keep the
same frozen command and oracle for RED and GREEN. Record real exit codes;
RED must identify the expected disclosure assertion against unchanged production
code. Setup failures do not establish a disclosure baseline. No bare
owner-environment `env check`, init, sync or provider call is a baseline.
Run required normal gates separately through `heavy-run`; their results are
not proof that the entire repository never reads the owner environment.
No timing gain is claimed. The docs-only preparation is not proof of the fix.

Estimate: active effort 30 / 60 / 120 minutes, elapsed 45 / 90 / 180 minutes
low / likely / high. Existing safe CLI scaffolding reduces uncertainty.
Queue time, upstream composition and full-gate failures can extend elapsed
time. Revise the forecast from actual evidence, retaining the original.

## Recorded result — 2026-11-06

Prediction commit: `3f7c55d40e07b8538ea96957974d9699142d2907`.
The historical truncation expectation was replaced before the first RED run,
as registered. The existing formatter implementation remained unchanged for RED.

| Stage | Real exit | Observed result |
| --- | --- | --- |
| RED, isolated targeted runner | 1 | 19 expected privacy failures; 28 preservation cases passed |
| GREEN, same isolated runner and frozen assertions | 0 | 47 passed; no failed case |
| Uncached composed full gate | 0 | 6420 passed; 33 skipped; all 20 gate steps fresh, none cached |

RED exposed the synthetic marker in every sealed formatter row and every
default-variable source-CLI row. It also failed the zero-read getter guard.
For example, the CLI printed an `ANTHROPIC_MODEL=` line containing
`SYNTHETIC_VALUE_C01_` instead of the registered exact name-only line. This was an actual disclosure
assertion failure, not a setup error or a test against the owner's environment.

GREEN reduced formatter marker disclosures from 9/9 to 0/9 and actual-CLI
marker disclosures from 8/8 to 0/8. All exact variable-name lines passed,
the getter recorded zero reads, and warning exits remained one. Clean check,
internal checker values, custom helper selection, unset commands and existing
sanitize shell/stream behavior passed. The custom case used the helper API;
it was not presented as a CLI option.

Both targeted runners used the registered outer `env -i` allowlist. Their CLI
children used explicit scratch environments, synthetic values and the
npm-prefix-only stub. No owner environment snapshot or real authentication
material was used as qualification input. Each CLI fixture removed its scratch
HOME; both outer scratch directories were also removed and their absence
recorded. No owner-environment `env check`, init or sync was used as a baseline.

The test source hashes were identical between RED and GREEN. Before the full
gate, Biome changed only test layout and trailing commas; it changed no fixture,
assertion or oracle. The runtime formatter and README hashes stayed exact.
The full gate qualified tree `95b8f64ae25aa0c98321d9d13850b74d064c8ba5`,
composed with main `c3331d9fd9dde61911b63cff81ef351bb57c407a`.
Its source hashes and tree stayed unchanged for the entire run. Inner and outer
exit receipts both recorded zero. Install e2e correctly skipped because no
install path changed. These normal repository checks do not establish that
every unrelated test avoids owner-environment reads.

Private receipts retain the RED/GREEN logs, source hashes, cleanup records,
full log, real exit codes, frozen composed sources and gate timings. Only this
plan and the completed task block change for closeout; the qualified runtime,
tests, README and always-loaded guide remain unchanged. No timing improvement
or field recurrence measurement is claimed. The completed task leaves the queue;
its prediction and evidence remain here.
