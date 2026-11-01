# Bounded install-path diagnostic

## Hypothesis

Goal: distinguish installation-path runtime from the historical whole-tool-call
category. Question: does the documented helper avoid most warm-cache install
work on the same committed source? Three paired replicas compare fresh
`npm ci`, a fresh helper clone, and its unchanged rerun. Predict helper-fresh
median <=25% of npm-ci median and helper-rerun median <=10%.

This prediction uses the earlier dated local helper measurements as prior
information. It is not a claim that the performance question is unseen.
No production behavior changes. Preserve the existing documented helper
selection regardless of this diagnostic's result.

## Measurement

Commit this plan and its task correction before execution. The private harness
SHA-256 is `5545dbe78f5dc5c2e311f84a666713175505d82cb985b23afcc92b9ea8f03654`. Static syntax was checked; no profile or install has
run. From the clean committed agentbrew source, run this one heavy batch:

```sh
heavy-run python3 /tmp/ab-install-leaf-profile.py --repo "$PWD" --revision HEAD --script-sha256 5545dbe78f5dc5c2e311f84a666713175505d82cb985b23afcc92b9ea8f03654 --output ~/.local/state/tooling-goal-2026-11-01/install-leaf-profile.json
```

The harness verifies its hash and a clean committed source. It archives only
tracked content into profile-batch-owned scratch fixtures. It makes a donor
through `bash scripts/worktree-deps.sh <donor>` itself; this preparation seeds
an isolated npm cache and is recorded separately from the nine trials.

Each of three replicas then runs these leaves, with the same Node/npm versions,
source and lock hash:

1. Fresh fixture: `npm ci --prefer-offline --no-audit --no-fund`.
2. Fresh fixture: `bash scripts/worktree-deps.sh <donor>`; require a documented
   clone/copy-on-write route, not a fallback install.
3. Same helper fixture: repeat the helper; require its unchanged-lock route.

Each child has a 120-second execution cap. Every return path checks its owned
process group independently of leader exit and pipe EOF. Cleanup has five
seconds after TERM and five after KILL to prove group extinction and drain
pipes. A live or unknown group, or undrained pipes, makes cleanup incomplete;
there is no unbounded drain. A normal leader that leaves residual work is an
invalid timing sample even if cleanup later stops that work. Monotonic timing starts inside the acquired
heavy-run batch, immediately around the leaf. Archive extraction, version
checks, cache preparation and lock wait are outside the trial measurement.
Record every trial, exit, timeout, fixed route enum and fixture validity. Check
lock preservation, real node_modules directories and helper stamps. Stop at
an invalid trial; do not replace it or choose new samples after results.
Report medians and all three observations, not a p95 from three samples.

Child environment uses only PATH, LANG, LC_ALL, LC_CTYPE, TZ and TERM when
present, plus private HOME, XDG, TMP and npm-cache settings. It inherits no
authentication, NODE_OPTIONS, BASH_ENV, ENV or custom helper overrides.
HOME, XDG directories, temporary files and npm cache are private fixture state.
Only the explicit mode-600 result survives normal cleanup. Package output is
not retained; no raw command, environment, credential or transcript is logged.
The source checkout and real npm cache are never install targets.

## Mocked cleanup controls

Before execution, the original harness failed four of six mocked controls:
TERM-ignoring descendants with closed pipes, a successful leader leaving a
child, an unkillable group and an unknown group were falsely accepted or not
stopped. The corrected proposal passes eight controls, also including normal
absence, TERM-responsive cleanup, bounded open-pipe drain and a clock crossing its
deadline. These are mocked
safety checks, not installation or timing results. The actual nine-trial
performance diagnostic remains unexecuted.

## Success

Diagnostic validity: 9/9 trial exits and fixture/version checks are valid,
with nine finite monotonic measurements, proved process-group cleanup and no
residual owned-group work on successful completion. Only then assess the predicted
median ratios (fresh <=0.25; rerun <=0.10). An unsuccessful ratio is a valid
negative diagnostic, not a reason to discard a trial.

## Pivot

Any invalid exit, timeout or changed fixture makes the diagnostic inconclusive;
abandon a speed-remedy claim. If either valid median ratio exceeds its limit,
abandon the claim that this helper path explains the speed remedy under this
fixture. Keep the documented install selection; inspect the failed path before
proposing any code change. Do not tune samples or thresholds afterwards.

## Historical limit and field follow-up

The dated summary contains 235.698 seconds/day across the npm-ci and helper
key groups. The recorder selects one dominant command for a compound Bash
call and assigns the whole call's duration. The aggregate cannot split npm,
other chained work or queue wait, so it is not isolated npm runtime and does
not prove a causal cache failure. Both key groups remain in the historical
outcome; no slow observation is dropped. Do not add the all-project aggregate
to its project subset or attribute tooling-started calls without evidence.

This diagnostic cannot prove the daily-cost outcome or close the task. After
verified recorder/helper/report deployment and a private UTC cutover, retain
the original Success/Pivot thresholds for a full new seven-day cohort. Unknown
attribution remains unknown.

## Anchor

Basili, Caldiera and Rombach (1994), Goal Question Metric; Forsgren, Humble and
Kim (2018), delivery measurement. The earlier local helper timings are dated
in TASKS.md; they inform this prediction rather than count as new results.

## Observed diagnostic (2026-11-01)

Source `e76c9a1be454145ba619cd2d1bbbaf43b36e5e04`; Node `v24.21.0`, npm `12.2.1`; exact private harness hash `5545dbe78f5dc5c2e311f84a666713175505d82cb985b23afcc92b9ea8f03654`. All nine trials were valid. The diagnostic met both registered ratio thresholds. Field daily cost remains unknown.

| Replica | npm ci (ms) | helper fresh (ms) | helper rerun (ms) |
| --- | ---: | ---: | ---: |
| 1 | 9350.694 | 1053.669 | 12.487 |
| 2 | 8802.738 | 1036.943 | 12.840 |
| 3 | 9218.810 | 1060.462 | 13.201 |

Median ratios: fresh 0.11430; rerun 0.00139. No observation was replaced or dropped. The original full seven-day field thresholds and installed-source cutover remain required.
