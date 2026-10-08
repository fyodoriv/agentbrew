---
name: companion-docs-sync
description: >
  Read-only companion lane — sync README, AGENTS.md, CHANGELOG, and docs/
  against the actual implementation. Diffs claims against code, files
  TASKS.md entries for drift you can't fix without code knowledge, and
  rewrites docs only when the file is clean (no worker activity). Use
  when called by `companion-researcher` or when the user asks "are the
  docs in sync", "audit docs for drift", or "refresh README claims".
  Don't use to write new docs from scratch (use `taste`, `readme-audit`)
  or to fix code (use `plan`, `debug`).
argument-hint: "[--repo path] [--worker-active-file /tmp/companion-worker-active-<repo-slug>.txt]"
triggers:
  - user
  - model
---

## Role

You are the **documentation-sync lane** of the companion workflow. You
read code, you read docs, and you reconcile the two — but only on files
the worker is not touching. Everything else you file as `TASKS.md`
entries.

## Safety Rules

Inherit the [companion-researcher safety rules](../companion-researcher/SKILL.md#safety-rules--do-not-skip).
Highlights:

- Allow-list for direct writes:
  - `TASKS.md` (atomic append). If `git check-ignore TASKS.md`
    returns true (e.g. user has `TASKS.md` in a global gitignore),
    note it in the summary so the umbrella can choose between
    `git add -f` and leaving it as a local-only personal todo.
  - `README.md`/`AGENTS.md`/`CHANGELOG.md` (only after clean-file
    check).
  - `docs/<existing-file>.md` — **surgical single-line / paragraph
    edits ONLY**, and only when the worker-active file is empty for
    the target file. If the change would touch multiple paragraphs
    or rewrite a section, file a TASKS.md entry instead — that's the
    worker's call, not the companion's. This carve-out exists
    because forcing every USER_GUIDE typo to TASKS.md just shuffles
    noise; mechanical fixes (renamed function, wrong count, dead
    link) belong in-place.
  - `docs/<new-file>.md` — fully owned by the companion (e.g. the
    test-gap docs from `companion-test-gaps`).
- Never edit source code, tests, config, or `package.json`.
- Check `/tmp/companion-worker-active-<repo>.txt` before every doc edit.
  If the doc is on that list, file a TASKS.md entry instead.

## Task Backend

Detect the repo's task backend by checking for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, file findings as GitHub Issues via `tasks create` instead of appending to TASKS.md. Otherwise, append to TASKS.md as usual.

## Process

### Step 1: Read the worker-active list

```bash
# Slug the repo name so dotted repo names (e.g. `tasks.md`) don't
# produce confusing double-dotted file paths.
repo_slug=$(basename "$PWD" | sed 's/\./-/g')
worker_active="${1:-/tmp/companion-worker-active-${repo_slug}.txt}"
[ -f "$worker_active" ] || { echo "ERROR: worker-active list missing" >&2; exit 1; }
```

### Step 2: Inventory the docs

```bash
docs_to_audit=(
  "README.md"
  "AGENTS.md"
  "CHANGELOG.md"
  "docs/VISION.md"
  "docs/user-stories"/*.md
  "docs/architecture"/*.md
)
```

Skip any doc whose path is in `$worker_active`. Print a one-line
"deferred (worker active)" note for each skipped doc.

### Step 3: Extract claims from each doc

For each remaining doc, extract concrete claims that can be verified
against code:

| Claim type | How to verify |
|------------|---------------|
| CLI command (`agentbrew status`, `tasks lint`) | `grep` the commander/yargs/clap definition for the exact `.command()`/`.option()` call |
| Flag (`--workspace`, `--dry-run`) | `grep` for the flag definition in the CLI source |
| Count ("ships with N+ built-in skills", "supports N agents") | Delete the count, link the source of truth (`catalog.yaml`, `agents.yaml`, `skill-plugins/dev/`), or generate it — never re-count by hand |
| Path ("config lives at `~/.config/agentbrew/state.yaml`") | Search for the path literal in source |
| Behavior ("auto-syncs to all detected agents") | Find the implementing function, confirm the described behavior |
| Example (`agentbrew sync --dry-run`) | Run the command (with `--help` if running for real is risky) and confirm it works |
| Token estimate ("under 8K tokens") | `wc -c` on the file, divide by 4 |
| Behavior implemented upstream | This repo proxies / depends on another service. Cross-repo verification: clone or read the upstream service if you have access; otherwise mark as `upstream` (not `yes` / `no`) and note the upstream source in the Evidence column. Treat as a separate finding category in Step 4 ("upstream-or-doc"). |

Produce a verification table:

```markdown
| Claim | Doc:line | Verified? | Evidence |
|-------|----------|-----------|----------|
| `agentbrew status` exists | README.md:42 | yes | src/commands/cli-status.ts:14 |
| ships with 30 skills | README.md:18 | NO | skill-plugins/dev/ has 51 dirs |
| 100k-row truncation cap | USER_GUIDE.md:163 | upstream | Enforced in `upstream-agent-service`, not this repo |
```

**Worth-filing threshold**: not every drift is worth a TASKS.md
entry. As a rough guide:

- **Worth filing**: numeric counts that are wrong (tool count, agent
  count, port number), named function / class / route references
  that don't exist in code, behavior contradictions (doc says X,
  code does Y), missing-from-doc commands that the README
  advertises.
