# The Loop


```
┌──────────────────────────────────────────────────┐
│  0a. ANALYZE — read past taskgrind logs          │
│  0b. DETECT — identify project type & commands   │
│  1. TIDY — merge dangling PRs, clean stale state │
│  2. CHECK QUEUE — are there actionable tasks?    │
│     YES → go to 4 (skip sweep)                   │
│     NO  → 3. SWEEP → MERGE → 4                  │
│  4. IMPLEMENT × N — pick, ship, repeat           │
│  5. Go to 1 (with progressive depth)             │
└──────────────────────────────────────────────────┘
```

Batch size N = $1 (default: 10). After N tasks (or when TASKS.md empties), sweep again.

### CRITICAL: Existing tasks always beat sweep findings

**The sweep exists to find work when the queue is empty.** If TASKS.md has
unclaimed, unblocked tasks — even large/complex ones — skip the sweep entirely
and go straight to IMPLEMENT. Never generate easy busywork while real roadmap
tasks sit untouched.

**When remaining tasks are all large/complex:**
Do NOT fall back to sweeping. Instead, decompose one task:
1. Pick the highest-priority unclaimed, unblocked task
2. Read its Details and Acceptance criteria
3. Break it into 2-4 sub-tasks in TASKS.md (same priority, add `**Parent**: <original-id>`)
4. Commit: `chore: decompose <task-id> into sub-tasks`
5. Implement the first sub-task

This is how the queue progresses — by making large tasks smaller, not by
inventing test-writing tasks that produce commits without advancing the roadmap.

---

### Phase 0a: ANALYZE PAST GRINDS

Before doing anything else, read the taskgrind logs for this repo to learn from
prior sessions. This takes 30 seconds and prevents repeating mistakes.

```bash
# Find all grind logs for the current repo (filter by repo= header)
repo_path=$(pwd)
grep -l "repo=$repo_path" /tmp/taskgrind-*.log 2>/dev/null | sort | tail -5
```

For each matching log, extract the structured data:

```bash
# Parse session outcomes from a log file
grep -E 'session=.*ended|grind_done|stall_warning|stall_bail|git_sync failed' "$log_file"
```

**What to look for and what to do:**

| Pattern | Signal | Action |
|---------|--------|--------|
| `shipped=0` on 3+ consecutive sessions | Agent stalled on hard tasks | Check which tasks were in the queue then — are they still there? If so, decompose them NOW in Phase 4 |
| `stall_bail` | Marathon gave up | The tasks that stalled the marathon are likely still in TASKS.md. Prioritize decomposing them |
| `git_sync failed` | Agent left repo on wrong branch | Already fixed in taskgrind, but if you see it, verify you're on main |
| `tasks_after > tasks_before` | Session added tasks without completing any | Sweep-generated busywork — don't repeat this. Skip sweep, go to Phase 4 |
| `duration=` < 60s on real sessions | Sessions crashing fast | Check for broken verify gate, missing dependencies, or env issues |
| Many sessions, low total shipped | Poor efficiency | Focus on small, shippable tasks — decompose aggressively |

**Turn findings into tasks:** If the log reveals a repo-specific pattern that caused
stalling (e.g., "sessions 3-10 all stalled at 19 tasks"), add a P1 task to TASKS.md:

```markdown
- [ ] Decompose remaining P0 tasks into shippable sub-tasks
  **ID**: decompose-stalled-epics
  **Tags**: grind, productivity
  **Details**: taskgrind log shows sessions stalled after shipping easy tasks.
    Remaining tasks are large epics that need decomposition before the next grind.
  **Acceptance**: Every P0/P1 task is either one-commit-sized or has sub-tasks
```

Then commit: `chore: add tasks from grind log analysis`

**Skip this phase** if no logs exist for this repo (first-ever grind).

### Phase 0b: DETECT

Before the first sweep, identify the project type once. Check for:

| Marker | Type | Verify command | Test command |
|--------|------|----------------|--------------|
| `package.json` + `tsconfig.json` | TypeScript | `npx tsc --noEmit && npx biome check .` | `npm test` (or `npx vitest run`) |
| `package.json` (no TS) | JavaScript | `npx eslint .` | `npm test` |
| `Cargo.toml` | Rust | `cargo check && cargo clippy` | `cargo test` |
| `go.mod` | Go | `go vet ./...` | `go test ./...` |
| `pyproject.toml` | Python | `ruff check . && mypy .` | `pytest` |
| `Makefile` + `*.sh` | Shell | `make lint` | `make test` |

