---
name: verify-vision-trace
description: Validate a PR's vision-trace block against the repo's VISION.md goals. Use when a PR body has a `## Vision trace` section and you want to verify the goal id (e.g. G1, G2) actually exists in VISION.md's structured frontmatter goals list. Don't use for repos whose VISION.md lacks YAML frontmatter (the skill falls back to a soft warning).
---

# verify-vision-trace

Companion to the `pr-vision-trace` CI gate. The gate enforces the *presence* of a Vision trace block; this skill enforces the *correctness* of its goal references against the repo's VISION.md.

## When to use

- After authoring a PR body's `## Vision trace` block, before opening the PR.
- During PR review, to spot-check whether the cited goal ids resolve.
- Inside a CI step that wants stricter enforcement than the regex-only `check-pr-vision-trace.mjs` script.

## VISION.md frontmatter schema (v1)

A VISION.md MAY start with a YAML frontmatter block. The skill is opt-in: VISION.md without frontmatter passes with a warning, not a failure.

```yaml
---
schema: vision-v1
version: 1
last_reviewed: 2026-05-23
goals:
  - id: G1
    name: Curate, not host
    description: Reference skills in source repos; never duplicate content.
  - id: G2
    name: Generic-first, overlay-second
    description: Public catalog stays org-agnostic; team-specific tools live in overlay catalogs.
  - id: G3
    name: One sync command does everything
    description: agentbrew sync is the single entry point — never ask the user to run two commands.
non_goals:
  - id: NG1
    name: Per-agent config UI
    description: Editing agent-specific config files (CLAUDE.md, etc.) directly. agentbrew manages them.
---

# Vision

… prose continues here …
```

Required keys: `schema: vision-v1`, `goals: [...]` (list of objects with `id` and `name`).
Optional keys: `version`, `last_reviewed`, `non_goals`, plus any custom keys.

## Run

```bash
bash ~/.config/agentbrew/scripts/verify-vision-trace.sh <path-to-pr-body.md>
```

The script:
1. Locates VISION.md (or `vision.md`, lowercase) in the current repo's root, `docs/`, or `.minsky/`.
2. Parses the YAML frontmatter (or warns if missing).
3. Scans the PR body for `Vision goal: <id>` lines.
4. For each cited id, checks it exists in the frontmatter `goals:` list.
5. Exits 0 on success; 1 on cited id not found; 0 with warning on missing frontmatter.

## Output format

```
verify-vision-trace @ /Users/me/apps/myrepo
  VISION.md: docs/VISION.md
  schema: vision-v1
  goals declared: 3 (G1, G2, G3)
  PR body: /tmp/pr-body.md
  cited ids: G1, G7
  ✓ G1 — Curate, not host
  ✗ G7 — NOT FOUND in VISION.md goals list
exit 1 — 1 invalid goal id
```

## When to skip

- VISION.md lacks frontmatter → warn, don't fail. File a P3 TASKS.md entry "add frontmatter to VISION.md".
- PR body has `N/A — <reason>` for the vision-goal line → skip validation; the trace gate already accepts this.
- Sync auto-commit / lockfile / release-bot PRs with the `<!-- vision-trace: not-applicable -->` opt-out marker → skip the entire validation.

## Related

- `~/.config/agentbrew/scripts/check-pr-vision-trace.mjs` — the regex-level CI gate that runs on every PR.
- `competitor-spot-check` skill — for the prior-art line of the Vision trace block.
- `load-project-context` skill — auto-loads VISION.md into session context at the start of every session.
- `companion-competitor-watch` skill — weekly refresh of `competitors/*.md` corpus.
