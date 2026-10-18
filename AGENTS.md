# AGENTS.md — agentbrew guide for agents

## Start here

agentbrew is a Node.js CLI that syncs skills, MCP servers, rules, commands, and
agent definitions to every supported AI coding agent. The canonical repo is
`github.com/fyodoriv/agentbrew`, branch `main`. It is public.

Read this file first. Then open only the doc that the routing table names. Do
not read `README.md` end to end; it is the user manual. `CLAUDE.md` is a symlink
to this file. The full docs map is [`docs/README.md`](docs/README.md).

## Commands

Run every command from the repo root.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Run the CLI from source | `npm run dev -- <command>` (for example `npm run dev -- status`) |
| One test file | `npx vitest run src/path/file.test.ts` |
| Tests for changed files | `npm test` (git-aware) |
| All tests | `npm run test:all` |
| Typecheck / lint | `npx tsc --noEmit` / `npx biome check src scripts` |
| Rule lints (Minsky rules on this repo) | `npm run lint:rules` |
| Task queue lint | `node scripts/lint-tasks-stability.mjs TASKS.md` |
| Hook fixtures | `bash scripts/run-hook-fixtures.sh` |
| Fast gate; says `merge-ready` when no full gate is needed | `npm run verify:changed` — seconds |
| Full gate | `npm run verify` — takes several minutes; run it in the background |
| Install e2e (real `scripts/install.sh`, scratch HOME) | `npm run test:install-e2e` (gates run it when an install path changes) |
| Build | `npm run build` |
| Metrics with goal and pivot | `bash scripts/metrics.sh` ([`docs/metrics.md`](docs/metrics.md)) |

## Where to change what

| I want to… | Change | Update this doc too |
|---|---|---|
| Add or change a supported agent | `src/core/agents.yaml` | README "Supported agents", [`docs/repo-map.md`](docs/repo-map.md) |
| Add a catalog skill, MCP server, or rule | `src/catalog.yaml` (skill `agentbrew-add-catalog-source`) | README "Install a skill or MCP server" |
| Change the instructions deployed to every agent | `templates/AGENTS.md` (tests pin its sections) | none beyond the template |
| Change how rules, MCP, skills, or hooks sync | `src/sync/*-sync.ts`, `src/sync/*-delegate.ts` | [`docs/repo-map.md`](docs/repo-map.md) data flow |
| Change MCP probe or auto-repair | `src/mcp/probe.ts`, `src/mcp/heal-cycle.ts`, `src/mcp/heal-actions.ts` | README "Drift detection" |
| Add a deterministic hook | `hooks/manifest.yaml`, `hooks/checks/<id>.sh` + `<id>.test.sh` | [`docs/hook-protocol.md`](docs/hook-protocol.md) |
| Add or change a CLI command | `src/cli.ts`, `src/commands/` | README "CLI reference" |
| Add a built-in skill | `skill-plugins/workflow/` (or `skill-plugins/dev/` only for agentbrew itself), with `evals/evals.json` | `skill-plugins/*/README.md` or `SOURCES.md` |
| Change the Agentfile format | `src/agentfile*.ts` | README "Agentfile" |
| Change default models | `src/sync/model-sync.ts` | README "Agentfile" |
| Change context-budget measurement | `src/measure/` | README "Context budget measurement" |
| Change the rule lints | `src/adapters/rule-lint.minsky.ts`, `scripts/run-rule-lints.ts` | README "Development" |
| Add or close a task | `TASKS.md` (`.prereg-allowlist` lists old tasks without rule-9 fields) | [`docs/task-backend-contract.md`](docs/task-backend-contract.md) |
| Change a leak or privacy gate | `src/oss/no-internal-refs.test.ts` | [`SECURITY.md`](SECURITY.md) |
| Add a docs test | `src/docs/*.test.ts` | [`docs/README.md`](docs/README.md) |
| Add a top-level doc | `docs/<name>.md` | a row in [`docs/README.md`](docs/README.md) (test-enforced) |

## Rules

Full text and examples: [`docs/editing-rules.md`](docs/editing-rules.md), which also
maps each rule to its check. Other files cite these numbers.

1. Pass the `## Delivery` gate before you say a change is done.
2. Update the docs that match a behavior change in the same PR (see `## Docs upkeep`).
3. Agent definitions live in `src/core/agents.yaml`.
4. Runtime state lives in `~/.config/agentbrew/state.yaml`. Never hardcode paths.
5. Resolve `~` with `expandHome()` from `src/utils.ts`.
6. Before you propose a feature, read [`VISION.md`](VISION.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`MILESTONES.md`](MILESTONES.md). Trace it to a user story in `docs/user-stories/`. Prefer wrapping a tool to writing one.
7. Delete before adding. Shrinking the code is always a valid PR.
8. Org-specific content goes to the `agentbrew-<org>` overlay, never into shared code or `src/catalog.yaml`.
8a. New skills go to a source repo or `skill-plugins/workflow/`, not `skill-plugins/dev/`.
9. Keep the CLI small. Add a visible command only for a distinct user problem.
10. Write tasks as outcomes ("users can do X"), with the why.
11. Scout while you work: record bugs, stale docs, and gaps you see as new tasks in the same PR.
12. A ticket key is optional. Never invent one.
13. Global git hooks enforce conventional commits (`type: description`, header <= 72 chars). Fix the message; never bypass the hook.
14. Publishing outside `fyodoriv/agentbrew` (npm, releases, other repos, Slack, Jira) needs explicit approval in the current session.
15. Never mock `expandHome` as identity in a test that writes files.

