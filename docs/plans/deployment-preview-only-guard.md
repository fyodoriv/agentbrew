# Preview-only deployment guard experiment

## Overall goal and vision

Diagnose an installation preview without allowing the operator's guard to
enter an explicit configuration apply. Preserve the previous source, build,
owner settings and scheduler. This is a local operational experiment. It does
not add an agentbrew CLI command or claim a healthy installed deployment.

## Decision and alternatives

Add an explicit preview-only mode to the reviewed private operator harness.
Keep its strict preview acceptance and restoration checks. Run the global
preview once, then restore even when the preview is clean. Apply mode remains
a separate, explicit choice.

Running an apply-capable harness and assuming stderr will stop it is not a
preview-only contract. Broad rollback can overwrite later owner edits. Reuse
the existing source/build restoration path before any apply starts; never use
configuration snapshots as an automatic rollback.

## Evidence ledger

| Claim | Source of truth | Status |
| --- | --- | --- |
| A sync preview can write bookkeeping | Current sync implementation and operational runbook | fact |
| The existing operator harness can proceed from a clean preview to apply | Reviewed private executor | fact |
| The previous preview retained aggregate diagnostics but not every line category | Private attempt receipt | fact; its missing line cannot be reconstructed |
| An exclusive outer queue reservation uses the root lock protocol | Current dotfiles heavy-run source | fact |
| A nested exclusive request upgrades an existing normal reservation | Current nested fast path | false; never rely on this |
| Preview-only mode prevents explicit sync apply and restores prior state | Proposed guard and controls | verify |

## Scope and lifecycle

The operator invocation owns the preview capture, source/build restoration,
temporary dotfiles lock and temporary scheduler quiescence. Captured output,
configuration preimages and owner fingerprints remain in RAM. Emit only fixed
categories and numeric counts. Never print raw stderr, paths, source labels,
configuration values or copied conversation records.

Acquire a genuine outermost exclusive heavy-run reservation. Verify its held
lease and owner ancestry before acquiring the dotfiles lock. Do not clear a
live lease variable to force nested admission. Leave memory services, memory
privacy choices, deduplication and native conversation-import opt-outs intact.

Restoring the existing scheduler can trigger its configured RunAtLoad action.
Therefore zero explicit apply calls is not a claim that the entire operation
makes no writes. Compare the required protected state after restoration.

## Registered hypothesis and measurements

- **Hypothesis:** the preview-only mode has a zero false-allow rate for explicit
  sync apply across the fixed scenarios below. Clean previews complete their
  diagnostic path and restore prior source/build and scheduler state.
- **Measurement:** first implement isolated controls around the actual executor
  with fake commands and services. Confirm the missing-mode or unsafe-route
  failure before changing its behavior. Then run the same controls on the
  candidate. Only after review may one guarded real diagnostic run proceed.
- **Success:** zero explicit apply calls in preview-only mode; mode retained
  through re-exec; strict stderr/nonzero refusal preserved; required source,
  build, scheduler and protected-state checks pass. Cleanup failures remain
  nonzero and separate from the primary result.
- **Pivot:** any apply reachability, lost mode, weakened refusal, private-output
  emission, skipped preservation check or unverified restoration rejects the
  approach. Do not accept a warning merely because it looks harmless.
- **Anchor:** Basili, Caldiera and Rombach (1994), Goal Question Metric;
  Munafò et al. (2017), preregistration; the existing source-preservation and
  explicit-apply contracts.

The private paths are required operator inputs, not installed public commands.
Proposed execution once the reviewed harness artifacts exist:

```sh
heavy-run python3 "${PREVIEW_GUARD_SELFTEST:?}"
heavy-run --exclusive python3 "${PREVIEW_GUARD:?}" --preview-only
```

The registration itself uses the existing repository gate:

```sh
heavy-run npm run verify:changed
```

## Fixed control matrix

Seal the executor and control source hashes before observing their results.
Exercise the actual orchestration entrypoint with synthetic commands, state
and services; do not substitute a duplicate model of the guard.

| ID | Input | Required observation |
| --- | --- | --- |
| C01 | Clean global preview | no apply; restore source/build and scheduler |
| C02 | Recognized warning on stderr | strict refusal; no apply; restoration attempted |
| C03 | Nonzero preview exit | strict refusal; no apply; restoration attempted |
| C04 | Lock acquisition and re-exec | preview-only mode survives; apply mode is not substituted |
| C05 | Source/build restoration fails | nonzero cleanup result; primary result retained separately |
| C06 | Scheduler restoration fails | nonzero cleanup result; protected-state comparison still runs |
| C07 | Protected state changes after restoration | nonzero result; no claim of preservation |
| C08 | Missing, shared or inherited normal reservation | refuse before service or source mutation |

Keep apply-mode tests separate. A preview-only guard must not silently change
the intended apply workflow or its existing safety checks.

## Numbered work breakdown

### 1. Register and reproduce

- **Why:** prove the exact mode and apply boundary before the real operation.
- **Parallelism:** independent of Rust inventory and lifecycle implementation.
- **Owner/change:** operator plan and isolated controls; no live services run.
- **Acceptance:** immutable prediction precedes code; actual missing capability
  or unsafe apply reachability is observed without real configuration writes.
- **Verification:** the proposed private self-test command and source review.

### 2. Implement the preview-only boundary

- **Why:** a successful preview must still be unable to enter apply.
- **Parallelism:** after step 1; source review can accompany queued checks.
- **Owner/change:** private executor argument handling, re-exec and mode guard.
- **Acceptance:** mutually exclusive modes; only the global preview runs;
  apply is explicitly guarded; installed-artifact probes are skipped;
  apply-started remains false and ordinary restoration runs.
- **Verification:** the same sealed controls, including cleanup-failure cases.

### 3. Gather the missing live diagnostic

- **Why:** the missing historical stderr line cannot justify an allowlist.
- **Parallelism:** after controls and independent review; use the real exclusive
  reservation, then the existing dotfiles lock and fresh writer checks.
- **Owner/change:** one bounded operator invocation. Preview bookkeeping and the
  scheduler's existing RunAtLoad behavior are acknowledged effects.
- **Acceptance:** all stderr lines classified in RAM; emit only source-backed
  category counts and unknown line numbers. Unknown lines still refuse.
  Verify protected settings, memory services, native import opt-out, old
  source/build, scheduler state and owned lock cleanup after the attempt.
- **Verification:** private terminal receipt and fresh readback, with no raw
  preview transcript or secret values persisted.

## Rollout and failure handling

Keep the normal apply workflow unchanged. A later allowlist requires a
separate source-backed decision for every category and its preconditions.
An optional unconfigured warning does not explain another unknown line.
Never widen acceptance from an exit-zero observation alone.

If restoration fails, stop and preserve the observed state for review. Do not
overwrite owner files, disable configured memory, force a branch, change queue
capacity or claim installed health. Publishing the registration follows normal
leak and delivery gates; local operational work can proceed while sign-in is
unavailable.