**Prefer project-specific targets** — if the project has `make check`, `make verify`,
`npm run verify`, `npm run test:affected`, `npm run test:all`, or similar, use those.
They encode project-specific knowledge such as changed-file test selection and cache
settings. Check AGENTS.md for the canonical verify command.

Also detect: has README, has VISION.md, has user stories, has CLI, has UI.
Store these flags — they control which sweep tiers and verify steps run.

**Web project detection** — if the project has a UI (React, Vue, Svelte, HTML pages),
detect the dev server command and store it:

| Marker | Dev server command |
|--------|-------------------|
| `vite.config.*` | `npx vite` or `npm run dev` |
| `next.config.*` | `npx next dev` |
| `angular.json` | `npx ng serve` |
| `webpack.config.*` | `npx webpack serve` |
| `index.html` + no framework | `npx serve .` or `python -m http.server` |

Check `package.json` scripts for `dev`, `start`, `serve`, or `storybook`. Also check
if the project has a running production URL in AGENTS.md, README, or `.env*` files.
Store: `dev_server_cmd`, `dev_server_port`, `production_url` (if any).

### Task Backend Detection

Detect the repo's task backend by checking for `.tasksmd.json` at the git root:
- If `.tasksmd.json` declares `backend: github-issues`, use the GitHub Issues backend
- Otherwise, default to `TASKS.md` backend

**GitHub Issues backend:** Do not edit TASKS.md — it is retired. Use the `tasks` CLI:
- List tasks: `tasks list [--priority P1] [--unclaimed]`
- Pick next task: `tasks pick [--backend github-issues]`
- File new task: `tasks create "<title>" [--priority P2] [--body ...] [--tag ...]`
- Claim task: `tasks claim <id>` (self-assigns the issue)
- Complete task: Put `Closes #N` in the PR that fixes it

**TASKS.md backend:** Follow the standard TASKS.md format and workflow described in AGENTS.md.

### Phase 1: TIDY — merge everything, then sync

Before finding new work, aggressively close out ALL loose ends. The goal is:
every open PR merged into main, local and remote fully in sync, zero dangling state.

#### Step 1: Merge every open PR

Run `gh pr list --author @me --state open --json number,title,headRefName,mergeable,statusCheckRollup`.
For **each** PR, escalate through every strategy until it merges:

1. **If this repo is under `~/apps/tooling` and substantive checks are green, admin/bypass merge by default**: `gh pr merge <n> --squash --admin`. This is standing-approved for the user's own tooling PRs; do not stop at review/base-branch policy.
2. **Otherwise try normal merge**: `gh pr merge <n> --squash --delete-branch`
3. **If blocked by failing status check** (e.g. a required ticket check, required CI):
   - Inspect the failing check name and reason
   - Fix metadata issues: `gh pr edit <n> --title "type: description TICKET-123"`
   - Fix CI issues: check out the branch, run verify, fix lint/type/test errors, push
   - Wait about 15 seconds, let the checks re-run, then retry merge
4. **If blocked by merge conflicts or a moved base branch**:
   - Check out the branch, rebase onto main, resolve conflicts, force-push
   - Retry the merge
5. **If blocked by required approvals outside `~/apps/tooling`**:
   - If the repo belongs to an approved repo family, follow that repo's AGENTS.md merge path.
   - In org/work/product repos outside explicitly approved families, do **not** try `--admin`, REST merge bypasses, branch-protection bypasses, or any force-merge path. Leave the PR open and log the exact review/check blocker.
6. **If all allowed strategies fail**: log the PR number and reason, move to the next PR.
   Do NOT close the PR — it has code worth saving.

**Do not skip PRs because they look hard.** Every open PR is unshipped work.
Fight for each one before moving on.

#### Step 2: Clean up uncommitted local state

Run `git status`. If there are staged/unstaged changes from a prior crashed session:
- Review the diff — commit if the changes look complete
- Stash if unclear (the next session can evaluate)
- Only discard if clearly broken/partial with no salvageable work

Also delete any leftover local branches that were already merged:
```bash
git branch --merged main | grep -v '^\*\|main' | xargs -r git branch -d
```

#### Step 3: Sync local and remote

Get local main fully up to date with remote, and ensure remote has everything local:
```bash
git checkout main
git fetch origin --prune
git rebase origin/main
git push origin main        # push any local-only commits (merged PRs, direct commits)
```

