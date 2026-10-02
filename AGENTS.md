# AGENTS.md — AgentBrew Codebase Guide

## What This Repo Is

A skill manager and sync engine for AI coding agents. Pure Node.js CLI that syncs skills, MCP servers, rules, commands, and agent definitions across every supported agent — Claude Code, Cursor, Windsurf, Devin, Augment, Codex, Gemini CLI, Copilot, OpenCode, Kiro, Amp, Goose, Cline, Roo Code, Trae, Junie, Continue, Warp, and more.

## Repo Layout

```
agentbrew/
├── src/                            # Node.js CLI (TypeScript)
│   ├── cli.ts                      # Command definitions (commander)
│   ├── commands/                   # CLI command registration (cli-mcp.ts, cli-infra.ts, etc.)
│   ├── catalog/                    # Catalog browse, install, search
│   ├── catalog.yaml                # Catalog data (skills, MCP servers, rule sets)
│   ├── sync/                       # Sync engines (mcp-sync, rules-sync, skills-sync, etc.)
│   ├── mcp/                        # MCP management (adapters, mcp-git, mcp-setup, mcp-status, mcp-validation, mcp-wizard, etc.)
│   ├── skills/                     # Skill tools (init-skill, validate, skill-versions, etc.)
│   ├── core/                       # Core infra (agents.yaml, context, env-sanitize, errors, logger, state-manager, transforms)
│   ├── ui/                         # Interactive UI (browse)
│   ├── health.ts                   # Drift detection + auto-repair
│   ├── portable.ts                 # Config export/import as portable bundles
│   ├── types.ts                    # Core interfaces
│   └── *.test.ts                   # Unit tests (colocated)
├── templates/                      # Source templates
│   └── AGENTS.md                   # Shared instruction template (deployed to all agents)
├── skill-plugins/dev/              # Dev skills (deployed via symlinks) — see skill-plugins/dev/README.md
├── docs/                           # Vision, competition research, user stories, RFCs
├── Agentfile.yaml                  # Repo-local MCP/skill/source manifest for agentbrew work
├── TASKS.md                        # Task queue
└── README.md
```

> `.devin/` is gitignored per-developer Devin CLI config (hooks, local permissions). It does not hold shared repo content — any skill that would help anyone working on agentbrew belongs in `skill-plugins/dev/`. Interested contributors can copy the opt-in marathon-session Stop hook from [`docs/devin-marathon-hooks-example.md`](docs/devin-marathon-hooks-example.md) into their own `.devin/`. The same rule applies to sibling tool dirs (`.claude/`, `.cursor/`, etc.) that agents may create locally.

## Development

```bash
npm install                        # install dependencies
npm run dev -- status              # run CLI in dev mode
npm test                           # affected Vitest tests (git-aware)
npm run test:all                   # full Vitest suite
npm run typecheck                  # tsc --noEmit
npm run build                      # tsup → dist/
npm run playwright:install         # install Chromium for Storybook smoke tests (verify runs this)
npm run verify                     # typecheck + lint + security + tests (full gate)
```

## Frozen agents

Windsurf, Devin, and Augment are deprecated and frozen ([VISION NG4](VISION.md)). Keep their `agents.yaml` entries, sync targets, and tests. Never implement a fix or a feature for them, and never file tasks for them. If work for a supported agent breaks a frozen agent's existing test, skip that test with a note naming NG4.

## Rules for Editing

