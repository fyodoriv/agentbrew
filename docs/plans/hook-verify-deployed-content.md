# Verify deployed hook script bytes

The original Stop command was registered. The active script still matched the previous accepted source. `agentbrew hooks verify` reported zero drift because it checked the command registration. Read the referenced files only when Agentbrew owns the deployed copy.

## Pre-registration

**Hypothesis:** A correctly registered managed hook with stale bytes goes from 0 detected content differences to 1. A current managed copy and a user-owned script in the same event have 0 content warnings.

**Measurement:** Run `npx vitest run src/drift-checks/hooks.test.ts src/hooks/verify-cli.test.ts` in hosted CI. Compare source and deployed bytes with `cmp -s "$HOOK_FIXTURE_SOURCE" "$HOOK_FIXTURE_DEPLOYED"` after a controlled sync in a scratch home.

**Success:** Report 1 stale script in the baseline fixture after the correction, 0 inaccurate warnings across the two controls, and 0 differing bytes after the controlled repair.

**Pivot:** Stop the new content check if it reports 1 or more user-owned copies as stale. Require positive file ownership before reporting drift.

**Anchor:** [Original registered-hook rollout](https://github.com/fyodoriv/agentbrew/pull/1342) and [published registration check](https://github.com/fyodoriv/agentbrew/blob/662381a4402a970504a6a811b1a7cb6df63e222e/src/hooks/verify-cli.ts).
