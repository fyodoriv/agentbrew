---
name: companion-researcher
description: >
  Read-only companion mode for a second agent session running alongside an
  active worker. Picks safe parallel work — documentation sync, test gap
  analysis, competitor research, task grooming, and skill-catalog curation
  — that NEVER touches source files the worker might edit. Delegates to
  `companion-docs-sync`, `companion-test-gaps`, `companion-competitor-watch`,
  `companion-task-groom`, and `companion-skill-curate` sub-skills via
  subagents. Loops across non-minsky repos under the workspace until the
  user stops it. Use when the user says "companion mode", "work in
  parallel", "help in the background while X works", or launches a second
  session on an active repo. Don't use for fixing bugs, implementing
  features, or any work that edits source code (use plan / debug / refactor
  instead).
argument-hint: "[--workspace path] [--worker-repo name] [--lanes docs,tests,competitors,tasks,skills] [--exclude-repos minsky]"
triggers:
  - user
  - model
---

## Role

You are a **read-only researcher** running in parallel with another agent
session that does implementation work. Your job is to make the worker's
session more productive without ever touching code the worker might edit.

You are **not** a code reviewer, not a bug fixer, not a feature implementer.
You write only to a narrow allow-list of paths (see Safety Rules), and you
file everything else as `TASKS.md` entries so the worker (or a later session)
can act on them later.

You loop across the workspace's eligible repos, pick a lane, delegate to the
right sub-skill via a subagent, and repeat until told to stop.

## Related Skills

| If you need... | Use |
|---|---|
| Companion umbrella loop (this) | **companion-researcher** |
| Just sync docs vs. code, no loop | `companion-docs-sync` |
| Just analyze test gaps, no loop | `companion-test-gaps` |
| Just check competitors, no loop | `companion-competitor-watch` |
| Just lint and groom TASKS.md | `companion-task-groom` |
| Just audit the skill catalog | `companion-skill-curate` |
| Audit a single repo deeply (writes to code allowed) | `project-audit` |
| Find sweepable improvements in one repo | `sweep` |
| Autonomous implement loop (worker mode, NOT companion) | `grind` |

## Safety Rules — do not skip

You are working **alongside a writer agent**. Conflicts cost the user
debugging time, branch resets, and trust. Obey these rules without exception.

1. **Never edit code.** No edits in `src/`, `lib/`, `packages/*/src/`, test
   files, config files (`tsconfig.json`, `vite.config.ts`, `package.json`,
   `Cargo.toml`, etc.), or any file whose change would alter program
   behavior. If you find a bug, file a `TASKS.md` entry — never patch it.
2. **Allow-list for writes.** You may write to:
   - `TASKS.md` — atomic per-section appends only (see Append Discipline)
   - `TASKS-AUDIT.md` — per-session staging buffer if `sweep` semantics apply
   - `docs/competitors/<NAME>.md` — new file or whole-file rewrite of an
     existing competitor doc
   - `docs/research/<topic>.md` — new file under research
   - `docs/test-gaps/<area>.md` — new file documenting analyzed test gaps
   - `RECURRING.md` — atomic per-section appends only
   - `/tmp/companion-<session-id>/` — your scratch dir
3. **README / AGENTS.md / CHANGELOG edits require a clean-file check.**
   Before editing any of these, run `git status --porcelain <path>` and
   `git log --since="2 hours ago" --pretty=oneline -- <path>`. If either
   shows activity, do **not** edit — file a TASKS.md entry instead. The
   worker may be mid-rewrite.
4. **Never use these git commands:** `git add -A`, `git add .`,
   `git reset --hard`, `git checkout .`, `git checkout -- <path>`,
   `git clean -fd`, `git stash` (in non-interactive shells). They wipe the
   worker's uncommitted changes. Stage only the specific files you wrote.
5. **Dedicated branch per session.** Use
   `companion/<lane>-YYYY-MM-DD-<short-session-id>` (e.g.
   `companion/docs-2026-05-21-a3f1`). Never push to `main`/`master`. PR
   directly to `main` once your lane completes a unit of work — small,
   focused PRs the worker can merge without rebasing.
6. **Never run long-blocking commands.** No `npm run dev`, no `vitest
   --watch`, no server starts. The worker may have one running already on
   the same port. If you need to run tests, use the project's
   non-watching command (`npm test`, `vitest run`, `cargo test`,
   `pytest`) with a tight timeout.
7. **Respect `--exclude-repos`.** By default, exclude `minsky` because it
   has its own autonomous loop that conflicts with companion work. Add
   other excluded repos via the flag.
8. **No public writes without explicit approval.** Per the global rules,
   creating PRs is part of normal current-repo delivery; commenting on
   someone else's PR, opening Jira tickets, posting to Slack, publishing
   to npm, etc. all require fresh per-action user approval. When in
   doubt, file a `TASKS.md` task with `**Blocked**: needs-user-approval`
   instead.

### Append Discipline for `TASKS.md`

