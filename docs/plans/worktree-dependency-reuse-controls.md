# Validate worktree dependency reuse

This follows the [locked installation evidence](locked-install-evidence.md)
and uses the build guard's installed-version comparison. N2 used an
out-of-date donor with a matching lockfile. N3 used an out-of-date target
with a matching stamp. Both produced a readiness claim in the baseline.

- **Hypothesis**: Verify the installed versions at the target, donor and
  publication points. A stale donor cannot seed a target stamp. A
  stale target with a matching stamp is refused without changing files.
- **Measurement**: Run the existing worktree fixture suite and two
  rooted synthetic transitive-drift controls on hosted CI. Compare
  the donor and target versions, stamp bytes, install calls and exit.
- **Success**: Both negative controls refuse reuse. All supported
  matching clone, fresh install and clean rerun paths pass, and normal
  Linux and macOS gates pass. A matching healthy rerun stays under
  five seconds in the isolated hosted fixture.
- **Pivot**: Any trusted stale donor, fresh stamp on an unqualified
  target, modification of the donor, supported-path regression or
  slow healthy rerun rejects the proposed reuse boundary.
- **Anchor**: The sealed N2/N3 and P2 decisions in the locked-install plan.

The npm installer remains responsible for producing fresh dependencies.
The worktree helper checks the result before writing the readiness stamp.
A stale existing stamped target is preserved and reports the explicit
reinstall action. Both the limits and the result apply to dependency
version evidence.

## Stamp publication controls

- **Hypothesis**: Publish a regular stamp atomically from the exact
  lockfile snapshot that the dependency verifier checked.
- **Measurement**: Run the hosted worktree fixtures. Seed a symlink at
  the stamp path, then create one during a separate install. In another
  fixture, change the lockfile while npm projects its data.
  Check exit, stamp kind, the symlink destination and cleanup.
- **Success**: All three cases exit 1, leave the linked destination untouched,
  and publish zero new stamps. A normal matching rerun remains under five
  seconds. The npm override handles install and read-only comparisons.
- **Pivot**: Any changed external file, unsafe stamp, extra install, or
  healthy regression rejects the publication method.
- **Anchor**: Review of N2/N3 readiness publication in this plan.

The hosted pre-fix fixture returned status 0 in both new controls, which
expected status 1. See [publication baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44206413141).

The [first candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44206774876)
passed 17 focused Linux cases, including the original two stamp controls.
A healthy matching rerun took 500 ms.

## Platform measurements

The [final Linux fixture](https://github.com/fyodoriv/agentbrew/actions/runs/44207160288)
passed 18 cases, with eight unselected or platform-specific cases skipped.
The [macOS fixture](https://github.com/fyodoriv/agentbrew/actions/runs/44207888465)
passed 23 cases, with three unselected observation cases skipped. It exercised
the real APFS clone and the fallback copy. A healthy matching rerun took
508 ms on Linux and 1,169 ms on macOS, both under the five-second bound.

Both hosts refused the linked-stamp fixtures and the lockfile change during
verification. These focused runs qualify the changed helper and tests. The
full gate and the combined frozen observation are still required before
closing the parent task.

## Keep the frozen observer usable after the guard change

- **Hypothesis**: The existing sealed donor and target fixtures can use the
  pinned read-only npm comparison without changing their source locks,
  hidden locks, manifests or payloads. A targeted refusal can be measured
  by its exact exit, no install call and independently unchanged files.
- **Measurement**: Run only the sealed N2 and N3 worktree observations on
  hosted Linux using a runner-local npm 10.9.9. Compare the pre-fix observer
  to the repaired observer. Leave the same sealed fixture bytes in place.
  Finish the complete cohort on a macOS runner, which supports the P2
  clone. Keep raw synthetic responses out of published logs.
- **Success**: The old observer gives incomplete evidence. With the
  repaired port, N2 records a fresh supported install after rejecting its
  donor and N3 records a refusal without changing the stamped target.
  Both observations are complete. The later full cohort reports zero
  unsafe families and supports all four positive cases.
- **Pivot**: Any changed frozen input, install on the donor, unproven
  refusal, or misclassified setup failure rejects the measurement.
- **Anchor**: The N2/N3 and P2 rows in the original locked-install plan.