After this step: `git log main..origin/main` and `git log origin/main..main` should
both be empty. Local and remote main are identical. No dangling branches, no open PRs
(except those that genuinely need human approval).

Skip this phase only if this is session 1 AND there are no open PRs.

### Phase 2: CHECK QUEUE

Before sweeping, check if TASKS.md has actionable tasks:

```
actionable = unclaimed AND unblocked tasks (no `(@agent)`, no `**Blocked by**:`)
```

| Queue state | Action |
|-------------|--------|
| Has actionable tasks (any size) | **Skip sweep. Go to Phase 4 (IMPLEMENT).** |
| All tasks are claimed or blocked | Sweep to find new work |
| Queue is empty | Sweep to find new work |

**"Large task" is not "no task".** A complex P0 epic with 5 acceptance criteria is
actionable — decompose it in Phase 4, don't sweep around it.

### Phase 3: SWEEP (only when queue has no actionable tasks)

Run a read-only audit using the sweep skill's 8-tier structure. Launch parallel subagents:

| Tier | Name | Focus | Priority |
|------|------|-------|----------|
| 1 | Verify gate | Typecheck, lint, test, security failures | P0 |
| 2 | Stability | Error handling, crash paths, input validation | P0 |
| 3 | Test depth | Coverage gaps, edge cases, test quality | P2 |
| 4 | Docs fidelity | README accuracy, working examples, link rot | P2 |
| 5 | Code health | Large files, complexity, dead code, duplication | P2-P3 |
| 6 | Dependencies | Outdated, unused, vulnerabilities, deprecated APIs | P2 |
| 7 | DX & UX | Error messages, CLI help, output consistency, accessibility | P1 |
| 8 | Vision alignment | User story gaps, competitive edge, feature completeness | P1 |

**Tier-specific guidance** (commonly missed checks — see `sweep` and `project-audit` for full lists):

- **T2 Stability**: Check for these production stability patterns — they apply to any codebase. Check: silent `catch {}` blocks (every catch must log or propagate), string-based error classification (use typed errors, not regex on messages), missing pre-condition checks before expensive operations, inconsistent error handling across parallel code paths (5 retry paths where just 2 verify health first = bug), fire-and-forget async (`void asyncFn()` without `.catch()`), resource leaks (unclosed handles, unreaped child processes, `buf += chunk` without cap, `on(` without `off(`), unbounded growth (log files, queues, caches without rotation/eviction), missing timeouts on ALL external calls (HTTP, exec, OS commands), crash-retry loops without health checks between attempts, missing validation gates between pipeline stages, shallow `isAvailable()` checks that don't test auth/connectivity, and graceful shutdown issues (double-shutdown race, no hard timeout, active work not stopped).
- **T3 Tests**: Flag files with no test file, assertion density < 2/test, flaky indicators (`setTimeout` in tests, date-dependent assertions, order-dependent tests), and mock overuse (mocking so deep the test verifies nothing real).
- **T4 Docs**: Verify AGENTS.md layout matches actual dirs. Build user-story → implementation coverage matrix. Check cross-doc consistency (README, VISION, AGENTS.md must agree on features and names). Click every link, run every documented command. **Volatile counts** — an inventory count in docs (agents, skills, tests, packages) goes stale, even as `N+`. Never file tasks to re-count it. File one task to delete the count, link its source of truth, or generate it.
- **T5 Code health**: Flag >300-line source files, >4-level nesting, magic numbers/hardcoded strings, ESM/CJS shims where `import.meta.dirname` works, and inconsistent patterns (5/6 calls follow a pattern, 1 doesn't — that's a bug).
- **T6 Dependencies**: Check `.preferred-deps.yaml` before suggesting replacements. Separate major (breaking) from minor/patch (safe) updates. Check license compliance (copyleft in permissive projects). Flag oversized deps with lighter alternatives. **Scan for custom code replaceable by packages** — hand-rolled utilities that duplicate maintained packages (retry logic vs `p-retry`, deep-merge vs `deepmerge`, glob vs `fast-glob`), entire subsystems a library solves (custom config loading vs `cosmiconfig`, custom process spawning vs `execa`), and vendored/copied code. Verify the replacement package is maintained and the custom code has real deficiencies before recommending. Shape findings as: "replace custom X with package Y — deletes ~N lines."
- **T7 DX/UX**: For CLIs — verify `--help` on every command, actionable error messages, non-zero exit on failure, progress indicators on long ops. Check first-run experience.
  For **web projects** — use the browser (agent-browser CLI or Playwright MCP tools):
  1. Start the dev server (background): `npm run dev &` or the detected `dev_server_cmd`
  2. Open the app: `agent-browser open http://localhost:<port>` (or use Playwright MCP `browser_navigate`)
  3. Take a snapshot: `agent-browser snapshot -i` to get element refs and page structure
  4. Walk every page reachable from nav/sidebar/footer — screenshot each
  5. Test mobile: `agent-browser set viewport 375 812` (or Playwright `browser_resize`)
  6. Check forms: fill fields, submit, trigger validation errors
  7. Check empty/error states: navigate to edge cases, missing data
  8. Check console: `agent-browser console` for JS errors and warnings
  If the project has a production URL, test that too. Portal tasks, portal configuration,
  and admin UI tasks are all browser tasks — use `agent-browser` or Playwright MCP to do them.
