# Register the fetch caller contract

[Issue #692](https://github.com/fyodoriv/agentbrew/issues/692) asks for a
bounded parallel fetch helper. This preparation records what two current
callers need from it. Register the controls before writing fixtures. The
caller baseline is unmeasured.

The first caller is wrap-up's open-work script. The Agentbrew repo checkup
already invokes it. The second is dotfiles tooling-checkup inventory.
Agentbrew sync --pull has a different contract. It runs eight cached-source
pull workers and indexes the resulting checked-out files. Replacing those
pulls with fetch alone could index stale content. Status, MCP ref updates,
dotfiles tooling-sync and other network calls retain their own contracts.

## Frozen caller matrix

Use the existing Vitest wrap-up and Bats tooling-checkup suites. Run the
actual shell entry points against task-owned scratch repos. Use finite
ports for fetch and external discovery. Preserve the existing test
assertions and caller behavior. Hold normal repo inputs constant across
the applicable cases and put the failure first in scan order.

| ID | Input | Fetch attempts | Required observation |
| --- | --- | ---: | --- |
| W01 | Two eligible clean pushed checkouts, fetch enabled | 2 | One current origin fetch per checkout, both inventoried, exit 0 |
| W02 | Same two checkouts with OPEN_WORK_NO_FETCH=1 and origin/HEAD absent | 0 | Zero fetch or ls-remote calls, local branch fallback and both checkouts inventoried, exit 0 |
| W03 | First eligible origin fetch returns nonzero, second succeeds | 2 | One stale-result warning for the first checkout, second still inventoried, exit 1 |
| W04 | A noncheckout outside any Git worktree, then a clean checkout | 1 | Noncheckout is rejected and never fetched, second still inventoried, exit 2 |
| D01 | Two eligible primary checkouts, fetch enabled | 2 | One current origin fetch per primary checkout, both inventoried, exit 0 |
| D02 | Same two primaries with TOOLING_CHECKUP_NO_FETCH=1 | 0 | Both inventoried, zero fetches, exit 0 |
| D03 | First primary origin fetch returns nonzero, second succeeds | 2 | One stale-result warning for the first checkout, second still inventoried, exit 0 |
| D04 | One primary, one linked worktree and one plain directory | 1 | Fetch and primary inventory only for the primary. The linked worktree may still be reported as a worktree. Exit 0 |

Pin clean inputs and origin HEAD in all cases except W02. Seed local bare
origins and set no-GitHub flags. Use a finite fixture port that accepts
only the expected synthetic roots and exact argv. For the unchanged
wrap-up caller the fetch argv is `git -C <checkout> fetch -q --prune origin`.
For the unchanged inventory caller it is
`git -C <checkout> fetch --prune --quiet origin`. Record fixed fixture ID,
fetch count, normalized argument vector, inventory visit, warning attribution
and caller exit. Check the warning under its own checkout heading. Use no
real remote fetch, SSH, credential prompt or hung process. Limit each
fixture invocation to 20 seconds for safety. A safety timeout is incomplete
setup evidence and supplies no passing receipt.

Retain one receipt per case. Treat a missing, duplicate or malformed
receipt and an off-fixture attempt as four separate rejected recorder
samples. Require 4/4 calibration decisions. Capture command exits and
counts even when a product expectation differs from its prediction. This
measures routing and dispositions without timing or concurrency assertions.

## Commands and decision

After the registered fixtures exist, run from each repository root.

```sh
# Agentbrew
JOBS=1 heavy-run npx vitest run --reporter=default --silent=false --maxWorkers=1 src/skills/wrap-up-open-work.test.ts
JOBS=1 NO_CACHE=1 LOCKFILE_SYNC_NPM=npm@10.9.9 heavy-run npm run verify
# Dotfiles
JOBS=1 heavy-run bats tests/tooling-checkup-skill.bats
JOBS=1 heavy-run make check BATS_JOBS= TEST_FILE_JOBS=
```

Keep logs private and report only synthetic aggregate fields. The GQM
question is whether each caller requests the right fetch and preserves its
inventory decision. Predict 8/8 complete exact receipts, ten fetch
attempts, two correctly attributed stale warnings, zero off-fixture
attempts and zero setup errors. Require every case and both repository
gates. A zero runner exit with absent receipts is inconclusive. Pivot on
any incorrect decision or unsupported side effect.

## Retained native acceptance

The later native slice keeps default jobs 8, a 60-second work deadline
starting after admission, noninteractive Git and SSH, verified whole-group
cleanup, one ok/timeout/fail outcome per input, all-ok exit 0 and bad usage
exit 2. Queue wait does not spend the work budget. An unknown cleanup is a
nonzero result and must stop unsafe new admissions. Preserve the worktree,
index, HEAD, local branches and tags. The exact remote-tracking refspec
and permitted Git metadata writes need separate scratch proof. Preserve
the previously proposed F01–F20 native controls and separate original and
supplemental pure cohorts. Use independent start barriers for concurrency.

The shared Rust process owner still lacks qualified Darwin group cleanup.
The permission error during group termination leaves that outcome unknown.
Retain the process-primitives task and the existing transport diagnostic
contract. Require a qualified worker, held checkout identity, strict ref
mutation proof and actual installed helper before wiring either caller.
Keep the issue open through required native proof and qualified integration.

Anchors are Basili, Caldiera and Rombach (1994), Goal Question Metric, and
Munafò et al. (2017), preregistration.
[Git fetch ref mapping and pruning](https://git-scm.com/docs/git-fetch).

## Agentbrew caller baseline result

The scoped wrap-up suite passed all 27 tests. W01–W04 recorded five
intercepted fetches across the four runs, no fetch in no-fetch mode, and
one stale warning attributed to the first checkout. The next checkout
was still inventoried. The plain directory was rejected. No call left
the fixture, and all four recorder controls passed.

The baseline binds caller routing. Native timeout and cleanup require
their own process tests before activation.

## Caller baseline closeout

[Agentbrew PR #718](https://github.com/fyodoriv/agentbrew/pull/718) and
[Dotfiles PR #445](https://github.com/fyodoriv/dotfiles/pull/445) delivered
the two baselines. The eight routing cases matched. Each caller intercepted
five fetches, attributed one stale warning, and made zero off-fixture calls.
All four recorder controls passed in each repository. Agentbrew passed all
20 verification steps. Dotfiles passed `make check`. The native worker
and its integration remain open in [issue #692](https://github.com/fyodoriv/agentbrew/issues/692).
