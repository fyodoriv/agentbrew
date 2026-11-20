# Use one priority order across watched repositories

Registered on 2026-11-20. Target: `ac074d1d`. User request: always work on the highest-priority runnable task.

- **Hypothesis**: Collecting explicit priorities across repositories before applying the display limit puts a later repo's P0 ahead of an earlier repo's P2.
- **Measurement**: Run `npx vitest run src/skills/watch-issues.test.ts` on hosted CI. Freeze both repo arguments, use real scratch Git repositories and a local GitHub fixture, and compare exact result keys before and after the fix.
- **Success**: The highest two ready priorities win the two available slots in both repo orders, with 0 claimed, blocked, or stale entries shown. Recognize explicit P0–P3 labels. Keep the result format, seen keys, optional P3 file tasks, and the outside issue reservation for remaining unranked slots.
- **Pivot**: Stop after 1 priority inversion, 1 surfaced blocked or stale file task, 1 unexpected permission or network action, or 1 output or seen-key regression.
- **Anchor**: Existing [watch workflow](../../skill-plugins/workflow/watch-issues/SKILL.md) and the [priority task format](../task-backend-contract.md).

The watcher ranks only priorities it can read from the current task file or
an explicit GitHub label. The working agent still checks details and live
prerequisites before claiming work.
