---
description: Preserve all agent work before shutdown, or list what is unsafe
---

# Prepare to go offline

Arguments: `--dry-run` inventories and proposes actions without changing
sessions, repos, processes, tabs, locks, or remote services.

Set one shared deadline about three minutes from now. Read this platform's
live capabilities before acting. Use its native session inventory and
coordination tools when they exist. Never claim that an unavailable control
exists. Do not run a full gate or wait for CI on this path.

## 1. Inventory (read only, bounded by the deadline)

List every session's owned repos, dirty and unpushed work, unmerged branches,
missing upstreams, stashes, and open PRs. Use wrap-up's open-work inventory
when available. Bound network calls to the time left; failed or incomplete
inventory is an unresolved item, never a clean result.

Also list setup-owned scheduled loops, background shells, preview servers,
agent browser tabs, and the temporary browser lease. Check ownership from
session records and process arguments, not a guessed name. Do not copy
private payloads, credentials, or raw session transcripts into a report.

In dry-run mode, print this inventory and exact proposed actions, then stop.
Say `NOT SAFE: dry run; shutdown preparation was not executed`.

## 2. Ask other sessions to preserve their work

Use native coordination to ask each other session to run wrap-up by the draft
route: save useful changes, push only to an approved destination, and open or
update a leak-checked draft PR with a Pending list and a task per pending item.
No merge, CI wait, force-push, hook bypass, or claim of a passing unrun gate.
If a required commit gate cannot finish by the deadline, preserve local files
and patches privately and report that item unresolved; do not skip the gate.

Wait for each session's actual acknowledgment and evidence within the time
left. Archive a session only after its handoff is proved. If it does not
answer, use the platform's supported stop control before touching its repos;
confirm it stopped and inventory again. If stop is unavailable or unproven,
leave its repos untouched and list the session unresolved. Never kill an
unknown process to imitate a session stop.

## 3. Stop only setup-owned resources

Stop owned scheduled loops, background shells, preview servers, agent tabs,
and the temporary browser lease only after their work is preserved. Use each
resource's owner API; release only a lease held by this session. Never touch
the user's browser tabs, another agent's lease or an unrelated lock holder.
Re-read actual state after each stop. A submitted stop request is not proof.
Wrap up this session's work by the same draft route, without a merge.

## 4. Report the shutdown verdict

Show a short local report of preserved branches, PRs and pending tasks,
stopped resources, and unresolved items with their owner and next step.
No resource can count as safe from a missing tool, timeout or inferred result.
If inventory, handoff and stops are all complete and proved, finish with
`SAFE TO SHUT DOWN`. Otherwise finish with `NOT SAFE: <what is left>`.
A company plugin may add its hosts and tools; generic behavior lives here.

Persist the final handoff and deliver its verdict before archiving this session.
Use the supported self-session archive tool as the last platform action, only
when doing so preserves the visible report. If self-archive is unavailable,
list it as unresolved and report NOT SAFE rather than silently omitting it.
