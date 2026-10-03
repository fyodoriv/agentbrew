# Architecture

> A skill manager and sync engine for AI coding agents. Curator, not host. Single source of truth at `~/.config/agentbrew/state.yaml`; deploys to every supported agent's config paths via per-engine sync modules.

This file is the root-level architecture summary that the `load-project-context` rule expects. Detailed sections live in [`AGENTS.md`](AGENTS.md); this doc points at them and adds the system-level overview a fresh contributor needs before touching any code.

## System overview

```
                       ┌─────────────────────────────────┐
                       │  ~/.config/agentbrew/             │
                       │    state.yaml                     │  ← Source of truth
                       │    shared-rules.md                │     (human-edited or
                       │    commands/                      │      Agentfile-applied)
                       │    Agentfile.yaml (global)        │
                       └────────────────┬────────────────┘
                                        │  agentbrew sync
                                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  sync engines (idempotent, read-only diff → write-if-changed) │
   │    mcp-sync          rules-sync         skills-sync           │
   │    commands-sync     agents-sync        hooks-sync            │
   │    instructions-sync                                          │
   └──────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  ~/.claude/    ~/.cursor/    ~/.codeium/    ~/.config/devin/  │
   │  ~/.augment/   ~/.codex/     ~/.config/opencode/   …          │
   │       (supported agent config targets — output-only)          │
   └──────────────────────────────────────────────────────────────┘
```

## Layered structure

The codebase has three concentric layers; cross-layer reads are forbidden in the inner direction:

1. **CLI / commands layer** (`src/cli.ts`, `src/commands/`) — argv parsing, output formatting, exit codes. Stateless.
2. **Engine layer** (`src/sync/`, `src/catalog/`, `src/mcp/`, `src/skills/`, `src/core/`) — pure functions where possible; isolated I/O at adapter boundaries. This is where business logic lives.
3. **Adapter layer** (`src/sync/mcp-delegate.ts`, `rules-delegate.ts`, `commands-delegate.ts`, per-agent maps in `src/core/agents.yaml`) — calls out to external tools (`mcpm`, `ai-rules`, `skills add`) or writes config files.

State lives only in `~/.config/agentbrew/` (manifest, state, backups). The repo itself is stateless.

## Sync data flow

