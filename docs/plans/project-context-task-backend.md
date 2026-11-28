# Use the declared task backend during project entry

**Hypothesis:** Reusing the task-backend resolver gives the context helper the
same answer as other task-aware tools for all four descriptor cases. The old
helper reads legacy metadata and can route work to the wrong queue.

**Measurement:** Run `npx vitest run src/sync/helper-scripts-behavior.test.ts`
in hosted CI. Compare the shell helper's route with the resolver for an
Agentfile, the fallback config, no descriptor, and conflicting legacy metadata.
Run the existing session-entry hook cases for process isolation and timeout.

**Success:** Four of four descriptor cases report the resolver's backend
without creating a task file. The existing 0.75-second startup timeout and
restricted executable search path stay in effect.

**Pivot:** If one descriptor case disagrees or the helper cannot load the
trusted resolver within the existing budget, keep the task open. Keep the
documentation listing available and omit an unavailable backend hint.

**Anchor:** [Task-backend contract](https://github.com/fyodoriv/agentbrew/blob/0507a2c76480daf840a8d227692e77005f376fcf/docs/task-backend-contract.md)
and the [session-entry deadline](https://github.com/fyodoriv/agentbrew/blob/0507a2c76480daf840a8d227692e77005f376fcf/hooks/lib/session-entry-context.pl).

## Verification

Nov 28, 2026. [PR #1363](https://github.com/fyodoriv/agentbrew/pull/1363)
merged at `47e876a9`. Both hosted runners in
[run 46102675083](https://github.com/fyodoriv/agentbrew/actions/runs/46102675083)
passed 32 helper cases, eight contract cases and 14 resolver cases.

The installed helper matched the shipped template after accounting for its
configured absolute resolver paths. Fresh Bash processes agreed with that
resolver on all four descriptor inputs and created no task file. The
shipped SessionStart handler also returned the declared and default routes
when called with two scratch events and the installed helper. This exercised
the handler directly. Client activation of the opt-in hook is separate.
