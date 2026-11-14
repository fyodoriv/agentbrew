# Targeted managed-skill refresh: coordination preparation

This plan starts task `targeted-managed-skill-refresh`. A scoped refresh must
not overwrite owner edits, other skills, or an interrupted operation. The
existing source-checkout lease protects source operations, not the installed
skill staging directory. Install, refresh, prune and clean can all mutate that
directory, while agents can read it through links.

## First prediction

- **Hypothesis:** A shared, fail-closed managed-skill transaction boundary prevents
  cooperating skill writers from overlapping state and staging mutations,
  without changing unrelated skill paths or source checkouts.
- **Measurement:** Add focused scratch-only controls and run `heavy-run npx vitest run src/skills/targeted-refresh.test.ts`, followed by hosted CI. Exercise each existing staging writer, same-name contention across processes, distinct names, case and normalization aliases, nested same-invocation calls, different-name contention, unrelated state and manifest writes, invalid paths, symlink or parent replacement, private-root ownership and modes, interrupted ownership, uncertain cleanup, exception paths and pre-existing unrelated skills. Verify refusal leaves links and source state unchanged as well as the staging directory. No real installed skill or source is mutated.
- **Success:** At least eight controls pass, every competing writer refuses or waits before touching the target or shared state, and zero unrelated files or
  source checkouts change. Missing or uncertain ownership and interrupted
  recovery must refuse; no automatic stale-lock removal is allowed.
- **Pivot:** If any managed writer cannot share the boundary, a lock identity
  cannot be verified, cleanup could remove another owner's lock, or lock order
  can deadlock, stop and retain the existing behavior. Do not expose a
  targeted refresh command or claim that the task is complete.
- **Anchor:** `src/catalog/install-skill.ts`, `src/source-skill-prune.ts`,
  `src/clean.ts`, `src/catalog/source-checkout-lease.ts`, task measurement,
  Basili et al. 1994 (GQM), and Munafò et al. 2017 (preregistration).

## Boundary and remaining work

Review reuse of the existing checkout-lease machinery before adding a lock.
A distinct staging boundary must not nest into an incompatible checkout
scope. The order is source checkout, then one managed-skill transaction; no path may
acquire a checkout while holding the transaction. Refuse contention without
waiting while another lock is held. Prepare source data first, then acquire
the transaction and reload and revalidate ownership and state before any
mutation in a compound install, clean or prune operation, including links and
source state. Audit every writer of shared state, lock and manifest files.
Other commands writing those files need a common file-level lock or a reviewed
atomic/versioned merge protocol with a fixed order. Different-skill and
unrelated-command contention controls must detect lost updates. Fail closed for names
whose case or Unicode normalization aliases cannot be established. Keep lock
files outside skill discovery roots. Bind a
private lock directory and owner token to the invocation; never use PID alone
as proof, and leave uncertain crash state for verified recovery.

This phase coordinates only cooperating managed writers. It does not prove
that arbitrary same-user processes cooperate, that readers cannot observe a
partial or missing directory, that owner edits are preserved, or that a
refresh is recoverable. A normal two-rename swap can leave a read gap. Before
the user-facing refresh, independently review owner provenance, source
identity, state updates, agent-link continuity, interrupted replacement and
recovery. If these cannot be established, refuse without changing the staged
skill. Keep the task open until the full acceptance criteria pass.

## Shared-file audit checkpoint

A source search at base `941226a27d973f0348250138517de4bb7fbb04d0` found state saves in source management, catalog installation,
clean, memory commands, MCP, settings and sync paths. The telemetry module
has a separate state writer and is not evidence of a `state.yaml` write. Lock-file writes also
come from source, catalog, plugin and update paths. Manifest saves come from
clean and several sync engines. These are candidate call sites, not proof that
all indirect or external writers are known. `state.ts` uses atomic file
replacement, but that alone does not serialize read-modify-write operations.
`manifest.ts` logs save failures, so a caller cannot treat return from the
current save as proof of persistence. The state manager caches a loaded value
for the manager lifetime; a transaction must invalidate or otherwise prove a
fresh read after admission. Its disk writer reports errors through exit status
rather than throwing, so the caller must verify persistence independently.