Detailed table is in [`AGENTS.md` § "Data Flow"](AGENTS.md#data-flow). The short version:

| Source | Engine | Target | Carve-outs vs delegated |
|---|---|---|---|
| `state.yaml` `mcpServers` | `mcp-sync.ts` | Native/delegated MCP configs plus Cursor/Devin `permissions.allow` grants | `AGENTBREW_ONLY_MCP_AGENTS` stay native; `MCP_INTERSECTION_AGENTS` flow through `mcpm` (matrix: `src/sync/mcp-sync-carveout-matrix.test.ts`) |
| `shared-rules.md` | `rules-sync.ts` | Native carve-outs + ai-rules delegation | `AGENTBREW_ONLY_RULES_AGENTS` native; `CANARY_DELEGATED_AGENTS` delegate (matrix: `src/sync/rules-sync-carveout-matrix.test.ts`) |
| `commands/*.md` | `command-sync.ts` | Native carve-outs + ai-rules delegation | carve-outs per `src/core/commands-agent-map.ts`; `CANARY_DELEGATED_AGENTS` delegate |
| installed skill selections + opt-in source dirs | `skills-sync.ts` | symlinks into `~/.*/skills/*` | agents with `readsFrom` skip duplicate |

**Always-fresh managed skills.** Plain `agentbrew sync` (via `src/sync/soft-update.ts` + `refreshInstalledSkills` in `src/sync-runner.ts`) refetches stale caches and re-copies installed skills for agentbrew-managed sources only (`origin: catalog`, `team:<label>`, `global`). User/project/agentfile sources refresh on `agentbrew sync --pull` only. Built-in `skill-plugins/dev/` is read directly from the agentbrew checkout — no cache step.

| `templates/AGENTS.md` | `instructions-sync.ts` | `~/.claude/CLAUDE.md`, etc. | merged with shared-rules.md |
| `templates/scripts/*`, `scripts/check-pr-vision-trace.mjs` | `helper-scripts.ts` (called by `instructions-sync.ts`) | `~/.config/agentbrew/scripts/*` | writes only missing files or files agentbrew wrote (manifest hash); keeps any other file |
| Agentfile `hooks:` | `hooks-sync.ts` | `~/.claude/settings.json`, `~/.cursor/hooks.json`, `.devin/hooks.v1.json` | Per-agent native hook formats; Devin output is project-local |

## Shared semantic memory

Semantic memory keeps one loopback `mcp-memory-service` daemon and one SQLite
store behind the same MCP fan-out used by the other agents. The state invariant
is:

```text
state.memory.enabled === true
  ⇒ state.mcpServers contains a valid managed "memory" HTTP entry
```

The managed entry uses source `agentbrew-memory`, an empty command/argument/env
set, and `http://127.0.0.1:18765/mcp`. Apply, sync, and repair paths reconcile a
missing or malformed entry before computing agent fan-out. An unchanged entry
keeps its `addedAt` metadata, so healthy syncs remain no-ops.

`Agentfile` merge preserves `memory.enabled` and deduplicates pack paths after
resolving each path relative to its declaring file. Agentfile generation emits
the memory fields but omits the managed HTTP implementation from the generic
`mcp:` list. Pack discovery is separate from installation: sync refreshes
installed pack ledgers only, and neither disabling memory nor removing a team
overlay deletes SQLite rows.

Claude project-memory files are a source for this same store. The managed
SessionEnd bridge uses a metadata ledger to ingest only changed stores and
records a bounded scheduler receipt without memory text or source paths.
Readable project labels remain available for intentional filtering, while a
hashed source tag prevents provenance collisions. Global recall is unchanged.
The pinned service still uses the compatible session-based Streamable HTTP
path. `memory transport-report` is a read-only compatibility gate for a future
Origin/authentication/protocol migration, not a second runtime or a migration
mechanism.

## Agent artifact static analysis

`src/agent-artifacts/inventory.ts` is a read-only static-analysis layer over the same repo-owned sources the sync engines consume. It inventories commands, built-in skills, instruction templates, rules, subagent/source declarations, hooks, MCP declarations, and skill/source references as `{ kind, name, sourcePath, targetAgents, risk, coverage }` records. The lint API rejects duplicate names within a kind, generated output paths treated as source, missing prompt metadata, high-risk artifacts without tests/evals/exemption, and obvious instruction-template safety-policy contradictions.

The inventory deliberately stops at source files (`Agentfile.yaml`, `src/catalog.yaml`, `templates/AGENTS.md`, `src/core/agents.yaml`, `hooks/manifest.yaml`, `hooks/checks/*`, `skill-plugins/dev/*/SKILL.md`, and catalog CLI command markdown). It does not inspect deployed output under `~/.claude`, `~/.cursor`, `~/.config/devin`, or other agent home directories. Run `npm test src/agent-artifacts` before changing agent-facing prompt/config surfaces.

## Ownership boundary

agentbrew owns: `~/.claude/`, `~/.cursor/`, `~/.codeium/`, `~/.augment/`, `~/.codex/`, `~/.config/devin/`, `~/.config/opencode/`, `~/.kiro/`, `~/.config/amp/`, `~/.config/agentbrew/`.

It does NOT own: `~/.zshrc`, `~/.gitconfig`, macOS defaults, `~/Library/LaunchAgents/` — those are dotfiles territory.

Full table in [`AGENTS.md` § "Ownership Boundary"](AGENTS.md#ownership-boundary). The iron rule: **never have two repos write to the same target path.**

## Repo layout

See [`AGENTS.md` § "Repo Layout"](AGENTS.md#repo-layout) for the directory tree. The notable shapes:

- `src/sync/*.ts` is the per-engine sync module set; one file per concern.
- `src/core/agents.yaml` is the runtime-loaded agent definition catalog — adding a new agent goes here, not in TypeScript.
- `src/catalog.yaml` lists installable skills, MCP servers, and rules in declarative form. The team overlay lives in a separate `agentbrew-<org>` repo.
- `skill-plugins/dev/` holds only skills that document agentbrew itself (`agentbrew-*`, `agentfile-init`, `sync-agent-config`); all other skill content lives in source repos that agentbrew references — never duplicates.
- `templates/AGENTS.md` is the cross-agent instruction template that gets composed and deployed by `instructions-sync.ts`.

## Pattern conformance

Sync engines follow the **idempotent diff-then-write** pattern: read current target state → compute desired state → diff → write only if changed → update manifest. This is the same shape Kubernetes controllers use (reconciliation loops); the agentbrew implementation is a synchronous one-shot version.

The carve-out vs delegate decision per engine follows VISION.md's "delegate, contribute, absorb" strategy: if an upstream tool handles 80%+ of the target's needs, delegate; the remaining 20% gets filed upstream as PRs.

The build pipeline has a dependency drift guard before `tsup` and a CLI smoke after `tsup`. `scripts/build-pipeline-guard.sh` delegates dependency validation to `npm ls --depth=0 --json`, prints `deps out of sync — run npm ci` when `node_modules` no longer matches `package-lock.json`, and verifies `dist/cli.js --version` after each build. `npm run verify` runs this pipeline before the broader typecheck/lint/test gate.

## Where to read next

| You're here to… | Read this |
|---|---|
| Add a feature | [`VISION.md`](VISION.md) (§ "delegate, contribute, absorb") + [`docs/user-stories/`](docs/user-stories/) |
| Add an agent | `src/core/agents.yaml` + [`AGENTS.md` § "Data Flow"](AGENTS.md#data-flow) |
| Modify a sync engine | [`AGENTS.md` § "Rules for Editing"](AGENTS.md#rules-for-editing) + the relevant `src/sync/*.test.ts` |
| Add a catalog rule | `src/catalog.yaml` + [`docs/COMPETITION.md`](docs/COMPETITION.md) |
| Debug a sync mismatch | `agentbrew status` + `~/.config/agentbrew/state.yaml` + manifest.json |
| Understand competitive positioning | [`docs/COMPETITION.md`](docs/COMPETITION.md) + [`docs/competition/`](docs/competition/) |
