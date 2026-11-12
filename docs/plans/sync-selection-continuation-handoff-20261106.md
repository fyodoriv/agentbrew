# Sync selection: unapproved continuation handoff

The task is `sync-selection-preflight`. Its behavior fix is not complete.
The original goal is paused. This handoff preserves work for a later session;
it is not a registered prediction or authorization to run measurements.

## Original acceptance stays unchanged

Keep these four controls and their separate roles:

1. `emptyAPI`: real `update({only:""})`.
2. `emptyPull`: real CLI `sync --pull --only ""`.
3. `unknownPlain`: real CLI `sync --only fixture-invalid`.
4. `selectedPlain`: real CLI `sync --only hooks`.

Invalid selections must exit nonzero before startup, workspace, state,
installation, source or publication effects. A valid selection must exclude
live preparation and native publication for every unselected module while
deploying the requested content. An invocation without a selection retains normal
configured behavior.
Keep default, explicit-pull and ownership regression controls.
Zero calls at replaced collaborators do not prove zero real writes.

## Preserved observed failure

The installed PR #806 canary on Nov 6 rejected `hooks,fixture-invalid` with
actual exit 1, but the strict unchanged-tree assertion failed: the last-seen
timestamp record changed. Preserve that failed result and its original oracle.
The same receipt reported state unchanged and selected hook absent.
The caller is the root `preSubcommand` hook, not `preAction`.
Only the timestamp change was observed; other startup effects are source risks,
not additional measured failures. Do not invent an exact execution timestamp
where the receipt contains none.

## Current design status

An earlier generic five-unit observer/descriptor proposal was not implemented.
Its unit helpers would not establish interception of actual product calls.
Retain it as superseded history, not a preparation result.

The newer existing-seam proposal is unreviewed design only. It proposes actual
`buildProgram`, `filterSyncModules`, `buildSyncModules` and direct `update`, with
explicit existing Vitest collaborator mocks and all eight module bindings.
It is not committed prediction, execution approval or evidence of safety.

Strict sequence: register and review exact infrastructure, land its preparation
PR without admitting target cases, verify landed source, then capture once.
Use dedicated measurement-only entries outside the default test glob and an
explicit config inheriting all ordinary isolation, scratch-home, task-write and
environment guards. No product environment selector or generic observer is needed.
The preparation full gate qualifies infrastructure, not four-case outcomes.

The proposed capture is descriptive: actual ordered imported-boundary calls,
mocked publication labels, selected names, in-memory changes, invocation status
and actual outer exit. Do not assert the future safety-zero outcome yet.
An empty source fixture and a mocked runner leave source/lock and real runner
preparation coverage open. Missing evidence cannot become an acceptance pass.
Same-module lexical helpers cannot be intercepted by spying on their exports.

## Remaining real-output obligations

Register actual signed local plugin fixture bytes and identities before real
child controls: tag, commit, tree, signer, capabilities, lock, modes and outputs.
Freeze canonical scratch paths, built artifact identities, startup/cache bytes,
audit paths and no-network/write restrictions before invoking the child.
Snapshot bytes, kind, links, mode and modification time. Include a normal enabled
scratch event log, an explicitly empty telemetry key and no real endpoint.
Actual child output proves writes in that fixture, not internal call absence.

Requested native facets must work in cold selected hooks/MCP/rules controls.
A blanket native-emitter skip cannot replace requested deployment.
Freeze shared envelope/version/source ownership, declared versus generated hooks,
unselected facet preservation, launcher ownership/pruning and required safety
pattern dependencies before behavior promotion.
Activation is separate from payload publication. Cold/warm/enabled/disabled/unknown
activation outcomes remain subject to review; this handoff adopts no new policy.
Safety requirements must precede any selected publication or activation.

## Next admitted step

First review and register the exact dedicated config, fixtures, mock inventory,
default-exclusion proof, receipt schema and bounded capture command.
Only after preparation merges and its source is verified may this proposed command
be used under that registration:

```sh
JOBS=1 heavy-run npm exec -- vitest run --config vitest.sync-selection-baseline.config.ts --maxWorkers=1 --reporter=default --silent=false
```

Capture four cases once; preserve actual exits and pause for review.
Do not run this command now: the proposed entries/config do not exist.
Then separately register real-child instrumentation and behavior measurements.
The original three-file task RED/GREEN command and all acceptance remain required.
Future reviewed preparation may live under `docs/plans/`; no such design was
promoted by this handoff.
