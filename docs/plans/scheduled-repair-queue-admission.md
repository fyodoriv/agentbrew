# Scheduled repair queue admission

## Overall goal and vision

Scheduled repair must enter the configured machine queue before it runs sync
or starts MCP probes. Keep the existing per-user scheduler and its privacy,
Node, working-folder, log, interval and enabled-state policies. This is a
current-correctness repair before the separately measured Rust port.

Prediction: task `scheduled-repair-queue-admission`, committed in `f68ac571`.
This plan freezes the adapter controls before their first run. No installed
scheduler, owner setting or queue limit changes in this preparation.

## Decision and alternatives

Add `scheduledRepairQueue` to the existing setting table, with `direct` and
`heavy-run` values. Default to `direct` for standalone installations. Selecting
`heavy-run` uses the existing active dotfiles-bin resolver and retains the
approved Node plus `cli.js fix` as separate arguments. A missing, nonexecutable
or rejecting selected runner never falls back to direct repair.

A plain queue prefix is insufficient: the queue's nested fast path trusts an
inherited held-reservation marker. The queued scheduler entry therefore needs
a fixed launch-context guard that refuses any nonempty incoming
`HEAVY_RUN_HELD`. It must not copy a lease or clear one to force admission.
A narrow POSIX `exec` guard is the candidate execution-context adapter; it
must not contain repair or scheduling policy. A new scheduler, generic process
supervisor and duplicated capacity policy are excluded. The exact guard is
subject to outside review before production code.

## Evidence and current state

| Claim | Source | Status |
| --- | --- | --- |
| Scheduled repair currently runs Node and `cli.js fix` directly | `src/sync/scheduler-paths.ts`, `buildLaunchAgentFixArgs` | fact |
| The plist retains a Node override only when it equals the first argument | `src/sync/launchagent.ts`, `buildPlistContent` | fact |
| Node drift helpers currently inspect only the first argument | `src/drift-checks/launchagent-path.ts` | fact |
| Queue rejection can stop the payload before sync/probes | generated-argv execution controls | verify |
| The setting belongs to the existing CLI configuration table | `src/settings.ts` | proposed |

## Boundary contracts

The setting is per-user `state.yaml` configuration, written through
`agentbrew config set`. It does not change `autoRepair` or install a job when
the user opted out. The generated plist is the per-user scheduler output.
Configuration applies on the next intentional auto-sync installation/repair.
Selecting the queue while an old direct job remains must be reported as drift;
the setting alone must not imply that the deployed job is queued.

The configured runner comes from `resolveDotfilesBinPath`, not arbitrary shell
text. Its arguments preserve Node identity, CLI path and `fix`. Queue-run mode
must retain `AGENTBREW_NODE_BIN` and recognize that same Node in drift checks.
Unknown wrapper shapes must not be treated as validated queue routes.

Controls execute the actual generated arguments with a deterministic fixture
runner and a harmless Node payload. That proves adapter dispatch and refusal,
not actual machine-queue ownership, capacity or launchd behavior. Only service
calls are replaced; plist rendering, configuration, argv and Node execution
remain real. Fixtures use scratch HOME and contain no owner config or secrets.

## Frozen controls

| ID | Input | Required outcome |
| --- | --- | --- |
| Q01 | Selected queue holds admission | no sync/probe payload start before admission |
| Q02 | Selected runner rejects | runner exit retained; no payload start |
| Q03 | Selected runner missing | nonzero refusal; no direct payload start |
| Q04 | Selected runner lacks execute permission | nonzero refusal; no direct payload start |
| Q05 | Selected runner admits | admission precedes sync/probe starts; approved Node, argv and cwd retained |
| Q06 | Fresh scheduler entry receives a nonempty lease marker | refuse before queue or payload; do not clear or reuse it |
| Q07 | Queue prefix plus explicit Node override | generated plist retains the override and approved Node |
| Q08 | Queue selected but deployed job still direct | report queue-route drift |
| Q09 | Queued job's Node disappears | report Node drift rather than skipping it behind the prefix |
| Q10 | Standalone direct route | retain the direct Node/CLI/fix contract |
| Q11 | New setting through existing setter | save/read back allowed values; reject another value; retain unrelated settings |
| Q12 | Queued plist | preserve cwd, interval, logs, RunAtLoad and locale; do not serialize caller lease variables |

## Numbered work breakdown

### 1. Reproduce the adapter gap

- **Why:** prove the direct route can start repair before configured admission.
- **Parallelism:** independent of Rust inventory and lifecycle work.
- **Owner / boundary:** agentbrew scheduler adapter and isolated fixtures.
- **Change:** add the frozen controls without changing production code.
- **Evidence / acceptance:** record actual unadmitted-start and refusal failures;
  keep setup errors separate from product failures.
- **Verification:** `heavy-run npx vitest run src/sync/launchagent-queue.test.ts src/sync/scheduler-paths.test.ts --maxWorkers=1`.

### 2. Implement after outside review

- **Why:** stop configured repair from bypassing queue admission.
- **Parallelism:** depends on the actual unchanged-source red and plan review.
- **Owner / boundary:** settings, scheduler argv/plist and route-aware drift.
- **Change:** implement the narrow adapter and matching README guidance.
- **Evidence / acceptance:** zero unadmitted starts or direct fallbacks in the
  frozen controls; all retained scheduler/private policies pass.
- **Verification:** the same focused command, then `heavy-run npm run verify`.

### 3. Prove the operator handoff separately

- **Why:** waiting for a queued RunAtLoad job while retaining an exclusive
  outer reservation deadlocks admission.
- **Parallelism:** after the queued scheduler route is delivered and reviewed.
- **Owner / boundary:** private operator lifecycle, not a second scheduler.
- **Change:** restore/bootstrap without waiting under the outer lease; release
  the owned dotfiles lock and outer reservation before a fresh bounded observer
  verifies the newly admitted run and protected state.
- **Evidence / acceptance:** an owned synthetic handoff completes after release;
  no fabricated lease, copied marker or changed machine capacity.
- **Verification:** register the exact handoff controls before that private
  operator change; an installed launchd proof remains pending until then.

## Rollout and security

Keep all work local while publication is unavailable. First deliver the source
change through its normal gate. Then intentionally configure the owner's queue
using the CLI setter and review the generated job before any service change.
Preserve the previous generated job for a reviewed rollback; do not restore
unknown owner files or disable memory/privacy choices. Do not describe fixture
dispatch as field ownership, deployment success or complete queue safety.
