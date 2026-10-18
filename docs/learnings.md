# Learnings

What we predicted for a change, and what we observed. One row per closed
change that carried a pre-registered hypothesis. Add the row in the PR that
closes the change, or when the measurement window ends.

A miss is a useful row: it says the model of the system was wrong. Do not
delete misses, and do not edit a prediction after you see the result.

| Date | Change | Predicted | Observed | Next |
|---|---|---|---|---|
| 2026-10-18 | `meet-new-project-requirements` PR 1: vision, metrics, docs map | `check-setup.sh . --profile tool` rises from 9/24 to at least 13/24 | 14/23 (60%); mapping metrics merged two checks into one (#229) | keep going with observability |
| 2026-10-18 | PR 2: content-free event log, a fix on every drift item | observability area met (15/22); metrics show real sync and repair rates once events exist | 15/22 (68%) (#231); rates stay `(stub)` until real runs log events | stories and e2e |
| 2026-10-18 | PR 3: a metric and e2e scenarios for every story, map test | 17/22 or better | 17/22 (77%) (#232); the map test failed on the old map as expected | gate, checkup, setup |
| 2026-10-18 | PR 4: cached, timed gate; checkup; one-line setup ending with the doctor | score reaches 22/22 (100%); a rerun of `npm run verify` on an unchanged tree takes seconds | 20/20 (100%): mapped areas count as one check each; uncached gate 328 s, cached rerun 1 s | measure `gate_ms` monthly |
