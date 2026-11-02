# MCP git candidate build preparation

## Overall goal and vision

Move a git-installed MCP server to the requested source without changing the
files used by its current runtime. A refused re-pin must keep that runtime,
its dependencies and user files intact. This supports VISION G5 and stories
US-10 data safety and US-26 rollback. G5 is "Drift detection + auto-repair" in
the current VISION frontmatter; docs/user-stories/10-data-safety.md and
26-rollback.md hold the preservation contracts. PR #607 remains draft until the new
boundary and the original compatibility cases pass.

## Decision and alternatives

Build each different source commit in a fresh candidate clone. Register the
candidate's absolute runtime path after validation. Keep the old runtime at
its original path. Do not swap directories, mutate the old checkout, or carry
its ignored/untracked files into the candidate. Retain refused/interrupted
candidates for recovery; this change adds no automatic garbage collection.

Reject output ownership inferred from before/after filenames, timestamps,
extensions or declared output folders. Builds and running servers can both
create config or token files in those folders. A fresh candidate removes the
need to classify old files for moving or deletion. Reject an in-place clone
swap: an already running process can load more files through its old pathname.

Reuse Git's independent clone and exact-ref helpers, current Node entrypoint
resolution, state registration, and the real-git fixture harness. Use no linked
worktree, shared object directory, alternates, or borrowed node_modules from
the active cache. Prefer no new dependency or top-level CLI action. The narrow
fresh-runtime argument below addresses the state portability consequence.

## Evidence and current state

| Claim | Current source of truth | Delivery path | Status |
| --- | --- | --- | --- |
| Current re-pin updates the cache before building | mcp-git.ts cloneOrUpdateRepo and install/update flows | checkout then npm | fact |
| Draft output records include any newly seen non-node_modules file | listUntracked, pendingBuild | file inventory to move set | fact |
| Draft rollback checks out the old commit and may reinstall dependencies | restoreCachePin | active runtime directory | fact |
| Main validates Node paths as files or resolvable directory entries | isNodeEntrypoint; mcp-git-entrypoint-files.test.ts | detectEntrypoint | fact |
| Build/registration fixtures use scratch repositories and mock agent sync | mcp-git-install.test.ts | actual Git/npm, fake state sink | fact |
| Install syncs before saving state; update saves before sync | mcp-sync-commands.ts addMcpServer; mcp-git.ts updateMcpFromGit | existing registration owners | fact |
| Candidate builds preserve every prior runtime inode and file | proposed boundary below | independent clone to state args | proposed |
| Candidate receipts exclude stale legacy artifacts | proposed receipt and controls | exact source/runtime validation | verify |

The preserved starting PR head is 4574eb7b60aa5262cf5fcae902c692678dee2761.
Its normal main merge includes b8ce653dc5b83b14ff221f1755538196227c3ba7.
This registration precedes new fixtures, their results, and production changes.

## Scope

In: install/re-pin/update candidate ownership, source/ref identity, entrypoint
selection, explicit fresh-runtime consent, truthful publication outcomes,
failure preservation and recovery, the task and README guidance.
Keep URL credential scrubbing, env prompting, exact ref rules, Node directory
entrypoints and current Python support. No MCP process, real cache, service,
agent config, setting or native conversation store changes during development.

Out: a sandbox for arbitrary build scripts, runtime-state migration, automatic
cache deletion, a generic supervisor, live service restart, and the later Rust
MCP lifecycle port. Repository builds remain trusted executable code. The data
preservation guarantee governs agentbrew's own mutation sets; it is not a claim
that a malicious build cannot deliberately write outside its directory.

## Boundary contracts

### Candidate ownership and lifecycle

