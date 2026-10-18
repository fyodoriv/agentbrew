# Learnings

What we predicted for a change, and what we observed. One row per closed
change that carried a pre-registered hypothesis. Add the row in the PR that
closes the change, or when the measurement window ends.

A miss is a useful row: it says the model of the system was wrong. Do not
delete misses, and do not edit a prediction after you see the result.

| Date | Change | Predicted | Observed | Next |
|---|---|---|---|---|
| 2026-10-18 | `meet-new-project-requirements` PR 1: vision, metrics, docs map | `check-setup.sh . --profile tool` rises from 9/24 to at least 13/24 | see the PR transcript | keep going with observability |