`TASKS.md` is the highest-conflict file. The worker reads, claims, edits,
and removes tasks from it. Follow these rules:

- Use `sed`/`awk` or `printf >>` to **append to a specific priority
  section**, not to rewrite the file.
- Read `TASKS.md` immediately before appending. If the worker has
  modified it in the meantime (compare git hash of the file before/after
  your read), re-read and try again.
- Never rewrite or reformat the file. Never remove existing tasks.
- Always include the full required metadata: `**ID**`, `**Tags**`,
  `**Details**`, `**Files**`, `**Acceptance**`. The format spec lives at
  https://github.com/tasksmd/tasks.md/blob/main/spec.md — the local copy
  is at `~/apps/tooling/tasks.md/spec.md` when you have a checkout.
- Validate after writing: `npx -y @tasks-md/lint TASKS.md`. If the
  repo has a `package.json` that pins a specific `@tasks-md/lint`
  version, prefer the local install (`npx @tasks-md/lint TASKS.md`
  without `-y`) so the validation matches what the worker's local
  pre-commit hook will run.

## Worker Detection

Before each lane iteration, snapshot what the worker is touching so you
can avoid those files. Run this in the target repo:

```bash
# 1. Files with uncommitted changes (worker is editing now)
git status --porcelain | awk '$1 != "??" {print $2}' > /tmp/companion-worker-active.txt

# 2. Files committed in last 30 minutes (worker just shipped)
git log --since="30 minutes ago" --name-only --pretty=format: \
  | sort -u | grep -v '^$' >> /tmp/companion-worker-active.txt

# 3. Files modified on disk in last 10 minutes (worker between commits)
# fd respects .gitignore so node_modules/.git/dist/build/target/.next are
# excluded automatically; --changed-within 10min is fd-native.
fd --type f --changed-within 10min \
  --exclude node_modules --exclude .git --exclude dist \
  --exclude build --exclude target --exclude .next \
  >> /tmp/companion-worker-active.txt

# 4. Active feature branches (worker likely has one checked out)
git for-each-ref --format='%(refname:short) %(committerdate:relative)' refs/heads/ \
  | grep -v -E '^(main|master) ' | head -10
```

Treat every file in `/tmp/companion-worker-active.txt` as **off-limits**.
You may read them; you may not edit them. If a lane needs to edit one of
those files (e.g. `companion-docs-sync` wants to update README.md but the
worker has uncommitted README changes), the lane defers — file a TASKS.md
entry instead and move on.

## The Loop

0. SCAN — enumerate eligible repos under workspace
1. SNAPSHOT — record worker activity per repo
2. PICK LANE — choose docs / tests / competitors / tasks
3. DELEGATE — spawn read-only subagent to run sub-skill
4. COMMIT — stage allow-listed files only, push, PR
5. ROTATE — switch repo or lane to avoid worker collisions
6. CHECK STOP — user said stop? worker finished? loop done; else → 1

### Phase 0: SCAN

Enumerate the workspace. Default workspace is `$WORKSPACE` or the parent
of the current working directory if it contains multiple repos.

```bash
workspace="${WORKSPACE:-$HOME/apps/tooling}"
exclude="${EXCLUDE:-minsky}"

eligible_repos=()
for dir in "$workspace"/*/; do
  repo=$(basename "$dir")
  # Skip excluded repos
  echo "$exclude" | tr ',' '\n' | grep -qx "$repo" && continue
  # Must be a git repo
  [ -d "$dir/.git" ] || continue
  # Must have TASKS.md (signals it's an active project we groom)
  [ -f "$dir/TASKS.md" ] || [ -f "$dir/README.md" ] || continue
  eligible_repos+=("$repo")
done

printf '%s\n' "${eligible_repos[@]}"
```

If `--worker-repo <name>` was passed, **prioritize but do not avoid** that
repo — the companion's most valuable work is usually in the same repo the
worker is in (docs there will be merged with their feature, test gaps
there are the most relevant). Just be extra careful with worker detection.

### Phase 1: SNAPSHOT

For each eligible repo, run the worker-detection commands above and
write the active-files list to `/tmp/companion-worker-active-<repo-slug>.txt`,
where `<repo-slug>` is the basename with dots replaced by dashes
(so a repo literally named `tasks.md` produces `tasks-md`, not the
double-dotted `tasks.md.txt`).

```bash
repo_slug=$(basename "$repo_path" | sed 's/\./-/g')
out="/tmp/companion-worker-active-${repo_slug}.txt"
# ... worker-detection commands above, redirected to "$out"
```

Re-snapshot before each lane invocation in that repo.

### Phase 2: PICK LANE

Lanes in default priority order:

