# Harness-locate cross-check (2026-04-26)

One-shot audit of agentbrew's per-agent path table (`src/core/agents.yaml`)
against [Bridle's `harness-locate` crate](https://github.com/neiii/bridle/tree/master/crates/harness-locate)
v0.4.1, source pulled to `~/apps/bridle-research/`. Closes the
`audit-harness-locate-paths` P2 task in `TASKS.md`. (Upstream relocated
2026-05-02 from `superwall/bridle` to `neiii/bridle`; default branch
renamed `main` → `master`. Singular `skill/`/`command/` bug confirmed
still present at `neiii/bridle@master:crates/harness-locate/src/harness/opencode.rs:43-45,75-77`.)

The intent is sanity-checking, not absorption — agentbrew already lands
its paths from a different research path (per-tool docs + skills CLI)
and Bridle is the second independent source. Anything where the two
disagree is recorded with a written verdict (Bridle right / agentbrew
right / both valid in different contexts).

## Cross-check matrix

Bridle covers 7 harnesses: `amp_code`, `claude_code`, `copilot_cli`,
`crush`, `droid`, `goose`, `opencode`. Each row shows the **global**
path; project-scope rows are noted in the "Notes" column when they
differ from the obvious `<global-prefix>/<surface>` mapping.

| Harness | Surface | Bridle | agentbrew | Verdict |
| --- | --- | --- | --- | --- |
| Claude Code | skills | `~/.claude/skills/` | `~/.claude/skills` | MATCH |
| Claude Code | agents | `~/.claude/agents/` | `~/.claude/agents` | MATCH |
| Claude Code | commands | `~/.claude/commands/` | `~/.claude/commands` | MATCH |
| Claude Code | MCP | `~/.claude/` (settings file `.mcp.json` / `~/.claude.json`) | `~/.claude.json` (the user-level config file) | MATCH (Bridle returns directory, agentbrew returns file — same data) |
| Claude Code | rules | `~/.claude/` (Global), project-root for Project | `~/.claude/CLAUDE.md` (file, not dir) | MATCH (Bridle returns dir; agentbrew is more specific to `CLAUDE.md`) |
| Claude Code | plugins | `~/.claude/plugins/` | (not modeled) | **GAP — agentbrew missing** |
| Claude Code | env override | `CLAUDE_CONFIG_DIR` | (not honored) | **GAP — agentbrew missing** |
| Copilot CLI | skills | `~/.copilot/skills/` | `~/.copilot/skills` | MATCH |
| Copilot CLI | agents | `~/.copilot/agents/` | (not modeled) | **GAP — agentbrew missing** |
| Copilot CLI | commands | (not modeled) | (not modeled) | MATCH |
| Copilot CLI | MCP | `~/.copilot/mcp-config.json` | `mcpConfigVscodeSettings: true` (writes to VS Code settings instead) | DIFFER — see Note 1 below |
| Copilot CLI | rules | `~/.copilot/` (file: `copilot-instructions.md`); project: `.github/` | (not modeled — agentbrew does not write Copilot rules today) | **GAP — agentbrew missing** |
| Copilot CLI | env override | `XDG_CONFIG_HOME` | (not honored) | **GAP — agentbrew missing** |
| Copilot CLI | project skills | None (project-local skills not natively supported per Bridle) | n/a | MATCH |
| OpenCode | skills | `~/.config/opencode/skill/` (singular) | `~/.config/opencode/skills` (plural) | DIFFER — **agentbrew right** per [OpenCode docs](https://opencode.ai/docs/skills) ("`~/.config/opencode/skills/<name>/SKILL.md`") |
| OpenCode | commands | `~/.config/opencode/command/` (singular) | `~/.config/opencode/commands` (plural) | DIFFER — **agentbrew right** per [OpenCode docs](https://opencode.ai/docs/commands/) ("Global: `~/.config/opencode/commands/`") |
| OpenCode | MCP | `~/.config/opencode/` (key `mcp` in `opencode.json`) | `~/.config/opencode/opencode.json` (key: `mcp`) | MATCH |
| OpenCode | rules | None (Global), project root for Project (`AGENTS.md`) | (not modeled in agents.yaml — global rules treated separately) | MATCH (no global rules support) |
| AMP Code | skills | `~/.config/agents/skills/` (shared with Goose, Bridle claim) | `~/.config/amp/skills` (per-agent) | DIFFER — see Note 2 below |
| AMP Code | commands | `~/.config/amp/commands/` | (not modeled) | **GAP — agentbrew missing** |
| AMP Code | MCP | `~/.config/amp/settings.json` (top-level `amp.mcpServers` per Bridle ParseConfig) | `~/.config/amp/settings.json` key `amp.mcpServers` | MATCH |
| AMP Code | rules | `~/.config/amp/` (file: `AGENTS.md`); project: project root | (not modeled) | **GAP — agentbrew missing** |
| AMP Code | project skills | `.agents/skills/` (Bridle agentskills.io standard) | (treated as separate `.agents` skill dir, not AMP-specific) | MATCH (handled at the project layer, not the agent layer) |
| Goose | skills | `~/.config/agents/skills/` (shared with AMP, Bridle claim) | `~/.config/goose/skills` (per-agent) | DIFFER — see Note 2 below |
| Goose | commands | (not modeled — Bridle returns config dir) | (not modeled in agents.yaml) | MATCH |
| Goose | MCP | `~/.config/goose/` (key `extensions` in `config.yaml`) | `~/.config/goose/config.yaml` (key: `extensions`) | MATCH |
| Goose | rules | `~/.config/goose/` (file: `.goosehints` / `AGENTS.md`); project: project root | (not modeled) | **GAP — agentbrew missing** |
| Crush | skills | `~/.config/crush/skills/` | `~/.config/crush/skills` (`experimental: true`) | MATCH |
| Crush | MCP | `~/.config/crush/` | (not modeled — `experimental: true`, only skills in agents.yaml) | **GAP — agentbrew minimal** |
| Crush | rules | `~/.config/crush/` (Global); project root for Project | (not modeled) | **GAP — agentbrew missing** |
| Droid | skills | `~/.factory/skills/` | `~/.factory/skills` (`experimental: true`) | MATCH |
| Droid | agents | `~/.factory/droids/` (note: "droids", not "agents") | (not modeled) | **GAP — agentbrew missing** |
| Droid | commands | `~/.factory/commands/` | (not modeled) | **GAP — agentbrew missing** |
| Droid | MCP | `~/.factory/` (file: `mcp.json`) | (not modeled) | **GAP — agentbrew minimal** |

## Notes

**Note 1 — Copilot CLI MCP location.** Bridle says
`~/.copilot/mcp-config.json`. agentbrew uses
`mcpConfigVscodeSettings: true`, which writes MCP entries into the
user's VS Code settings file (e.g. `~/Library/Application
Support/Code/User/settings.json` on macOS) under the `github.copilot.*`
keys. **Both can be valid**: Bridle's path is for the GitHub Copilot
*CLI* (`@github/copilot` npm package) standalone config, while
agentbrew's path is for Copilot inside VS Code as an extension.
**Action:** if a user runs `agentbrew install <mcp-server>` and uses
Copilot CLI (not VS Code), the MCP entry won't be picked up. Worth
filing a follow-up task to support both targets.

**Note 2 — AMP/Goose shared skills directory.** Bridle returns the
agentskills.io community standard `~/.config/agents/skills/` for both
AMP and Goose, treating skills as agent-tool-agnostic. agentbrew uses
per-tool paths (`~/.config/amp/skills`, `~/.config/goose/skills`) which
are also valid because Goose's docs specify a per-tool dir and AMP
doesn't override it. **Both can be valid** — Bridle is shipping the
canonical agentskills.io path; agentbrew is shipping per-tool paths
that real users see. Cross-checked against each tool's docs:

* OpenCode docs explicitly enumerate `.opencode/skills/`,
  `.claude/skills/`, **and** `.agents/skills/` as discovery roots
  (project) — supporting Bridle's "shared" directional claim.
* No definitive agentskills.io spec was found that mandates
  `~/.config/agents/skills/` over per-tool dirs.
* agentbrew's paths are what skills CLI's symlinks land at today.

**Action:** the agentbrew paths are correct as-is. A future
enhancement could add `~/.config/agents/skills/` as an *additional*
deploy target for AMP/Goose (so the same skill is reachable via either
path), but this is not a bug — just a coverage choice.

**Note 3 — Plugin manifest discovery (Claude Code).** Bridle models
`~/.claude/plugins/` with the `.claude-plugin/plugin.json` marker file.
Slice 9 of `delegate-skill-install-to-skills-cli` (2026-04-27) closed
this question for agentbrew: `isSkillShaped()` already detects
`.claude-plugin/marketplace.json` and routes those repos through skills
CLI delegation for the supported-agent intersection (which covers Claude Code
plugins end-to-end). Bridle's coverage independently confirms the
upstream surface is real, but agentbrew's gap is closed via delegation.
**Action:** none.

## Summary

* **OpenCode `skill/` vs `skills/` and `command/` vs `commands/`** —
  Bridle has these wrong per OpenCode's official docs (2026-04-26).
  agentbrew is correct. Worth filing an upstream issue at Bridle so the
  next user of `harness-locate` doesn't get tripped up. (Drafting an
  issue is not publishing per the file-level publishing policy; *filing*
  it requires explicit per-action approval.)
* **AMP/Goose shared `~/.config/agents/skills/`** — Bridle's claim is
  arguable but not contradicted by official docs. agentbrew's per-tool
  paths are equally valid. No code change needed.
* **Gaps in agentbrew** (`Claude Code plugins`, `Copilot CLI agents`,
  `Copilot CLI rules`, `AMP commands/rules`, `Goose rules`, `Crush MCP/rules`,
  `Droid agents/commands/MCP`) — these are real coverage holes. Most
  matter only for users on those specific tools. The Claude Code
  plugins gap is closed via delegation as of slice 9 of
  `delegate-skill-install-to-skills-cli` (2026-04-27): `isSkillShaped()`
  routes manifest-shaped sources through `npx skills add`, which
  already handles plugin manifest discovery. The others are scout
  candidates if/when those tools' user counts justify the surface area.
* **Env-var overrides agentbrew doesn't honor** (`CLAUDE_CONFIG_DIR`,
  `XDG_CONFIG_HOME`) — these are real gaps. Worth a small follow-up
  task to honor them in agents.yaml-backed path resolution. Filing as
  a scout task is appropriate.

## Scout output

Two follow-up tasks worth filing (per AGENTS.md rule #11 / `TASKS.md`
"Scout while you work" policy). Both are P2 — they don't block any
current user outcome, just close coverage gaps:

* `agents-yaml-honor-env-overrides` — **SHIPPED 2026-04-26**.
  agentbrew now respects `CLAUDE_CONFIG_DIR` (substitutes `~/.claude/`
  paths) and `XDG_CONFIG_HOME` (substitutes `~/.copilot/` paths with
  `$XDG_CONFIG_HOME/copilot/`) at the loader layer in
  [`src/core/agents.ts`](../../src/core/agents.ts). Relative env-var
  values fall back to the original path so downstream `expandHome`
  doesn't silently emit a CWD-relative result. 14 unit tests cover
  the resolver and the loader plumbing.
* `bridle-opencode-path-issue` — file an issue at
  `neiii/bridle` (upstream relocated 2026-05-02 from `superwall/bridle`)
  noting `harness-locate` uses singular `skill/`
  and `command/` for OpenCode but the official docs use plural.
  Drafting the issue text is fine; *posting* requires explicit
  per-action publishing approval per the file-level policy in
  `TASKS.md`.

## Verdict

Sanity check **passes**. agentbrew's path table is correct on every
documented case where Bridle disagrees, has 8 documented coverage
gaps (most narrow; the Claude Code plugins one already tracked at P0),
and 2 env-var-handling gaps worth a small follow-up task. No
agentbrew bug fix landed from this audit; the value is the documented
sanity check against a second independent source.

`docs/COMPETITION.md` Bridle deep-dive is updated separately to note
"absorb complete: `harness-locate` cross-check produced
`docs/audits/harness-locate-cross-check.md`; no path corrections
needed in agentbrew."