1. **Test before committing**: `npm run verify` (or at minimum `npm test` + `npm run typecheck`)
2. **Update README alongside behavior changes** — README drift is a bug
3. **Agent definitions live in `src/core/agents.yaml`** — loaded at runtime by `loadAgentDefinitions()`, re-exported from `src/types.ts`
4. **State lives in `~/.config/agentbrew/state.yaml`** — human-readable YAML, never hardcode paths
5. **Use `expandHome()` from `src/utils.ts`** for all `~` path resolution
6. **Read [`VISION.md`](VISION.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`MILESTONES.md`](MILESTONES.md) before proposing features** — every feature must trace to a user story under [`docs/user-stories/`](docs/user-stories/). Prefer wrapping existing tools over writing custom code. The `load-project-context` rule (in `~/.config/agentbrew/shared-rules.md`) plus the Claude Code SessionStart hook auto-load these on session entry; this rule is the in-repo elaboration. `docs/VISION.md` is preserved as a back-compat symlink — edit `VISION.md`, not the symlink.
7. **Delete before adding** — the non-test source line target is <20K. Shrinking the codebase is always a valid PR.
8. **team overlay lives in the team overlay repo** — The team catalog overlay (`catalog-overlay.yaml`) and related content have been extracted to a separate `agentbrew-<org>` team overlay repo. The remaining in-repo org-specific paths are `src/commands/cli-team.ts` and `src/core/team-detect.ts` (legacy, pending full extraction). NEVER mix org-specific logic into shared code paths, never copy skill content into agentbrew (curator, not host — see `docs/VISION.md`), never add org-specific entries to `src/catalog.yaml`. This includes catalog entries whose `command:` / `url:` / `args:` refer to org-internal infrastructure — SSO-gated `*.api.example.com` URLs, a local auth proxy, internal-only entrypoints, or any MCP requiring a proprietary desktop app or marketplace entitlement. Those entries belong in the `agentbrew-<org>` overlay's `catalog-overlay.yaml`. Generic transport features (e.g. HTTP `url:` field on `CatalogMcpServer`) ARE shared because any HTTP MCP — org or not — benefits; that's a transport-shape change, not org-specific content. Detection semantics and merge rules live as JSDoc on `detectTeamOverlay`, `loadCatalog`, and `mergeCatalog`. **The cross-agent rule that gets synced to every agent's instruction file lives in [`templates/AGENTS.md`](templates/AGENTS.md) under "Org-overlay routing (agentbrew + dotfiles family) — IRON LAW"; that's where the routing table, detection regex, and per-class disposition for every agent on every machine are defined. This file's rule #8 is the agentbrew-repo-specific elaboration of that cross-agent rule.**
8a. **New skills go to a source repo, not `skill-plugins/dev/`.** Per VISION.md "Curator, not host", agentbrew references skill content; it does not duplicate it. The built-ins under `skill-plugins/dev/` are a narrow exception: skills that document agentbrew itself (`agentbrew-*`, `agentfile-init`, `sync-agent-config`, `load-project-context`) stay built-in permanently because they have nowhere else to live. Everything else is a migration candidate — see `skill-plugins/dev/README.md` for the bucket list. A PR that adds a new SKILL.md under `skill-plugins/dev/` is rejected unless it documents an agentbrew-specific concern; everything else commits to a source repo and lands in agentbrew via a `catalog.yaml` pointer (or the team overlay's `catalog-overlay.yaml` for org-specific content). The catalog header comment in `src/catalog.yaml` covers the decision tree; the `skill-plugins/dev/README.md` table flags each existing built-in as permanent or migration-candidate.
9. **Keep the external API small** — merge overlapping commands, hide advanced ones. A user should never wonder which overlapping command to run. Add a new visible command only when it solves a distinct user problem that no existing command covers.
10. **Tickets are prompts** — task descriptions are agent prompts. Write outcome-shaped tasks ("users can do X") not implementation-shaped issues ("add flag Y to command Z"). Include the why. Never fragment into atomic technical issues upfront — assign the biggest piece justifiable and let the agent decompose. ([dheer.co/tickets-are-prompts](https://dheer.co/tickets-are-prompts/))
11. **Always scout and record** — every PR must include scouted tasks in TASKS.md. While implementing, look for bugs, missing tests, stale docs, dead code, and security issues in files you touch. Record them as new TASKS.md entries (P1–P3) in the same commit. An empty scout log means you weren't paying attention.
12. **A ticket is optional** — github.com has no Jira check. PR titles use `type: description`. Add a ticket key (`type: description PROJ-XXX`) only when a real ticket exists. Never invent a ticket number.
13. **Global git hooks are active** — `~/apps/dotfiles/git-hooks/` contains `pre-commit` (secret scanning) and `commit-msg` (conventional commits enforcement). Commit messages MUST match `type(scope): description` or `type: description` (≤72 chars first line). Multi-line messages work if the first line matches. If a hook blocks silently, check with `bash -x ~/apps/dotfiles/git-hooks/commit-msg .git/COMMIT_EDITMSG`. Never use `core.hooksPath=/dev/null` — fix the message instead.
14. **Publishing requires explicit per-action approval** — any task step that would publish, send, or broadcast to a destination outside `fyodoriv/agentbrew` is blocked until the user explicitly approves that specific action in the current session. Covered: `npm publish`, `gh release create`, creating/commenting/reviewing PRs or issues at ANY external repo (public or private, including any other org's repos), Slack / Teams / email, Jira, pushing to any `github.com/*` repo other than `fyodoriv/agentbrew`, or registering on `skills.sh`. Research, reading, drafting PR bodies, and local testing are NOT publishing. Approval to CLAIM a task is NOT approval to PUBLISH — ask fresh approval at the publish moment. The full policy lives in the file-level `<!-- policy: PUBLISHING REQUIRES EXPLICIT PER-ACTION APPROVAL -->` comment at the top of [`TASKS.md`](TASKS.md); the global External Communication Ban in the global agent instructions covers the same ground.
15. **Never mock `expandHome` as pure identity when the code under test writes files.** An identity mock (`expandHome: (p) => p`) leaks literal `~` paths into `writeFileSync` / `symlinkSync` / `mkdirSync`, which the OS then resolves against cwd, producing a `./~/` directory in the repo. This pollutes `biome check`, `git status`, and future test runs. Safe alternatives: (a) a tmpdir pattern — mock `expandHome` as `(p) => p.replace(/^~/, mockHome)` where `mockHome` is a `vi.hoisted()` tmpdir created in `beforeAll` and deleted in `afterAll` (see [`src/lint.test.ts:58`](src/lint.test.ts), [`src/sync/skills-sync.test.ts`](src/sync/skills-sync.test.ts)); (b) mock the filesystem-writing callee directly (`vi.mock('./shell-hook.js', ...)` — see [`src/init.test.ts`](src/init.test.ts)). When in doubt, prefer (b) — it's cheaper than managing tmpdirs. The pollution guard (`./~/` exclusion) was removed from `biome.json` once the identity-mock leaks were fixed; adding a new identity mock will re-break verify.

## Data Flow

```
agentbrew state                     sync engine                     target
───────────────                     ───────────                     ──────
state.yaml (mcpServers)          →  mcp-sync.ts                  →  Native MCP writes for `AGENTBREW_ONLY_MCP_AGENTS`
                                                                      (paths pinned in src/sync/mcp-sync-carveout-matrix.test.ts,
                                                                      e.g. ~/.config/devin/config.json, ~/.cursor/mcp.json,
                                                                      ~/.codeium/windsurf/mcp_config.json); intersection clients
                                                                      in `MCP_INTERSECTION_AGENTS` delegate to `mcpm install` +
                                                                      `mcpm client edit` via mcp-delegate.ts. agents.yaml
                                                                      `mcpPermissionsConfig` also writes permissions.allow for
                                                                      Cursor CLI and Devin.
shared-rules.md                  →  rules-sync.ts                →  Native writes for `AGENTBREW_ONLY_RULES_AGENTS` (paths in
                                                                      src/sync/rules-sync-carveout-matrix.test.ts); agents in
                                                                      `CANARY_DELEGATED_AGENTS` go through `ai-rules generate`
                                                                      via rules-delegate.ts.
~/.config/agentbrew/commands/    →  command-sync.ts              →  Native carve-outs per `src/core/commands-agent-map.ts`;
                                                                      `CANARY_DELEGATED_AGENTS` go through `ai-rules generate`
                                                                      via commands-delegate.ts
installed skills + opt-in dirs  →  skills-sync.ts               →  ~/.*/skills/* (symlinks — agents with readsFrom are skipped)
~/.config/agentbrew/agents/      →  agents-sync.ts               →  ~/.claude/agents/*.md, ~/.cursor/agents/*.md, etc.
templates/AGENTS.md              →  instructions-sync.ts         →  ~/.claude/CLAUDE.md, ~/.codeium/windsurf/memories/global_rules.md, etc.
Agentfile hooks                  →  hooks-sync.ts                →  ~/.claude/settings.json (hooks key),
                                                                      ~/.cursor/hooks.json,
                                                                      .devin/hooks.v1.json (project-local)
Agentfile defaultModel           →  model-sync.ts                →  ~/.claude/settings.json (model key),
                                                                      ~/.config/devin/config.json (agent.model),
                                                                      ~/.codex/config.toml (model). Cursor/Windsurf
                                                                      have no file surface (app-managed/UI model state).
```

### Deterministic hooks

Hook definitions live in `hooks/manifest.yaml`; executable checks live in `hooks/checks/`. The runtime contract is documented in [`docs/hook-protocol.md`](docs/hook-protocol.md). When adding a hook, add a shell fixture next to it when the behavior is deterministic and register the script in the manifest.

`gh-pr-skill-requires-evals` enforces `templates/AGENTS.md` § "Skill PRs Must Ship Evals (IRON LAW)" on `gh pr create` / `gh pr edit`: new skill PRs must include same-PR `evals/evals.json` plus `## Skill eval results` and `## How to run these tests yourself` sections. Existing skill edits without eval changes warn only. Emergency bypass is `HOOK_BYPASS_GH_PR_SKILL_REQUIRES_EVALS=1`; file a follow-up task when using it.

`RECURRING.md` is a sibling of `TASKS.md` at the repo root holding calendar-driven work (quarterly reviews, weekly competitor sweeps). Tasks with a `**Cadence**:` field live there, not in `TASKS.md`; the next-task workflow consults both files but skips a recurring task until its cadence window opens. The validator in `src/docs/tasks-md-output-cadence.test.ts` enforces the split.

### Agentfile

`Agentfile.yaml` is the repo-local manifest for working on agentbrew itself. It declares the MCP servers, catalog skills, and local `skill-plugins/dev` source this codebase expects agents to have. Project Agentfiles are additive: applying this file may add repo-specific tools to state, but the global Agentfile (`~/.config/agentbrew/Agentfile.yaml`) remains the portable machine-wide source of truth and generated per-agent config under `~/.*/` stays output-only.

Run `npm run dev -- lint` after editing it to validate syntax and catalog shorthands. Use `agentbrew sync --dry-run --agentfile ./Agentfile.yaml` to preview state/skill changes without mutating `state.yaml`, then run `agentbrew sync --agentfile ./Agentfile.yaml` when you intentionally want those repo-local tools deployed. Use [`docs/agent-guide-baseline.md`](docs/agent-guide-baseline.md) when refreshing agent-tool repo guides so Agentfile lifecycle, source ownership, task policy, and verification stay structurally aligned without copy/paste drift.

### Skill Sources

Skills are collected from installed source selections plus opt-in `skillSourceDirs` in `state.yaml`. A tracked source in `state.sources` is an index of available skills; only names listed in that source's `skillsInstalled` are symlinked during `agentbrew sync`. Legacy/manual `skillSourceDirs` outside tracked source paths remain explicit opt-in directories and deploy every skill they contain.

To add a new skill source, edit `~/.config/agentbrew/state.yaml`:

```yaml
skillSourceDirs:
  - label: my-project
    path: /path/to/my-project/skill-plugins/dev
```

Then run `agentbrew sync`. The source repo owns the skill files — agentbrew just creates symlinks. **Always edit skills in the source repo, not in `~/.*/skills/`.** The source repo may have change propagation rules (e.g., the tasks.md repo requires updating all agent variants in the same commit). `.devin/skills/` paths may appear in legacy setups but are not a recommended location — shared skills belong in a tracked repo directory.

## Ownership Boundary

| Target path | Owner | Notes |
|-------------|-------|-------|
| `~/.claude/` | **agentbrew** | CLAUDE.md, commands/, agents/ (shared by claude-code + claude-desktop Cowork) |
| `~/.cursor/` | **agentbrew** | mcp.json, cli-config.json (MCP permissions), rules/, commands/, agents/ |
| `~/.codeium/` | **agentbrew** | mcp_config.json, windsurf/memories/, windsurf/global_workflows/ |
| `~/.windsurf/` | **agentbrew** | rules/ |
| `~/.augment/` | **agentbrew** | guidelines.md |
| `~/.codex/` | **agentbrew** | AGENTS.md, config.toml, agents/ |
| `~/.config/devin/` | **agentbrew** | skills/, agents/, commands/, config.json (mcpServers + permissions), AGENTS.md |
| `~/.config/opencode/` | **agentbrew** | skills/, commands/, opencode.json |
| `~/.config/goose/` | **agentbrew** | skills/, config.yaml, AGENTS.md |
| `~/.config/amp/` | **agentbrew** | skills/, settings.json, AGENTS.md |
| `~/.kiro/` | **agentbrew** | skills/, settings/mcp.json |
| `~/.cline/` | **agentbrew** | skills/, AGENTS.md (MCP via VS Code extension config) |
| `~/.roo/` | **agentbrew** | skills/, AGENTS.md (MCP via VS Code extension config) |
| `~/.firebender/` | **agentbrew** | skills/, AGENTS.md |
| `~/.kilocode/` | **agentbrew** | skills/, AGENTS.md |
| `~/.gemini/` | **agentbrew** | commands/ |
| `~/.copilot/` | **agentbrew** | skills/, AGENTS.md |
| `~/Library/.../Claude/` | **agentbrew** | claude_desktop_config.json (mcpServers key only; Cowork reads rules/commands/agents from `~/.claude/`) |
| `~/Library/.../Code/User/` | **agentbrew** | settings.json (mcpServers key only) |
| `~/Library/.../TeamDesktopApp/` | **agentbrew** | skills/, mcp-config.json |
| `~/.config/agentbrew/` | **agentbrew** | state.yaml, shared rules, commands, backups, manifest |

**Rule**: Never have both repos write to the same target path.

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
