# Safe iteration speed standard

## Hypothesis

Goal: make fast, trustworthy iteration a normal part of development. Question: do shared guidance, the reviewer, the performance skill, and the session hook carry the same actionable safety boundary? Metric: registered synthetic delivery controls. Predict five of five controls pass after the change, including a hook hint on measured recurring work and a silent no-data control. Before the change, the new guidance is absent.

## Measurement

`npx vitest run src/sync/iteration-speed-standard.test.ts` and `bash hooks/checks/perf-brief.test.sh`. Use synthetic fixtures and the installed sync contract; then run `npm run verify:changed` and the required full gate.

## Success

Keep the change only if all five registered controls pass, the hook remains silent without data, and no control permits reuse with unknown inputs or skipping the required final gate. This measures delivered guidance, not actual human compliance or elapsed-time savings. Application-level speed changes require their own timed before/after experiment.

## Pivot

Abandon this approach if fewer than five controls pass, the hook blocks work, a no-data session produces unsolicited performance data, or guidance treats an unsafe cache hit as proof.

## Anchor

Basili, Caldiera and Rombach, Goal Question Metric Paradigm (1994).

## Scope

Reuse the shared instruction template, reviewer agent, performance-review skill, and performance brief hook. Prefer narrow measured iteration checks, safely keyed successful results, explicit invalidation and conservative fallback, followed by the required full gate. Avoid project-specific private data.
