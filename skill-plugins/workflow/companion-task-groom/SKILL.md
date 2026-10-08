---
name: companion-task-groom
description: >
  Read-only companion lane — groom `TASKS.md` without competing with the
  worker's edits. Lints the file, identifies dead tasks (referencing
  deleted files), stale agent claims, duplicates, and tasks missing
  required metadata. Files corrections as new task blocks or as P3
  follow-ups. Use when called by `companion-researcher` or when the user
  asks "groom tasks", "lint tasks", or "clean up TASKS.md". Don't use to
  pick a task to work on (use `next-task`) or to implement tasks (use
  `plan` / `grind`).
argument-hint: "[--repo path] [--worker-active-file /tmp/companion-worker-active-<repo-slug>.txt] [--stale-claim-hours 24]"
triggers:
  - user
  - model
---

## Role

You are the **task-grooming lane** of the companion workflow. You read
`TASKS.md`, validate it against the spec, surface dead/stale entries,
and propose corrections — but you do not edit or remove existing task
entries (that's the worker's role). Your output is a curated set of P3
follow-up tasks plus an optional `TASKS-AUDIT.md` summary.

## Safety Rules

Inherit the [companion-researcher safety rules](../companion-researcher/SKILL.md#safety-rules--do-not-skip).
Highlights:

- **You may NOT remove existing tasks.** The worker may be partway
  through one; deleting their claimed task would lose work. File a P3
  follow-up that proposes removal and quotes the dead entry.
- **You may NOT reorder tasks.** Priority order matters to the worker.
- **You may append** new P3 tasks via atomic `printf >>` style.
- **You may overwrite `TASKS-AUDIT.md`** if the project uses it (e.g.
  the `sweep` skill conventions).
- Skip the lane entirely if the worker's active list contains
  `TASKS.md` — the worker is editing it now and an append might race.

## Process

### Step 0: Detect task backend

Check for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, the repo uses GitHub Issues for tasks — skip this skill (grooming is not applicable to GitHub Issues). Otherwise, proceed with TASKS.md grooming.

### Step 1: Pre-flight

```bash
# Slug the repo name so a repo like `tasks.md` doesn't produce
# `/tmp/companion-worker-active-tasks.md.txt` with a confusing
# double-dot. Strip any extension and replace `.` with `-`.
repo_slug=$(basename "$PWD" | sed 's/\./-/g')
worker_active="${1:-/tmp/companion-worker-active-${repo_slug}.txt}"

# Bail if worker is editing TASKS.md right now
if grep -qx "TASKS.md" "$worker_active" 2>/dev/null; then
  echo "Worker active on TASKS.md — skipping task-groom lane"
  exit 0
fi

# Bail if there's no TASKS.md
[ -f TASKS.md ] || { echo "No TASKS.md in $(pwd) — skipping"; exit 0; }
```

### Step 2: Lint

```bash
npx -y @tasks-md/lint TASKS.md > /tmp/companion-tasks-lint.log 2>&1
status=$?
```

If lint passes, continue. If lint fails, **read the errors** — don't
auto-fix yet. Some failures (missing metadata, ordering) need human
judgment.

For each lint error, capture:
- The line number
- The error type
- The full task block at that line

### Step 3: Spec-aware checks beyond lint

Run these checks independently of the linter (the spec is at
https://github.com/tasksmd/tasks.md/blob/main/spec.md if you need
to reread it).

| Check | How | Output |
|-------|-----|--------|
| **Missing `**ID**`** | `awk` per-task; flag tasks without ID line | "ID missing on `<task line>`" |
| **Duplicate `**ID**`** | sort + uniq -d on ID values | "Duplicate ID: `<id>` at lines X, Y" |
| **Stale claim** | `(@agent-id)` claim with no commit by that agent in last `--stale-claim-hours` (default 24) | "Stale claim by `<agent>` on `<task>` — last commit by agent was <Nh ago>" |
| **Dead file reference** | `**Files**:` lists a path that no longer exists. For paths outside the current repo (absolute paths or `../<repo>/...` references), `ls`/`test -e` the absolute path; if you have read access and it doesn't exist, flag as **dead**. If you can't read the path at all (permission denied, mount missing), flag as **unverified** instead — don't claim "dead" when you couldn't check. | "Dead Files ref in `<task>`: `<path>` doesn't exist" |
| **Acceptance missing verifier** | `**Acceptance**:` field is **present** but contains no verification command (no backtick command, no `Run:`/`Test:` line). NOTE: per the spec, `**Acceptance**:` is OPTIONAL — a task with no Acceptance line at all is valid. Only flag tasks where the field exists but the content is weak. If the task is trivial (single-file change under 30 min), don't flag at all. | "Acceptance criteria for `<task>` has no verification command" |
| **Blocked without unblock path** | `**Blocked**:` field with no follow-up or owner | "Blocked task `<task>` has no unblock path documented" |
| **`<TBD>` or empty fields** | grep for `<TBD>`, `TODO`, empty colons | "Placeholder text in `<task>`: `<line>`" |
| **Tasks older than 90 days** | `git log` for first-touch of each task block | "Old task `<task>` filed <Nd ago>, never claimed" |

For Minsky-bootstrapped repos (`.minsky/repo.yaml` exists), additionally
check Rule-#9 fields: `**Hypothesis**`, `**Success**`, `**Pivot**`,
`**Measurement**`, `**Anchor**` must each fit on a single line.

### Step 4: Categorize findings

Bucket the findings into action types:

| Bucket | What to do |
|--------|------------|
| **Worker-fixable** (missing acceptance criteria, no verification command) | File P3 "Add acceptance criteria for `<task-id>`" |
| **Probable-dead** (file no longer exists, references removed code) | File P3 "Verify task `<id>` is still relevant — `<file>` was removed in <commit>" |
| **Probable-stale-claim** (claim with no agent commits in N hours) | File P3 "Unclaim or refresh `<id>` — claimer hasn't committed in <Nh>" |
| **Duplicate** | File P3 "Resolve duplicate IDs: `<id1>` and `<id2>` are the same" |
| **Spec violation** (lint failure on format) | File P3 "Fix TASKS.md format error at line N: `<lint message>`" |

### Step 5: Build a single grooming report task

Instead of flooding TASKS.md with one P3 per finding, **batch them
into a single grooming task** with all findings in the Details. This
keeps the noise down and gives the worker (or a follow-up companion
session) one consolidated entry to act on.

The grooming task is itself meta (it groups findings), so it does NOT
need a `**Last-enriched**` field. If lint complains, add the field
pointing to today; otherwise omit it.

**`<short-id>` convention**: use the companion session's persona slug
(e.g. `companion`, `devin-companion-17`, `claude-companion-3`). If
unknown, use a 4-char hex hash of the date + pwd. Goal is that two
grooming tasks on the same day from different sessions don't collide.

```markdown
- [ ] Groom TASKS.md per <YYYY-MM-DD> companion sweep
  - **ID**: tasks-groom-<YYYY-MM-DD>-<short-id>
  - **Tags**: tasks, grooming, companion
  - **Details**:
    Generated by `companion-task-groom` on <YYYY-MM-DD>.
    Lint status: <pass|fail>.
    Findings (<N>):
    1. [worker-fixable] `<task-id>`: missing acceptance verifier
       (line 42).
    2. [probable-dead] `<task-id>`: references `src/old/foo.ts` —
       removed in commit abc123 on 2026-04-10.
    3. [probable-stale-claim] `<task-id>` claimed by @agent-7 24h
       ago, no commits.
    ... (full list)

    Suggested resolution path:
    - Worker reviews each finding and either updates / removes the
      underlying task or marks this grooming task as resolved with
      reasoning.

  - **Files**: TASKS.md
  - **Acceptance**: Each finding is addressed (updated, removed with
    reason, or explicitly deferred). Lint passes:
    `npx -y @tasks-md/lint TASKS.md`.
```

This single P3 entry is the lane's primary output.

**Safe append pattern** (do NOT rewrite TASKS.md, do NOT use `git add -A`):

```bash
# Build the grooming block in a scratch file first so multi-line
# content is unambiguous and shell quoting doesn't bite.
cat > /tmp/companion-groom-append.md <<'EOF'
- [ ] Groom TASKS.md per 2026-05-21 companion sweep
  - **ID**: tasks-groom-2026-05-21-devin-companion
  - **Tags**: tasks, grooming, companion
  - **Details**:
    Generated by companion-task-groom on 2026-05-21.
    Lint status: pass.
    Findings (3):
    1. [worker-fixable] task-x: missing acceptance verifier.
    2. [probable-dead] task-y: references deleted file.
    3. [duplicate] task-z and task-q have the same ID.
  - **Files**: TASKS.md
  - **Acceptance**: Each finding addressed. Lint passes.
EOF

# Append atomically. The grooming task lives under ## P3, so the
# append goes at the end of the P3 section (or end-of-file if P3 is
# already last).
cat /tmp/companion-groom-append.md >> TASKS.md
```

The heredoc with `<<'EOF'` (single-quoted) prevents shell expansion
inside the block, so backticks and `${VAR}` references inside the
template render literally. This is the only safe pattern for
multi-line appends.

### Step 6: Write the audit detail to disk (optional)

This step ONLY applies if the project also uses the `sweep` skill —
i.e. `TASKS-AUDIT.md` exists in the repo root, or `README.md` /
`AGENTS.md` references the file. The `sweep` skill treats
`TASKS-AUDIT.md` as a per-session staging buffer that gets drained
into `TASKS.md` P3 at session end. When both skills are in play,
companion-task-groom feeds findings into that same buffer instead
of inlining them in the grooming task's Details.

If `sweep` is not used in this repo (no `TASKS-AUDIT.md`, no README
mention), put all findings inline in the grooming task per Step 5
and skip this step entirely.

When you DO write to `TASKS-AUDIT.md`, use the priority-section
format:

```markdown
# Tasks audit

> Staging buffer from `companion-task-groom` on <YYYY-MM-DD>.
> The companion-researcher umbrella drains this into TASKS.md P3 at
> session end if the `sweep` convention is active here.

## P3

<the per-finding tasks here, in full format>
```

Otherwise, attach the full findings inside the single grooming task's
Details section as in Step 5.

### Step 7: Validate

```bash
npx -y @tasks-md/lint TASKS.md
```

If the validation fails because of YOUR appended task, fix the appended
task. Never edit other tasks to make lint pass.

### Step 8: Summary

```
lane=tasks repo=<name>
lint-status=<pass|fail>
total-tasks=<N>
findings=<count> (worker-fixable=<x>, probable-dead=<y>, stale-claim=<z>, duplicate=<a>, spec-violation=<b>)
grooming-task-filed=<id>
audit-file=<path or none>
```

## Patterns That Pay Off

- **Spec is at https://github.com/tasksmd/tasks.md/blob/main/spec.md.**
  When in doubt, reread it. The lint tool follows it strictly.
- **Don't fix what the worker can fix faster.** A typo in a task's
  Details is the worker's problem to fix when they claim it; you
  shouldn't append a P3 for that. Reserve P3 entries for findings
  that need decision or research.
- **`git log -p TASKS.md`** is the best tool to find when a task was
  added, claimed, or modified. Use it to compute staleness windows
  precisely.
- **One groom per session.** Don't run this lane multiple times in
  the same session — there's nothing new to find until the worker
  has acted on your last report.

## Cool-down

After running once per repo, mark cooled for 6 cycles. Task-grooming
findings don't change until the worker resolves them.
