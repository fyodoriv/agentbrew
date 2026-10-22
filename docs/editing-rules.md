# Editing rules — full text

This file keeps the full text of the agentbrew editing rules. [`AGENTS.md`](../AGENTS.md)
keeps a one-line summary of each rule with the same number and links here.
Other files cite these numbers, so never renumber them.

## Rules for editing

1. **Test before committing**: `npm run verify` (or at minimum `npm test` + `npm run typecheck`)
2. **Update README alongside behavior changes** — README drift is a bug
3. **Agent definitions live in `src/core/agents.yaml`** — loaded at runtime by `loadAgentDefinitions()`, re-exported from `src/types.ts`
4. **State lives in `~/.config/agentbrew/state.yaml`** — human-readable YAML, never hardcode paths
5. **Use `expandHome()` from `src/utils.ts`** for all `~` path resolution
6. **Read [`VISION.md`](VISION.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`MILESTONES.md`](MILESTONES.md) before proposing features** — every feature must trace to a user story under [`docs/user-stories/`](docs/user-stories/). Prefer wrapping existing tools over writing custom code. The `load-project-context` rule (in `~/.config/agentbrew/shared-rules.md`) plus the Claude Code SessionStart hook auto-load these on session entry; this rule is the in-repo elaboration. `docs/VISION.md` is preserved as a back-compat symlink — edit `VISION.md`, not the symlink.
7. **Delete before adding** — the non-test source line target is <20K. Shrinking the codebase is always a valid PR.
8. **company content lives in the company plugin repo** — Org-specific content ships in a separate `agentbrew-<org>` repo as a signed company plugin (`agentbrew-plugin.yaml`, see `src/plugins/`). agentbrew 1.0 removed team overlays and the `catalog-overlay.yaml` merge. NEVER mix org-specific logic into shared code paths, never copy skill content into agentbrew (curator, not host — see `docs/VISION.md`), never add org-specific entries to `src/catalog.yaml`. This includes catalog entries whose `command:` / `url:` / `args:` refer to org-internal infrastructure — SSO-gated `*.api.example.com` URLs, a local auth proxy, internal-only entrypoints, or any MCP requiring a proprietary desktop app or marketplace entitlement. Those entries belong in the `agentbrew-<org>` company plugin. Generic transport features (e.g. HTTP `url:` field on `CatalogMcpServer`) ARE shared because any HTTP MCP — org or not — benefits; that's a transport-shape change, not org-specific content. **The cross-agent rule that gets synced to every agent's instruction file lives in [`templates/AGENTS.md`](templates/AGENTS.md) under "Org-overlay routing (agentbrew + dotfiles family) — IRON LAW"; that's where the routing table, detection regex, and per-class disposition for every agent on every machine are defined. This file's rule #8 is the agentbrew-repo-specific elaboration of that cross-agent rule.**
8a. **New skills go to a source repo or `skill-plugins/workflow/`, not `skill-plugins/dev/`.** Per VISION.md "Curator, not host", agentbrew references upstream skill content; it does not duplicate it. Owner decision 2026-10-07: the owner's opt-in workflow skills (formerly the `fyodoriv/dev-skills` repo) live in `skill-plugins/workflow/`. They install only when selected by name (catalog `source: fyodoriv/agentbrew` or an Agentfile `skills:` list), never by default, and each records provenance in `skill-plugins/workflow/SOURCES.md`. The built-ins under `skill-plugins/dev/` are a narrow exception: skills that document agentbrew itself (`agentbrew-*`, `agentfile-init`, `sync-agent-config`, `load-project-context`) stay built-in permanently because they have nowhere else to live. Everything else is a migration candidate — see `skill-plugins/dev/README.md` for the bucket list. A PR that adds a new SKILL.md under `skill-plugins/dev/` is rejected unless it documents an agentbrew-specific concern; everything else commits to a source repo and lands in agentbrew via a `catalog.yaml` pointer (or a company plugin for org-specific content). The catalog header comment in `src/catalog.yaml` covers the decision tree; the `skill-plugins/dev/README.md` table flags each existing built-in as permanent or migration-candidate.
8b. **Career-data features belong to careerbrew.** agentbrew deploys agent config for work in any repo. A feature that reads or writes a user's career data, such as a standup report or a daily status update, belongs to careerbrew, not to agentbrew's catalog, built-in skills, or `~/.config/agentbrew/`. agentbrew only deploys careerbrew's commands from careerbrew's own source. The same holds for any repo that owns a command: never hand-copy it into `~/.config/agentbrew/commands/`. Declare the repo's command folder in its `Agentfile.yaml` (`commands: [./commands]`) and let `agentbrew sync` deploy it. A hand copy is a second source with no owner, and it drifts from the repo's version. README "Commands that a repo owns" has the user steps.
9. **Keep the external API small** — merge overlapping commands, hide advanced ones. A user should never wonder which overlapping command to run. Add a new visible command only when it solves a distinct user problem that no existing command covers.
10. **Tickets are prompts** — task descriptions are agent prompts. Write outcome-shaped tasks ("users can do X") not implementation-shaped issues ("add flag Y to command Z"). Include the why. Never fragment into atomic technical issues upfront — assign the biggest piece justifiable and let the agent decompose. ([dheer.co/tickets-are-prompts](https://dheer.co/tickets-are-prompts/))
11. **Always scout and record** — every PR must include scouted tasks in TASKS.md. While implementing, look for bugs, missing tests, stale docs, dead code, and security issues in files you touch. Record them as new TASKS.md entries (P1–P3) in the same commit. An empty scout log means you weren't paying attention.
12. **A ticket is optional** — github.com has no Jira check. PR titles use `type: description`. Add a ticket key (`type: description PROJ-XXX`) only when a real ticket exists. Never invent a ticket number.
13. **Global git hooks are active** — `~/apps/dotfiles/git-hooks/` contains `pre-commit` (secret scanning) and `commit-msg` (conventional commits enforcement). Commit messages MUST match `type(scope): description` or `type: description` (≤72 chars first line). Multi-line messages work if the first line matches. If a hook blocks silently, check with `bash -x ~/apps/dotfiles/git-hooks/commit-msg .git/COMMIT_EDITMSG`. Never use `core.hooksPath=/dev/null` — fix the message instead.
14. **Publishing requires explicit per-action approval** — any task step that would publish, send, or broadcast to a destination outside `fyodoriv/agentbrew` is blocked until the user explicitly approves that specific action in the current session. Covered: `npm publish`, `gh release create`, creating/commenting/reviewing PRs or issues at ANY external repo (public or private, including any other org's repos), Slack / Teams / email, Jira, pushing to any `github.com/*` repo other than `fyodoriv/agentbrew`, or registering on `skills.sh`. Research, reading, drafting PR bodies, and local testing are NOT publishing. Approval to CLAIM a task is NOT approval to PUBLISH — ask fresh approval at the publish moment. The full policy lives in the file-level `<!-- policy: PUBLISHING REQUIRES EXPLICIT PER-ACTION APPROVAL -->` comment at the top of [`TASKS.md`](TASKS.md); the global External Communication Ban in the global agent instructions covers the same ground.
15. **Never mock `expandHome` as pure identity when the code under test writes files.** An identity mock (`expandHome: (p) => p`) leaks literal `~` paths into `writeFileSync` / `symlinkSync` / `mkdirSync`, which the OS then resolves against cwd, producing a `./~/` directory in the repo. This pollutes `biome check`, `git status`, and future test runs. Safe alternatives: (a) a tmpdir pattern — mock `expandHome` as `(p) => p.replace(/^~/, mockHome)` where `mockHome` is a `vi.hoisted()` tmpdir created in `beforeAll` and deleted in `afterAll` (see [`src/lint.test.ts:58`](src/lint.test.ts), [`src/sync/skills-sync.test.ts`](src/sync/skills-sync.test.ts)); (b) mock the filesystem-writing callee directly (`vi.mock('./shell-hook.js', ...)` — see [`src/init.test.ts`](src/init.test.ts)). When in doubt, prefer (b) — it's cheaper than managing tmpdirs. The pollution guard (`./~/` exclusion) was removed from `biome.json` once the identity-mock leaks were fixed; adding a new identity mock will re-break verify.

## How each rule is enforced

Each numbered rule in `AGENTS.md` maps to the check that enforces it, or to
"advisory" with the reason no machine check exists. `src/docs/rule-enforcement-map.test.ts`
fails when a rule has no row or a named file is missing.

| Rule | Enforced by |
|---|---|
| 1 | Hook `hooks/checks/verify-before-completion.sh` (blocks the end of a turn that edited code but ran no verify command). |
| 2 | Hook `hooks/checks/gh-pr-body-requires-docs.sh` (opt-in; blocks a PR body without `## Docs`) and `src/docs/agent-guide-contract.test.ts` (docs map). |
| 3 | Test `src/types.test.ts` (one agent definition per `agents.yaml` row). |
| 4 | Advisory: telling a real path from a hardcoded one needs review; no static check is reliable. |
| 5 | Advisory: same reason as rule 4. |
| 6 | Advisory in this repo: `scripts/check-pr-vision-trace.mjs` exists but `npm run verify` does not run it, because PR bodies are not in the tree. |
| 7 | Advisory: a judgment call per PR. |
| 8 | Test `src/oss/no-internal-refs.test.ts` and the global pre-push leak gate. |
| 8a | Advisory: a new skill's home is a review decision. |
| 8b | Advisory: whether a feature handles career data, and where a command's source lives, are review decisions. |
| 9 | Advisory: whether a command solves a distinct problem is a review decision. |
| 10 | Advisory: `scripts/lint-tasks-stability.mjs` and the rule-9 lint check task fields, not outcome wording. |
| 11 | Advisory: whether a PR scouted enough cannot be checked. |
| 12 | Advisory: the rule only allows something (an optional ticket key). |
| 13 | Hook `hooks/checks/git-commit-conventional.sh` and the global `commit-msg` git hook. |
| 14 | Hook `hooks/checks/no-cross-workspace-publish.sh` (blocks a PR, fork, or push outside the workspace without approval). |
| 15 | Advisory: an identity mock is legal when the code under test writes no files. |

## Frozen agents

Windsurf and Devin support was removed on 2026-10-08. agentbrew no longer knows either agent. Do not re-add them. Augment stays deprecated and frozen ([VISION NG4](VISION.md)). Keep its `agents.yaml` entry, sync targets, and tests. Never implement a fix or a feature for it, and never file tasks for it. If work for a supported agent breaks Augment's existing test, skip that test with a note naming NG4.

## Privacy & security gates

`github.com/fyodoriv/agentbrew` (branch `main`) is the only canonical home.
It is public. There is no mirror.

Contribute from any machine:

1. Create a feature branch from `main`.
2. Run `npm run verify`.
3. Push the branch: `git push origin <branch>`.
4. Open a PR on `github.com/fyodoriv/agentbrew`, then merge it.
5. Run `git pull` on `main` to get the latest.

**No private email, no org identifier outside the allowlist, and
no hardcoded secret may reach the repo.** Full design lives in
[`SECURITY.md`](SECURITY.md). The short version every contributor needs:

1. **Set a public-safe `user.email` in this repo:**
   ```
   git -C ~/apps/tooling/agentbrew config user.email <your-public@email>
   ```
   There is no mailmap and no history rewrite. A private email can never
   be made safe by mapping it. The dotfiles global `git-hooks/pre-push`
   hook blocks a push to `github.com/fyodoriv/agentbrew` when any author
   or committer email matches the private-email pattern from the org
   overlay. Fix the commit identity before you push.

2. **`src/oss/no-internal-refs.test.ts`** is the content gate. It reads
   the private-identifier regex (`OSS_READINESS_INTERNAL_PATTERN`) from
   the org overlay's `oss-readiness.env`. To scrub a new identifier:
   add it to the overlay pattern, run
   `npx vitest run src/oss/no-internal-refs.test.ts`, clean any new
   violators, and add a row to the "Pattern history" table at the bottom
   of `SECURITY.md`.

3. **`npm run verify` is the local gate.** Run it before every push.
   The CI workflow (`.github/workflows/oss-readiness.yml`) runs the
   no-internal-refs test and a private-email check. GitHub Actions is
   disabled on `fyodoriv/agentbrew` today, so CI does not run.

`dotfiles/lib/oss-readiness.sh` reads the same `oss-readiness.env` as
[`src/oss/no-internal-refs.test.ts`](src/oss/no-internal-refs.test.ts).
Update the overlay file to extend coverage.

## Feedback Loop Guardrails

**Principle: "Your CLAUDE.md is a suggestion. Your linter isn't."** ([zernie.com/blog/feedback-loop-is-all-you-need](https://zernie.com/blog/feedback-loop-is-all-you-need/))

Instructions help agents get it right on the first try. Lint rules make sure they can't get it wrong. When code can be produced nonstop, **you** are the bottleneck, not the agent.

### No counts in docs or comments

Do not write counts of tests, files, lines, agents, skills, commands, servers, or catalog entries — exact or `N+`. They go stale and nobody should maintain them. Write "every supported agent" or link the generated source (the agent matrix in README, `agents.yaml`, `agentbrew status`, or delegation sets such as `AGENTBREW_ONLY_*` / `MCP_INTERSECTION_AGENTS` and the carve-out matrix tests).

**Never create tasks, PRs, or commits to update a count.** When you find one, delete it.

**CI guards (scope):**

| Test | What it scans |
| --- | --- |
| `src/docs/agent-count-claims.test.ts` | User-facing prose in README, VISION, MILESTONES, COMPETITION, AGENTS, CONTRIBUTING, `src/catalog.yaml`, `package.json` — agent-count phrases in Agentbrew-facing narrative and selected table cells. Historical external measurements may use a nearby `<!-- agent-count-allowlist: reason -->` comment. |
| `src/docs/volatile-count-claims.test.ts` | Root user-facing docs (including `TASKS.md`, `CHANGELOG.md`, `RECURRING.md`), user stories, and every shipped `skill-plugins/**/SKILL.md` for volatile inventory counts (agents, skills, carve-outs, delegation boundaries, etc.). Skips HTML comments, fenced code, and `<!-- *:start/end -->` generated blocks. Every comment and JSDoc line under `src/**/*.ts` via `src/docs/volatile-count-scan.ts`. For an archived measurement, put `volatile-count-allowlist: reason` on its own line immediately before it. Meaningful thresholds stay (for example `≤500 lines`, `under 500 lines`, version/date/ID literals). |

`docs/VISION.md` is a symlink to root `VISION.md` — edit the root file only.

### Rules for agents

1. **Every recurring review comment must become a lint rule.** If you catch the same mistake twice, encode it as a lint/biome rule — not another AGENTS.md line. A lint rule fires deterministically on every commit; instructions are probabilistic.
2. **Complexity limits are non-negotiable.** This repo enforces `noExcessiveCognitiveComplexity: 15` via biome. If your function exceeds it, decompose — extract helpers, name things properly, separate concerns. Do not suppress.
3. **No `any` in production code.** Strict TypeScript means agents can't exploit type holes. `noExplicitAny: error` is active. Use `unknown` + type guards instead.
4. **User-facing CLI output goes through the `chalk`-wrapped `console.log` / `console.error` conventions already in the codebase.** `noConsole` is intentionally `off` in biome — agentbrew is a CLI that prints to stdout/stderr by design. Non-user-facing diagnostics (swallowed errors, silent skips) must use `logSkipped()` / `logger.warn()` so they can be filtered and instrumented.
5. **Run the full verify gate before claiming done.** `npm run verify` = typecheck + biome + security lint + all tests. No exceptions.
6. **When something goes wrong, ask: "Can this be a lint rule?"** Every bug that reaches CI should become a rule that prevents the next one. The system feeds on its own failures.