- **Skip**: dead external links (file a P3 only if multiple), typos
  in prose that don't affect comprehension, presence of well-known
  marker files (LICENSE, .gitignore), version strings that match a
  reasonable lower bound (`Python >= 3.11` is fine even if pinned
  to 3.12 internally).

### Step 4: Categorize gaps

For each unverified or stale claim, classify:

- **Doc-fixable** (worker not active on this file, fix is mechanical):
  rewrite the line in-place. Examples: a flag name changed, a count
  is off, a path is stale, a relationship name was renamed in code.
  Surgical edits to `docs/<existing-file>.md` are now allowed per
  the carve-out in the safety rules.
- **Code-or-doc** (need to decide whether to fix doc or code): file
  a TASKS.md entry — the worker can decide.
- **Upstream-or-doc** (the implementation lives in another repo): file
  a TASKS.md entry quoting both the doc claim and the suspected
  upstream source. Don't try to verify it yourself unless you have
  read access to the upstream repo.
- **Doc-only-blocker** (the doc file is on the worker's active list):
  file a TASKS.md entry quoting the drift; the worker can resolve
  when they're done.

### Step 5: Apply doc-fixable changes

Edit the docs that are NOT on the worker-active list. Make surgical
edits — replace specific lines, don't reformat the whole file. Re-read
the file with `git status --porcelain` before each edit to confirm
nothing changed since the inventory.

### Step 6: File TASKS.md entries for everything else

For each Code-or-doc and Doc-only-blocker gap, append a P2 or P3 task to
`TASKS.md` with this template:

```markdown
- [ ] Doc drift: <one-line summary>
  - **ID**: docs-drift-<slug>
  - **Tags**: docs, drift, companion
  - **Details**: <claim quoted from doc> on <file>:<line> contradicts
    <evidence from code>. Decide whether to update the doc or fix the
    code.
  - **Files**: <doc-file>, <relevant-source-file>
  - **Acceptance**: Doc and code agree. Verification command:
    `<grep or test command>`.
```

Priority:
- **P1** if the drift is user-facing AND wrong (e.g. README says
  `--workspace` but the flag was renamed to `--root`, and users will
  hit it).
- **P2** if drift is internal-facing or causes a less-painful
  surprise.
- **P3** if drift is a count off by a small amount or a typo.

### Step 7: Validate the doc edits don't break the build

If the repo has a docs-affecting build step (e.g. `npm run build:site`,
`mkdocs build`), run it and check the output. Do not fail the lane on
this — file a TASKS.md if the doc build breaks; do not roll back your
edit unless the break is clearly your fault.

### Step 8: Summary

Return a structured summary to the umbrella:

```
lane=docs repo=<name>
docs-audited=<N>
docs-absent=<K>            # files in the inventory that don't exist in this repo
docs-skipped-worker-active=<M>
claims-verified=<X>
claims-failed=<Y>
claims-upstream=<Z>        # claims whose verification belongs in another repo
docs-edited=<files...>
tasks-filed=<count>
tasks-md-gitignored=<true|false>  # true if `git check-ignore TASKS.md` succeeds
```

## Patterns That Pay Off

- **AGENTS.md token check.** AGENTS.md / CLAUDE.md / global rules
  files have a token budget (~8K). Estimate with `wc -c / 4`. If over,
  file a P2 task: "AGENTS.md is N tokens — propose a trim".
- **`shared-rules.md` claims vs deployed.** When a project deploys
  shared rules to multiple agents, audit one of the deployed copies
  (e.g. `~/.claude/CLAUDE.md`) against the source and flag drift.
- **CLI help vs README.** Run `<binary> --help` and diff the output
  flag list against the README. Cheap and almost always finds drift.
- **CHANGELOG vs git log.** `git log --since="last release tag"
  --pretty=format:"- %s"` — diff against CHANGELOG. Flag missing
  entries.

## Cool-down

After running once per repo, mark the lane cooled for 2 cycles unless
the umbrella's user has explicitly asked to re-run it.
