# Handle a lease released during inspection

Agentbrew Linux run `44561942662` reported a missing second worker result
with exit 1 and `other/ENOENT`. The failure does not identify the syscall.
The [earlier controlled release-window work](source-lease-release-window-research.md#executed-cohorts-and-failed-qualification)
observed a lock directory disappear after exclusive creation returned
`EEXIST` and before the competing worker could inspect it.

- **Hypothesis:** If the lease disappears during this inspection, the
  asynchronous waiter takes its existing bounded retry and acquires a
  fresh lease before executing work. This removes the reproducible raw
  `ENOENT` from this one inspection boundary.
- **Measurement:** Run a focused unit regression with an injected
  `EEXIST` on the first creation attempt at one scratch path. The following
  inspection sees the absent directory. Compare the exact error and
  callback count before and after the change. Run the existing unit suite
  and ordinary hosted checks.
- **Success:** The baseline rejects with `ENOENT` and zero callbacks. The
  candidate acquires on the second attempt and runs exactly one callback
  inside a verified lease. The synchronous caller still refuses. Errors
  after successful creation and the existing unsafe-owner controls still
  refuse with zero unlocked work.
- **Pivot:** Any unlocked call, additional unsafe retry, missing ownership
  proof, or change outside the inspected contention result rejects this
  repair.
- **Anchor:** The prior controlled release-window evidence and the
  exclusive directory creation in `src/catalog/source-checkout-lease.ts`.

The regression injects one return path and launches no Git children. The
natural and physical research cohorts remain closed. The original incidents
still have no confirmed syscall attribution.

## Unit evidence

The baseline failed with `ENOENT` during the competing lease inspection.
With the repair, all 18 checkout lease tests passed. The new controls cover
a fresh asynchronous acquisition, the synchronous busy result, and an
inspection failure after successful creation. Existing tests still reject
unsafe ownership and record poisoned leases.
