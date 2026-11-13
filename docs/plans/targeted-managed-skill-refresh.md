# Targeted managed-skill refresh: coordination preparation

This plan starts task `targeted-managed-skill-refresh`. A scoped refresh must
not overwrite owner edits, other skills, or an interrupted operation. The
existing source-checkout lease protects source operations, not the installed
skill staging directory. Install, refresh, prune and clean can all mutate that
directory, while agents can read it through links.

## First prediction

- **Hypothesis:** A shared, fail-closed per-skill mutation boundary prevents
  cooperating staging writers from modifying the same skill concurrently,
  without changing unrelated skill paths or source checkouts.
- **Measurement:** Add focused scratch-only controls and run `heavy-run npx vitest run src/skills/targeted-refresh.test.ts`, followed by hosted CI. Exercise each existing staging writer, same-name contention across processes, distinct names, case and normalization aliases, nested same-invocation calls, sorted multi-name acquisition, invalid paths, symlink or parent replacement, private-root ownership and modes, interrupted ownership, uncertain cleanup, exception paths and pre-existing unrelated skills. Verify refusal leaves links and source state unchanged as well as the staging directory. No real installed skill or source is mutated.
- **Success:** At least eight controls pass, every same-name competing writer
  refuses or waits before touching the target, and zero unrelated files or
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
scope. The order is source checkout, then staging; no path may acquire a
checkout while holding staging. Acquire multiple staging names in a stable
sorted order, and refuse contention without waiting while another lock is
held. Acquire the boundary before any mutation in a compound install, clean
or prune operation, including links and source state. Fail closed for names
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
