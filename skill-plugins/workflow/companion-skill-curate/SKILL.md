---
name: companion-skill-curate
description: >
  Read-only companion lane — audit the agent skill collection across all
  sources, find duplicates and near-duplicates, check for outdated source
  repos (new commits since the last fetch), and discover new candidate
  skills on the web (agentskills.io, github topics like
  `claude-code-skills`, awesome-* lists, the trailofbits/skills repo).
  Files TASKS.md entries with concrete `agentbrew install` /
  `agentbrew catalog --sources fetch` / `agentbrew uninstall` commands the worker
  or user can execute. Use when called by `companion-researcher` or
  when the user says "find new skills", "audit the skill catalog",
  "any duplicate skills", "what skills should we add", or "check for
  skill updates". Don't use to install skills directly (use
  `agentbrew-add-skill`), create or improve skills from scratch (use
  Anthropic `skill-creator` or Superpowers `writing-skills`).
argument-hint: "[--workspace path] [--scope inventory|duplicates|updates|discovery|all] [--max-discovery 5]"
triggers:
  - user
  - model
---

## Role

You are the **skill-curation lane** of the companion workflow. You
audit the agent skill collection — what's installed, what's
duplicated, what's outdated, what's missing — and surface concrete
install / uninstall / update commands as `TASKS.md` entries. You
never install or uninstall skills yourself (that's a side effect on
many other agents' configs); you propose, the worker or user
executes.

## Safety Rules

Inherit the [companion-researcher safety rules](../companion-researcher/SKILL.md#safety-rules--do-not-skip).
Highlights:

- **You may NOT run `agentbrew install`, `agentbrew uninstall`,
  `agentbrew catalog --sources fetch`, or any other state-mutating
  agentbrew command.** They deploy symlinks to every configured agent and edit
  global state; one bad invocation propagates everywhere.
- You may run **read-only** agentbrew commands: `agentbrew status`,
  `agentbrew catalog --sources list` / `sources show`, `agentbrew catalog list`,
  `agentbrew sync --dry-run`.
- You may write to `TASKS.md` (atomic append) and
  `docs/skill-curation/<YYYY-MM-DD>.md` (new file per session).
- Never edit any `~/.*/skills/` mirror directly — those are
  agentbrew-managed symlinks and editing them desyncs the catalog.
- Never edit any skill content in another source repo without the
  worker's awareness; treat all source-repo content as read-only and
  file a TASKS.md entry instead.

## Task Backend

Detect the repo's task backend by checking for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, file findings as GitHub Issues via `tasks create` instead of appending to TASKS.md. Otherwise, append to TASKS.md as usual.

## Process

### Step 1: Inventory

Snapshot the current state so the findings have concrete numbers
in them. Also discover the **real agentbrew CLI verbs** for the
suggested actions in the report — otherwise the report ends up
recommending commands that don't exist.

```bash
mkdir -p /tmp/companion-skill-curate

# Overall stats
agentbrew status > /tmp/companion-skill-curate/status.txt 2>&1 \
  || npm run --prefix ~/apps/tooling/agentbrew dev -- status \
       > /tmp/companion-skill-curate/status.txt 2>&1

# Real CLI verbs — used later for the suggested-actions list. Do
# this once per run rather than guessing, because flag syntax has
# drifted historically (e.g. `agentbrew install --source` vs
# `agentbrew catalog --sources add`).
agentbrew --help > /tmp/companion-skill-curate/help.txt 2>&1 \
  || npm run --prefix ~/apps/tooling/agentbrew dev -- --help \
       > /tmp/companion-skill-curate/help.txt 2>&1
grep -E '^\s+(install|uninstall|sources|catalog|sync)' \
  /tmp/companion-skill-curate/help.txt | head -10

# Build the skill inventory using pure bash — no pyyaml dependency.
# The `state.yaml` schema for skillSourceDirs is well-known and
# flat, so a small awk parser is more portable than `python3 -c`
# with a yaml import that may or may not be present.
state_file="${HOME}/.config/agentbrew/state.yaml"
[ -f "$state_file" ] || state_file="${HOME}/.agentbrew/state.yaml"

> /tmp/companion-skill-curate/inventory.tsv

# Parse state.yaml::skillSourceDirs with awk. Output one
# "<label>\t<expanded-path>" line per source.
awk '
  /^skillSourceDirs:/ { in_block = 1; next }
  in_block && /^[a-zA-Z]/ { in_block = 0 }
  in_block && /^\s*- label:/ {
    sub(/^.*label:[ \t]*/, "")
    label = $0
  }
  in_block && /^\s*path:/ {
    sub(/^.*path:[ \t]*/, "")
    print label "\t" $0
  }
' "$state_file" \
  | sed "s|~|$HOME|g" \
  > /tmp/companion-skill-curate/sources.tsv

# Also include the in-repo built-in source if it exists and isn't
# already listed (agentbrew's `skill-plugins/dev/` is special).
builtin="${HOME}/apps/tooling/agentbrew/skill-plugins/dev"
if [ -d "$builtin" ] && \
   ! grep -qF "$builtin" /tmp/companion-skill-curate/sources.tsv; then
  printf 'builtin-dev\t%s\n' "$builtin" \
    >> /tmp/companion-skill-curate/sources.tsv
fi

# Enumerate skill dirs per source.
while IFS=$'\t' read -r label path; do
  [ -d "$path" ] || continue
  for skill_md in "$path"/*/SKILL.md; do
    [ -f "$skill_md" ] || continue
    skill_name=$(basename "$(dirname "$skill_md")")
    printf '%s\t%s\t%s\n' "$label" "$skill_name" "$skill_md" \
      >> /tmp/companion-skill-curate/inventory.tsv
  done
done < /tmp/companion-skill-curate/sources.tsv

total=$(wc -l < /tmp/companion-skill-curate/inventory.tsv | tr -d ' ')
unique_names=$(cut -f2 /tmp/companion-skill-curate/inventory.tsv \
  | sort -u | wc -l | tr -d ' ')
n_sources=$(wc -l < /tmp/companion-skill-curate/sources.tsv | tr -d ' ')
echo "total-skill-files=$total unique-names=$unique_names sources=$n_sources"
```

Capture these numbers — they go into the summary and the proposed
TASKS.md entries. Capture the discovered CLI verbs from `--help`
output for use in Step 5's "Suggested actions" list.

### Step 2–4: Duplicates, updates, discovery

Full bash, cluster definitions, freshness signals, and discovery venues: read `references/process.md`.

### Step 5: Write a curation report

Always write `docs/skill-curation/<YYYY-MM-DD>.md`. Report shape and suggested-actions template: `references/report-template.md`.

### Step 6: File P3 TASKS.md entry

One consolidated P3 task per session (like `companion-task-groom`
does — no fragmentation):

```markdown
- [ ] Curate skill catalog (companion 2026-05-21 sweep)
  - **ID**: skill-curate-2026-05-21-<short-id>
  - **Tags**: skills, agentbrew, curation, companion
  - **Details**: See [`docs/skill-curation/2026-05-21.md`](docs/skill-curation/2026-05-21.md)
    for the full report. Summary:
    - <N> exact-name duplicates flagged (top 3: ...)
    - <M> outdated sources (top 3: ...)
    - <K> new candidate skills with concrete install commands
    Highest-priority action: <one-line recommendation>.
  - **Files**: docs/skill-curation/<YYYY-MM-DD>.md
  - **Acceptance**: Each recommended action is either executed
    (and a follow-up commit removes this task) or explicitly
    deferred with a one-line reason appended here.
```

### Step 7: Validate

```bash
npx -y @tasks-md/lint TASKS.md
```

### Step 8: Summary

```
lane=skills repo=<umbrella-target-repo>
total-skills=<N>
unique-names=<U>
sources=<K>
duplicates=<count>
outdated-sources=<count>
new-candidates=<count>
report-file=<docs/skill-curation/YYYY-MM-DD.md>
tasks-filed=<count>
```

## Patterns That Pay Off

Catalog version-pinning, read-before-propose, topic-gap discovery, trailofbits signal, gitignore handling: `references/patterns.md`.

## Cool-down

After running once per workspace, mark cooled for 7 umbrella-loop cycles (seven `companion-researcher` Phase 2 iterations on this workspace — not wall-clock days). Cool-down key is the workspace, not any individual sub-repo.