Do not add a staging-only lock and call the refresh safe. First trace each
shared-file writer, determine a common transaction or versioned merge
boundary, and test different-name and unrelated-command interleavings. If that
boundary cannot cover the operations without changing unrelated work, the
registered pivot applies.

The independent static audit found no existing transaction primitive that
covers staging, agent links, state, lock and manifest together. The source
checkout lease has checkout scope; the MCP publication lease has MCP build
scope; neither protects these shared operations. The memory-ledger lock has
different stale-lock behavior and is not a safe substitute. `lock.ts` and
`manifest.ts` can treat unreadable data as empty, which is not authoritative
for recovery. Atomic replacement of one file does not serialize a
read-modify-write or make a multi-file operation atomic. Dynamic and external
writers remain outside this source scan.

## State interleaving baseline prediction

Registered before the control. Two independently cached managers can read
the same state, then save different edits; a later stale save may discard the
earlier edit even if the file replacement itself is atomic.

- **Hypothesis:** In a deterministic synthetic shared store, the stale
  interleaving loses the first edit; invalidating and reloading before the
  second edit preserves both.
- **Measurement:** Add one test to `src/skills/targeted-refresh.test.ts` and
  run `heavy-run npx vitest run src/skills/targeted-refresh.test.ts`. Use two
  real state-manager instances with structured clones on every in-memory
  read and write. Assert distinct object identities and explicit field values
  before and after each interleaving; invalidate before the second edit. Record the
  stale result and the serialized control separately. No filesystem, network,
  real user state or live agent process is used.
- **Success:** The selected baseline test runs and shows exactly the
  predicted lost edit, while the reload control retains both edits.
- **Pivot:** An absent test, shared object alias, unexpected schema migration
  or different result invalidates this model. Correct the measurement before
  designing a transaction; do not claim live concurrency was reproduced.
- **Anchor:** `src/core/state-manager.ts`, the shared-file audit above,
  Basili et al. 1994 (GQM), and Munafò et al. 2017 (preregistration).

This is a baseline, not a fix. The later implementation must use a failing
regression that demands both edits survive or the stale write refuses, and it
must cover real cooperating process and filesystem boundaries.

### Baseline result (2026-11-13)

The selected synthetic test passed. With two distinct cached managers, the
second stale save discarded the first edit; after invalidating and reloading
before that edit, both changes survived. Independent review checked cloned
reads and writes and the control order. This demonstrates the manager-level
interleaving only. It does not reproduce a live process race or fix it.

## Overlapping reload prediction

Register before adding or running this control. A reload alone is not a lock.

- **Hypothesis:** Two fresh loads that overlap can still lose an unrelated
  edit; a fully serialized load/edit/save sequence preserves both edits.
- **Measurement:** Add one focused test in `src/skills/targeted-refresh.test.ts`
  and run `heavy-run npx vitest run src/skills/targeted-refresh.test.ts`.
  Use two real managers and the existing cloned in-memory store. Invalidate
  and load A; then invalidate, load, edit and save B; then edit and save A's
  earlier loaded object. Separately save A before B reloads and saves.
- **Success:** The selected test demonstrates exactly one lost B edit in the
  overlapping order and retains both edits in the serialized order. Assert
  distinct object identities and exact field values throughout.
- **Pivot:** Stop if object aliases, schema changes, a missing test or a
  different result make the interleaving ambiguous. Do not infer a fix or
  cross-process safety from this in-memory model.
- **Anchor:** `src/core/state-manager.ts`, the baseline above, Basili et al.
  (1994), Goal Question Metric, and Munafò et al. (2017), preregistration.

This control touches no real state, filesystem, subprocess or worker. It does
not prove lock ownership, recovery, other writer cooperation, or atomicity
across staging, links, manifest and state. A later real transaction must reload
inside a shared ownership boundary or use a reviewed versioned merge.

### Overlapping reload result (2026-11-13)

Both focused tests passed. The new synthetic control showed the unrelated
server edit lost after two overlapping fresh loads; the serialized control
retained both edits. Independent review checked the order, cloned objects and
assertions. This does not establish a live race or a transaction fix.
