# Cross-process receipt-bound source reads (#780)

## Goal, question and hypothesis

Every managed source-cache writer must honor the checkout lease. An explicit
update must retain its lease until its copied bytes and revision receipt have
been read. A module-only promise tail cannot protect separate agent processes.
Manual Git commands do not cooperate with this protocol and remain outside its
guarantee.

Hypothesis: the real separate-process race below changes from one wrong-byte
receipt to zero. No accepted source revision may describe different installed
skill bytes. This extends the original zero-false-receipt threshold; it does not
replace the existing safety or bounded-progress controls.

## Frozen reproduction

Use one scratch HOME and two synthetic local origins/checkouts, X and Y.
Advance X to SHA1 and advance Y so its post-merge hook runs. Start a real
child Node process running the production
`update({skillName: "fixture"})` entry point. Hold Y's real Git post-merge hook
on a fixture-owned release file. Wait for X's accepted refresh outcome. Advance
its origin to SHA2 and start a second child process using the production explicit
source-refresh entry point for X. No updater, Git operation or copy is mocked
in either process. No source or credential from the owner is read.

Release Y after the second operation either completes or reports a cooperative
lease wait/refusal. A lease wait is evidence only when the production lease
boundary reports it; silence is not proof. A busy refusal must be explicit and
accept no new revision. After A finishes, a waiting B or a fresh retry must
refresh X normally. Both normal child invocations must exit zero once their
lease is available. The installed SKILL.md after A must equal SHA1's expected
working-copy bytes, and A's state and lock must still name SHA1. Do not replace
this identity check with process-exit or timing success.

Bound fixture handshakes and child completion at 60 seconds. The fixture hook
has its own 30-second self-timeout. On any failure, release the fixture hook and
await owned children before deleting fixture data. A handshake timeout, missing
expected outcome, unknown child termination, or cleanup failure invalidates the
case; none counts as a semantic RED or success.

```sh
PATH=/opt/homebrew/opt/rust/bin:$PATH:/opt/homebrew/bin heavy-run npx vitest run src/sync/pull-source-caches.test.ts -t 'cross-process receipt-bound copy'
```

Success: zero wrong-byte receipts, explicit busy outcomes, a successful refresh
after lease release, and all original fifteen safety plus five bounded-progress
controls and required gates green. Pivot: any mismatched receipt, unlocked
fallback, live/dead-unknown owner theft, lost owner bytes, or parallelism-cap
regression rejects the approach. Preserve the same-process RED and all earlier
failed full-gate logs.

## Proposed implementation constraints

Reuse the existing MCP publication-lease safety pattern in a separate source
namespace: canonical checkout key, private same-owner directory, unique token
and inode-bound release. Do not change the MCP publication lease. Include every
managed clone, pull, pinned checkout, ordinary prefetch and realignment writer.
Keep the existing cap of eight network operations per invocation. Stable
multi-key ordering must prevent opposite-order checkout deadlocks. Ordinary
APIs returning mutable paths do not become immutable merely by taking a lease.

The explicit update lease ends only after its receipt-bound reads and copies.
Normal completion releases in finally only after owned Git operations finish.
A parent death or timeout is not proof its Git descendants stopped: retain the
lease and fail closed when termination is unknown. Never reclaim by age,
silence or parent PID alone. Git hooks, modes, symlinks, ignored files, populated
submodules and checkout-filter output retain their existing copy semantics;
tracked-only tar extraction is not a drop-in replacement.

Production design is reviewed after the RED, before implementation. No new
dependency, generic lock rewrite, owner-cache mutation or publication is part
of this preparation.

Anchor: Basili, Caldiera and Rombach (1994), GQM; Git working-tree identity;
Node.js child-process and filesystem exclusive-creation APIs.

## Receipt-bound scope findings

The registered separate-process reproduction failed with the accepted SHA1 in
state and lock while the installed file contained SHA2 bytes. Retain the valid RED separately from the earlier setup and tree-guard failures;
those failures are not semantic measurements. A module-only tail cannot close this gap.

The first filesystem draft retained the old module tail. A mixed-order control
then failed because an existing filesystem owner waited on a tail whose waiter
needed that owner's filesystem lease. The fix uses one filesystem acquisition
protocol and per-invocation source grouping. The same control retains the owner
progress requirement. Another control requires the source-path API to surface a
typed busy refusal while preserving normal clone-failure behavior.

Exact canonical path permissions remain separate from folded collision keys.
This can over-serialize case-distinct cache paths on a case-sensitive filesystem;
it does not equate origins or authorize an unreserved path. The queued-context
control checks that an expired callback cannot use a later owner's token.