Use a separate `~/.config/agentbrew/mcp-builds/<name>/<attempt>` namespace.
The validated server name identifies one installation. An unpredictable
exclusive-created attempt directory belongs to one install/update invocation.
Reject symlinked parents, foreign ownership and existing attempt collisions.
Clone from the verified source into it with independent Git object storage.
Use `--no-local` for local-path sources; no `--shared` or reference repository.
The official [clone contract](https://git-scm.com/docs/git-clone) distinguishes
these forms and warns that shared objects depend on the source's retention.
Never initialize it by copying a runtime cache or by checking out a new commit
over an old one. All npm/build writes target the new candidate.

Keep the legacy `mcp-repos/<name>` cache and every previously accepted candidate
untouched. Do not rename, unlink, truncate, checkout or install dependencies in
them. Do not traverse their arbitrary file payloads to discover carry-over data.
Read only source/ref and registered-runtime identity needed to validate an
update. Source URL mismatch or unsafe legacy Git metadata still refuses.
Disable optional Git index writes for those legacy metadata reads. Do not
run status, refresh, fetch or an old-cache payload inventory. Preserve the
owner Git wrapper, credentials context and repository-redirect environment scrub.

No automatic cleanup after failure, interruption or success may remove a
candidate: it can contain files a build or runtime created. Retention consumes
disk space. State this tradeoff; do not switch back to destructive output lists
if fresh cloning is slow. No latency improvement is claimed by this experiment.

### Source and receipt authority

A versioned receipt binds an attempt ID, validated server name, credential-free
source identity, full target commit, original ref kind/name, resolved entrypoint
path and hash, and build verdict. Store no command output, secret value or
runtime file content. A successful build alone is not activation authority.
Write candidate-ready evidence after validation; mark acceptance only after
confirming registration names that exact candidate. Ready evidence alone does
not authorize same-commit fallback.
Receipts must be atomically written and read as untrusted data with strict
schema/path/size validation. Missing or malformed receipt cannot authorize old
artifact reuse. A legacy output-list or built-commit marker is not this receipt.

No source branch in the active runtime is advanced during update. A fresh
candidate resolves the saved branch again. Preserve tag/commit update refusal,
tag-before-branch precedence, full OID validation and source-origin checks.
For a legacy installation, read its validated Git ref identity without writing
the cache; acquire a fresh candidate. Never bless legacy ignored output.

### Entrypoint identity and compatibility

Only detect within the new clone or an already accepted same-commit candidate
with valid source/runtime identity. The final resolved entrypoint must be a
regular file inside that exact candidate; external symlink targets refuse.
Preserve supported Node directory resolution. Store the actual resolved file
identity while preserving Node invocation behavior when it needs a directory.

An ignored v1 output cannot exist in the clean v2 clone. A v2 build moving
dist/index.js to build/index.js therefore selects build/index.js on every run.
A no-op build with no usable target entrypoint refuses. A tracked entrypoint
already shipped by the target remains eligible under the existing fresh-clone
policy; no failed build may authorize old-commit output from another directory.

Do not use an arbitrary token/config filename as an entrypoint merely because
it appeared during a build. Keep the existing supported candidate filenames
and package bin/main inputs. A package-declared candidate and a discovered
candidate must meet the same source/root/file checks.

Same-commit reuse is allowed only for a valid accepted candidate whose sealed
runtime identity still matches. Do not rebuild it in place. When the requested
build fails, retain the already accepted runtime only if the source commit and
runtime evidence still match; otherwise refuse without editing it. An absent
or changed receipt/entrypoint never falls back to the legacy cache.

### Runtime-state portability and caller parity

Preserving old files is not proof that a new directory preserves application
state. Relative database/config paths can resolve differently. Do not infer
portability from a clean tree, filenames, env equality or a successful build.

First installation has no previous runtime to migrate. Reusing a verified
accepted same-commit runtime keeps its original path and needs no new choice.
For a different runtime directory, require explicit `--fresh-runtime` consent:
start with new cache-local runtime state, preserve the old directory, and copy
nothing automatically. Without it, refuse activation with the fixed portability
reason. `--yes` means non-interactive mode in both current parser paths; it does
not provide this different consent. Preserve that meaning.

Add the same narrow argument to `install --git`, `mcp add --git`, and `mcp update`.
Validate use with a git operation. Keep ordinary env/ref handling unchanged.
Commander remains the source for `actions --json`; test option propagation and
the agent note describing the fresh-state consequence. There is no agentbrew
UI to duplicate: src/actions.ts and docs/repo-map.md explicitly say so. Any
future UI must consume that same generated action. No hidden alternate action.

This is a deliberate registered policy change. Existing success fixtures for
a different runtime must opt into it when adapted to the new namespace; their
original data/ref/env assertions remain. Add a separate refusal fixture without
consent. Do not present this adaptation as an unchanged-policy result. No live
runtime choice is made in this source task.

### Registration, failure and recovery

Before candidate acceptance, clone/build/detection/portability failures call no
registration or sync and leave old state/config and old runtime bytes unchanged.
Use one short cooperative publication lease for participating git installers,
including different server names. Do not hold it while cloning or building.
After acquiring it, reload state and compare the expected server/source/ref;
refuse an observed change. Merge only this server into the fresh state. Bound
contention; a missing/foreign/crashed lease refuses rather than running unlocked.
No stale numeric PID or age proves permission to clear a lease. This boundary
does not claim to serialize old CLI processes or arbitrary external editors.

The current owners differ: addMcpServer syncs then saves; updateMcpFromGit saves
then syncs. Add a narrow git-candidate publication result without claiming a
broad state transaction: refused-before-publication, verified, or partial/unknown.
Its state write must read back the exact source/ref/command/args/env in memory.
Collect native and bridge/client fan-out errors as typed outcomes, with exact
effective-definition readback for a verified verdict. Compare env values only
in process memory; never log, snapshot or copy them into receipts. Missing outcomes remain
unknown. Do not infer completion from a void promise, counts or server presence.

If publication/save/sync fails after any possible write, retain both complete
runtimes, ready evidence and original runtime identity. Return nonzero and name
only safe failure categories; do not print success or mark the receipt accepted.
Some configs or state may name the complete candidate. Retry from the actual
read-back desired state; do not silently roll back across partial fan-out or
claim atomic cross-agent deployment. Existing unrelated state writers retain
their own behavior; no universal compare-and-swap claim is made here.

The existing config snapshot/rollback path can recover deployed configs after
review. Do not automatically restore an old whole-state snapshot over another
writer. This task does not redesign all state writers or make sync--rollback
restore runtime data. A re-pin to the preserved old source/runtime remains
possible after its identity is revalidated.

An attempt interrupted before publication remains unregistered and retained.
After any possible publication, keep both runtimes and require readback before
classifying the outcome. Later attempts use a different directory. Recovery
receipts must not contain stale numeric-PID
authority or silently resume a partially built candidate. A malformed or
interrupted activation receipt is non-green and requires preservation.

## Registered hypothesis and measurement

Goal/question/metric: does the isolated-candidate boundary eliminate stale
registration and mutations of the old runtime, while retaining supported
source/ref and build behavior? Measure unsafe outcomes and wrong decisions
against the frozen matrix below and the existing real-git cases.

Hypothesis: source predicts old-runtime mutation in N01-N04 and N07 on the
current in-place implementation. Candidate ownership reduces those unsafe
outcomes from five to zero. All matrix decisions must be correct; no original
retained assertion may be weakened or removed.
This predicts five mutation defects, not failure of the entire new cohort.
Valid expected positive controls must remain accepted. The explicit portability
consent change above is separate from that safety prediction.

Success: 100% expected matrix decisions; zero agentbrew-caused old-runtime
byte/inode/HEAD or dependency mutation, zero lost user files, zero stale-commit registrations,
zero changed state on pre-publication refusal, and every retained MCP regression
and required gate passes. No speed or complete-process-sandbox claim.

Pivot: any unsafe mutation, stale registration, accepted missing identity or
changed retained policy rejects this boundary implementation. Do not fall back
to in-place build/output classification. If the candidate/registration boundary
cannot satisfy a case, change its ownership design before production work.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration; US-10 and US-26 preservation contracts. Git clone is the
maintained isolation mechanism; its independent-storage and ref behavior must
be checked against the official clone documentation before implementation.

Proposed fixture cohort in the existing real-git test file:

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git-install.test.ts -t 'isolated candidate boundary'
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git-install.test.ts src/mcp/mcp-git-entrypoint-files.test.ts src/mcp/mcp-git.test.ts
JOBS=1 heavy-run npm run verify:changed -- origin/main
JOBS=1 heavy-run npm run verify
```

The new named cohort is not present at registration. A zero-selected run or a
fixture/setup/compiler failure is inconclusive, never semantic red. Root owns
heavy job admission and exact source receipts. The docs-only prediction gate
is `JOBS=1 heavy-run npm run verify:changed -- HEAD`, run after the normal main
integration commit and before committing this plan. That explicit baseline
compares only new docs with the already gated integration, rather than
mislabeling the existing draft runtime delta as new docs. It must pass before
this prediction is committed and before fixture source is added. After runtime
changes, use the explicit origin/main gate and full verify above; the prediction
gate is not a runtime acceptance receipt.

## Frozen matrix

| ID | Condition | Required decision and preservation oracle |
| --- | --- | --- |
| N01 | Successful v1-to-v2 moved-output re-pin, repeated | register exact v2 build path; old tree/HEAD/dependencies unchanged |
| N02 | Candidate fails after creating partial output | refuse before registration; old tree and state unchanged |
| N03 | v2 tracks v1's previously ignored output pathname | candidate isolated; old ignored bytes/inode unchanged |
| N04 | Build creates config; old runtime writes token during candidate build | never move/delete/replace either old file |
| N05 | Legacy cache has stale output and no accepted receipt | never reuse legacy output; fresh target or refusal |
| N06 | No-op build has no target entrypoint | refuse; old output cannot satisfy detection |
| N07 | Branch update's build is refused | old branch/HEAD/dependencies/state remain unchanged |
| N08 | Candidate interrupted before acceptance | retain it; next attempt never clears or resumes it implicitly |
| N09 | Entrypoint or candidate ancestry escapes via symlink | refuse; no outside mutation or registration |
| N10 | Receipt/source/root/entrypoint identity is missing or mismatched | refuse reuse; no legacy fallback |
| N11 | Same-name and different-name participating git installers overlap | parallel builds; serialized publication reloads state and preserves both definitions or refuses safely |
| N12 | Registration/save/sync fails after candidate validation | retain complete runtimes/ready evidence; no false accepted receipt or success |
| N13 | Existing runtime changes directory without fresh-runtime consent | refuse before publication; old state/runtime stay selected |
| N14 | Ordinary --yes without fresh-runtime consent | same refusal; no expanded meaning for --yes |
| P01 | Same target has a valid accepted build; a fresh candidate build fails | reuse the accepted runtime without rebuilding it in place |
| P02 | Fresh target contains committed entrypoint and its build fails | retain current fresh-clone committed-artifact policy |
| P03 | Tracked no-build Node file/directory or Python entrypoint | preserve supported detection with candidate-local resolved file |
| P04 | Exact ref/source/env behavior | retain branch/tag/commit rules, origin mismatch refusal and credential-safe env behavior |
| P05 | Explicit fresh-runtime request through all supported parser/action paths | same handler/policy, new directory selected only after verified publication |

Use owned readiness barriers for N04/N08/N11, real scratch repositories and
synthetic marker bytes. Snapshot the old tree before each attempted re-pin;
include tracked/ignored/untracked files and dependencies. Assert exact bytes,
inode identity and HEAD afterwards. For N04, allow only the exact synthetic
runtime writer's declared token delta; compare every other path unchanged.
Keep expected state and registration-path
oracles separate from the implementation's receipt. Do not print payloads.

## Numbered work breakdown

### 1. Register and reproduce

- Why: preserve the original design defects as observable counterexamples.
- Parallelism: after normal main integration; before production changes.
- Owner/boundary: PR #607 docs and scratch real-git fixtures.
- Change: commit this prediction after its gate; then add only the named cohort.
- Acceptance: every fixture reaches an actual behavior assertion; preserve the
  five predicted mutation results even if other decisions already pass.
- Verification: first focused command; root captures exact red tree and log.

### 2. Replace mutation ownership

- Why: remove old runtime files from every checkout/build/move/delete set.
- Parallelism: after valid semantic red and independent root review.
- Owner/boundary: mcp-git install/update adapter; candidate invocation and receipt.
- Change: fresh clones, candidate-local detection, identity and registration;
  delete superseded output-list/aside/restore logic rather than layer both.
- Acceptance: all matrix and retained cases pass; original data remains.
  - Verification: the focused and retained commands, then required gate.

### 3. Document and deliver

- Why: explain retained disk state, runtime-local data and recovery truthfully.
- Parallelism: after boundary acceptance; root owns publication.
- Owner/boundary: README pinning guidance, task, PR Pending and install coverage.
- Change: replace the draft's incorrect output-list safety claim; document that
  ignored files are not migrated and old directories are kept. Update install
  path coverage for the candidate namespace where required.
- Acceptance: source/current-base gate and leak checks pass; no live cache or
  process action. Task closes only after final implementation evidence.
- Verification: required verify gate and outside review; full gate if needed.

## Rollout, security and unresolved checks

Keep the existing draft PR and contributor history. No force push, bypass or
live install. Root alone commits and publishes. The first new commit is this
prediction, then fixture-only red, then reviewed runtime changes. Preserve old
refused/interrupted recovery copies throughout integration.

Before production, root review must accept the exact same-commit receipt
strength, cooperative publication exclusion, explicit consent parity,
typed partial outcomes, candidate root validation and
entrypoint resolution. These are implementation proof obligations, not a
permission to omit matrix rows. No live timing baseline or new speed claim is
needed for this correctness experiment; later Rust measurements stay separate.


## N15 supplement: real registration success before final readback

This supplement preserves N01-N14 and P01-P05 unchanged. Their candidate
boundary receipt is separate from this new registration-message control.
The original compatibility cases remain a separate acceptance obligation.

Goal: prevent a Git candidate publication failure from reporting success.
Question: does real `addMcpServer` print a success message after its save or
fan-out port reports failure? Metric: false-success outcomes in two fixed
synthetic cases. Source inspection predicts two outcomes before the fix and
zero after a candidate-only success-reporting guard.

N15 uses the real `addMcpServer` implementation, reached through the existing
scratch publication port. Each case starts with an accepted scratch runtime,
prepares a valid different candidate with explicit fresh-runtime consent,
then forces exactly one failure: state save or agent fan-out. Inject the
failure at that real implementation's existing port, not at an all-mocked
replacement that cannot print its registration message. No live agent,
MCP server, native config, credential, or owner cache participates.

Each case must reach its selected fault exactly once, exit with status one,
leave the complete prior runtime tree byte-, inode-, mode- and HEAD-identical,
retain candidate ready evidence without an accepted candidate receipt, and
emit no success claim containing `registered`, `installed from git`, or
`updated to`. Inspect the full captured log calls, including multi-argument
calls, in RAM. Do not weaken the existing N12 success oracle or fold these
new cases into its earlier result.

Measurement, from the owned checkout with one worker:

```sh
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git-install.test.ts -t 'N15 real registration failure'
JOBS=1 heavy-run npx vitest run --maxWorkers=1 src/mcp/mcp-git-install.test.ts -t 'isolated candidate boundary'
```

Freeze both variants and their assertions before the first baseline result.
A setup/compiler failure, missing selected case, or unreached fault is
inconclusive. Preserve that result separately; do not call it semantic red.
The pre-fix baseline must fail on the false-success assertion after the other
failure and preservation observations are collected. Keep the two-case
supplement denominator separate from the original boundary cohort.

Success: false-success outcomes fall from the predicted two to zero; both
faults are reached exactly once, both exits are one, both prior runtimes have
zero changes, no failed candidate is accepted, and all original boundary and
retained compatibility oracles pass before delivery. Pivot: any remaining
false success, accepted failed candidate, preservation change or weakened
oracle rejects the reporting fix. Revisit the publication boundary; do not
hide all output or infer success from registration alone.

The proposed production change is only an optional success-reporting argument
on the existing add-server options, disabled by candidate publication. Other
callers retain their existing messages. The Git handler reports success only
after exact saved-definition/fan-out readback and candidate acceptance. This
prediction authorizes no production edit before the baseline is reviewed.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et al.
(2017), preregistration; the registration/failure/recovery contract above.
The docs-only pre-commit gate is
`JOBS=1 heavy-run npm run verify:changed -- HEAD`, with the candidate source
preserved outside the index. It is not a runtime or compatibility gate.
