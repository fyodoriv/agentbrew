# Record completed checkup runs

Issue [#572](https://github.com/fyodoriv/agentbrew/issues/572) asks each checkup
to show the last completed run before work starts and save a record at
completion. This plan registers a prediction. Outcomes are unmeasured.

One standalone Rust owner serves the Agentbrew repo checkup, the rendered
new-project checkup, and dotfiles' tooling-checkup. Existing caller scripts
supply captured facts. The existing CLI parser owns action discovery.
Preserve the HTML report and the richer dotfiles history. This slice has no
dependency on the Rust inventory transport.

Commit this registration before writing fixtures or production code. Land
the calibrated observer first. Measure the unchanged callers before the
repair. Keep every observed attempt, including inconclusive setup failures.
Register any method change before its next measurement.

## Observation and acceptance

Use existing Vitest and Bats, with the fixture names below. The
recorder calibration runs normally; the real product cohort selects all six
FIRST/TWO cases. Every TWO is its own pair of real synthetic assessments.

```sh
# Agentbrew, ordinary calibration and retained HTML guard.
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/checkup-run.test.ts src/docs/checkup-html-report.test.ts
# Agentbrew, four selected product cases.
CHECKUP_RUN_OBSERVATION=1 CHECKUP_RUN_REQUIRE_FEATURE=1 JOBS=1 heavy-run npx vitest run --reporter=default --silent=false --maxWorkers=1 src/checkup-run.test.ts src/docs/checkup-html-report.test.ts

# Dotfiles, ordinary calibration and retained history guards.
JOBS=1 heavy-run bats tests/tooling-checkup-skill.bats
# Dotfiles, two selected product cases and the scoped contracts.
CHECKUP_RUN_OBSERVATION=1 CHECKUP_RUN_REQUIRE_FEATURE=1 JOBS=1 heavy-run bats tests/tooling-checkup-skill.bats
```

For the post-change dotfiles run, set the fixture-only CHECKUP_RUN_TEST_CLI
to the absolute qualified scratch launcher. The fixture's agentbrew command
must resolve
to the qualified scratch install from the first-host gate. Bind its launcher,
native asset, source revision and lock in the private run receipt. The
unchanged caller baseline supplies no nonexistent helper. Use the explicit
Vitest reporter when collecting receipt output to avoid passing-console
suppression. Count missing receipts as inconclusive even when the runner exits
zero.

Predict complete generic product cases rise from 0/6 to 6/6,
with 2/2 in each TWO and zero calibration errors or setup failures. The six
cases contain nine assessments. Preserve rich history/backfill and existing
HTML behavior. Require every R/C/D variant, zero unsafe writes, zero extra
export probes, zero stale replay and zero unexpected changes to history rows.
Stop the candidate on any miss. A genuine earlier fixture/tool failure
requires a recorded setup correction before interpreting product outcomes.

The ordinary preparation gate measures sealed recorder samples. Select real
observations with CHECKUP_RUN_OBSERVATION=1 and product assertions with
CHECKUP_RUN_REQUIRE_FEATURE=1. Both use the same captured result. The first
selected run must observe the old callers finishing before it counts missing
generic context or a missing completion record as a failure. An absent
command, compiler error or incomplete fixture is inconclusive. Do not require
a native helper for the unchanged-caller baseline.

## Public record contract

The public actions are:

- `agentbrew checkup-run show <checkup> [--json]`
- `agentbrew checkup-run record <checkup> --finished-at <RFC3339> --result <green|degraded|blocked> [--commit <repo>=<sha> ...] [--json]`

The record path is `${XDG_STATE_HOME:-~/.local/state}/checkups/<checkup>.json`.
The caller captures the assessment completion time once. The Rust
owner validates and normalizes UTC. Reuse the existing CLI action routing.
Use stable IDs for the repo checkup, generated project and tooling-checkup.
Require an explicit valid ID if a generated project's name is unsuitable.
A missing prerequisite reports unavailable and preserves the existing
checkup work. A failed required record reports incomplete. Only completed
assessments record a result, including an explicitly completed blocked one.
Preserve the checkup's existing nonzero failure status. Capture each checked
commit from the assessment without adding discovery inside the record owner.

Stored JSON has only finished_at, result and commits. Bound checkup and repo
labels to 1–64 ASCII characters matching
[a-z0-9][a-z0-9_-]*. Allow 7–64 hex SHA characters and at most 256 unique
repo entries. Bound input and record bytes at 64 KiB each. Reject duplicate
entries/keys, unknown fields, malformed UTF-8/time and oversized input.
The owner's descriptor lock serializes publication.
An incoming time older than the saved completion refuses as stale-run. The
same time and semantically identical tuple succeeds idempotently with no
write. A conflicting tuple with the same time also refuses as stale-run. Do not order
assessments by file mtime, export-attempt time or UUID string.

Freeze these --json envelopes, without omitted optional fields:

```json
{"status":"missing","record":null,"record_sha256":null}
{"status":"present","record":{"finished_at":"2026-11-02T12:00:00Z","result":"green","commits":{"fixture":"abcdef0"}},"record_sha256":"<64 lowercase hex>"}
{"status":"recorded","record":{"finished_at":"2026-11-02T12:00:00Z","result":"green","commits":{"fixture":"abcdef0"}},"record_sha256":"<64 lowercase hex>","changed":true}
{"status":"error","code":"stale-run"}
```

changed is false for idempotent success. record_sha256 hashes the actual
stored bytes, not a caller's alternative JSON spelling. Errors use one fixed
code from invalid-input, invalid-state, unsafe-target, unsupported-target,
busy, stale-run or io. JSON errors go to stderr; success goes to stdout.
Exit 0 means successful show or record, including missing show. Refusals
exit 2.
Do not emit input, paths, raw errors, config or historical values on failure.

## Filesystem publication

Initial qualification is a local APFS state directory on darwin-arm64.
Require an absolute state root. Walk components with held directory
descriptors; directory opens use RDONLY|DIRECTORY|CLOEXEC|NOFOLLOW.
Do not silently follow a symlink component. Tests pass canonical scratch
roots; a symlinked root/component is an unsafe-target case, not a repair.
Missing show creates nothing. Record creates missing managed directories
with mkdirat mode0700, then opens and validates them. Final state/checkups
directories must be owner-owned and not group/other writable.

Record reads use RDONLY|CLOEXEC|NOFOLLOW|NONBLOCK, followed by fstat before
reading: regular file, expected UID, one link, no execute/group/other bits.
The stable lock leaf uses RDWR|CREAT|CLOEXEC|NOFOLLOW|NONBLOCK and mode0600,
the same fstat validation, and maintained nonblocking exclusive flock.
Temporary leaves use WRONLY|CREAT|EXCL|CLOEXEC|NOFOLLOW and mode0600.
Bound reads before allocation; write the complete validated temporary file,
sync it, recheck the owned destination identity, and publish with renameat
in the same held directory. Keep the stable lock inode after release.

NONBLOCK prevents a FIFO open from hanging before fstat rejects it. This
contract covers cooperating writers and unsafe targets; it is not a sandbox
against malicious same-UID processes, administrators or arbitrary remote
filesystem semantics. Interruption before rename preserves the old record. After rename the new
complete record may be visible even if acknowledgement was lost. Reconcile
with show before retrying. Sync the complete temporary file before rename. No local unsafe FFI is proposed.

## Dotfiles capture and recovery

Current checkup_state.py record mutates current and backfills timeout values
before persistence. Extract a separate immutable generic projection at entry
to record, before that loop. Never derive fresh checked commits from the
mutated/backfilled dictionary or from the prior last-run snapshot.

When record is called with explicit --result, create one completed-assessment
receipt under a new namespaced field of the existing last-run.json:

```text
checkup_record = {
  version: 1,
  run_id: <fresh UUID v4 for this completed assessment>,
  finished_at: <UTC RFC3339 completion time, captured once>,
  result: green | degraded | blocked,
  commits: <copied, validated fresh repo labels and SHAs>,
  eligibility: eligible | ineligible,
  reason: complete | invalid-captured-commit | incomplete-capture
}
```

This is private snapshot metadata, not a new queue or service. Existing rich
fields, timeout backfill, history row shape and append/backfill behavior stay
unchanged. history_row already selects time/verdict/metrics, so it does not
copy this receipt into historical rows. Legacy calls without explicit result
retain their old behavior and produce no exportable receipt; they cannot
reuse an earlier receipt from the previous last-run file.

Validate every originally captured repo value before backfill. Timeout,
missing or malformed required identity makes the receipt ineligible. Keep
the previous generic record; emit a fixed incomplete result. Never substitute
an older SHA or turn a partial healthy assessment into generic green. A
completed blocked assessment may have an empty commits map only when its
explicit captured scope contains no checked repos; bad captured entries are
not equivalent to that case.

The receipt's completion time is captured after assessment/capture completes,
not taken from an earlier snapshot timestamp or generated again on export.
Persist it atomically with the rich snapshot. Then export that exact tuple.
An export failure preserves the already saved rich history and reports that
generic publication is incomplete. There is no cross-file transaction claim.

Recovery is exactly:

```sh
python3 skills/tooling-checkup/scripts/checkup_state.py export --expected-run <run_id>
```

Route export before main's snapshot call. Load and validate the owned saved
receipt once; require its run_id to equal the supplied expected ID, eligibility
eligible, and the complete closed tuple to be valid. Do not accept --result or
new commits on recovery. Recheck the saved file's identity/hash before export;
replacement or missing receipt refuses as stale-run. Read the tuple only from
this immutable receipt, never recompute it from backfilled repos. No history
append, clock refresh, version/Git probe or full-assessment replay occurs.

A later assessment has a fresh run_id even when its result is unchanged.
Therefore recovery for A cannot pair A's result with replacement B's commits.
After uncertain acknowledgement, show reconciles the exact saved tuple. If
the current generic record is newer, recovery refuses; it cannot overwrite a
newer completion with an older one. The existing Phase 12 rule may record a
new completed assessment when answers actually change its outcome; that is
a new identity/time, not a retry relabeled as fresh.

## Frozen safety and caller controls

The following names and variant sets are frozen; a family passes only when every variant passes.

| ID / proposed exact Rust test name | Required decision |
| --- | --- |
| R01 first_show_is_read_only | Missing path returns first-run; no directory, lock or record created |
| R02 two_completed_runs_preserve_previous_context | Real record A/show/record B/show; exact A then B, parsed UTC completion times, distinct per-checkup isolation |
| R03 closed_results_roundtrip | green/degraded/blocked accepted explicitly; no verdict inference |
| R04 interrupted_before_publish_preserves_previous | Kill a separate writer process at a test-only ready barrier immediately before the actual publication call; old bytes survive, lock releases, next valid record succeeds |
| R05 invalid_inputs_preserve_previous | Empty/traversal/oversized name; invalid result/SHA; duplicate entry/key; unknown field; invalid UTF-8/time; 64 KiB+1; 257 entries all refuse unchanged |
| R06 unsafe_targets_preserve_foreign_bytes | Selected-root symlink; checkups symlink; record symlink/FIFO/directory/hardlink; insecure managed mode; wrong-owner metadata decision all refuse without following/blocking/writing |
| R07 concurrent_writer_is_busy | Held real descriptor lock denies another writer; after release same request succeeds; stable lock inode |
| R08 atomic_commit_has_complete_acknowledgement_boundary | Before-rename failure preserves old; after-rename acknowledgement loss is reconciled by show as complete new; no truncated state or false rollback claim. Older retries and conflicting equal-time tuples refuse. Identical retry writes nothing |
| R09 malformed_existing_record_is_not_first_run | Corrupt/oversized/wrong-schema stored record returns fixed refusal, no overwrite |
| R10 missing_or_invalid_commit_capture_is_blocked | Caller cannot silently publish green from missing/invalid checked-repo identity |

Wrong-owner control uses a pure metadata validator plus a real same-owner positive. Do not require chown/root or claim a privileged filesystem probe occurred. Real unsafe-path variants run under scratch HOME/state. The interruption barrier is compiled into the test harness around the actual record library; it is not a production environment flag, signal supervisor, fake cleanup implementation or timing benchmark.

### Caller and native controls

Proposed exact Vitest group: "checkup run record".
- C01/C02: agentbrew FIRST/TWO.
- C03/C04: generated-project FIRST/TWO.
- C05: interruption during existing checkup work invokes no record and preserves prior bytes.
- C06: completed degraded/blocked output is explicit; recording failure cannot turn an old failure or healthy completion into a false green.
- C07: CLI show/record discovery uses existing action routing; no duplicate list, UI path reaches same handler or existing terminal-only contract.
- C08: built CLI loads the fixed packaged native asset from app root, not cwd/PATH/untrusted override.
- C09: missing/wrong-architecture/truncated native asset returns fixed refusal before state mutation; unrelated commands still work.
- C10: generated caller without its optional installed agentbrew prerequisite reports unavailable and preserves pre-existing checks, no false record claim.

Dotfiles Bats additions under exact group prefix "checkup generic record":
- D01/D02: FIRST/TWO through the actual script and actual native artifact.
- D03: existing history backfill/append/metrics and previous snapshots survive generic export; no historical row rewritten.
- D04: counted version/Git ports get zero additional calls after current snapshot is handed to the adapter; captured unknowns refuse generic green. Fresh timeout with a valid old SHA preserves rich backfill and prior generic bytes.
- D05: generic failure preserves saved rich history and fixed failure output; delayed recovery preserves time, result and commits. Replacement B refuses expected A. Same-run retry writes no duplicate history and runs no probes.
- D06: cancellation before completed assessment preserves prior generic and rich records.

Retain the pre-existing tests named "state records a run and reports what changed since" and "state record appends history and backfills the run recorded before it". Do not replace them with new easier controls.

## Scoped skill evaluation

Use the existing dotfiles SKILL.md, evals/evals.json and tooling-checkup Bats
gate. The current maximum eval ID is 23. Append IDs 24–27 with three or more
expectations each. Add Bats assertions for the exact consuming command
contracts and freeze these four synthetic next-decision cases:

| ID | Fixture inputs | Expected ordered decisions |
| --- | --- | --- |
| 24 | Phase 1, previous record exists, no work started | show prior generic record, then existing diff |
| 25 | Phase 10, healthy assessment complete with captured commits | record once with explicit green result, then dashboard export |
| 26 | Phase 12, owner answers leave the prior verdict unchanged | no new record or recovery |
| 27 | Recovery for run A refuses stale-run because run B replaced it | report stale recovery, with no record, reprobe or replay |

For actual model decisions use the existing installed Promptfoo 0.124.1
binary with its maintained Ollama chat provider. The repo default provider
only reads text and cannot answer these cases. Add a dedicated
skills/tooling-checkup/evals/checkup-run.promptfoo.yaml using
ollama:chat:qwen3:14b. Freeze its synthetic prompts and expected ordered
action lists in the preparation. Load the exact checked-in skill text and
the four existing eval prompts as case input. Expected action lists belong
only to deterministic assertion context. Require a JSON action list and
exact parsed-array equality, including length and order. The model returns only a proposed decision. Grade synthetic data with
local deterministic assertions.
Set temperature=0, think=false, format=json, num_ctx=16384,
num_predict=256, and use one worker. Check the rendered prompt includes all
three phase sections and fixture inputs. Keep the configuration outside the
default deterministic CI suite. Record missing/failed model service as
inconclusive rather than counting it as a model decision.

Before execution, bind the qualified model identity from the loopback
server to CHECKUP_MODEL_DIGEST in the private admission receipt. Require the
same identity after execution. A disk manifest alone does not establish what
the server serves. Set CHECKUP_EVAL_DIR to a fresh private receipt directory.

```sh
# Run before and after the selected model eval. A false result stops admission.
curl --noproxy '*' --silent --show-error --fail --max-time 4 http://127.0.0.1:11434/api/tags | jq -e --arg digest "$CHECKUP_MODEL_DIGEST" '($digest | test("^[0-9a-f]{64}$")) and any(.models[]?; .name=="qwen3:14b" and ((.digest|sub("^sha256:";""))==$digest))'
# From the approved agentbrew test worktree. DF572 points at the frozen dotfiles worktree.
JOBS=1 PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1 PROMPTFOO_CONFIG_DIR="$CHECKUP_EVAL_DIR/state" OLLAMA_BASE_URL=http://127.0.0.1:11434 NO_PROXY=127.0.0.1 no_proxy=127.0.0.1 heavy-run --exclusive ./node_modules/.bin/promptfoo eval -c "$DF572/skills/tooling-checkup/evals/checkup-run.promptfoo.yaml" --max-concurrency 1 --no-cache --no-share --no-write --no-progress-bar --output "$CHECKUP_EVAL_DIR/receipt.json"
```

Require 4/4 valid exact decisions on the first qualified evaluation of the
candidate, zero unexpected actions, zero provider/setup errors and four
retained case receipts. A failed decision rejects the registered skill
wording. An unavailable provider leaves model acceptance pending. This
measures four decisions from the stated provider and input, while Bats
measures real diff/record behavior and static instructions. Neither measures
an actual twelve-phase run.

Primary runner references: [Ollama chat provider](https://www.promptfoo.dev/docs/providers/ollama/)
and [local telemetry controls](https://www.promptfoo.dev/docs/configuration/telemetry/).
The installed provider source also confirms OLLAMA_BASE_URL routes /api/chat.

## First native host gate

First qualification is aarch64-apple-darwin with a fresh private APFS state
root. Require the scratch fixture's host/mount probes below and recheck its
ownership and selected toolchain before admission. CHECKUP_STATE_FIXTURE
is the private state root selected by that run. Record the source revision,
lock, toolchain and Mach-O architecture
and asset SHA from each real scratch install. A missing toolchain is setup
failure. Do not broaden the Node floor, add runtime compilation to the
packed app or activate on an unqualified target.

Use a standalone locked Cargo package at rust/checkup-run. The
CLI resolves the target-tagged native asset at
`dist/native/darwin-arm64/checkup-run` from its installed application root.
Cargo builds outside dist, then the existing build stages the qualified
asset after tsup's clean phase. An app build must not silently leave a
claimed-supported helper absent. Cold source qualification uses a declared
prequalified compiler; pack runs the installed asset without a compiler.
Exercise source, cold, pack and predecessor-preservation cases through the
existing real-e2e scenarios, with these exact commands after adding the
checkup fixture controls:

```sh
test "$(uname -s)-$(uname -m)" = Darwin-arm64
diskutil info -plist "$(df -P "$CHECKUP_STATE_FIXTURE" | awk 'END { print $1 }')" | plutil -extract FilesystemType raw -o - - | rg -x apfs
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/checkup-run/Cargo.toml --target aarch64-apple-darwin -- --test-threads=1
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run npm run build
JOBS=1 heavy-run npx vitest run --maxWorkers=1 --config vitest.real-e2e.config.ts real-e2e/scenarios/us01-one-step-install.test.ts
JOBS=1 CARGO_BUILD_JOBS=1 E2E_COLD=1 heavy-run npx vitest run --maxWorkers=1 --config vitest.real-e2e.config.ts real-e2e/scenarios/us01-one-step-install.test.ts
JOBS=1 heavy-run npx vitest run --maxWorkers=1 --config vitest.real-e2e.config.ts real-e2e/scenarios/us01-us21-npm-package-hooks.test.ts
JOBS=1 CARGO_BUILD_JOBS=1 NO_CACHE=1 LOCKFILE_SYNC_NPM=npm@10.9.9 heavy-run npm run verify
# From dotfiles.
JOBS=1 heavy-run make check BATS_JOBS= TEST_FILE_JOBS=
```

Require N01 built CLI, N02 cold source and N03 packed install to return the
exact record contract through their actual fixed native asset. Within N01
verify missing, wrong-architecture and truncated scratch assets each refuse
with zero record writes and preserve ordinary CLI behavior. N04 requires
failed candidate preparation to preserve a usable predecessor and the
previous state. Keep separate scratch prefixes and compare byte identities.
Require 4/4 native families with all variants and actual receipts. A run that
skips an install scenario cannot supply that family's receipt.

There is a real limit on the current in-place update path. install.sh runs
npm ci and build directly in REPO_DIR, and tsup cleans dist. Its settings
restore path does not establish preservation of the predecessor executable.
The staged scratch candidate gate proves isolated preparation failure only.
If the supported rollout uses in-place updates, require a separate qualified
preservation mechanism and proof before activation. Do not substitute source
success or a newer build-info file for that proof. Retain unsupported host
behavior and keep issue 572 open wherever required delivery remains unproved.

Preserve behavior on other hosts. A target without a qualified asset reports
unsupported-target for the new action without writing state or downloading
a helper. Keep any required target qualification in the native delivery task.
For native ownership and atomic publication, prefer maintained safe Rust
filesystem operations and a maintained RFC3339 parser. Freeze the toolchain
and Cargo lock before compilation.

## Decision and completion

GQM asks whether each completed assessment exposes its original prior record
and whether unsafe or partial writes preserve it. Keep the candidate only at
the exact thresholds above. Reject it on any semantic miss, unsafe write,
stale replay, extra probe or retained-history regression. Missing host or
provider proof leaves its acceptance pending. Close the issue only after
the required producer, recovery, skill and supported native delivery proof.

Anchors: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration; [POSIX rename](https://pubs.opengroup.org/onlinepubs/9799919799/functions/rename.html).

## Reproduce in-place publication on Apple Silicon

Use a local Apple Silicon Mac with Xcode, Node, npm and Rust. The fixture
builds the public predecessor at commit
`6710ea9b633e27f34314029a92835fa84be5f68d`. It checks both lockfiles,
the build stamp, the native executable and the complete output manifest.
Keep the source clone and evidence in scratch storage.

```bash
scratch="$(mktemp -d)"
mkdir "$scratch/evidence" "$scratch/empty-template"
git init --template="$scratch/empty-template" "$scratch/source"
git -C "$scratch/source" fetch --depth=2 \
  https://github.com/fyodoriv/agentbrew.git \
  6710ea9b633e27f34314029a92835fa84be5f68d
git -C "$scratch/source" checkout --detach FETCH_HEAD
heavy-run env E2E_COLD=1 E2E_CHECKUP_IN_PLACE=1 \
  CHECKUP_N04_PUBLIC_SOURCE="$scratch/source" \
  CHECKUP_N04_DEVELOPER_DIR="$(xcode-select -p)" \
  CHECKUP_N04_EVIDENCE="$scratch/evidence" \
  npm run test:real-e2e -- real-e2e/scenarios/us01-one-step-install.test.ts -t N04
```

The producer checks that its scratch write succeeds and an outside sentinel
stays unchanged. It then runs four provenance checks and six installer
and publication tests. Keep logs and generated artifacts out of commits.

## Recorder read guard

The Rust recorder can hold its existing writer lock while an in-process
caller acts on one checked record. The caller supplies the digest returned by
`show`. The guard checks that digest after it takes the lock. A missing or
replaced record refuses before the operation. A concurrent writer returns
`busy` until the guard releases. The operation must not call the recorder's
writer. The guard creates no state.

```bash
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/checkup-run/Cargo.toml --target aarch64-apple-darwin --test native_read_guard -- --test-threads=1
```

This API has no CLI route. Dotfiles still needs a qualified build dependency,
a shared lease for its rich-state writers, and a final publisher that holds
both locks. Keep its writer and dashboard changes together. The four model
cases and installed acceptance remain open.
