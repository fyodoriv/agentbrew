# Repo map — data flow, skill sources, ownership

This is reference detail for [`AGENTS.md`](../AGENTS.md). `AGENTS.md` keeps the
rules; this file keeps the diagrams and tables they point to.

## Data Flow

```
agentbrew state                     sync engine                     target
───────────────                     ───────────                     ──────
state.yaml (mcpServers)          →  mcp-sync.ts                  →  Native MCP writes for `AGENTBREW_ONLY_MCP_AGENTS`
                                                                      (paths pinned in src/sync/mcp-sync-carveout-matrix.test.ts,
                                                                      e.g. ~/.cursor/mcp.json,
                                                                      ~/.config/opencode/opencode.json); intersection clients
                                                                      in `MCP_INTERSECTION_AGENTS` delegate to `mcpm install` +
                                                                      `mcpm client edit` via mcp-delegate.ts. agents.yaml
                                                                      `mcpPermissionsConfig` also writes permissions.allow for
                                                                      Cursor CLI.
shared-rules.md                  →  rules-sync.ts                →  Native writes for `AGENTBREW_ONLY_RULES_AGENTS` (paths in
                                                                      src/sync/rules-sync-carveout-matrix.test.ts); agents in
                                                                      `CANARY_DELEGATED_AGENTS` go through `ai-rules generate`
                                                                      via rules-delegate.ts.
~/.config/agentbrew/commands/    →  command-sync.ts              →  Native carve-outs per `src/core/commands-agent-map.ts`;
                                                                      `CANARY_DELEGATED_AGENTS` go through `ai-rules generate`
                                                                      via commands-delegate.ts
installed skills + opt-in dirs  →  skills-sync.ts               →  ~/.*/skills/* (symlinks — agents with readsFrom are skipped)
~/.config/agentbrew/agents/      →  agents-sync.ts               →  ~/.claude/agents/*.md, ~/.cursor/agents/*.md, etc.
templates/AGENTS.md              →  instructions-sync.ts         →  ~/.claude/CLAUDE.md, ~/.augment/guidelines.md, etc.
templates/scripts/* +            →  helper-scripts.ts            →  ~/.config/agentbrew/scripts/* (only missing or
  scripts/check-pr-vision-trace.mjs                                   agentbrew-written files)
Agentfile hooks                  →  hooks-sync.ts                →  ~/.claude/settings.json (hooks key),
                                                                      ~/.cursor/hooks.json
Agentfile defaultModel/Effort    →  model-sync.ts                →  ~/.claude/settings.json (model, effortLevel),
                                                                      ~/.codex/config.toml (model, model_reasoning_effort). Cursor
                                                                      has no file surface (app-managed/UI model state).
```

### Deterministic hooks

Hook definitions live in `hooks/manifest.yaml`; executable checks live in `hooks/checks/`. The runtime contract is documented in [`docs/hook-protocol.md`](hook-protocol.md). When adding a hook, add a shell fixture next to it when the behavior is deterministic and register the script in the manifest.

`gh-pr-skill-requires-evals` enforces `templates/AGENTS.md` § "Skill PRs Must Ship Evals (IRON LAW)" on `gh pr create` / `gh pr edit`: new skill PRs must include same-PR `evals/evals.json` plus `## Skill eval results` and `## How to run these tests yourself` sections. Existing skill edits without eval changes warn only. Emergency bypass is `HOOK_BYPASS_GH_PR_SKILL_REQUIRES_EVALS=1`; file a follow-up task when using it.

`RECURRING.md` is a sibling of `TASKS.md` at the repo root holding calendar-driven work (quarterly reviews, weekly competitor sweeps). Tasks with a `**Cadence**:` field live there, not in `TASKS.md`; the next-task workflow consults both files but skips a recurring task until its cadence window opens. The validator in `src/docs/tasks-md-output-cadence.test.ts` enforces the split.

### Agentfile

`Agentfile.yaml` is the repo-local manifest for working on agentbrew itself. It declares the MCP servers, catalog skills, and local `skill-plugins/dev` source this codebase expects agents to have. Project Agentfiles are additive: applying this file may add repo-specific tools to state, but the global Agentfile (`~/.config/agentbrew/Agentfile.yaml`) remains the portable machine-wide source of truth and generated per-agent config under `~/.*/` stays output-only.

Run `npm run dev -- lint` after editing it to validate syntax and catalog shorthands. Use `agentbrew sync --dry-run --agentfile ./Agentfile.yaml` to preview state/skill changes without mutating `state.yaml`, then run `agentbrew sync --agentfile ./Agentfile.yaml` when you intentionally want those repo-local tools deployed. Use [`docs/agent-guide-baseline.md`](agent-guide-baseline.md) when refreshing agent-tool repo guides so Agentfile lifecycle, source ownership, task policy, and verification stay structurally aligned without copy/paste drift.

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
| `~/.augment/` | **agentbrew** | guidelines.md |
| `~/.codex/` | **agentbrew** | AGENTS.md, config.toml, agents/ |
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
