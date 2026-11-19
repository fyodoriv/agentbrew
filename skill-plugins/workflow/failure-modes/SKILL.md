---
name: failure-modes
description: Write a tested failure-mode table for a new component, job, service, or feature before it ships - steady state, blast radius, escape hatch, and one row per fault with the expected behavior and the test that proves it. Use when you add something that does I/O, runs unattended (LaunchAgent, cron, daemon, watcher), calls a network service, an LLM, or an external CLI, or holds state, and when a PR adds retries or fallbacks. Don't use for pure functions, docs, one-line fixes, or debugging a live failure (use systematic-debugging).
---

# Failure modes

Decide how a component fails before it fails in use. Write the decision down,
then prove each row with a test. A failure path that has no test is a guess.

Adapted from minsky rule #7 (chaos coverage).

## When it applies

Apply it when the change adds or changes code that:

- reads or writes files, a database, or a network service;
- runs with no person watching (LaunchAgent, cron, daemon, file watcher, CI job);
- calls an LLM or an external CLI;
- keeps state between runs (cache, lock, queue, checkpoint);
- adds a retry, a fallback, or a timeout.

Skip it for pure functions, docs, and one-line fixes.

## Steps

1. **Steady state.** Write the measurable signal that shows the component
   works. Example: "the sync log has one `ok` line per night and the target
   folder matches the source". Name the command that reads the signal.
2. **Blast radius.** Write who or what breaks when it fails: users, other
   jobs, data, money, the machine.
3. **Escape hatch.** Write the exact command or setting that turns it off or
   recovers it. An operator must be able to stop it without reading the code.
4. **Fill the table.** Walk the fault axes below. Add one row for each fault
   that can really happen:

   | Mode | Trigger | Expected | Test |
   |---|---|---|---|

   `Expected` is exactly one of these three behaviors:

   - `crash loudly`: stop with a clear error and a non-zero exit. Pick it
     when going on would corrupt data, or when a supervisor (launchd,
     systemd, a CI rerun) restarts the work. A loud crash is a valid design.
   - `circuit-break and notify`: stop calling the failing dependency for a
     cool-down period, and tell a person (log at error level, a
     notification, a doctor line). Pick it for a dependency that fails again
     and again, so you do not hammer it.
   - `degrade gracefully`: keep the main job working with less (cached
     data, no optional feature), and show that it degraded. Pick it when a
     user is waiting and a partial result is better than none.

   Never write "retry silently", "ignore", or "log and continue". These
   hide the failure. A bounded retry is fine inside one of the three
   behaviors, but the last failure must still crash, break, or degrade, and
   it must be visible.
5. **Write a fault-injection test for each row.** Force the trigger (a fake
   that throws, a full temp disk, a held lock, a stub that sleeps past the
   timeout). Assert the expected behavior. See the test fail first, then
   pass. Put the test file path or test name in the `Test` cell, in
   backticks.
6. **Publish the section.** Put it under `## Failure modes` in the
   component's README, or in the PR body when the component has no README.
7. **Run the checker** and fix every line it prints:

   ```bash
   node <skill-dir>/scripts/check-failure-modes.mjs README.md --repo .
   ```

   It checks the three labels, the table, the allowed behaviors, and (with
   `--repo`) that each named test exists.

## Fault axes to walk

- Dependency down (service, database, CLI not installed).
- Slow response or timeout.
- Bad or partial input (empty file, wrong schema, truncated JSON).
- Disk full or permission denied.
- Two runs at once, or a stale lock left by a dead run.
- Crash mid-write that leaves partial state.
- Clock or timezone change (DST, sleep and wake, a wrong system clock).
- Expired auth (token, cookie, key).
- Rate limit or quota.
- Missing or invalid config.

Skip an axis only when it cannot happen. Do not skip it because it is hard to
test; write the test.

## Example

```markdown
## Failure modes

**Steady state:** `sync.log` gets one `ok` line per night, and
`diff -r src/ mirror/` prints nothing.

**Blast radius:** the mirror goes stale; nothing else reads it.

**Escape hatch:** `launchctl bootout gui/$UID/com.example.nightly-sync`, or set
`sync.enabled: false` in `config.yaml`.

| Mode | Trigger | Expected | Test |
|---|---|---|---|
| Source missing | source folder unmounted | crash loudly | `tests/sync-missing-source.test.ts` |
| Two runs at once | lock file held by a live run | crash loudly | `tests/sync-lock.test.ts` |
| Crash mid-copy | process killed during a write | degrade gracefully | `tests/sync-atomic-write.test.ts` |
| Remote API down | 5xx responses three times in a row | circuit-break and notify | `tests/sync-remote-down.test.ts` |
```

"Degrade gracefully" for the mid-copy crash means: write to a temp file and
rename, so the old mirror file stays valid and the next run repairs it.

## Done when

- The section has a steady state, a blast radius, an escape hatch, and a
  table row for every fault that can happen.
- Every row has a test, and every test passed after it first failed.
- The checker prints `OK`.

## Sources

- Basiri et al. 2016, "Chaos Engineering", IEEE Software.
- Armstrong 2003, "Making reliable distributed systems in the presence of
  software errors" (let it crash), PhD thesis.
- Nygard 2007 and 2018, "Release It!" (circuit breaker, timeouts, bulkheads).