Also: no counts of agents, skills, tests, or files in docs or comments (CI checks it).
Windsurf and Devin were removed; Augment is frozen (keep it, never fix it).

## Gotchas

- GitHub Actions is off on this repo. `npm run verify` is the only CI.
- Develop in a worktree under `~/apps/tooling/wt/` (not `.wt/`: vitest skips it). Deps: `bash scripts/worktree-deps.sh`.
  A symlinked `node_modules` breaks `src/cli.test.ts`.
- `src/cli.test.ts` can time out under load. Re-run it before you blame your change.
- A test that writes this repo's `TASKS.md` fails its file (`vitest.tasks-guard.ts`). Stub writers such as `writeFollowups`.
- The owner's global gitignore lists `TASKS.md`. Fixture git repos need `GIT_CONFIG_GLOBAL=/dev/null`; store templates as `*.template.md`.
- A vitest `globalSetup` teardown error only logs; it does not fail the run. Use a `setupFiles` `afterAll` hook.
- In the agent sandbox, ssh, `gh` TLS, `.git/config` writes, tsx IPC, and the `mktemp` calls in hook fixtures fail. Run those commands outside the sandbox. `$TMPDIR` differs between the two.
- `jks-js` is a local stub (`scripts/stubs/jks-js`, plus an `overrides` entry) that keeps the unpatched `node-forge` out. Drop it when upstream ships a fix.
- The CLI bundles `src/catalog.yaml`: a new catalog skill installs only after `npm run build` in the live checkout.
- `agentbrew init` with a temporary `HOME` still runs `launchctl load` in your real GUI domain (`com.agentbrew.check`).
- `npm run lint:rules` needs a Minsky checkout (`AGENTBREW_MINSKY_DIR` or `~/apps/tooling/minsky`). Without one, each rule is skipped.
- PR hooks read `gh pr` in command position and heredoc bodies; a line in your command that starts with `gh pr create` counts, so write hook test input with the Write tool.
- The rule-9 lint applies to every `- **ID**:` task block. Give new tasks Hypothesis, Success, Pivot, Measurement, and Anchor fields.
- Hook scripts run under macOS `/bin/bash` 3.2 (no `${var,,}`). Put long jq programs in `hooks/lib/*.jq`. Write a JSON default as `"${INPUT:-{\}}"`; `scripts/lint-security.sh` rejects `"${INPUT:-{}}"`.
- The install e2e (`real-e2e/scenarios/us01-one-step-install.test.ts`) runs under `sandbox-exec`: writes outside its scratch folder fail it. Add new install paths to `scripts/install-e2e-if-needed.sh`.
- `.agents/requirements.yaml` maps each new-project area to the files that meet it. Change a mapped file, keep the map true.
- Tests run with `AGENTBREW_EVENTS=0` (`vitest.config.ts`). A new event field must pass `sanitizeEvent` ([`docs/observability.md`](docs/observability.md)).
- Name a real-e2e scenario after every story it covers (`usNN-usMM-...`) and list it in `real-e2e/SCENARIO_MAP.md`; `src/docs/scenario-map.test.ts` checks both.
- Task fields need the list dash (`  - **Field**: value`); parsers ignore a bare `  **Field**:` line. `npx @tasks-md/lint --fix TASKS.md` adds it.

## Delivery

1. Branch `type/short-description` from `main`, in a worktree.
2. Make the change, with its tests and its docs.
3. Iterate with `npm run verify:changed`. Unless it says `merge-ready`, run the full `npm run verify` once before merge.
   Then run the leak check:
   `bash -c 'source ~/.config/oss-readiness/oss-readiness.env; git diff origin/main | grep -icE -- "$OSS_READINESS_INTERNAL_PATTERN"'` must print `0`.
4. Commit with a conventional header and the pre-registered hypothesis in the body.
5. Push and open a PR. The body has `## Summary`, `## Details`, `## Docs`, a hypothesis block, and `## Visual proof` (a pasted terminal transcript).
6. When the gate is green, squash-merge. Remove the worktree and the branch.

## Docs upkeep

- Every behavior change updates its docs in the same PR. The routing table above names the doc.
- A gotcha that cost you time goes into `## Gotchas` in the same PR, or becomes a test or lint if a machine can check it.
- Every PR body has a `## Docs` section: the docs you changed, or `Docs: none — <reason>`. The opt-in hook `gh-pr-body-requires-docs` enforces it.
- A new top-level `docs/*.md` file needs a row in [`docs/README.md`](docs/README.md). `src/docs/agent-guide-contract.test.ts` checks this file's sections and size, the docs map, and the README opening.
- Repos outside agentbrew: follow [`docs/agent-guide-baseline.md`](docs/agent-guide-baseline.md).
