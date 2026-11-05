# Explicit pull refresh evidence

## Outcome and scope

[Issue #780](https://github.com/fyodoriv/agentbrew/issues/780) reports that an
explicit pull deploys old source bytes while printing completion. Account for
every registered Git checkout read by that invocation, including local artifact
paths within MCP runtime repositories. Refresh eligible source caches or report
an actionable ownership, pin, runtime or failure reason. Never pull an active
MCP runtime in place; reuse its verified fresh-candidate update route where
eligible. Preserve owner work, pins and origin checks.

## Registered experiment

Goal: deploy refreshed source bytes without silent stale-success reports.
Question: can invocation-owned refresh results and actual checkout receipts
distinguish fresh, skipped and failed source reads across all relevant caches?

Hypothesis: the eight controls below produce zero silent stale-success results,
zero false revision receipts and zero unsafe checkout/runtime mutations.
Baseline semantic RED must be recorded before implementation. Setup, compiler
and dependency failures do not count as RED.

Measurement, from the repository root:

```sh
PATH=/opt/homebrew/opt/rust/bin:$PATH:/opt/homebrew/bin heavy-run npx vitest run src/sync/pull-source-caches.test.ts src/catalog/index-source.test.ts src/update.test.ts src/cli-sync-agentfile.test.ts src/mcp/mcp-git-install.test.ts
```

Success: all eight decisions match, all existing affected controls remain green,
and normal required repository verification passes. Pivot: any silent stale
success, wrong accepted revision, lost owner work or unsafe runtime mutation
rejects this approach. Do not lower thresholds. Anchor: Basili, Caldiera and
Rombach (1994), GQM; POSIX/Git fast-forward and observed checkout identity.

## Frozen controls

1. A remote source cache behind its local fixture origin fast-forwards before
   its updated artifact bytes are read.
2. Earlier same-process source access cannot suppress an explicit refresh.
3. A failed refresh retains old bytes but reports failure, not freshness.
4. Recorded deployed revision equals accepted checkout HEAD, not remote HEAD.
5. A registered local Git source has an explicit ownership decision and reason.
6. An MCP runtime has a safe candidate update or actionable skip outcome; a
   local artifact source inside it is tied to that runtime's actual read path.
7. Dirty, divergent and pinned checkouts retain bytes and identity; no reset,
   force operation or silent pin movement is allowed.
8. Dry-run reports actions without Git or deployment mutation.

Use local synthetic Git repositories and the existing scratch-HOME harness.
No downloads, owner cache mutations, owner payloads, credentials, new dependency
or public writes are part of the experiment. Registrations and refresh results
belong to one update invocation. Existing source-module session caches cannot
serve as evidence that a later explicit refresh succeeded.

## Work and validation order

Commit this prediction and the source/test ownership task first. Add regression
controls and record exact semantic RED before behavior changes. Trace all actual
registered source/artifact readers, choose their refresh owner, then implement
the smallest result propagation and revision correction. Keep MCP candidate
publication and active-runtime identity invariants intact. Update README and
the sync data-flow documentation with behavior. Root coordinates source commits
and publication after independent review and normal green gates.

## Receipt boundary found by control 4

The supplied checkout-revision map must also be authoritative in `src/lock.ts`.
A missing accepted revision cannot fall back to a remote lookup. The real Git
dirty-cache control reproduced that false lock update before the lock change.
Calling the lock API without a supplied map retains its existing remote lookup
behavior. This extends the same registered receipt control, not its thresholds.

## Git hook receipt controls for decisions 4 and 7

Retain candidate tree `cd6ba982bce8bb31ff5995c217b12f7543f2858b` and its
SHA receipt before these controls. Two real local Git fixtures install only
fixture-owned hook paths: post-merge for an existing cache, and post-checkout
for a fresh clone. Each hook changes tracked SKILL.md bytes and exits zero.
The original zero-false-receipt threshold remains: both cases must retain hook
edits and enabled hook configuration, report neither refreshed nor unchanged,
accept no SHA, and preserve the prior lock revision. Run the existing focused
command with `-t "fixture .* hook"` for RED before changing receipt code, then
run the complete focused cohort and typecheck. No owner Git config is changed.
