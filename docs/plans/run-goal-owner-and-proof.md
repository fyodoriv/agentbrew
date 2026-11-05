# Goal ownership and proof verification (#778)

## Prediction before changes

Goal: retain the requested outcome when another team owns its settings, and
reject completion claims based only on a proof image's caption. Question:
does intake establish the actual owner and valid submission route before
promising a change, and does verification reconcile the image with the
system-of-record log?

Hypothesis: the unchanged skill and eval registry fail five new deterministic
requirements. Narrow guidance and self-contained evals235/236 reduce those
failures to zero. Keep the existing independent-review control passing.
These are structural contract checks, not measured model behavior.

Eval235 supplies writable application source, an externally owned host runtime
and plugin asset, and available owner/route lookup results. The agent must
probe that boundary early. Preserve the original upgrade and plugin criteria
as blocked or unverified. Prepare an owner-ask draft and test path, but do not
post without authorization or call that draft the original goal's completion.
Only explicit user approval may replace the original acceptance criteria.
Unknown ownership or an unverified submission route stays unknown.

Eval236 supplies a synthetic proof image and matching run-identity log, with
a misleading completion caption. The image and log show waiting for input.
Require reading the image itself and the system-of-record log before quoting
completion. An unavailable image/log reader or mismatched run identity leaves
the criterion unverified. The fixture is not a screenshot of a live app.

Freeze the new guard before its baseline. Preserve every existing eval and
repeat the exact assertions after the fix. Missing tools, malformed fixture
data or dependency setup failures are inconclusive, not semantic red.

Measurement from the repo root, with qualified Node/npm and owner PATH:

```sh
JOBS=1 heavy-run npm exec -- vitest run src/skills/run-goal-owner-and-proof.test.ts --maxWorkers=1
JOBS=1 heavy-run npm exec -- vitest run src/skills/run-goal-owner-and-proof.test.ts src/skills/run-goal-eval-234.test.ts src/skills/run-goal-evals-source-count.test.ts --maxWorkers=1
JOBS=1 heavy-run npm run verify:changed -- f3de373f29bd9cb94160d4c4b4fcc04df0896bd1
```

Commit this prediction after its docs gate, before test/eval implementation
or results. Success: zero focused failures, the existing control stays passing,
and required verification passes. Pivot on any remaining unsafe rescope,
caption-only completion, unauthorized message, lost prior eval, or failed
preservation check. No live external store, browser, model or message action
is part of this patch. Publication remains with the orchestrator.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric;
Munafò et al. (2017), preregistration. Issue778 supplies the ownership and
misleading-image failure examples; the retained user goal is the acceptance
authority.