- **T8 Vision**: Review API surface (minimal? coherent?). Check CRUD symmetry (create without delete = gap). Verify naming consistency across commands/flags/functions.

Each subagent receives the current TASKS.md task list so it skips duplicates.
Collect results and write NEW findings to `TASKS-AUDIT.md`.

**Progressive depth**: Track which tiers produced findings on each sweep:
- Sweep 1: Run all 8 tiers broadly (surface-level scan)
- Sweep 2+: Run all tiers, but go deeper on tiers that had findings last time
  (read individual functions, trace call chains, check edge cases)
- If a sweep produces < 3 new findings: the codebase is clean for now.
  Log "sweep clean — codebase in good shape" and stop.

**Audit cascade** (when the queue empties and normal sweep finds nothing):
Run deeper, specialized audits before declaring the codebase clean:
1. Trace every user story to its implementation — flag gaps
2. Run every documented CLI command — flag broken examples
3. Compare README claims against actual behavior — flag drift
4. Check that every exported function has tests — flag coverage gaps
5. For recurring patterns (same class of issue in 3+ places), suggest a lint rule or policy comment to prevent recurrence

Only declare "sweep clean" after the cascade also finds < 3 issues.

### Phase 3b: MERGE (after sweep only)

Merge audit findings into TASKS.md:
1. Read `TASKS-AUDIT.md`
2. For each task, check if TASKS.md already has it (by ID) — skip duplicates
3. Append new tasks under the correct `## P*` heading
4. Delete `TASKS-AUDIT.md`
5. Commit: `chore: merge sweep findings into task queue`

### Phase 4: IMPLEMENT (repeat N times)

For each iteration:

#### 4a. Read policies

Re-read TASKS.md. Check for `<!-- policy: ... -->` HTML comments:
- **File-level policies** (between `# Tasks` and first `## P*`) apply to every task
- **Section-level policies** (after a `## P*` heading) apply only to tasks in that section

Follow all policies alongside each task's own metadata. If a policy conflicts with
a task's instructions, the policy wins — it's the project owner's rule.

#### 4b. Resume unfinished work

Scan TASKS.md for your `(@agent-id)` claim:
- **Found + work is done but not committed** → skip to Ship
- **Found + work is in progress** → skip to Implement
- **Found + stale (no related code)** → unclaim (remove `(@agent-id)`), pick fresh
- **None found** → continue to Pick

#### 4c. Pick the next task

Walk **P0 → P1 → P2 → P3** in strict order. Within each level, prefer:

1. Tasks whose **ID** appears in another task's `**Blocked by**` — completing them unblocks others
2. Tasks with no `**Blocked by**`, or whose blockers no longer exist in TASKS.md
3. Unclaimed — skip tasks with `(@agent-name)` that isn't you
4. **Hardest first** — architectural, multi-file, or ambiguous tasks over simple ones

> **MCP shortcut:** If `tasks-mcp` is available, use `pick_task` — it applies these rules automatically.

**Never skip a higher-priority task for a lower-priority one.** If the first
unblocked P0 task looks hard, that's the task. Decompose it — don't drop to P2.

#### 4d. Decompose if needed

If the picked task would touch many files (rough guide: over 5), span multiple concerns, or has 3+
acceptance criteria, decompose it BEFORE implementing:
1. Break into 2-4 sub-tasks in TASKS.md under the same `## P*` heading
2. Each sub-task should be one-commit-sized (touching 1 to 3 of them)
3. Add `**Parent**: <original-id>` to each sub-task
4. Keep the parent task — it's "done" when all sub-tasks are removed
5. Commit: `chore: decompose <task-id> into sub-tasks`
6. Now pick the first sub-task and implement it

