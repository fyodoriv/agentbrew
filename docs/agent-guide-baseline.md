# Agent Guide Baseline

Use this contract when you create or refresh the docs of any repo that coding
agents work in. Humans should understand the repo in minutes. Agents should
work fast with little always-loaded context. Docs stay current because every
change updates them.

Keep each guide repo-specific: link here for the shape, then write the local
facts. Do not copy this checklist into other repos.

## Required Sections

`AGENTS.md` is loaded into every agent session, so it is a router, not a
manual. Keep it under 10,000 bytes. Add `CLAUDE.md` as a symlink to it (or a
file that holds only `@AGENTS.md`) so Claude Code loads it too. Use these H2
headings, in this order:

1. **`## Start here`**: what the repo ships and for whom, the canonical branch,
   and "read this file, then the doc the routing table names".
2. **`## Commands`**: a table of task → exact command from the repo root:
   install, one test file, tests for changed files, the full gate (and how slow
   it is), lint, build.
3. **`## Where to change what`**: a routing table of "I want to…" → files to
   change → doc to update.
4. **`## Rules`**: repo invariants, one or two lines each, numbered. Keep the
   numbers other files cite. Put long text in a linked doc. Cover the
   Agentfile lifecycle (what the root `Agentfile.yaml` declares, when to run
   `agentbrew sync --dry-run` versus `agentbrew sync`, and how it differs from
   generated per-agent config), skill and source ownership (edit sources, never
   the installed symlink mirrors), and the task queue policy.
5. **`## Gotchas`**: environment facts that cost agents time, each with its
   fix: known failing tests, sandbox limits, worktree location, slow gates.
6. **`## Delivery`**: branch pattern, gate, PR body sections (including
   `## Docs`), merge rule, cleanup.
7. **`## Docs upkeep`**: the docs-with-every-change rule below and a link to
   the docs map.

## Human Docs

- `README.md` opens, within its first 60 lines, with what the repo is, who it
  is for, a short quickstart code block, and a link to `docs/README.md`.
- `docs/README.md` is the docs map: one row per top-level `docs/*.md` file and
  per docs folder, with the question it answers and its audience (human, agent,
  or both). Group rows by Diátaxis type: tutorial, how-to, reference,
  explanation.

## Docs With Every Change

- A behavior change updates its docs in the same PR. The routing table names
  the doc.
- A gotcha that cost time goes into `## Gotchas` in the same PR, or becomes a
  test or lint when a machine can check it.
- Every PR body has a `## Docs` section: the docs it changed, or
  `Docs: none — <reason>`. The agentbrew hook `gh-pr-body-requires-docs`
  enforces it. Like every Bash hook it is opt-in: add its ID to `enabled:` in
  `~/.config/agentbrew/hooks-overlay/manifest.yaml`, then run `agentbrew sync`.
- A new top-level `docs/*.md` file gets a row in the docs map.

## Tests

Pin the contract with a test in the repo's own test runner:

- `AGENTS.md` has the required headings in order and stays under the budget.
- `CLAUDE.md` resolves to `AGENTS.md`.
- Every top-level `docs/*.md` file is linked from `docs/README.md`, and every
  link in the map resolves.
- The first 60 lines of `README.md` hold a code block and a link to
  `docs/README.md`.

agentbrew's version is `src/docs/agent-guide-contract.test.ts`.

## Adoption Steps

1. Create or update `Agentfile.yaml` first so the repo declares its agent
   dependencies.
2. Audit `AGENTS.md`, `README.md`, and `docs/` against this contract.
3. Fill gaps with repo-specific facts, not copied prose from this file.
4. Add the contract test.
5. Run the repo's docs or task linter if the edits touch `TASKS.md` examples,
   command snippets, or policy text.

## Agentbrew-Specific Notes

- The root `Agentfile.yaml` declares the MCP servers, catalog skills, and local
  skill source needed to work on agentbrew itself.
- Generated per-agent outputs live under user config directories such as
  `~/.claude/`, `~/.cursor/`, and `~/.codex/`; they are deployment
  targets, not source files.
- `templates/AGENTS.md` is the global instruction template deployed by
  agentbrew. `AGENTS.md` is the repo-specific contributor guide for this
  codebase. Update them separately and only when the same rule applies in both
  scopes.