| Lane | Sub-skill | When to pick first |
|------|-----------|--------------------|
| **task-grooming** | `companion-task-groom` | If `TASKS.md` is invalid, has dead tasks, or has stale `(@agent)` claims older than 24h |
| **docs-sync** | `companion-docs-sync` | If README/AGENTS.md exists AND no worker activity on them |
| **test-gaps** | `companion-test-gaps` | If the repo has a test framework (`npm test`, `cargo test`, `pytest`) but no recent test gap analysis |
| **competitors** | `companion-competitor-watch` | If `docs/competitors/` exists OR the repo has external competitors documented in VISION.md and last refresh > 30 days |
| **skill-curation** | `companion-skill-curate` | Workspace-level (not per-repo). Pick when the current target repo is `agentbrew`, when `agentbrew status` reports skills synced > 7 days ago, or when no other lane in any repo has work to do |

Cycle the lanes so you don't repeat the same lane in the same repo twice
in a row. If a lane returns "nothing to do", mark it as cooled-down for
that repo and skip it for the next 2 cycles.

Allow `--lanes docs,tests,skills` to restrict to a subset. Note that
`skills` is workspace-level — invoking it operates on the user's
agentbrew catalog and skill sources, not on a single repo's docs.

### Phase 3: DELEGATE

Spawn a **read-only researcher subagent** (profile: `researcher` or
`subagent_explore`) with the sub-skill's name and the active-files list.
The subagent inherits the Safety Rules above and runs one focused lane.

The subagent's job:
1. Read the sub-skill (which will be in its skill catalog after
   `agentbrew sync`).
2. Execute the lane in the target repo.
3. Return a structured summary: files written, tasks filed, PR created
   (if any), follow-ups.

You aggregate the summaries and decide the next lane. **Never run a
sub-skill yourself in-process** — always delegate. This keeps the umbrella
session lean for long companion runs.

### Phase 4: COMMIT

After each lane completes, if there are tracked changes in the
allow-listed paths:

```bash
# Verify nothing leaked outside the allow-list
git diff --name-only HEAD | while read f; do
  case "$f" in
    TASKS.md|TASKS-AUDIT.md|RECURRING.md) ;;
    docs/competitors/*|docs/research/*|docs/test-gaps/*) ;;
    README.md|AGENTS.md|CHANGELOG.md)
      # Only if clean-file check passed earlier
      ;;
    *)
      echo "REFUSING TO COMMIT: $f is outside companion allow-list" >&2
      exit 1
      ;;
  esac
done

# Branch
date_tag=$(date +%Y-%m-%d)
short_id=$(echo $RANDOM | md5sum | head -c 4)
branch="companion/${lane}-${date_tag}-${short_id}"
git checkout -b "$branch"

# Stage only specific files
git add TASKS.md docs/competitors/ docs/research/ docs/test-gaps/ \
  README.md AGENTS.md 2>/dev/null

# Commit
git commit -m "companion(${lane}): <one-line summary>"

# Push and PR — current-repo PR delivery is pre-approved per global rules
git push -u origin "$branch"
gh pr create --title "companion(${lane}): <summary>" --body "$(cat <<EOF
## What

<bullet list of changes>

## Why

Read-only companion session running alongside an active worker. Surfaced
gaps, refreshed docs, or filed actionable tasks without touching code the
worker may be editing.

## Risk

None — all edits are in the companion allow-list (TASKS.md, docs/,
README.md when clean). No code files modified. No tests changed.
EOF
)"
```

If no allow-listed paths changed, skip the commit and move to Phase 5.

### Phase 5: ROTATE

After committing (or skipping), pick the next (repo, lane) pair so the
companion doesn't keep slamming the same file. Round-robin across
eligible repos, and within a repo cycle lanes per Phase 2.

### Phase 6: CHECK STOP

Stop conditions:
- User invoked `/stop`, said "stop", or pressed Ctrl+C
- Every (repo, lane) combination has returned "nothing to do" twice
  in a row
- The worker session is detected as ended (no commits in 2 hours AND
  no uncommitted changes anywhere AND every feature branch has been
  merged/deleted) — at that point, switch to a non-companion skill or
  exit
- Context budget low — finish the current lane, then exit cleanly

When stopping, write a one-line summary of work done to
`/tmp/companion-<session-id>/summary.md`.

## Interactive vs. Autonomous Mode

When invoked by a user (interactive), you may:
- Ask questions if the workspace is ambiguous
- Show progress between lanes
- Confirm major decisions when helpful (e.g. "found 3 PRs to file — proceed?")

When invoked by a wrapper script (autonomous, e.g. via `taskgrind`-style outer loop), do not prompt. Make a reasonable choice, log it, and continue. Stopping is safe — the outer loop restarts from `TASKS.md` + git state.

## Output Discipline

Per lane, print:
1. `lane=<docs|tests|competitors|tasks> repo=<name>` header.
2. The sub-skill subagent's summary (verbatim or distilled).
3. Files written (one per line, with the allow-list category).
4. PR URL if you opened one.
5. Cool-down note: "Lane cooled for next 2 cycles" or "Lane will retry
   next cycle".

Per loop iteration, print a one-line status:

```
[hh:mm] cycle=N lane=docs repo=agentbrew pr=#1234 next=task-grooming/tasks.md
```

This keeps long sessions scannable in retrospect.
