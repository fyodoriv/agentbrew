# Tasks

Per-session staging buffer for `sweep` audits. Step 6 of the `sweep` skill
drains every finding into `TASKS.md` P3 at session end and resets this file.
If you see unclaimed tasks here outside an in-flight sweep, the previous
session's drain failed — file an issue.

<!-- policy: Keep tasks outcome-shaped and deduplicated against TASKS.md before adding them.
     policy: Verify referenced files/paths still exist before filing — cleaned up 2026-04-21 because three audit items
             pointed at files that had been renamed or never existed.
     policy: Step 6 of the sweep skill MUST drain every finding into TASKS.md P3 and reset
             this file to its empty header at session end. Do not park findings on `audit/*`
             or `sweep/*` branches that never merge. -->

## P0

## P1

## P2

## P3
