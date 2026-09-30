---
name: load-project-context
description: Load every canonical project doc (VISION, ARCHITECTURE, MILESTONES/ROADMAP, README, user-stories, competitors, TASKS, AGENTS) into working context when entering any repository. Use at the start of any non-trivial session in a project folder, especially after `cd` into a new repo, before proposing features, planning changes, or claiming a task. Don't use for read-only one-line questions or pure tool invocations where the project's strategic context is irrelevant.
---

# load-project-context

> The agent equivalent of "read the project's mission statement before doing anything." Runs the canonical-doc discovery script, lists every found doc, then reads them into the working context window.

## Why this exists

Agents that work in a repo without its VISION / ARCHITECTURE / ROADMAP / user-story context produce drift: they reinvent solved problems, propose features that contradict strategy, and miss user-story constraints. The cheapest fix is to treat canonical docs as part of the system prompt — load them once at session entry, then constrain every decision against them.

This skill is the invokable companion to the `load-project-context` catalog rule (in `~/.config/agentbrew/shared-rules.md`, deployed to every agent's rule file by `agentbrew sync`) and the Claude Code `SessionStart` hook (at `~/.config/agentbrew/Agentfile.yaml`). The rule and hook do the same thing automatically; this skill is for explicit invocation on demand.

## When to invoke

**Yes:** start of any non-trivial session in a project folder; after `cd` into a new repo; before drafting a PR; before proposing a feature; before claiming a TASKS.md task; after a worktree handoff.

**No:** read-only one-line questions ("what does this function do?"); pure tool invocations (`git status`, `gh pr view`); follow-ups in the same session where context is already loaded.

## What it does

1. Runs `~/.config/agentbrew/scripts/load-project-context.sh` from the current working directory. The script:
   - Scans repo root for canonical files (case-insensitive): `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `VISION.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `MILESTONES.md`, `USER_STORIES.md`, `COMPETITORS.md`, `PRD.md`, `TASKS.md`, `RECURRING.md`, `BACKLOG.md`, `DEPRECATED.md`, `INSTALL.md`, `CHANGELOG.md`.
   - Scans root-level subdirs: `user-stories/`, `competitors/`, `milestones/`, `architecture/`, `stories/`, `experiments/`, `plans/`, `rfcs/`, `adr/`.
   - Scans `docs/` for top-level files matching `*vision*`, `*architecture*`, `*roadmap*`, `*milestone*`, `*strategy*`, `*user-stor*`, `*competitor*`, `*overview*`, `*goals*`, `*objectives*`, `*charter*`, `*north-star*`, `*prd*`, `*design*`, `*spec*`.
   - Scans `docs/` for canonical-named subdirs (same list as root).
   - Detects an `Agentfile.yaml` / `Agentfile` and notes it.
   - Caps output at 40 entries; prints "no canonical docs found" gracefully if the dir isn't a project.

2. Reads each listed file into context:
   - Files ≤500 lines: full content.
   - Files >500 lines: table of contents + first/last 100 lines + targeted sections by header.
   - For directories with many files (e.g. `user-stories/`): read the index file (`README.md`, `INDEX.md`) if present; otherwise read the first 3 files and note the rest exist.
   - Follow markdown links to other docs to depth 2.
   - Resolve `@import/path` syntax (Claude-style imports).

3. Acknowledges what was loaded in one line so the user knows the agent is operating with project context.

4. Applies the docs:
   - Before proposing a feature, trace it to a user story OR a VISION goal. If neither matches, flag the gap before implementing.
   - When the user's request appears to contradict VISION or ROADMAP, surface the conflict BEFORE making changes — never silently override the strategic doc.
   - If a canonical doc lists invariants ("never X", "always Y"), treat them as hard constraints for the session.

## How to invoke

The simplest path is to run the script directly:

```bash
bash ~/.config/agentbrew/scripts/load-project-context.sh
```

Then read every file it lists. That's the whole skill. Agents that have skills as a tool surface should expose this as `load-project-context` (or its alias `project-bootstrap`) and trigger it on session start.

For Claude Code, the `SessionStart` hook fires this automatically — invoking the skill is only necessary when the hook didn't run (e.g. mid-session repo switch).

## What "loaded" looks like

After running, the agent's working context should contain:

- Repo identity (from `README.md` + `AGENTS.md`)
- Strategic direction (from `VISION.md`)
- System structure (from `ARCHITECTURE.md`)
- Current milestone + roadmap (from `MILESTONES.md` or `ROADMAP.md`)
- User stories (from `user-stories/` or `docs/user-stories/`)
- Competitive landscape (from `competitors/` or `docs/competitors/` or `docs/competition/`)
- Active work queue (from `TASKS.md` + `RECURRING.md` if present, or GitHub Issues if `.tasksmd.json` declares `backend: github-issues`)
- Process rules (from `AGENTS.md` + `CONTRIBUTING.md`)

Any decision the agent makes should be traceable to one of those surfaces.

## Task Backend Detection

When loading project context, also detect the repo's task backend by checking for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, note that the repo uses GitHub Issues for task management instead of TASKS.md. This affects how you list, pick, and file tasks during the session.

## Failure modes

- **Script not found**: agentbrew sync hasn't been run on this machine, or the script was deleted. Re-run `agentbrew sync` from `~/apps/tooling/agentbrew/` (or wherever the repo lives) — it redeploys the script.
- **`find` returns errors**: on systems with a shimmed `find` (e.g. some dotfiles ship `find` → `fd`), the script falls back to `/usr/bin/find`. If that's missing, the inventory is incomplete but the session still proceeds.
- **No canonical docs found**: the script prints a graceful "no canonical docs found" message. That means either (a) the current dir isn't a project root, or (b) the project doesn't follow the canonical doc convention. Proceed normally; the agent has no forced context to load.
- **Files too large**: the script doesn't fail, it just lists everything found. The agent is responsible for chunking large files using the read-strategy above (TOC + first/last 100 lines for >500-line docs).

## Execution and verification safety

This skill is read-only with respect to repo files: the script inventories canonical
docs and the agent reads them into context. Do not claim VISION, ROADMAP, user-story,
or TASKS context was loaded unless you ran
`bash ~/.config/agentbrew/scripts/load-project-context.sh` (or equivalent) and read
every file it listed. Do not fabricate missing strategic docs when the script prints
"no canonical docs found". Do not skip loading before `next-task`, `plan`, feature
proposals, or PR drafting when the user asked for non-trivial project work in a repo
where context is not already loaded from this session.

## Relationship to other skills

- `next-task` — picks a task from `TASKS.md`. Run this AFTER `load-project-context` so the picked task is evaluated against VISION + user-story context.
- `project-audit` — audits the project for issues. The audit is more accurate when canonical docs are loaded.
- `plan` — breaks features into spec + tasks. Loaded canonical context is the input to `plan`.
- `companion-docs-sync` — checks doc drift against implementation. Uses the same canonical doc set.
- `strategic-review` — deep strategic review of a project. Requires canonical docs to be loaded.
