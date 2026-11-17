# Qualify hosted gate cache reuse

- Hypothesis: identical hosted runner images can reuse the task-stability and artifact lints across a docs-only change. An unreported or changed image never restores another image's step record.
- Measurement: capture two hosted gates on the same runner image, with only an unrelated Markdown change for the second. Check the literal cache hits and exercise seeded invalid inputs.
- Success: both source-only lint steps hit on the second gate. Changes to the task queue, allowlist, lint script or root artifact presence force a fresh check. Installed-dependency and unqualified inputs get zero new cache allowances.
- Pivot: retain the image key and leave any step with an incomplete input list at its current cache policy.
- Anchor: `ci-step-cache-key-image-and-inputs`, the existing gate cache and the dependency-cache receipt in PR #765.

The first Ubuntu job used image `ubuntu24-20261111.127.1-X64`. Both added lint
steps ran and a cache record was saved for that image. The next dispatch changes
only this plan and measures reuse from that record.

## Hosted result

The [cold Ubuntu job](https://github.com/fyodoriv/agentbrew/actions/runs/44190741623/job/134419153228)
ran both lints in 25 ms and 41 ms. The [warm Ubuntu job](https://github.com/fyodoriv/agentbrew/actions/runs/44192772811/job/134434267603)
restored the same image record and served both results from the cache. The
gate reported three hits across 23 steps. The two lints accounted for 66 ms
of cold command execution. That is not a measurement of net gate speedup.
The stale-install evidence from PR #765 still applies to steps that read
installed dependencies, so those steps keep the existing cache policy.
