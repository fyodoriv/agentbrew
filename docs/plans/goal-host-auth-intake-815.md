# Goal intake host authentication experiment

Issue #815 reports that stale host credentials were discovered after the goal
contract. The issue describes one incident, not a measured population rate.

Goal: surface authentication blockers before the contract. Question: does a
two-host intake distinguish a stale environment credential from the keyring
without disclosing either? Metric: the registered synthetic two-host case must
identify the stale credential and the human login step before the contract.

Prediction: that case moves from 0/1 documented intake controls to 1/1, with
zero credential values printed, stored or sent. The unchanged healthy-host
control must remain usable. Measurement: `jq -e '.evals[] | select(.id == 255)
| (.expectations | length >= 4)' skill-plugins/workflow/run-goal/evals/evals.json`
and a fresh-context judge of the registered scenario against the skill.
Success requires both controls
and zero disclosures. Any missed blocker, false human step or disclosure
rejects the approach. The evaluation tests guidance, not live model behavior.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò et
al. (2017), preregistration; issue #815's recorded incident.