**This is critical.** The previous failure mode was: encounter a large task →
decide it's "not actionable" → fall back to sweeping → generate easy test-writing
tasks → make zero roadmap progress. Decompose and implement instead.

#### 4e. Claim and implement

Add your identity to the task line: `- [ ] Task description (@devin)`

Create a branch (if repo convention requires it — check AGENTS.md):
```bash
git checkout main && git pull --rebase
git checkout -b <type>/<task-id>
```
Some repos commit directly on `main` — check AGENTS.md first.

Follow the task's **Details**, **Files**, and **Acceptance** criteria.
Make minimal, focused edits — fix the root cause, not the symptom.

**Browser tasks** — tasks tagged with `portal`, `browser`, `visual`, `ux`, `plugin`, or
tasks whose Details mention URLs, portals, web UIs, or "verify in browser" are browser tasks.
Use `agent-browser` CLI or Playwright MCP tools to complete them:

```bash
# Navigate and interact with agent-browser
agent-browser open <url>
agent-browser snapshot -i          # get element refs (@e1, @e2, ...)
agent-browser click @e3            # click an element
agent-browser fill @e1 "value"     # fill a form field
agent-browser screenshot result.png
```

Or use the Playwright MCP tools directly:
- `browser_navigate` — open a URL
- `browser_snapshot` — get page accessibility tree with element refs
- `browser_click` — click an element by ref
- `browser_type` — type text into a field
- `browser_fill_form` — fill multiple form fields at once
- `browser_screenshot` — take a screenshot
- `browser_evaluate` — run JavaScript on the page
- `browser_console_messages` — check for JS errors

**For web project implementation tasks**: after making code changes, start the dev server
and verify your changes visually before committing:
```bash
# Start dev server in background
npm run dev &
# Wait for it, then verify
agent-browser open http://localhost:5173 && agent-browser screenshot after.png
```

**Never mark a browser task as "blocked by browser access".** You have full browser
automation via agent-browser and Playwright MCP. If a task requires navigating a website,
filling a form, clicking buttons, or verifying a web UI — do it.

#### 4f. Verify

1. Run the project's verify gate (detected in Phase 0b). All must pass.
2. Run `git diff --check` — catch conflict markers before they land.
3. If the project has no verify command, at minimum: run tests, check for syntax errors.

#### 4g. Ship

Remove the task block from TASKS.md (the entire block, not `[x]`). Include in the same commit:
```bash
git add <specific-files> TASKS.md
git commit -m "<type>: <description>"
git push origin <branch>
gh pr create --title "<same as commit>" --body "<what and why>"
```
Follow the repo's commit convention. Check AGENTS.md or recent git log.

#### 4h. Merge and sync

Merge immediately — don't accumulate open PRs. In repos under `~/apps/tooling`,
admin/bypass merge own PRs by default once substantive checks are green:
```bash
gh pr merge <number> --squash --admin
```
In other repos, escalate through every strategy (same as Phase 1 Step 1):
```bash
gh pr merge <number> --squash --delete-branch
```
If that fails:
1. Failing status check → inspect, fix metadata/CI, wait for re-run, retry
2. Merge conflicts → rebase branch onto main, force-push, retry
3. Required approvals → explicitly approved repo families follow their own AGENTS.md; other org/work/product repos are never admin/bypass/force-merged, so leave the PR open with the exact blocker
4. All allowed strategies exhausted → leave PR open (Phase 1 will retry next cycle)

Sync to main after merge:
```bash
git checkout main
git fetch origin --prune
git rebase origin/main
```

#### 4i. Loop to 4a

Go back to 4a (Read policies) and pick the next task. The queue may have changed
(other agents shipped work, your decomposition added sub-tasks). Always re-read TASKS.md.

### Phase 5: LOOP

After N tasks or when the queue empties:
- Log: "Batch complete. N tasks shipped. Starting next cycle."
- Go back to Phase 1 (TIDY), then Phase 2 (CHECK QUEUE) decides whether to sweep or implement.

**Re-sweep triggers** (sweep before hitting N tasks):
- Queue has only blocked/claimed tasks left (Phase 2 will route to sweep)
- Queue is empty (Phase 2 will route to sweep)
- You just fixed a bug that might expose new issues

**Never sweep just because remaining tasks look hard.** Decompose them instead.

---
