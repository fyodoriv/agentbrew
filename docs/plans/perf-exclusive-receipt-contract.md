# Qualify a saved exclusive performance verdict

The shared-slot timing experiment in the performance gate task crossed its
false-alarm limit. Keep those measurements and the original slowdown test.
The next approach gives a shared slot a verdict from an exclusive run for
the same inputs. The shared slot must not sample timing or start a build.

## Prediction

- **Hypothesis**: A shared-slot run with verified inputs returns the same
  result as the exclusive measurement. An absent, invalid, or stale result
  returns a setup failure before the timing child or build starts.
- **Measurement**: Add the named controls below to the existing
  `src/scripts/perf-gate.test.ts` fixture. Use its deterministic clock,
  scratch Git repos, and an append-only scratch invocation counter. Run the
  exact selected cases on hosted CI with one test worker and no retries.
  Keep the current fixture suite and the normal hosted gate green.
- **Success**: Both supported verdicts are returned unchanged. All eight
  refusal cases return exit 2. Every shared-slot case records zero build
  or timing starts. Unchanged full-gate behavior retains its existing
  verdicts and coverage.
- **Pivot**: Reject any stale, unverifiable, or concurrent evidence returned
  as a pass. If a supported command depends on an unverified input, refuse
  receipt reuse for that command until the producer and reader share a
  complete description of its inputs. Keep the hosted full gate.
- **Anchor**: The loaded-machine measurements in
  [Performance gate](../observability.md#performance-gate), the original
  gate's base-checkout guard, and Basili, Caldiera and Rombach (1994),
  Goal Question Metric.

## Frozen fixture controls

Use only committed shell fixture inputs and declared local executables.
Record setup failure and a timing start separately. The receipt model
qualifies this closed synthetic command set first.

| Case | Input and required decision |
| --- | --- |
| P01 | Same clean head, base and verified inputs as a passing exclusive run. Return 0 without another start. |
| P02 | Same verified inputs as an exclusive run that found a slowdown. Return 1 and keep its diagnostic without another start. |
| P03 | No receipt. Return 2. |
| P04 | Truncated receipt, unknown version or invalid verdict payload. Return 2. |
| P05 | Changed base, head, budget or committed contents. Return 2. |
| P06 | Dirty or untracked effective input in the consumer checkout. Return 2. |
| P07 | Changed command executable or sampling settings. Return 2. |
| P08 | Known unverified external input. Return 2. |
| P09 | A result file that is a symlink or readable by another user. Return 2. |
| P10 | Input changes during supported measurement or publication. Preserve the previous receipt and return 2 for the new inputs. |

Production reuse must account for the base and head build products,
installed code, transitive commands, effective options and host identity.
An equal commit ID or dependency lockfile alone does not establish these
bytes. Do not add an exception to ordinary `verify` or use a synthetic
receipt as proof of a production run.

## Observed shared-slot baseline

The [first hosted control](https://github.com/fyodoriv/agentbrew/actions/runs/44279151550)
ran P03 once with a numeric shared slot and no receipt. The scratch gate
returned exit 1 and created both the build stamp and the timing sample.
The test expected exit 2 and neither file. The old route enters the build
before it checks the slot, then times directly inside that shared slot.
This result covers P03 on the old route. It neither qualifies receipt
reuse nor changes the earlier loaded-machine result.
