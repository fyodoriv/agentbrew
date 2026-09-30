# AgentBrew — Competition Analysis

## TL;DR

**The "agent config sync" problem is real and growing.** Every developer now uses 2-4 AI coding tools (Claude Code, Cursor, Windsurf, Codex, Copilot), each with its own config format for skills, MCP servers, rules, commands, and permissions. AgentBrew is the only tool that combines **declarative config management** (YAML state), **cross-tool sync** (skills + MCP + rules + commands to every supported agent), **drift detection + auto-repair**, **catalog marketplace** (built-in + user sources), **MCP server execution**, **team config**, and **lock file + patch system** in a single CLI. Competitors either focus on one slice (skills only, MCP only, rules only) or use Claude Code as the source of truth (fragile). AgentBrew's moat is the **declarative YAML state layer** -- config is code, diffable, version-controlled, and self-healing. 15+ tools researched across 5 tiers.

**Contribute vs Build (VISION.md: "Contribute first, build second"):** every competitor in this doc carries one of three labeled verdicts — **Contribute** (80%+ overlap, active upstream → shrink agentbrew and delegate or upstream), **Keep separate** (stagnant, scope-misaligned, or ecosystem-mismatched upstream), or **Complementary** (different layer, recommend both). Today's tally: **1 Contribute (delegation shipped, split-strategy)** — skills CLI's slices 2–12 of the now-retired `delegate-skill-install-to-skills-cli` parent landed between 2026-04-26 and 2026-04-28 (`npx skills add` for delegated targets; native carve-outs documented in routing matrices); the residual hardware-bound proxy / sandbox / offline measurement closed 2026-05-02 — **10 Keep separate**, **21 Complementary**. See [Build or Contribute? — Per-Competitor Summary](#build-or-contribute--per-competitor-summary) for the strategic outcomes; the parent task retired 2026-04-28, mirroring `delegate-mcp-to-mcpm`'s PR #906 retirement.

---

## Purpose

AgentBrew manages AI coding agent configuration as a single source of truth -- skills, MCP servers, rules, and commands synced across every supported agent (Claude Code, Cursor, Windsurf, Augment, Codex, Gemini CLI, Copilot, OpenCode, Kiro, Amp, Goose, Cline, Roo Code, Trae, Junie, Continue, Warp, and more). This document tracks what competitors do, what AgentBrew should absorb, and where to focus next.

## Review Cadence

| Cadence | Action | Who |
|---------|--------|-----|
| **Monthly** | Scan changelogs of Tier 1 tools (skills CLI, Compound, vsync, MCPM). Update sections where major features shipped. | Anyone |
| **Quarterly** | Full review of all tiers. Check for new entrants. Re-evaluate roadmap priorities. **Re-run the Build-or-Contribute verdict** on every competitor (tier tables + summary section) — any "Keep separate (stagnant)" project that resumed activity, any "Complementary" tool that added sync + drift detection, and any new 80%+ overlap entrant changes its verdict. | Lead |
| **On major release** | When any tool ships a headline feature (e.g., skills CLI adds MCP sync), add a note and assess impact. | Anyone |

## Safe Refresh Workflow

1. Update `docs/competition-snapshot.json` with the new tracked data.
2. Review the handwritten prose in this file for any star or fork counts called
   out outside the generated freshness block.
3. Run `npm run docs:competition` to regenerate the README table and freshness
   tracker.

The sync intentionally fails if handwritten narrative still references stale
tracked counts. Fix the prose first, then rerun the sync so the generated
sections and analysis stay aligned.

<!-- competition-freshness:start -->
> Last updated: 2026-05-02 (tracked source: `docs/competition-snapshot.json`; 2026-05-02 weekly refresh: refreshed every stale competitor row. Material deltas: skills CLI grew to 16.7K stars, npm v1.5.3, 54 supported agents, added Devin, and flipped Kiro CLI hooks support to Yes; agentbrew mirrored the matrix by adding 8 skills-only agents, delegating Devin, and adding Kiro hooks support. Skills Manager jumped to 975 stars and v1.16.1 but stays GUI/skills-only. Context Hub reached 13.1K stars, OpenClaw catalog 47.7K stars / 5,400+ skills, anthropics/skills 126.9K stars, OpenViking 23.3K stars. No Build-or-Contribute verdict changed; all direct sync competitors remain Contribute/Keep separate/Complementary as before.)

### Freshness Tracker

| Tool | Last Researched | Stars | Needs Update? |
|------|----------------|-------|---------------|
| Caliber (@rely-ai/caliber) | 2026-05-02 | 933 | 2026-05-02 refresh: caliber-ai-org/ai-setup 933⭐ / 106 forks, latest release v1.49.3 (2026-04-29), npm @rely-ai/caliber v1.49.3, pushed 2026-04-29. Still a project-scoped LLM-generated context/setup tool for Claude Code, Cursor, Codex, OpenCode, and GitHub Copilot; no user-level machine sync or unmanaged-config drift detection. Verdict: Keep separate; watch if agent count grows past 10 or global config appears. |
| Bridle (neiii/bridle) | 2026-05-02 | 418 | 2026-05-02 refresh: 418⭐ / 18 forks, latest release still v0.2.9 (2026-01-30), npm bridle-ai v0.2.9, pushed 2026-04-25. Minor repo activity only; still 7-harness Rust TUI profile manager with tiny npm/crates adoption, no drift detection, catalog, rules managed sections, or lock file. Verdict: Keep separate. |
| skills CLI (Vercel) | 2026-05-02 | 16.7K | 2026-05-02 refresh: 16.7K⭐ / 1.3K forks, npm skills v1.5.3 (2026-04-28), latest GitHub release v1.5.1, open issues 265 / open PRs 211. Still no MCP sync, no rules sync, no drift detection; PR #630 (status/drift), PR #509 (validator), and PR #937 (config-system work) remain open. README matrix changed: supported agents now 54, including Devin; Kiro CLI hooks flipped to Yes. Mirrored into src/core/agents.yaml by adding 8 skills-only agents, removing Devin from the native carve-out set, and setting Kiro supportedSkillFeatures to [hooks]. |
| Skills Manager (desktop) | 2026-05-02 | 975 | 2026-05-02 refresh: xingkongliang/skills-manager 975⭐ / 86 forks, latest release v1.16.1 (2026-05-01), pushed 2026-05-01. GUI skill manager is now materially larger than the old ~50-star snapshot, but still skills-only, Electron GUI, no MCP/rules/commands or drift detection. Verdict: Complementary GUI companion; watch only if sync/repair appears. |
| Composio Connect | 2026-07-06 | N/A (hosted SaaS) | 2026-07-06 landscape review: Composio Connect at connect.composio.dev/mcp exposes 1,000+ SaaS apps via one HTTP MCP endpoint with managed OAuth and meta-tools (COMPOSIO_SEARCH_TOOLS, etc.). agentbrew delegates the per-vendor connector long tail to a single catalog entry (`composio`); removed `notion` and `atlassian` MCP catalog entries. Verdict: Delegate (catalog pointer) — G1 curate not host. |
| Compound Engineering | 2026-07-06 | 22.7K | 2026-07-06 refresh: EveryInc/compound-engineering-plugin 22.7K★ / 1.7K forks, pushed 2026-07-06. Official plugin for Claude Code, Codex, Cursor, and more — 29 skills including ce-compound knowledge accumulation and lfg full pipeline. Indexed in agentbrew catalog + sources.yaml (curator model). Prior nicepkg/compound 404 snapshot superseded. Verdict: Complementary curated source. |
| gstack | 2026-07-06 | 120K | 2026-07-06 refresh: garrytan/gstack 120K★ / 17.9K forks, pushed 2026-06-25. Opinionated sprint pipeline (office-hours → autoplan → qa → ship → retro) with real-browser QA and regression tests. 18 core sprint skills indexed in agentbrew catalog; ~35 niche skills (iOS, design, OpenClaw) deferred. Verdict: Complementary curated source (G1 curator model). |
| vsync | 2026-05-02 | 43 | 2026-05-02 refresh: nicepkg/vsync 43⭐ / 1 fork, latest release @nicepkg/vsync@1.1.0 (2026-01-27), pushed 2026-01-27. Description still names Claude Code, Cursor, OpenCode, and Codex; no material feature change. Verdict: Keep separate. |
| MCPM (mcpm.sh) | 2026-05-02 | 938 | 2026-05-02 refresh: pathintegral-institute/mcpm.sh 938⭐ / 100 forks, latest release v2.14.0 (2026-03-27), pushed 2026-04-24. No material post-delegation change; remains the MCP-specific package manager agentbrew delegates to for intersection clients. |
| Smithery CLI | 2026-05-02 | 703 | 2026-05-02 refresh: smithery-ai/cli 703⭐ / 88 forks, @smithery/cli v4.11.1 (2026-04-30), `smithery` package v1.0.0 + GitHub release v1.0.0 (2026-05-01), pushed 2026-05-01. Active hosted registry CLI for MCP servers and skills; no rules/commands/drift sync. Verdict: Complementary catalog/source, not replacement. |
| install-mcp | 2026-05-02 | 182 | 2026-05-02 refresh: supermemoryai/install-mcp 182⭐ / 33 forks, npm install-mcp v1.10.2 (2026-01-02), latest GitHub release v1.10.0, pushed 2026-04-17. Still one-shot MCP install with OAuth/header support; no ongoing management, removal, sync, or drift repair. Verdict: Complementary. |
| block/ai-rules | 2026-05-02 | 96 | 2026-05-02 refresh: block/ai-rules 96⭐ / 20 forks, latest release v1.6.0 (2026-03-31), pushed 2026-03-31. No material change after the 2026-04-27 delegation deep-dive; still rules/commands/skills generation across 10+ agents. Residual upstream PR #91 path flags remains approval-blocked in TASKS.md. |
| skillfile | 2026-05-02 | 115 | 2026-05-02 refresh: eljulians/skillfile 115⭐ / 13 forks, latest release v1.5.0 (2026-04-13), pushed 2026-05-01. Active Rust skills package manager with lock/patch/Skillfile primitives; still skills-only and not a multi-surface sync engine. Verdict: Keep separate; absorbed ideas remain documented only. |
| ai-rules-sync | 2026-05-02 | 27 | 2026-05-02 refresh: lbb00/ai-rules-sync 27⭐ / 1 fork, latest release v0.8.1 (2026-03-11), npm ai-rules-sync v0.8.1, last push still 2026-03-16. No material feature change; remains effectively dormant. |
| OpenViking | 2026-05-02 | 23.3K | 2026-05-02 refresh: volcengine/OpenViking 23.3K⭐ / 1.7K forks, release v0.3.13 (2026-04-29) with v0.3.14 tag, pushed 2026-05-01. Still a ByteDance context database / memory system, not config sync. Verdict: Complementary runtime context layer; possible MCP catalog entry. |
| knowhub | 2026-05-02 | 40 | 2026-05-02 refresh: yujiosaka/knowhub 40⭐ / 2 forks, last push still 2025-07-24. Still inactive generic knowledge-file sync; no agent-specific config conversion or MCP/rules/commands expansion. Verdict: Keep separate/out of scope. |
| MCP Dock | 2026-05-02 | 111 | 2026-05-02 refresh: OldJii/mcp-dock 111⭐ / 5 forks, latest release v1.2.0 (2026-03-06), pushed 2026-03-06. Still GUI MCP server manager; no skills/rules/commands or CLI automation. Verdict: Complementary GUI. |
| agent-config-sync (skill) | 2026-05-02 | 2 | 2026-05-02 refresh: liamdmcgarrigle/agent-config-sync 2⭐ / 0 forks, pushed 2026-02-28. Still a Claude Code skill wrapping vsync / npx skills / git hooks for Claude Code, OpenCode, Codex, and Cursor; no independent sync engine. Verdict: Keep separate. |
| mdskills.ai | 2026-05-02 | N/A | 2026-05-02 refresh: mdskills.ai redirects to www.mdskills.ai and returns 200 from Vercel; no public GitHub repo found in mdskills-ai/mdskills, mdskills/mdskills, or ai-sh/mdskills. Still a registry / marketplace data source candidate, not a config-sync competitor. |
| awesome-codex-subagents | 2026-05-02 | 4.4K | 2026-05-02 refresh: VoltAgent/awesome-codex-subagents 4.4K⭐ / 513 forks, no releases, pushed 2026-03-20. Still a Codex-native .toml subagent catalog, not a sync tool. Verdict: Complementary curated source. |
| claude-peers-mcp | 2026-05-02 | 2.0K | 2026-05-02 refresh: louislva/claude-peers-mcp 2.0K⭐ / 246 forks, no GitHub releases, pushed 2026-04-26. Still runtime peer messaging between Claude Code sessions via MCP, not config sync. Verdict: Out of scope / adjacent runtime infrastructure. |
| Warden | 2026-05-02 | 191 | 2026-05-02 refresh: getsentry/warden 191⭐ / 15 forks, latest release v0.22.0 (2026-04-28), pushed 2026-05-01. Sentry-backed code review runner continues active development and consumes SKILL.md; still execution layer, not install/sync layer. Verdict: Complementary. |
| Context Hub (chub) | 2026-05-02 | 13.1K | 2026-05-02 refresh: andrewyng/context-hub 13.1K⭐ / 1.2K forks, latest release v0.1.4 (2026-04-27), pushed 2026-04-29. Still runtime API-doc retrieval / local annotations / feedback loop for agents, not config sync. Verdict: Complementary; natural skill/MCP catalog source. |
| React Doctor | 2026-05-02 | 6.3K | 2026-05-02 refresh: millionco/react-doctor 6.3K⭐ / 200 forks, npm react-doctor v0.0.47 (2026-05-01), latest GitHub release react-doctor@0.0.38 (2026-04-17), pushed 2026-05-01. Still React diagnostics + skill installer; validates multi-agent install pain but writes directly to agent dirs. Verdict: Keep separate; ownership conflict remains. |
| Chops | 2026-05-02 | 1.3K | 2026-05-02 refresh: Shpigford/chops 1.3K⭐ / 78 forks, latest release v1.15.0 (2026-04-29), pushed 2026-04-29. Still macOS GUI skill browser/editor/installer and symlink-aware AgentBrew companion; no drift detection or MCP/rules sync. Verdict: Complementary GUI; watch if sync/repair appears. |
| OpenClaw / ClawHub | 2026-05-02 | 47.7K | 2026-05-02 refresh: VoltAgent/awesome-openclaw-skills 47.7K⭐ / 4.7K forks, pushed 2026-04-20; clawhub.ai returns 200 and openclaw.ai returns 403 to HEAD. Registry now claims 5,400+ filtered skills. Verdict: Complementary registry / catalog source, not config sync. |
| GitAgent | 2026-05-02 | 2.8K | 2026-05-02 refresh: open-gitagent/gitagent-protocol 2.8K⭐ / 330 forks, latest release v0.3.2 (2026-04-20), pushed 2026-04-23. The implementation repo open-gitagent/gitagent is 325⭐ and active; protocol remains single-agent git-native definition layer. Verdict: Complementary; watch for multi-agent sync + drift detection. |
| **anthropics/skills** | 2026-05-02 | 126.9K | 2026-05-02 refresh: anthropics/skills 126.9K⭐ / 14.9K forks, no GitHub releases, pushed 2026-05-01. Continued rapid growth; still canonical Agent Skills spec + production skills, not a manager. Watch for official CLI/marketplace/sync surface. |
| dotfiles pattern (manual) | 2026-05-02 | N/A | 2026-05-02 refresh: conceptual/manual pattern, no repository to query. Still valid baseline for hand-managed multi-agent config, but no productized drift detection, catalog, or format translation. |
| mcpick (spences10/mcpick) | 2026-04-26 | 72 | NEW. ~139 commits, 3 contributors, updated within 24h. TypeScript Vite+ build. Claude Code extension manager: toggles MCP servers on/off (fixes ~all-MCPs-load-at-startup token bloat), manages plugins/skills/hooks/agents/marketplaces, profiles + backups + plugin cache. Reads/writes ~/.claude.json and ~/.claude/plugins/ directly. Node 22+, Claude Code-only. Tier 5 / Complementary — single-agent runtime control vs agentbrew’s multi-agent config-sync; per-session MCP toggle UX has no agentbrew equivalent and no plan to add (runtime territory). |
| Alph (Aqualia/Alph) | 2026-04-26 | 61 | NEW. TypeScript CLI (npm @aqualia/alph-cli). "Universal MCP Server Configuration Manager" — 6 agents (Gemini CLI, Cursor, Claude Code, Windsurf, Codex CLI, Kiro) across HTTP/SSE/STDIO transports. Local-first atomic writes with timestamped backups + rollback, validation. Auto-installs STDIO tools via npm/brew/pipx/cargo. Cross-platform (macOS/Linux/Windows; Codex on Windows blocked upstream). Tier 2 / Complementary — narrower than MCPM (6 vs 10+ clients) but more polished UX (atomic+rollback+auto-install). Nothing strategically novel vs MCPM/install-mcp; the atomic-writes-with-backup pattern is worth absorbing if MCPM lacks it. |
| skillpm (sbroenne/skillpm) | 2026-04-26 | 8 | NEW. "npm-native package manager for Agent Skills." TypeScript CLI on npm. Uses npm registry as the distribution channel: `skillpm install` runs npm install + scans node_modules/ for skills/*/SKILL.md + delegates to vercel-labs/skills CLI to wire into agent dirs. `skillpm publish` validates agentskills.io spec and publishes to npmjs.org. Workspace monorepo support. Pass-through to npm for non-skillpm commands. Tier 3 / Complementary — npm-publishing front-end on top of skills CLI; different distribution channel from agentbrew (npm registry vs git URL). Distinguishing idea: npm semver as versioning vs agentbrew/skillfile git-SHA pinning. No absorbable feature today. |
| akm (itlackey/akm) | 2026-04-26 | 40 | NEW. "Agent Kit Manager" — npm akm-cli + standalone binary. 548 commits, very active solo project. MPL-2.0. Manages skills, commands, agents, knowledge, workflows, vaults, wikis, memories. Cross-tool via prompt injection ("add this to your AGENTS.md/CLAUDE.md"). Distinguishing capabilities: (a) website crawling — indexes pages as searchable knowledge; (b) feedback/usage tracking; (c) registry concept (official + private + skills.sh); (d) `akm clone` copies any asset from stash/remote. Plugin SDK. Tier 1 / Keep separate — broader scope than agentbrew (vaults/wikis/memories are out of scope per VISION.md "config-sync, not knowledge management"). Different model: prompt-injection vs managed-section sync. Watch: feedback-as-quality-signal + website-as-skill-source ideas. Re-evaluate if akm grows past 500⭐. |
| syncode (donnes/syncode) | 2026-04-26 | few | NEW. CLI on npm @donnes/syncode, Bun-first build. 17 agents (Amp, Antigravity, Claude Code, Clawdbot, Codex, Cursor, Droid, Gemini CLI, GitHub Copilot, Goose, Kilo, Kiro, OpenCode, Roo, Trae, VSCode, Windsurf). Git-repo-as-source-of-truth model: clones a config repo and symlinks (or copies for Claude/Gemini cache preservation) the entire agent dir. `syncode sync` bidirectional Import/Export. Auto-detects installed agents at `new`. Includes opinionated `install.sh` machine-deps setup. macOS/Linux only (Windows planned). MIT. Tier 1 / Keep separate — different model from agentbrew (full-directory sync vs managed-section sync); the full-copy model conflicts with agentbrew's user-stories prohibition on destroying user content. 17-agent list mostly overlaps agentbrew's 50+. Watch: machine-deps-as-skill (`install.sh` boilerplate as deployable skill) for the dotfiles + agentbrew composition story. |
| faf-cli (Wolfe-Jam/faf-cli) | 2026-04-26 | 27 | NEW. "The package.json for AI Context." Defines `.faf` YAML format (IANA-registered as application/vnd.faf+yaml). 26 commands: init, score, sync, export to AGENTS.md/.cursorrules/GEMINI.md, compile to .fafb binary. Bi-sync between .faf and CLAUDE.md (8ms); tri-sync to MEMORY.md. Auto-detects project type (MCP, fullstack, svelte, etc.) and reads metadata from package.json/pyproject.toml/Cargo.toml. WASM scoring kernel (0-100% AI-readiness). Bun-first, single-file binary, 51K+ npm downloads, 402 tests, very active. MIT. Tier 3 / Complementary — different layer: faf-cli creates the canonical AI-context content; agentbrew syncs content (skills/MCP/rules) across agents. They compose. Architectural disagreement: faf-cli treats bi-sync as a feature; agentbrew's VISION.md treats bi-sync as a non-goal due to source-of-truth ambiguity. |
| skillink (bosens-China/skillink) | 2026-04-26 | 0 | NEW. TypeScript CLI on npm `@boses/skillink`. "Robust symlink manager for AI tool configurations." Resolves glob patterns (e.g. `**/AGENTS.md`) into flat symlink structures across `.agents/` and tool-specific dirs (`.claude`, etc.). Distinguishing idea: **AES-256-GCM file encryption** (`skillink lock`/`skillink unlock`) for sensitive MCP configs and `.env` files so they can be safely committed to git — manifest tracked in `skillink.encrypt.json`. Cross-platform (macOS/Linux/Windows; uses NTFS Junctions with elevation fallbacks). Bilingual output (English/Chinese with `auto` locale detection). Strict-mode `--yes` fails on conflicts rather than overwriting. 56 commits, MIT, declarative `skillink.config.ts`. Tier 1 / Keep separate — narrower than agentbrew (just AGENTS.md sync + secret encryption, no MCP/rules/commands distribution). The lock/unlock encryption pattern for sensitive MCP configs is the only novel idea worth tracking; agentbrew today expects users to keep secrets out of state.yaml entirely (env-var indirection) so absorbing this would be a different security posture, not an enhancement. Watch if it grows past 50⭐ or adds full MCP/rules sync. |
| agentctl (liangquanzhou/agentctl) | 2026-04-26 | 0 | NEW. Go CLI, brew tap `liangquanzhou/tap`, MIT. "Unified control plane for managing multiple AI coding agents — think `terraform apply` but for your AI toolchain." 35 commits, single-static-binary distribution. **Direct competitor in scope**: 7 agents (Claude Code, Codex, Gemini CLI, Antigravity, OpenCode, OpenClaw, Trae CN) × 6 surfaces (MCP, rules, hooks, commands, ignore patterns, skills). Custom agent registry via TOML overrides in `~/.config/agentctl/agents/`. Private skill registries via `skills/sources.json`. Plan/apply/status/validate/doctor/rollback/drift/reconcile/runs verbs — same drift-detect-and-fix model as agentbrew. Distinguishing capabilities: (a) **ignore-patterns sync** (`.codexignore`, `.geminiignore`) — a surface agentbrew doesn't currently manage; (b) **`agentctl runs`** apply-history command for rollback target selection; (c) age-encrypted secrets in `~/.config/agentctl/secrets/`. Capability matrix in README is honest about gaps (OpenCode hooks via JS plugin not yet supported; Trae CN/OpenClaw rules/hooks/commands not yet investigated). Tier 1 / Keep separate — same problem space as agentbrew, smaller agent set (7 vs 50+), Go binary vs Node CLI. **Watch if it grows past 50⭐ or adds 10+ agents.** Two absorbable ideas: (1) ignore-patterns as a first-class sync surface (worth a TASKS.md entry to evaluate `.codexignore`/`.geminiignore`/`.cursorignore` parity); (2) the `agentctl runs` history-of-applies pattern for rollback UX (agentbrew has portable export/import but no per-apply log). |
| spm (skillpkg/spm) | 2026-04-26 | 0 | NEW. Go CLI (`spm` binary) + npm wrapper (`@skillpkg/cli`). "The package manager for AI agent skills." Active development — 341 commits, dedicated brand at skillpkg.dev with full registry stack (Cloudflare Workers + Hono API + Neon Postgres + R2 + admin dashboard). Apache-2.0. `spm install <skill>` installs and links to all detected AI agents (claims "Claude Code, Cursor, Copilot, Codex, and 30+ agent platforms" — same scope claim as vercel-labs/skills). Distinguishing capabilities: (a) **Sigstore keyless signing** (Fulcio + Rekor) for supply-chain integrity — every published skill is cryptographically signed; (b) **3-layer security scan pipeline** (regex → static analysis → ML) before any skill ships; (c) dedicated **MCP server** (`@skillpkg/mcp` on npm) so agents can discover skills directly via Model Context Protocol; (d) GitHub OAuth device flow for `spm publish`. Workspaces monorepo with Go binary + Cloudflare Worker API + React 19 web. ~640 tests across packages. Tier 3 / Complementary — yet another skills CLI (similar functional shape to vercel-labs/skills) but with security-first posture: signed packages, scanned uploads, MCP-discoverable registry. Different distribution channel from agentbrew (skillpkg.dev registry vs git URL). The Sigstore-signing-of-skills idea is novel in this ecosystem (vercel-labs/skills uses git SHA pinning; skillpm uses npm semver; skillfile uses git SHA + patches). Worth tracking as the security-leaning alternative if/when supply-chain incidents become a real concern. No absorbable feature today — agentbrew delegates skill install to skills CLI per the P0 delegation strategy. |
| ctx (ctx-hq/web) | 2026-04-26 | 0 | NEW. TypeScript / Hono SSR + Cloudflare Pages. The `ctx-hq/web` repo is just the **website** (getctx.org) for a planned product called "ctx — Universal Package Manager for LLM Context." 62 commits, MIT. The actual CLI (`ctx install <package>`, `ctx serve`) is referenced but not in this repo. Three claimed package types: skills, MCP servers, CLI tools. Distinguishing UX idea: **agent-readable bootstrap skill** — the README literally says "For AI agents — paste this into your agent: `Read https://getctx.org/skill.md and follow the instructions to use ctx`" — a meta-pattern where the install instructions ARE a skill the agent fetches and follows. Tier 5 / Complementary or registry-style — functional shape closer to skills.sh / mdskills.ai / OpenClaw (registry + CLI front-end) than to agentbrew's multi-surface sync. Without seeing the CLI repo we can't fully classify; Tier 5 is the safest holding bucket. The bootstrap-via-skill idea is the only novel piece worth tracking; agentbrew's `agentbrew add <repo>` happens at the user-CLI level, not via an agent reading a remote skill. Watch for: (a) the CLI repo going public with cross-agent sync claims (would re-classify to Tier 1); (b) registry growth past skills.sh tier (would warrant adding as a `catalog --search` query target like the `catalog-registry-source` P3 task contemplates). |
| skillkit (PuvaanRaaj/skillkit) | 2026-04-26 | 1 | NEW. Go CLI (Go 1.26+), distributed via shell installer + Go install + npm wrapper. MIT. "One source of truth for every AI agent" — 13 rules targets (claude, cursor, copilot, agents_md default-on; gemini, windsurf, aider, goose, jules, continue, amazon_q, kodu, zed opt-in). Same shape as block/ai-rules: define rules in `.skillkit/rules/` (with optional scoped overrides in `.skillkit/scoped/`) and `skillkit sync` regenerates each tool's native format. Distinguishing capabilities: (a) **lockfile** (`.skillkit/skillkit.lock`) for reproducible drift detection — same model as agentbrew's lockfile but rules-only; (b) **`skillkit sync --check`** exits 2 in CI when outputs would change (CI-friendly drift gate); (c) **`skillkit import --from claude`** migrates existing CLAUDE.md / .cursorrules / Copilot instructions / AGENTS.md into `.skillkit/`; (d) monorepo `parent/child` rule layering (`monorepo.inherit: true`); (e) experimental MCP server over stdio for agent-driven sync. Project-scoped only — does not write user-level config. Has a marketing site at skillset-v1.netlify.app. Tier 1 / Keep separate — same rules-sync slice as block/ai-rules / ai-rules-sync, narrower than agentbrew (rules only, project-scoped, no MCP/skills/commands distribution beyond the experimental MCP). The CI-friendly `--check` exit code and the `import --from <tool>` migration helper are both worth tracking as polish-level absorb candidates if/when agentbrew's drift gate or import story needs UX work. Watch if it grows past 50⭐ or adds MCP/skills sync. |
| conforme (maxgfr/conforme) | 2026-04-26 | 1 | NEW. Rust CLI, distributed via Homebrew (`brew install maxgfr/tap/conforme`), `cargo install`, and pre-built binaries (macOS ARM64/x64, Linux ARM64/x64, Windows ARM64/x64). 13 supported tools — the most complete cross-tool surface we've documented at this scope: Claude Code, Cursor, Windsurf, GitHub Copilot, Continue.dev, Kiro (AWS), Roo Code/Cline, Amazon Q, plus Codex CLI, OpenCode, Gemini CLI, Zed AI, Amp via AGENTS.md fallback. **Source-of-truth flexibility** is the headline UX: read from any tool (`conforme sync --from claude`) and propagate to all detected tools, not just AGENTS.md as the canonical. SHA-256 content hashing means unchanged files are never touched. Orphan files (renamed/removed rules) are auto-deleted. Distinguishing capabilities: (a) **rules + skills + agents + MCP** all in one CLI (full four-surface scope) — most rules-sync competitors are rules-only; (b) **4 activation modes** normalized across all tools (always / glob / agent decision / manual) with a per-tool capability matrix in the README; (c) `conforme migrate --source gemini --output opencode` for cross-tool config translation; (d) `conforme hook install` for git pre-commit drift gate; (e) per-target frontmatter handling (Claude `paths` vs Cursor `globs` vs Windsurf `trigger` etc) that maps activation modes correctly to each tool's native frontmatter shape. Tier 1 / Keep separate — closest to agentbrew in functional surface (13 tools × 4 surfaces vs agentbrew's 50+ × 4 surfaces). Project-scoped only (writes `.cursor/rules/`, `.claude/rules/`, etc — no user-level `~/.<agent>/` writes), so it doesn't compete with agentbrew's user-level posture. **Three absorbable ideas worth tracking**: (1) source-of-truth flexibility (`--from <tool>` to read from a non-AGENTS.md canonical) — agentbrew's `agentbrew add` always writes to a state.yaml-managed source repo, doesn't honor an existing tool's config as the canonical; (2) the activation-mode normalization across rules formats — agentbrew's rules sync today is a flat injection without per-tool frontmatter mapping; (3) `conforme migrate` for cross-tool translation — agentbrew's portable export/import is repo-to-repo, not tool-to-tool. Watch if it grows past 50⭐, adds user-level config, or claims an agent count past 20. |
| aitoolsync (EvanL1/aitoolsync) | 2026-04-26 | 1 | NEW. Rust CLI distributed via npm (`aitoolsync`) + `cargo install` + Homebrew + pre-built binaries (macOS ARM64/x64, Linux x86_64/ARM64, Windows x64). MIT, ~2ms execution. 7 platforms (Claude Code, Codex CLI, Gemini CLI, Cursor, Copilot, Windsurf, Cline). Source-of-truth `.agents/` directory layout: `rules/`, `skills/`, `agents/`, plus `platforms/<name>/` for per-platform runtime extras (settings.json, hooks/, plugins/, .mcp.json, output-styles/). Auto-converts file extensions per platform (`.md` → `.mdc` for Cursor, `.instructions.md` for Copilot) and rolls flat skill markdown into `<name>/SKILL.md` directory format. **Distinguishing capabilities**: (a) **LAN config server** — `aisync serve --port 9753` exposes the `.agents/` dir over HTTP for any teammate on the same network to `aisync pull http://config-server:9753`; (b) **SSH push** — `aisync remote add devbox deploy@host` + `aisync remote push devbox` rsync-pushes `.agents/` to a remote machine; (c) **`aisync user`** writes to user-level (`~/.claude/`, etc) in addition to the default project-scope writes — narrower analogue of agentbrew's user-level posture; (d) explicit `aisync import` from any source platform. Tier 1 / Keep separate — same shape as conforme (Rust binary, multi-platform sync) but narrower (7 vs 13 platforms) and adds team-distribution UX (LAN/SSH push) that other competitors don't have. The LAN config server + SSH push are the novel pieces; useful for air-gapped enterprise teams. agentbrew's portable export/import bundle is the closest analogue but requires manual file shipping. Watch if it grows past 50⭐ or generalizes beyond LAN/SSH (e.g. cloud sync). |
| claude-agents-sync (alexandrbasis/claude-agents-sync) | 2026-04-26 | 1 | NEW. Python script + Claude Code `PostToolUse` hook — not a CLI. "Automatic synchronization for CLAUDE.md ↔ AGENTS.md files in Claude Code projects." Last update late 2025 (semi-stale). Auto-discovers all `(CLAUDE.md, AGENTS.md)` pairs in a project (root + subdirs for monorepos), bidirectionally copies content when either file is edited via Claude Code's Write/Edit tools. Triggers in <1s, logs to `.claude/hooks/hook-debug.log`. Inspired by `iannuttall/source-agents` but with content-duplication instead of `@AGENTS.md` sourcing. Tier 4 / Out of scope — single-purpose Claude Code hook, not a multi-agent config-sync tool. Doesn't compete with agentbrew's surface area at all (no MCP, no skills, no commands, no rules across tools — just two-file content duplication). The auto-discovery-of-pairs approach is reusable for any "two files I want to keep identical" automation but agentbrew already handles AGENTS.md / CLAUDE.md / cursor-rules / windsurf-rules through a different model (managed-section sync from a single source). No absorbable feature. |
| rulix (danielcinome/rulix) | 2026-04-26 | 2 | NEW. TypeScript CLI on npm (`rulix`), Node 22+, MIT. v0.1. "Single source of truth for AI coding rules across Cursor, Claude Code, AGENTS.md, and more." Currently 3 export targets (Cursor, Claude Code, AGENTS.md); Windsurf, Copilot, Codex listed as Planned. Distinguishing capabilities: (a) **typed rule frontmatter** — every rule has `id` (kebab-case), `scope` enum (`always` / `file-scoped` / `agent-selected`), `description`, optional `category` and `priority` (1–5), `globs` for file-scoped rules; (b) **token budget tracking** — `rulix status` reports per-tool token-budget usage so users know when rules exceed a tool's recommended limit; (c) **deterministic validation** (`rulix validate`) — catches duplicates, vague descriptions, missing fields, token overflow; zero LLM dependency, works offline; (d) **programmatic API** for embedding in build pipelines (`loadRuleset`, `validateRuleset`, `exportRules`); (e) `rulix import --from cursor|claude-code` for migration. Tier 1 / Keep separate — same rules-sync slice as block/ai-rules / skillkit / ai-rules-sync. v0.1 status with 3 targets vs agentbrew's 8 rules-sync targets. The token-budget reporting is the only distinctive idea worth tracking — useful for users hitting per-tool context limits. Watch if it grows past 50⭐ or adds Windsurf/Copilot/Codex (currently Planned). |
| agentsync (spyrae/agentsync) | 2026-04-26 | 3 | NEW. Python CLI on PyPI (`agentsync-cli`), Python 3.9+, MIT. "Sync MCP server configs and rules across AI coding agents." 4 agents (Claude Code as source; Cursor, Codex, Antigravity as targets). Single source of truth = Claude Code's config (`~/.claude.json` global MCP + `.mcp.json` project + `CLAUDE.md` rules). **JSON ↔ TOML automatic conversion** for MCP server configs. **Markdown → filtered Markdown / MDC frontmatter** for rules. Case-insensitive deduplication (handles `Notion` vs `notion` from different sources). Dry-run mode + automatic backups before every write. Adapter-based architecture for extending to new agents (each adapter is a single Python class). Distinguishing capabilities: (a) **JSON↔TOML config-format conversion** that handles the Codex CLI's distinctive TOML format — a real engineering challenge most rules-sync competitors don't tackle; (b) **claude-as-source-of-truth opinion** instead of a separate `.agents/` dir or `AGENTS.md` canonical; (c) **`exclude_servers`** and **`exclude_sections`** per-target filters for selectively dropping MCP servers or rules sections per agent. Tier 1 / Keep separate — narrower than agentbrew (4 agents vs 50+, only MCP+rules vs full four-surface), Python distribution. The JSON↔TOML conversion is the only piece worth tracking; agentbrew's MCP adapter system covers the same territory via `core/format-adapters/` per-format adapters. The exclude-per-target filter idea overlaps with agentbrew's per-Agentfile filtering. No absorbable feature today. Watch if it grows past 50⭐ or adds 10+ agents. |
| AICodingControl (nangongwentian-fe/AICodingControl) | 2026-04-26 | 6 | NEW. Electron + React 18 + TypeScript desktop app. MIT. Chinese-first UI with English README. **Visual GUI for config-sync**, not a CLI. 7 tools (Trae, TraeCN, Cursor, OpenCode, Codex, Claude Code, Antigravity). Each tool gets its own Rules / MCP / Skills / Commands tab in a Monaco-editor-backed UI. Quick-Settings shortcut for Claude Code (bypasses Plugin login + edits `settings.json` / `.claude.json` directly). Custom-tool support via `~/.ai-coding-control/ai_coding_tools.json`. Tier 5 / Complementary — desktop-GUI alternative to agentbrew's CLI; doesn't compete because it serves a different audience (visual editing) and operates as user-level config editor (different ownership semantics from agentbrew's managed-section sync). The Monaco-backed visual editing is the distinctive UX; agentbrew has no GUI plans. Watch if it adds drift detection or grows past 50⭐. |
| ay-claude-templates (walidboulanouar/ay-claude-templates) | 2026-04-26 | 5 | NEW. TypeScript CLI on npm `@ay-claude/cli`, Node 18+, MIT. Last update Nov 2025 (semi-stale). Official CLI for the **AY Claude Platform** — a Claude Code-only marketplace covering Skills, Agents, Commands, Hooks, Plugins, MCPs, and Settings. Distinguishing capabilities: (a) **OAuth Device Flow + system keychain** for authenticated package install; (b) **5-stage security verification pipeline** for installed packages; (c) **HMAC-SHA256 request signing** + audit logging; (d) **Package bundles** for curated stack-installs (`react-dev-stack`, `nodejs-backend`, etc); (e) **Health scores** + **smart recommendations**; (f) **Team workspaces** + **favorites** + **search history** + **rollback**. Cross-platform (macOS / Linux / Windows). Tier 5 / Complementary — Claude Code-only platform tool, sits in the same niche as OpenClaw / mdskills.ai / skills.sh (registry + CLI front-end for one agent). Doesn't compete with agentbrew's cross-agent sync mission. The OAuth device flow + signed packages + bundle concept are interesting platform-level moves, but they're a different product layer (marketplace) from agentbrew (config sync). No absorbable feature. |
| apc-cli (FZ2000/apc-cli) | 2026-04-26 | 3 | NEW. Python CLI (Python 3.12+), MIT. "AI Personal Context Manager." 6 tools (Claude Code, Cursor, Gemini CLI, GitHub Copilot, Windsurf, OpenClaw). Three sync surfaces: skills + MCP servers + **memory entries** (the novel one). Local cache at `~/.apc/`; secrets redacted to OS keychain on collect. Distinguishing capabilities: (a) **LLM-powered memory sync** — transforms memory entries into each tool's native format using any configured LLM provider (Anthropic, OpenAI, Gemini, Qwen, GLM, MiniMax, Kimi, or any OpenAI/Anthropic-compatible endpoint via `apc configure`); (b) **age-encrypted export/import** for cross-machine portable bundles — commit the encrypted dir to a private repo, transfer the age private key once via secure channel; (c) **manifest tracking** so user edits are never overwritten; (d) **smart conflict resolution** when two tools have overlapping configs; (e) **`apc install owner/repo --skill foo`** for direct GitHub-skill install with `--list` / `--all` / `--skill '*'` modes. Tier 1 / Keep separate — closest competitor in this batch by surface (6 tools, skills+MCP+memory). The **LLM-powered memory transformation** is the only novel idea this ecosystem has produced; agentbrew's VISION.md explicitly defers memory to OpenViking / chub etc ("config-sync, not knowledge management"), so absorbing this would be a scope expansion the strategy currently rejects. The age-encrypted export/import is similar in spirit to agentbrew's portable export but with stronger crypto. Watch if it grows past 50⭐; if it does, the LLM-memory-sync question may need re-litigating in a strategic-review. |
| cacs (hjnnjh/coding-agent-config-sync) | 2026-04-26 | 2 | NEW. Python CLI (Python 3.12+, uv-installed), MIT. Chinese-first README. "Cross-device AI coding assistant config sync via private GitHub repo." Currently 2 supported tools (Claude Code Router, OpenCode), extensible via `sync_config.yaml`. **GitHub private repo as sync hub**: `cacs init` uploads, `cacs pull` downloads with auto-backup, `cacs push -m "<msg>"` commits, `cacs status` shows local-vs-remote diff. Distinguishing capabilities: (a) **field-level ignore** — `ignore_fields` in `sync_config.yaml` lists JSON paths (dot-separated, e.g. `mcpServers.filesystem.args`) that are preserved locally on pull and skipped in status comparisons — useful for keeping machine-specific values out of the synced canonical; (b) **timestamped backups** before every pull with restore-by-timestamp; (c) **auto-update check** (24h rate-limited) on every command. Tier 4 / Out of scope — dotfiles-pattern-as-CLI for narrow tool set (CCR + OpenCode), GitHub private repo as sync mechanism. Doesn't compete with agentbrew's surface (no skills, no rules, no commands, no cross-agent translation). The field-level `ignore_fields` JSON pruning is the only piece worth tracking — useful when agentbrew users want to commit their state.yaml to git but keep machine-specific MCP `cwd:` paths or OS-specific `command:` entries out of the canonical. No absorbable feature today. |
| glooit (nikuscs/glooit) | 2026-04-26 | 22 | NEW. TypeScript (Bun-first build), distributed via Homebrew (`brew tap nikuscs/glooit`) + npm + bun + pnpm. **Most feature-rich rules-sync tool documented to date** at this size. 5 agents (Claude Code, Cursor, Codex, OpenCode, Roo Code/Cline) × 7 surfaces (rules, commands, skills, agents, MCP, agent hooks, settings merge). Distinguishing capabilities: (a) **symlink mode** — changes to source files reflect instantly in agent configs without running `glooit sync`; (b) **content transforms** with placeholders (`__TIMESTAMP__`, `__ENV_VAR__`, `__STRUCTURE__`) plus a `compact` filler-word remover — turns rules into per-context-aware artefacts; (c) **agent hooks** wired into Claude Code + Cursor lifecycle (`PreToolUse`, `PostToolUse`, `beforeShellExecution`, `afterFileEdit`, `Stop`) with TS/JS/sh script support — e.g. run prettier after file edits, block writes to sensitive files; (d) **settings merge** that consolidates env vars + permissions into provider-native settings files with safety-guard refusing to commit secrets to git-tracked files; (e) **file merging** combines multiple source files into one output (`file: ['.agents/coding-standards.md', '.agents/testing-guidelines.md']`); (f) **per-rule mode/path overrides** so a rule can target one file in `to: ./.cursor/rules/api.mdc` and a different file for `claude`; (g) automatic **backups** with retention (`backup: { enabled: true, retention: 10 }`); (h) **glob scoping** for Cursor (`globs: 'src/**/*.{ts,tsx}'`); (i) declarative `glooit.config.ts` with TypeScript types via `defineRules`. Tier 1 / Keep separate — closest functional shape to agentbrew at the project-scope layer (5 agents × 7 surfaces vs agentbrew's 50+ × 4 surfaces). Two absorbable ideas worth tracking: (1) the **content transforms** pattern (`__TIMESTAMP__`/`__ENV_VAR__`/`__STRUCTURE__` placeholders) gives users an inline templating layer agentbrew lacks; (2) the **safety-guard refusing to commit secrets** to git-tracked settings is exactly the kind of fail-closed default the dotfiles publishing-policy comment in agentbrew TASKS.md endorses. Watch if it grows past 100⭐ or claims an agent count past 10. |
| atk (Svtoo/atk) | 2026-04-26 | 13 | NEW. Python CLI on PyPI (`atk-cli`), distributed via `uv tool install`, MIT. "AI Tool Kit for Developers — a CLI plugin manager for AI-assisted development." **Different layer than rules-sync**: atk is a **registry-and-install** tool for MCP servers + local AI services (Docker, CLI binaries) that wires them into multiple coding agents at once. 5 agents (Claude Code, Codex, Gemini CLI, Augment Code / `auggie`, OpenCode). 11 curated registry plugins: fetch, git-local, github, gitlab, google-workspace, langfuse, notion, openmemory, piper (TTS), playwright, slack. Distinguishing capabilities: (a) **`atk mcp add github --claude --codex --gemini --auggie --opencode`** wires one MCP into multiple agents in a single command, calling each agent's native MCP-registration command (`claude mcp add` / `codex mcp add` / `gemini mcp add` / `auggie mcp add-json`) or writing config files directly; (b) **skill injection** — plugins ship a `SKILL.md` describing how to use the tool, and atk injects it into each agent's context (`@`-references in CLAUDE.md, read-directives in AGENTS.md, symlinks in `~/.gemini/skills/` / `~/.augment/rules/`, entries in opencode.jsonc instructions); (c) **lifecycle commands** (`atk start / stop / logs / upgrade / remove`) provide a uniform interface for Docker services, MCP servers, CLI binaries; (d) `~/.atk/` is **a git repository by default** — push it, clone on another machine, `atk install --all` restores everything; (e) **schema-validated curated registry** with version tracking; (f) `atk help <plugin>` renders the plugin README in-terminal. Tier 1 / Keep separate — not a rules/skills sync tool, but a peer in the MCP-management space (mcpm.sh / install-mcp / Alph) with **skill injection** as the unique twist. Two absorbable ideas worth tracking: (1) the **wire-into-multiple-agents-via-native-commands** pattern instead of writing config files directly — cleaner than agentbrew's mcp-sync because it relies on each tool's own validation; (2) the **plugin SKILL.md auto-injection** is exactly the pattern `agentbrew install <name>` could adopt for MCP servers that ship usage instructions — today agentbrew installs MCP configs but has no equivalent of the SKILL.md-as-context-extension flow. Watch if it grows past 50⭐ or expands the registry past 30 plugins. |
| skills-compat-manager (hnaymyh123-henry/skills-compat-manager) | 2026-04-26 | 1 | NEW. Python (per task description). README returns 404 at `main` branch — likely the repo has been deleted, renamed, or had its README removed since the task was filed. Per the task description: "Cross-platform compatibility layer for AI agent skills — pre-flight dependency checks, MCP-native, works with Claude Code, Cursor, Codex CLI." Tier 4 / Out of scope until the repo is reachable. Re-evaluate if a working README appears or the repo gets star-traction. The pre-flight-dependency-check angle from the description sounds plausibly novel — if the project resurfaces, deep-dive again because that idea overlaps with agentbrew's `agentbrew doctor` / health-check direction. |
| nix-agentic-tools (higherorderfunctor/nix-agentic-tools) | 2026-04-26 | 0 | NEW. Nix flake monorepo, Unlicense (public domain). Per task description: "stacked workflow skills, MCP server packages, and home-manager modules for AI coding CLIs." README is one sentence ("A Nix flake monorepo for AI coding CLI tools."); no command reference, no documentation of what's actually inside. Tier 4 / Out of scope — packaging-paradigm tool (Nix home-manager modules) for a different audience than agentbrew (CLI/Node ecosystem). Even if the home-manager-module approach turned out to be interesting, the user base overlap with agentbrew is near-zero (Nix-on-the-laptop is a niche-of-a-niche). The fact that the README is empty after 'updated within 2 days' suggests this is an experimental fork, not a polished tool. No deep-dive needed unless it grows past 20⭐ or publishes documentation. |
| Agent Deck (asheshgoplani/agent-deck) | 2026-04-26 | 2.1K | NEW. Go 1.24+ TUI (terminal session manager), MIT, macOS/Linux/WSL. 234 forks, 1,886 commits, active Discord community. **Mission control for multiple AI agent sessions** — tmux-style session organization for Claude Code, OpenCode, and other agents. Operates almost entirely within its own `~/.agent-deck/` namespace. Distinguishing capabilities relative to agent-config-sync: (a) **session-level fork** (`f`/`F`) creates a Claude conversation fork inheriting full history; (b) **MCP Manager** UI toggles MCP servers on/off per project from a config-defined pool, restarts the session automatically; (c) **Skills Manager** UI attaches/detaches Claude skills per-project from `~/.agent-deck/skills/pool/`, materializes the chosen subset into the project's `.claude/skills/`; (d) **MCP Socket Pool** shares MCP processes across sessions via Unix sockets (claims 85-90% memory reduction); (e) **per-group / per-conductor Claude config** overrides (`CLAUDE_CONFIG_DIR`, `env_file`) so different sessions can authenticate against different Claude accounts; (f) **git worktree management** (`agent-deck add . --worktree feature/a --new-branch`); (g) status detection (running/waiting/idle/error) + tmux notification bar; (h) `agent-deck conductor setup` first-class conductor entities. Per the task description's classification rule ("If it stays in its own `~/.agent-deck/` namespace, it belongs in Tier 6 (Adjacent Infrastructure — session manager) and is explicitly NOT a competitor"): Agent Deck materializes Skills into `.claude/skills/` per project (a small touch into Claude Code's territory) but its primary state lives in `~/.agent-deck/`, the agent set is Claude-Code-centric, and the entire UX is per-session orchestration not cross-tool config-sync. Verdict: **Tier 6 / Adjacent Infrastructure** — session manager / runtime orchestration layer, not a config-sync competitor. agentbrew operates one layer below (provisions the configs that Agent Deck's per-session toggles select from). The two compose: an Agent-Deck user could pull MCPs/skills from agentbrew's catalog into their `~/.agent-deck/skills/pool/`, then use Agent Deck's TUI to attach them per session. No absorbable feature from agentbrew's perspective; the conductor / MCP-socket-pool / per-group-Claude-config mechanisms are runtime concerns. |
| Tons of Skills / ccpi (jeremylongshore/claude-code-plugins-plus-skills) | 2026-04-26 | 2K | NEW. CLI `@intentsolutionsio/ccpi` on npm + marketplace site at tonsofskills.com. 266 forks, 1,115 commits, updated within 24h. **Largest skill marketplace by count we have seen**: 423 plugins, 2,849 skills, 177 agents, 16 community contributors. 26 published packages in the `claude-code-plugins` namespace. Sponsored by nixtla.io. **Claude Code-only** — plugins follow Claude Code's `/plugin marketplace` format. Distribution: `pnpm add -g @intentsolutionsio/ccpi` then `ccpi install <plugin>`, OR `/plugin marketplace add jeremylongshore/claude-code-plugins` + `/plugin install <name>@claude-code-plugins-plus`. 18 categories (AI/ML, AI Agents, API Development, Business Tools, Crypto/Web3, Database, DevOps, Design, MCP Servers, Performance, Productivity, SaaS Skill Packs (106 plugins!), Security, Skill Enhancers, Testing, etc). Live npm download stats published in the README via daily GitHub Actions. "Killer Skill of the Week" curation feature with editorial picks. Tier 3 / Complementary — same bucket as skills.sh / mdskills.ai / OpenClaw / `@ay-claude/cli`: registry + CLI front-end for ONE agent (Claude Code). Doesn't compete with agentbrew's cross-agent sync mission. Active commercial entity (intentsolutionsio) with sponsor relationship and editorial curation — strongest sustained marketplace momentum in this segment. **Decision**: per the P3 `catalog-registry-source` task direction, when agentbrew adds external-registry catalog sources it should query tonsofskills.com alongside skills.sh as a primary source for Claude Code skills (this is the largest catalog by plugin count). No agentbrew code change needed today; flagged for the future `catalog-registry-source` implementation. The ccpi CLI itself is Claude-Code-only with no observable cross-agent intent, so no risk of overlap with agentbrew's ownership boundary. |
<!-- competition-freshness:end -->

### What to Watch For

- **Caliber** (`@rely-ai/caliber`, 933⭐, v1.49.3): The most credible *problem-space* competitor — attacks the same "my agent configs drift from my code" pain but with LLM-generation instead of curation-and-sync. Ship cadence is extreme (~60 releases in 2 months). Signals that would change the verdict: adds user-level machine config (`~/.caliber/<global>`), adds drift detection for configs it didn't write, agent count grows past 10, launches hosted service / paid tier, or publishes a funding announcement. **Escalation from "Keep separate" to direct competition happens if Caliber adds the agentbrew surface.** Today they are complementary — VISION should document the coexistence markers explicitly.
- **Bridle** (`neiii/bridle`, 418⭐, v0.2.9 — last release 2026-01-30): Distinctive whole-harness profile system (work/personal/minimal) + Rust TUI + GitHub-URL install with interactive multi-select. Real usage is tiny (44 monthly npm, 64 recent crates.io downloads). Signals to watch: release cadence resumes (3-month gap today), adds drift detection, adds agent count beyond 7, adds rules managed-section injection. If bridle goes dormant permanently, its `harness-locate` Rust crate is still worth periodic cross-check for path-table accuracy against our `src/core/agents.yaml`.
- **skills CLI**: Now a full package manager (`update/check/find/remove/list/init` + lock file v3). v1.4.9 added snapshot download (faster installs) and openclaw malicious skill warnings. 16.7K stars and 54 agent targets (consolidated from 49+). If they add MCP sync, rules, or drift detection, direct competition.
- **Compound Engineering**: The GitHub repo is still 404, but the pre-404 snapshot showed MCP server sync and 10+ sync targets. If the product reappears outside GitHub, it is still worth watching. Still Claude Code-dependent.
- **anthropics/skills**: 126.9K stars and 14.9K forks (still growing). Anthropic owns the Agent Skills spec. Watch for official skill management CLI, sync features, or marketplace from Anthropic directly. Would be an existential threat.
- **vsync**: Small (43 stars). Watch mode in v1.3, web UI in v2.0 roadmap. Low threat.
- **MCPM**: v2.0 shipped. Usage analytics + public sharing. Profile-based MCP management becoming default pattern.
- **Native agent support**: VS Code, Cursor, Copilot adding built-in skill/MCP discovery UI.
- **Standards**: agentskills.io evolution, MCP registry GA, `.agents/` convention spreading. Sentry's Warden + Anthropic's own repo validate the standard.
- **OpenClaw + Chops**: OpenClaw is becoming the default skill registry with thousands of skills. Chops as GUI frontend is gaining traction (1.3K stars). If Chops adds sync/drift detection, it would overlap AgentBrew's core. Watch `~/.agents/skills` convention spreading.
- **GitAgent**: Git-native agent standard (2.8K stars). Adapters for claude-code, cursor, openai, crewai, openclaw. Currently single-agent definition, but if they add multi-agent sync or drift detection, direct competition. Watch for adoption of their `agent.yaml` + `SOUL.md` convention. Compliance features (FINRA, SEC) interesting for enterprise.
- **Warden**: Sentry-backed code review runner consuming SKILL.md. Watch for skill marketplace, trigger system evolution, and whether they add skill management (would overlap AgentBrew)
- **New entrants**: Any tool that tries to unify config + skills + MCP + rules
- **Smithery**: Skill reviews/voting, OAuth auth, tool introspection (could set UX expectations)
- **ai-rules-sync**: Git-based rule sharing, web dashboard draft, per-project + user-level sync
- **block/ai-rules**: Block (Square) backing. Rules-focused, 10+ agents, Go binary. Could grow fast with corporate support.
- **skillfile**: Lock file + patching is genuinely novel. Watch for agent count growth and MCP support.
- **OpenViking**: Volcengine (ByteDance) context database. 23.3K stars. Not competing on config sync, but their tiered context loading (L0/L1/L2) and filesystem paradigm for skills are interesting patterns. Could become an MCP server in the catalog.
- **New entrants**: ruler, syncai, AlignTrue — small but watch for traction

---

## Competitor Landscape

### Tier 1 -- Direct Competitors (cross-tool config sync)

| Tool | Maker | Type | Key Angle | Research | Verdict |
|------|-------|------|-----------|----------|---------|
| **Caliber** (`@rely-ai/caliber`) | Rely AI | CLI (npm) + GitHub Action | **LLM-driven project-scoped context generator.** 933⭐, v1.49.3, still shipping rapidly. 5 agents (Claude Code, Cursor, Codex, OpenCode, GitHub Copilot). Deterministic 100-point scoring across 6 categories, session learning via hooks → LLM → `CALIBER_LEARNINGS.md`, score-regression auto-revert, audit-first workflow (score → propose → review → backup → undo), `.caliber/manifest.json` tracks every write, 7-provider LLM abstraction (Anthropic SDK/Vertex, OpenAI-compat, Claude CLI as proxy, Cursor ACP, OpenCode, MiniMax). PostHog telemetry. Rely AI commercial entity (caliber-ai.dev "Agentic Control Plane"). Writes project-local only (CLAUDE.md / .cursor/rules/ / AGENTS.md / .mcp.json); `~/.caliber/` holds only auth + personal learnings. | Done | **Keep separate** — fundamentally different architectural bet: LLM generator + per-project scope vs agentbrew's curator + user-level-sync. <15% LOC overlap. LLM dependency is disqualifying for agentbrew (violates "no required external API" stance). Enhancement-on-top requires rebuilding 85% of agentbrew anyway. Upstream roadmap (more LLM providers, session learning ROI) would reject drift detection + 45-agent support as off-scope. Five absorption candidates were originally scoped (deterministic scoring, path-scoped rules, session learning, claude-CLI-as-LLM-provider, coexistence markers) but **deferred under the delegate-first strategy pivot** ([VISION.md § Delegate, contribute, absorb](VISION.md)) — kept in this doc for context only. |
| **Bridle** (`neiii/bridle`) | d0x | Rust CLI + TUI (npm + crates + homebrew + cargo) | **Whole-harness profile manager.** 418⭐, 26.8K Rust LOC across 3 crates (`bridle` + `harness-locate` + `skills-locate`), v0.2.9 (last release 2026-01-30). 7 harnesses (Claude Code, OpenCode, Goose, Amp, Copilot CLI, Crush, Droid). Profiles per harness (work/personal/minimal) — `profile create --from-current` snapshots config, `profile switch` copies snapshot into harness dir. Install from GitHub `owner/repo` URL with ratatui TUI multi-select picker. MCP Community Registry API client. **Real usage is tiny**: crates.io 244 total / 64 recent downloads, npm 44 monthly / 6 weekly. Single maintainer + 2 occasional contributors. No drift detection, no curated catalog, no rules managed-section injection, no commands format transform, no hooks sync, no agent definitions sync, no team config, no lock file, no LLM. | Done | **Keep separate** — ecosystem mismatch (Rust ↔ TypeScript makes in-process integration impractical), project stagnant (3-month release gap), real adoption is 64 recent crate downloads (below any meaningful usage threshold), and agent surface (7) is 38 agents short of agentbrew's agent matrix. Rebuilding agentbrew on top of `harness-locate` would require ~28K new Rust LOC to save ~11.5K LOC of path-resolution work — the math fails. Three absorption candidates were originally scoped (whole-machine profile system + interactive multi-select picker were **deferred under the delegate-first strategy pivot**, see [VISION.md § Delegate, contribute, absorb](VISION.md); the harness-locate path audit shipped 2026-04-26 — see [`docs/audits/harness-locate-cross-check.md`](audits/harness-locate-cross-check.md), no path corrections needed in agentbrew, two scout tasks filed for env-var overrides and a Bridle upstream issue). |
| **vsync** | nicepkg | CLI (npm) | Sync MCP, skills, agents, commands across Claude Code, Cursor, OpenCode, Codex. Claude Code as source of truth. Format conversion. 43 stars (previously overstated as ~2K). v1.1 current, roadmap v1.3 watch mode. | Done | **Keep separate** — Claude-Code-as-source is architecturally incompatible with agentbrew's agent-agnostic YAML state; 35 stars, small. |
| **Compound Engineering** | Every Inc | Claude Code plugin + CLI | **Live at EveryInc/compound-engineering-plugin** (22.7K★, 2026-07-06). 29 workflow skills — brainstorm→plan→work→review, ce-compound knowledge accumulation, multi-agent review, worktrees. Syncs to Codex, Cursor, and more via plugin install paths. Indexed in agentbrew catalog. | Done | **Complementary curated source** — agentbrew indexes pointers (G1); upstream still Claude Code–centric for plugin install. Revisit if upstream adds drift detection or declarative config. |
| **skills CLI** | Vercel Labs | CLI (npm) | Universal skill manager. `npx skills add/update/check/find/remove/list/init`. 16.7K stars, 54 agent targets, 80+ contributors. Lock file v3 (skillFolderHash). skills.sh directory + leaderboard. Security risk assessment. Becoming a full package manager. | Done | **Contribute — delegation shipped, parent task retired 2026-04-28 (split shipped: delegated targets → `npx skills add`, native carve-outs in routing matrices).** Slices 2–12 of the (now-retired) `delegate-skill-install-to-skills-cli` parent landed across PRs #790, #804, #805, #806, #807, #808, #809, plus PR #810 (slice 7: confirmed `cloneAndIndexRemoteSource` is permanent post-delegation because the carve-outs `claude-desktop` / `overlay-desktop` still stay native). The 5 `absorb-*-from-skills-cli` siblings closed under slices 8–12. Residual hardware-bound proxy / sandbox / offline measurement closed 2026-05-02, and the same refresh removed `devin` from the native carve-out set because skills CLI now supports it. |
| **ai-rules-sync** | lbb00 | CLI (npm) | Sync rules, skills, commands, subagents across Cursor, Copilot, Claude Code, Trae, OpenCode, Codex, Gemini, Warp, Windsurf, Cline, Universal (AGENTS.md). 10+ tools total. Git-based team sharing, per-project + user-level sync. Supports `.agents/skills/` convention. Homebrew install. 27 stars. | Done | **Keep separate** — stagnant (last push 2026-03-16, 24 stars). Contributing to a dormant project is wasted effort. |
| **block/ai-rules** | Block (Square / Cash App) | CLI (**Rust binary**) | Manage rules, commands, and skills across 10+ agents from a single source. `ai-rules generate`. Status check for drift. MCP config generation. Symlink mode. 96 stars. v1.6.0. Apache-2.0. Self-contained binary install via curl. | Done 2026-04-27 | **Contribute (selective delegation, wrapper-around-output model).** Two parallel delegation tracks landed: (a) **rules** — all 4 slices of [`evaluate-delegate-rules-to-block-ai-rules`](competition/block-ai-rules-vs-agentbrew.md) shipped (strict-intersection and free-capability agents delegate; native carve-outs documented in routing matrices); (b) **commands** — all slices of `delegate-commands-to-ai-rules` shipped 2026-04-27 (PRs #885, #889, #890, #891, #892) wiring delegated agents per the commands routing matrix; native carve-outs (windsurf, devin, gemini-cli, claude-desktop transitive, opencode) stay documented in routing tests. Both execution paths shipped: (a) rules — the (now-retired 2026-04-28) `delegate-rules-to-ai-rules` parent task (slices 1–5, 7 + slice 6b filed at block/ai-rules#91; residual slice 6a publish in [`delegate-rules-to-ai-rules-slice-6a-followup`](TASKS.md)); (b) commands — the closed `delegate-commands-to-ai-rules` task. |
| **skillfile** | eljulians | CLI (Rust binary) | Declarative Skillfile manifest + lock file (SHA pinning) + patch system. Search large skill registries. 8 platforms. URL source, guided wizard, split-pane TUI, `status --check-upstream`. 115 stars. | Done | **Keep separate** — ecosystem mismatch (Rust); three best ideas (lock file, patch system, per-project manifest) already absorbed (see Gap Analysis). Nothing left to contribute. |
| **akm (Agent Kit Manager)** | itlackey | CLI (npm `akm-cli` + standalone binary) | "Package manager for AI agent capabilities" — broader scope than agentbrew: scripts, skills, commands, agents, knowledge, workflows, vaults, wikis, **memories**. 40⭐, 548 commits, very active solo project. MPL-2.0. Cross-tool ("any AI assistant that can run shell commands") — works via prompts in AGENTS.md/CLAUDE.md, optional plugin for OpenCode. **Distinguishing capabilities**: (a) website crawling — `akm add https://docs.example.com` indexes pages as searchable knowledge; (b) feedback/usage tracking — `akm feedback skill:deploy --positive/--negative` records which assets actually helped; (c) registry concept — official + private + skills.sh integration; (d) `akm clone` copies any asset from stash or remote into a target dir. Plugin SDK for custom registries/sources. | Done | **Keep separate** — broader scope than agentbrew (vaults/wikis/memories/website-crawling are out of scope per VISION.md "config-sync, not knowledge management"). Single agent surface convention is "tell your agent about `akm` in its prompt" — fundamentally different model from agentbrew's managed-section sync into agent config files. Two ideas worth watching as they mature: feedback-tracking-as-skill-quality-signal and website-as-skill-source. Re-evaluate if akm grows past 500⭐ or if "akm vs agentbrew" comes up from a real user. |
| **syncode** | donnes | CLI (npm `@donnes/syncode`, Bun) | Agent config manager for 17 agents (Amp, Antigravity, Claude Code, Clawdbot, Codex, Cursor, Droid, Gemini CLI, GitHub Copilot, Goose, Kilo Code, Kiro, OpenCode, Roo Code, Trae, VSCode, Windsurf). Git-repo-as-source-of-truth model: clones a config repo and **symlinks the entire agent dir** (or copies for Claude/Gemini, which preserve agent caches). `syncode sync` is bidirectional (Import/Export). Auto-detects installed agents at `new`. Includes `syncode machine deps` opinionated `install.sh` for dev tooling. macOS/Linux only (Windows planned). MIT, Bun-first build. Modest: a few stars / one maintainer. | Done | **Keep separate** — different model: full-directory sync overwrites the entire agent config dir, vs agentbrew's managed-section sync that surgically writes only the blocks it owns. syncode's approach is faster to bootstrap on a fresh machine but riskier on an existing one (machine-A `syncode sync` after machine-B's edits could clobber unrelated changes). agentbrew's user-stories explicitly forbid destroying user content — syncode's full-copy model conflicts with that constraint. The 17-agent list mostly overlaps agentbrew's agent matrix — no novel agent target to absorb. Watch for: machine-deps-as-skill (`install.sh` boilerplate as a deployable skill) — interesting precedent for agentbrew if the dotfiles + agentbrew composition story needs sharpening. |

### Tier 2 -- MCP-Focused Tools

| Tool | Maker | Type | Key Angle | Research | Verdict |
|------|-------|------|-----------|----------|---------|
| **MCPM** | Path Integral | CLI (Python) | MCP package manager + registry. 938 stars. v2.14.0 (2026-03-27). Global config, virtual profiles, 14 clients (`mcpm client ls` 2026-04-26: Claude Code, Claude Desktop, Cline, Continue, Cursor, Goose CLI, Roo Code, VSCode, Windsurf, 5ire, Codex CLI, Gemini CLI, Qwen CLI, Trae). Usage analytics. AI Agent friendly (llm.txt). Public sharing via tunnels. 28 contributors; 380-server registry; MIT. | Done 2026-04-27 | **Contribute (selective delegation, split-intersection model).** All 4 slices of [`evaluate-delegate-mcp-to-mcpm`](competition/mcpm-sh-vs-agentbrew.md) landed: 9 strict client-intersection / 3 small adapters as upstream contribution candidates / 2 hard carve-outs. Execution path tracked by new P0 task `delegate-mcp-to-mcpm`. |
| **Composio Connect** | Composio | Hosted MCP (HTTP) | **1,000+ SaaS apps** (Gmail, Notion, Slack, GitHub, Linear, HubSpot, Jira, …) through one MCP endpoint at `connect.composio.dev/mcp` with 7 meta-tools and managed OAuth. Consumer key auth (`ck_...`). Alternatives: Arcade.dev, Scalekit. | Done 2026-07-06 | **Delegate (catalog pointer)** — agentbrew registers one `composio` catalog entry instead of maintaining per-vendor connector MCP entries + setup wizards. GET the connector outcome; keep bespoke MCPs (Sourcegraph, Context7, org-internal) as-is. |
| **Smithery CLI** | smithery-ai | CLI (npm) | MCP + skills registry. 703 stars. Hosted registry with auth (OAuth), tool introspection, skill reviews/voting, publishing. Skills support added. AGPL-3.0. | Done | **Complementary** — hosted-registry design; use as a catalog source, not a replacement. |
| **install-mcp** | supermemoryai | CLI (npm) | One-shot MCP server install into any client. OAuth auth for remote servers. 182 stars. | Done | **Complementary** — install-only, no management. Could be a backend for one-shot install of unknown MCP servers. |
| **MCP Dock** | OldJii | Desktop app | Cross-platform MCP server manager. One-click install, multi-client sync, curated registry. GUI-first. | Done | **Complementary** — GUI; VISION.md commits to CLI-first. |
| **MCP Dockmaster** | dcSpark | Desktop app | "App Store for AI tools." Browse, install, manage MCP servers with GUI. | Done | **Complementary** — GUI; VISION.md commits to CLI-first. |
| **MCP Server Manager** | vlazic | Web app (Go) | Single-binary, web GUI on localhost:6543. Cross-platform. | Done | **Complementary** — web GUI; different paradigm. |
| **Alph** | Aqualia | CLI (npm, TypeScript) | "Universal MCP Server Configuration Manager." 6 agents (Gemini CLI, Cursor, Claude Code, Windsurf, Codex CLI, Kiro). Local-first atomic writes with timestamped backups + rollback, validation. STDIO/HTTP/SSE transports. Auto-installs STDIO tools via npm/brew/pipx/cargo. Cross-platform (macOS/Linux/Windows). 61⭐. MIT. | Done | **Complementary** — narrower than MCPM (6 vs 10+ clients) but more polished UX (atomic+rollback+auto-install). Nothing novel that MCPM/install-mcp don't have at the strategic level; the atomic-writes-with-backup pattern is worth absorbing if MCPM doesn't already have it. Same Tier 2 niche. |

### Tier 3 -- Skills-Focused Tools

| Tool | Maker | Type | Key Angle | Research | Verdict |
|------|-------|------|-----------|----------|---------|
| **Skills Manager** | xingkongliang | Desktop app (Electron) | GUI for managing skills across 15+ tools. Central repo at ~/.skills-manager. Scenarios, tagging, git backup. | Done | **Complementary** — GUI-only, Electron, 975 stars; VISION.md commits to CLI-first. |
| **mdskills.ai** | mdskills | Web directory | Skills marketplace + docs. Browse, search, one-command install. 27+ agents. | Done | **Complementary** — data source candidate. The `registry-search.ts` adapter was deleted 2026-04-24 (never wired into a CLI command); see `catalog-registry-source` (P3) for the canonical integration path. |
| **agent-config-sync** | liamdmcgarrigle | Claude Code skill | Skill that sets up vsync + npx skills + git submodules. Claude Code as source of truth. | Done | **Keep separate** — thin Claude-Code skill wrapping vsync; not a tool. |
| **awesome-codex-subagents** | VoltAgent | Skill catalog (GitHub) | 130+ Codex-native `.toml` subagents across 10 categories. Model routing, sandbox modes. Manual `cp` install to `~/.codex/agents/`. Not a tool — a curated source. | Done | **Complementary** — curated skill source; could be added as a catalog source once Codex agents-sync lands. |
| **Warden** | Sentry (getsentry) | CLI (npm) + GitHub Actions | AI code review runner using agentskills.io SKILL.md format. Reads from `.agents/skills/` and `.claude/skills/`. Trigger system (`warden.toml`) with path globs, PR events, cron schedules. Severity levels, auto-fix, inline PR comments. Read-only skill execution (enforced). Remote skills from GitHub repos. Uses Anthropic Claude. 191 stars. FSL-1.1-ALv2 license. **Not a competitor** — complementary. AgentBrew manages which skills are installed; Warden uses those same skills for code review. Validates agentskills.io as industry standard. | Done | **Complementary** — code review runner that consumes SKILL.md. AgentBrew installs; Warden runs. Validates the agentskills.io standard. |
| **Chops** | Shpigford (Josh) | macOS app (SwiftUI) | GUI skill browser/editor/organizer. Scans same dirs as AgentBrew (`~/.claude/skills/`, `~/.cursor/skills/`, `~/.cursor/rules`, `~/.codex`, `~/.config/amp`, `~/.codeium/windsurf/memories/`, `~/.windsurf/rules`, `~/.agents/skills`). Also Copilot + Aider (project-level only). Collections, full-text search, real-time FSEvents file watching. Parses both YAML frontmatter (.md) and Cursor .mdc files. **Symlink-aware** — correctly deduplicates AgentBrew's symlinked skills. Remote skill install via [OpenClaw](https://openclaw.ai) (thousands of skills, vector search, VirusTotal scanning). No sync, no drift detection, no MCP management — browse/edit/install only. 1.3K stars, MIT. By Josh Shpigford (Baremetrics founder). **Complementary** — GUI companion to AgentBrew's CLI. VISION.md says "not a desktop app" — Chops fills that niche without competing on sync/config. Notable: scans `~/.agents/skills` (convention AgentBrew doesn't yet track). | Done | **Complementary** — GUI companion; symlink-aware so it coexists cleanly with AgentBrew's sync. |
| **OpenClaw / ClawHub** | OpenClaw | CLI (npm) + web registry | Skill registry with thousands of skills. `npx openclawskill install <name>`. Vector search, version control, VirusTotal security scanning. Python SDK (clawhub on PyPI). Chops uses it as a remote skill server. Community-curated (VoltAgent/awesome-openclaw-skills). Largest skill marketplace by count. **Potential integration** — `agentbrew search` could query OpenClaw alongside the existing catalog. VISION.md: "use existing registries, don't build your own." | Done | **Complementary** — largest skill registry by count. Add as a catalog source so `agentbrew catalog --search` queries it (integration target, not replacement). |
| **GitAgent** | open-gitagent | CLI (npm) + spec | Git-native open standard for defining AI agents. Entire agent = git repo (`agent.yaml` + `SOUL.md` + `RULES.md` + `skills/` + `tools/` + `workflows/` + `memory/` + `compliance/`). Framework adapters: claude-code, cursor (.mdc), openai, crewai, lyzr, openclaw, opencode, nanobot. `gitagent export --format claude-code` deploys to agents. `gitagent skills search/install`. Compliance-first (FINRA, SEC, Federal Reserve, segregation of duties). Inheritance & composition (agents extend parent agents). 2.8K stars in the protocol repo, early, MIT. **Different layer** — GitAgent defines one agent as a portable repo; AgentBrew manages all your agent configs across all frameworks simultaneously. Overlap: both export to multiple agents, both manage skills. If GitAgent adds multi-agent sync + drift detection, it would compete directly. For now, complementary — AgentBrew could import/export GitAgent format. | Done | **Complementary** — single-agent portable repo vs agentbrew's multi-agent config manager. Different layer; watch for multi-agent-sync features. |
| **skillpm** | sbroenne | CLI (npm) | "npm-native package manager for Agent Skills." Uses npm registry as the distribution channel: `skillpm install` runs npm install + scans `node_modules/` for `skills/*/SKILL.md` + delegates to vercel-labs/`skills` CLI to wire into agent dirs. `skillpm publish` validates the agentskills.io spec and publishes to npmjs.org. Workspace monorepo support (skill packages as first-party). Pass-through to npm for any non-skillpm command. 8⭐, MIT, TypeScript. Distinguishing idea: **npm semver as the versioning scheme** for skills (vs git SHA pinning that agentbrew + skillfile use). | Done | **Complementary** — npm-publishing front-end on top of `skills` CLI. Doesn't compete with agentbrew (different distribution channel — npm registry vs git URL). The npm-semver-for-skills idea is interesting but agentbrew's git-SHA pinning is more reproducible across forks. No absorbable feature today. |
| **faf-cli** | Wolfe-Jam | CLI (npm `faf-cli`, Bun, Homebrew) | "The package.json for AI Context." Defines a new YAML format (`.faf`, IANA-registered as `application/vnd.faf+yaml`) for project-level AI context, plus 26 commands to author / score / sync / export. **Bi-sync** between `.faf` and `CLAUDE.md` (8ms); tri-sync to `CLAUDE.md` + `MEMORY.md`. Auto-detects project type (MCP, fullstack, svelte, frontend, backend, cli, library) and activates relevant slots. Reads project metadata from `package.json`, `pyproject.toml`, `Cargo.toml`. Generates `AGENTS.md` / `.cursorrules` / `GEMINI.md` from the `.faf` source. WASM scoring kernel rates AI-readiness 0-100%. Compile to single-file binary (`.fafb`) for air-gapped use. **51K+ npm downloads**. MIT, 402 tests, very active. | Done | **Complementary** — different layer: faf-cli **creates** the canonical AI-context content; agentbrew **syncs** content (skills, MCP, rules) across agents. They compose: a user could run faf-cli to generate `AGENTS.md` for one project, then point agentbrew at that file as a source. **Architectural disagreement worth documenting**: faf-cli treats bi-directional sync (`.faf` ↔ `CLAUDE.md`) as a feature; agentbrew's VISION.md treats bi-directional sync as a non-goal because the source-of-truth ambiguity creates merge conflicts. Two different opinions on the same problem; users pick based on their risk model. |

### Tier 4 -- Dotfiles / DIY Patterns

| Tool | Maker | Type | Key Angle | Research | Verdict |
|------|-------|------|-----------|----------|---------|
| **dotfiles + agent config** | Community pattern | Dotfiles | Multiple blog posts about managing CLAUDE.md, .cursorrules, MCP configs via chezmoi/dotfiles. Manual setup, no marketplace. | Done | **Complementary** — manual pattern; agentbrew automates what dotfiles do by hand. Users can still commit their `~/.config/agentbrew/state.yaml` to a dotfiles repo. |
| **knowhub** | yujiosaka | CLI (npm) | Sync knowledge files (rules, templates, guidelines) across project. Copy/symlink + remote URLs. Plugin system. 41 stars. Inactive since July 2025. | Done | **Keep separate** — inactive since July 2025; scope-misaligned (not agent-aware). |
| **update-chezmoi skill** | nijaru | Claude Code skill | Automates chezmoi apply for agent config propagation. Single-machine focus. Outdated pattern. | Done | **Keep separate** — outdated single-machine pattern; agentbrew handles this natively. |

### Tier 5 -- Platform-Native (built into IDEs)

| Tool | Maker | Type | Key Angle | Research | Verdict |
|------|-------|------|-----------|----------|---------|
| **anthropics/skills** | Anthropic | Skill repo + spec | **126.9K stars**, 14.9K forks. The official Agent Skills specification + production skills (docx, pdf, pptx, xlsx). Partner skills program. Apache 2.0 (mostly). The canonical source for the agentskills.io ecosystem. Not a competitor — the foundation everything else is built on. | Done | **Complementary** — the spec agentbrew is built on; catalog already points at these skills. |
| **VS Code skill locations** | Microsoft | IDE setting | `chat.agentSkillsLocations` setting discovers skills from configured paths. No sync. | Done | **Complementary** — IDE setting; agentbrew's symlinks land in the discovery paths. |
| **Cursor Marketplace** | Anysphere | IDE marketplace | Built-in marketplace for skills, rules, MCP. Launched Feb 2026. Cursor-only. | Done | **Complementary** — Cursor-only IDE marketplace; agentbrew operates across every supported agent. |
| **Claude Code Marketplace** | Anthropic | Plugin system | 41+ plugins (skills, MCP, hooks). Claude Code-only. | Done | **Complementary** — Claude-Code-only plugin system; agentbrew is multi-agent. |
| **mcpick** | spences10 | CLI (npm, TypeScript) | Claude Code extension manager — toggles MCP servers on/off, manages plugins/skills/hooks/agents/marketplaces. Reads/writes `~/.claude.json` and `~/.claude/plugins/` directly. Profiles, backups, plugin cache, interactive TUI + non-TTY structured help for LLM agents. Pitched at fixing Claude Code's "all MCPs load at startup" token-bloat problem. Node.js 22+, requires Claude Code installed. 72⭐, ~139 commits, 3 contributors, updated within 24h. | Done | **Complementary** — Claude-Code-only plugin/MCP toggle. Agentbrew is multi-agent and writes managed sections; mcpick is single-agent runtime control of which servers load. They overlap on "manage Claude Code MCP config" but mcpick's per-session toggle UX has no agentbrew equivalent (and no plan to add — that's runtime territory, not config-sync). |

### Tier 6 -- Adjacent Infrastructure (context databases, memory engines)

| Tool | Maker | Type | Key Angle | Research | Verdict |
|------|-------|------|-----------|----------|---------|
| **OpenViking** | Volcengine (ByteDance) | Python server + Rust CLI | Context database for AI agents. Virtual filesystem paradigm (`viking://`), tiered context loading (L0/L1/L2), directory recursive retrieval, auto session memory. 23.3K stars. | Done | **Complementary** — runtime context DB (RAG++), different problem domain. Potential MCP catalog entry for persistent agent memory. |
| **awesome-codex-subagents** | VoltAgent | Skill catalog (GitHub) | 130+ Codex-native `.toml` subagents. Not a tool — a curated source. Manual install. Reveals gap: AgentBrew doesn't manage `~/.codex/agents/`. **Decision (2026-03-25)**: `~/.codex/agents/` is officially documented at developers.openai.com/codex/subagents. Format: `.toml` with `name`, `description`, `model`, `model_reasoning_effort`, `sandbox_mode`, `[instructions]`. Global at `~/.codex/agents/`, project at `.codex/agents/`. Support is feasible but requires extending `agents-sync.ts` to handle multi-format targets (currently `.md` only). Deferred — add `agentsDir: ~/.codex/agents` to agents.yaml and update agents-sync when there is user demand. | Done | **Complementary** — curated skill source (duplicate Tier 3 entry); add as catalog source once Codex agents-sync lands. |
| **claude-peers-mcp** | louislva | MCP server (Bun/TS) | Ad-hoc messaging between Claude Code instances. Broker daemon on localhost:7899 + SQLite. Uses Claude `channel` protocol. 5 commits, 1 contributor. Requires `--dangerously-skip-permissions`. Optional OpenAI API for auto-summary. Too early and out of scope — inter-agent messaging is runtime territory, not config sync. | Done | **Keep separate** — runtime inter-agent messaging, out of scope for config sync. |
| **Context Hub (chub)** | Andrew Ng (andrewyng) | CLI (npm) + content repo | Curated, versioned API docs for coding agents. CLI fetches markdown docs by library/language. Local annotations persist across sessions (self-improving agents). Community feedback loop (up/down ratings). Includes agentskills.io `get-api-docs` SKILL.md. 11.8K stars, 247 commits, 22 contributors. MIT license. **Complementary** — agents AgentBrew manages can use `chub` to fetch accurate API docs instead of hallucinating. Natural catalog addition as a skill source. | Done | **Complementary** — runtime API docs; agents consume chub at runtime. Add as skill/MCP catalog entry. |
| **React Doctor** | Million.co (millionco) | CLI (npm) + GitHub Actions | React code health diagnostics — 60+ lint rules + dead code detection → 0–100 score. Framework-aware (Next.js, Vite, Remix). `install-skill.sh` is a **mini multi-agent installer** that writes SKILL.md to 9 agent directories (Claude Code, Cursor, Amp, Codex, Windsurf, Gemini CLI, OpenCode, Antigravity, `.agents/`). Validates AgentBrew's value proposition — they had to hand-code what `agentbrew install` does generically. **Ownership conflict**: writes directly to directories AgentBrew manages; drift detection would flag it. 5.9K stars, MIT. | Done | **Keep separate** — niche lint runner; writes directly to agent dirs (ownership conflict with agentbrew's sync; drift detection will flag it). |

---

## Build or Contribute? — Per-Competitor Summary

**Principle (from VISION.md: "Contribute first, build second"):** if an existing tool does 80%+ of what agentbrew does and the upstream is active and receptive, agentbrew should contribute the missing 20% there — or delegate via subprocess — rather than maintain a parallel implementation. Every competitor in the tier tables above carries one of three labeled verdicts in a **Verdict** column; this section summarizes the outcomes and names the concrete action for each.

### Verdict tally (40 entries across Tiers 1–6; `awesome-codex-subagents` appears in both Tier 3 and Tier 6)

- **Contribute: 1** — skills CLI (the only 80%+ overlap case with active, receptive upstream)
- **Keep separate: 14** — Caliber, Bridle, vsync, Compound Engineering, ai-rules-sync, block/ai-rules, skillfile, akm, syncode (Tier 1); agent-config-sync (Tier 3); knowhub, update-chezmoi (Tier 4); claude-peers-mcp, React Doctor (Tier 6)
- **Complementary: 25** — every other entry (now incl. mcpick — Tier 5; Alph — Tier 2; skillpm, faf-cli — Tier 3); different layer, or "recommend both"

### Top strategic question (resolved 2026-04-26 — answer is "yes, partially shipped")

**Should agentbrew delegate skill installation to skills CLI?** Answer: yes — and slices 2–12 of the (now-retired) `delegate-skill-install-to-skills-cli` parent shipped (PRs #790, #804, #805, #806, #807, #808, #809, plus PR #810 for slice 7; slices 8–12 closed the 5 absorption siblings 2026-04-27). The split ships **delegated targets → `npx skills add`**, with **native carve-outs** documented in routing matrices (`claude-desktop` shares `~/.claude/skills` with `claude-code` via `readsFrom` design upstream conflates; `overlay-desktop` is organization-internal). The cache-clone + index path (`cloneAndIndexRemoteSource` in `src/add-source.ts`) is permanent post-delegation because it feeds the native deploy step for those two carve-outs. The parent task retired 2026-04-28 mirroring `delegate-mcp-to-mcpm`'s PR #906 retirement; the residual hardware-bound proxy / sandbox / offline measurement closed 2026-05-02 with PASS results on the current enterprise macOS / Devin CLI session and warm offline cache. All 5 `absorb-*-from-skills-cli` siblings became no-ops for delegated targets (handled upstream) and either SUBSUMED or DEFERRED for the 2 carve-outs.

### Why "Keep separate" for the other direct competitors

Every other Tier 1 competitor either has an architectural mismatch (vsync / Compound require Claude Code as source of truth), an ecosystem mismatch (block/ai-rules = Go, skillfile = Rust), is stagnant (ai-rules-sync), or has already had its good ideas absorbed (skillfile). None of these are "build parallel because we're smarter" — they're specific, documented reasons why contributing would be wasted effort today.

### What triggers a re-evaluation

Re-run the verdicts when any of these signal changes happen:
- A "Keep separate (stagnant)" project resumes activity (new maintainer, corporate adoption, 2x star growth)
- A "Keep separate (ecosystem mismatch)" project gains a Node.js port or stable subprocess interface
- A "Complementary" tool adds sync + drift detection (then it's no longer a different layer)
- A new competitor emerges with 80%+ overlap and active upstream (→ probable "Contribute" verdict)

This check is part of the quarterly refresh cadence (see Review Cadence above).

---

## Deep Dives

### Caliber (`@rely-ai/caliber`)

**What it is:** A per-project LLM-driven context generator that analyzes your codebase and writes tailored `CLAUDE.md`, `.cursor/rules/`, `AGENTS.md`, `.mcp.json` into the project directory. Commercially backed by "Rely AI" (caliber-ai.dev "Agentic Control Plane"). 707⭐, v1.46.0, 20,552 non-test TS LOC, ~60 releases in 2 months, 12,737 monthly npm downloads, PostHog telemetry, 7-provider LLM abstraction.

**Source of truth:** YOUR CODEBASE — analyzed via the `src/fingerprint/` module (1,915 LOC, cached in `.caliber/cache/`). LLM-driven detection (no hardcoded framework mappings).

**Scope:** Project-local only. The only user-level state is `~/.caliber/` holding auth config, telemetry config, and personal learnings — all agent config output is written into the current project directory. Confirmed via `grep os.homedir` across all source files.

**Strengths:**
- **LLM-driven generation from codebase fingerprint.** A new hire running `caliber init` in an unfamiliar repo gets a `CLAUDE.md` that references real build commands, real test framework, real architecture. Agentbrew's declarative Agentfile cannot do this.
- **Deterministic 100-point scoring** across 6 categories (Existence 25 / Quality 25 / Grounding 20 / Accuracy 15 / Freshness 10 / Bonus 9). Zero LLM calls in scoring. Cross-references config files against actual filesystem. See `src/scoring/constants.ts:10-72` for per-check weights. No competitor does this.
- **Session learning loop** (`src/learner/`, ~700 LOC). Hooks in `.claude/settings.json` stream tool events and user prompts to `.caliber/sessions/*.ndjson`. On `SessionEnd`, an LLM distills events into categorized learnings (`[correction]`, `[gotcha]`, `[fix]`, `[pattern]`, `[env]`, `[convention]`, `[preference]`) written to `CALIBER_LEARNINGS.md`. Also no competitor does this.
- **7 LLM providers** including **Claude CLI as proxy** (`src/llm/claude-cli.ts`, 325 LOC) — a Claude Code user runs Caliber without configuring any new credentials. Cursor ACP provider (417 LOC) does the same via Cursor's Agent Client Protocol.
- **Score-regression auto-revert.** If `caliber regenerate` produces a lower score than before, changes auto-revert.
- **GitHub Action** (`action.yml`) — `mode: score` posts PR comments with score delta; `mode: sync` creates a PR with refreshed configs.
- **Per-file rule frontmatter** — Claude `.claude/rules/*.md` with `paths: [globs]` and Copilot `.github/instructions/*.instructions.md` with `applyTo:`. Genuine tiered loading via native agent mechanisms.
- **Audit-first workflow:** score → propose → review → backup → undo. `.caliber/manifest.json` tracks every file written with checksum + timestamp; `caliber undo` is reliable.

**Weaknesses:**
- **5 agents only** — Claude Code, Cursor, Codex, OpenCode, GitHub Copilot. Agentbrew covers every supported agent. Most AgentBrew agent targets are out of scope for Caliber, including Windsurf, Devin, Augment, Gemini CLI, Kiro, Amp, Goose, Cline, Roo Code, Trae, Junie, Continue, Warp, Qwen Code, OpenHands, and more.
- **Project-scoped only.** No user-level sync. If you work in 20 repos, Caliber makes you run `init` in 20 places. Agentbrew installs a skill once at the machine level.
- **LLM required.** Cannot run offline. Cannot run without API credentials. This disqualifies Caliber for CI-only, air-gapped, or credential-constrained environments.
- **No curated catalog.** `caliber skills --query/--install` uses an LLM to rank results from a remote registry. Network failure = no install.
- **No cross-agent commands sync, no hooks sync** (beyond Caliber's own hooks), **no agent definitions sync beyond CLAUDE.md-style instructions, no team config, no lock file, no export/import.**
- **Per-agent writers, not a translator layer.** `src/writers/claude/index.ts` (64 LOC), `src/writers/cursor/index.ts` (72 LOC), `src/writers/codex/index.ts` (37 LOC), `src/writers/github-copilot/index.ts` (33 LOC), `src/writers/opencode/index.ts` (36 LOC). Adding a 6th agent requires a new hand-written writer.
- **Pre-commit refresh only** for drift. No background scheduler. A user who hasn't committed in a week has stale configs.

**AgentBrew advantage:** every supported agent vs 5. User-level machine config vs per-project. Zero LLM dependency. Curated catalog pointers (see `src/catalog.yaml`). Background drift detection every 30 min via LaunchAgent/systemd/cron. Cross-agent commands/hooks/agent-definitions/instructions sync. Team config. Lock file. MCP run. team overlay.

**Caliber advantage:** Codebase-aware generation. Quality scoring with remediation. Session learning. Claude-CLI-as-provider. GitHub Action with auto-PR. No external catalog dependency at install time (they control their own registry API).

**Contribute vs Build paragraph:** **Keep separate. Contribution paths exist but aren't good deals.** Caliber is fundamentally a generator: it uses an LLM to derive project context from the codebase. Agentbrew is fundamentally a curator: it deploys human-curated skills from source repos. Merging either direction means abandoning the core bet. Caliber's upstream is active and well-engineered, but their roadmap (from v1.30–v1.46 changelog entries: OpenCode as LLM provider, MiniMax provider, Cursor ACP, session-learning ROI, monorepo-aware refresh) focuses on strengthening the generator and LLM coverage, not on cross-agent sync or drift detection. Agentbrew contributing "add drift detection to Caliber" would force them to maintain machinery that fights their own scope model (per-project, per-commit refresh). Agentbrew asking Caliber to "add 40 more agent targets" would force 40 per-agent writers, which violates their LLM-driven + translator-free philosophy. The useful ecosystem contributions are (a) a `caliber publish` format spec alignment and (b) a managed-section marker convention — neither is a moat. **Absorb 5 ideas without contributing code.**

**Ideas worth absorbing** (all five **deferred under the delegate-first strategy pivot** — see [VISION.md § Delegate, contribute, absorb](VISION.md); kept here for context only):
1. **Deterministic 100-point scoring** — port the 6-category model (Existence/Quality/Grounding/Accuracy/Freshness/Bonus) to `agentbrew lint --score`. Reuses filesystem cross-referencing pattern without the LLM dependency. ~500 LOC port.
2. **Path-scoped rule frontmatter** for Claude `.claude/rules/*.md` (`paths: [globs]`) and Copilot `.github/instructions/*.instructions.md` (`applyTo:`). Reopens our tiered-context-loading recommendation from `docs/research/tiered-context-loading.md`.
3. **Session learning loop.** Big lift, requires RFC and LLM dependency decision.
4. **Claude-CLI-as-LLM-provider** pattern — only if agentbrew ever adopts LLM features.
5. **`caliber publish`-style machine-readable project manifest** — spec convention worth aligning on for cross-repo skill/context sharing.

**Coexistence:** Running Caliber alongside agentbrew is safe — Caliber's `<!-- caliber:managed:X -->` markers in CLAUDE.md don't collide with agentbrew's `<!-- agentbrew:start -->` markers because they're section-scoped. Documented in [VISION.md § Coexistence with other tools](VISION.md#coexistence-with-other-tools); regression test in [`src/sync/marker-utils.test.ts`](../src/sync/marker-utils.test.ts) covers the isolation.

**What to watch for (escalation signals):**
- Adds user-level machine config (`~/.caliber/<global>`) → becomes direct competition
- Adds drift detection for configs it didn't write → becomes direct competition
- Agent count grows beyond 10 → scope creep toward agentbrew territory
- Launches hosted service / paid tier / funding announcement → budget competitor response
- Adopts AGENTS.md / `.agents/` spec more aggressively → alignment opportunity

---

### Bridle (`neiii/bridle`)

**What it is:** A Rust TUI/CLI unified configuration manager for AI coding assistants, published as a Rust workspace with three crates (`bridle`, `harness-locate`, `skills-locate`). 417⭐, v0.2.9 (last release 2026-01-20, 3 months ago). 26,802 Rust LOC total. Solo maintainer `d0x` + 2 occasional contributors (`@kaiiiiiiiii` for Copilot CLI, `@edlsh/rari404` for Crush).

**Distinctive idea:** **Whole-harness profiles** (work / personal / minimal) per harness. `bridle profile create <harness> <name> --from-current` snapshots the current state of the harness's config dir; `bridle profile switch <harness> <name>` copies the profile dir into the harness's real config location. Active profile tracked in `~/.config/bridle/config.toml [active] <harness>=<profile>`.

**Supported harnesses (7, from `harness-locate::HarnessKind`):** Claude Code, OpenCode, Goose, Amp, Copilot CLI, Crush, Droid.

**Real-world usage (measured 2026-04-19):**
- **crates.io**: 244 total downloads, 64 recent (90 days)
- **npm `bridle-ai`**: 44 monthly downloads, 6 weekly
- **The 417 stars are aspirational** — actual usage is ~2,600× less than Caliber's 12,737 monthly downloads.

**Strengths:**
- **`harness-locate` crate** (11,561 LOC, independently published) — per-harness path resolution library for 7 harnesses. Genuinely reusable work; other tools could depend on it. Agentbrew's equivalent is `src/core/agents.yaml` (authoritative registry).
- **Rust single-binary distribution** via npm (`bridle-ai`), Homebrew (`neiii/bridle/bridle`), and cargo (`cargo install bridle`).
- **ratatui-based TUI** with dashboard + cards views.
- **Interactive install multi-select** (`dialoguer_multiselect::GroupMultiSelect`) — shows discovered skills/MCPs grouped by which harnesses support them, with per-target warnings.
- **MCP Community Registry API client** (`skills-locate/registry.rs`) — fetches server metadata from the official MCP registry.
- **Format-aware MCP writing:** JSON (Claude), JSONC (OpenCode), YAML (Goose), distinct files per harness.
- **Skill format transformation for OpenCode** — `sanitize_name_for_opencode` + `transform_skill_for_opencode` enforce OpenCode's frontmatter requirements.
- **Output formats** (`-o text|json|auto`) — JSON for scripting, auto-detects TTY.

**Weaknesses:**
- **7 harnesses vs agentbrew's agent matrix.** Missing: Cursor, Windsurf, Devin, Codex, Gemini CLI, Augment, Copilot (VS Code), Kiro, Cline, Roo Code, Trae, Junie, Continue, Warp, and many others.
- **No drift detection.** `bridle status` shows "installed / config only / binary only / not installed" per harness — that's the harness binary status, not config drift.
- **No auto-repair.** No background scheduler. No hook integration.
- **No curated catalog.** `bridle install` requires a GitHub owner/repo URL; no bundled recommendations, no curated set.
- **No rules managed-section injection.** `rules_file: Option<PathBuf>` in `ProfileInfo` exists for display only; bridle does not deploy rules across agents or inject into existing rules files.
- **No commands format transform** beyond skill path mapping — commands are raw-copied between harness dirs.
- **No hooks sync, no agent definitions sync, no instructions sync** (`CLAUDE.md` / Windsurf memories / etc.).
- **No team config, no git-backed baseline.**
- **No lock file / SHA pinning.** `bridle install` fetches GitHub archives live on every install — no cache, no reproducibility guarantee.
- **Profile-as-snapshot model** drifts from any declarative intent. A user who edits their active profile's `.claude/skills/` loses why it differs from others; no source of truth separate from snapshots.
- **No LLM integration, no scoring, no session learning** (not necessarily a con — different design stance).
- **Stagnant: last release 3 months ago** (v0.2.9 on 2026-01-20); 12 open PRs and 5 open issues with no recent activity.
- **Dog-fooding is light** — the repo has `.cursor/rules/` but no CLAUDE.md, no AGENTS.md, no `.claude/skills/`. The maintainer doesn't deeply use their own tool.

**AgentBrew advantage:** every supported agent vs 7. Drift detection + 30-min scheduler. Curated catalog. Team config. Lock file. Rules managed-section injection. Commands format transform. Hooks sync. Agent definitions sync. Instructions sync. MCP run. team overlay. Export/import. User-content preservation (bridle's profile switch does a full dir copy that can clobber user edits). Written in TypeScript — same-ecosystem integration.

**Bridle advantage:** Whole-harness profile system. ratatui TUI (agentbrew is CLI-only by VISION). Single-binary Rust distribution. Interactive multi-select install UX. Published `harness-locate` library for anyone to reuse.

**Contribute vs Build paragraph:** **Keep separate. No contribution path makes sense.** Bridle has been stagnant for 3 months with a solo maintainer, 44 monthly npm downloads, and a Rust codebase that cannot share code with agentbrew's TypeScript. The useful reusable piece (`harness-locate`) is a library already published to crates.io; agentbrew's equivalent (`src/core/agents.yaml`) serves the same purpose for a superset of agents. Contributing would mean either learning the bridle codebase and filing Rust patches for an unresponsive maintainer, or trying to merge agentbrew into bridle (architectural impossibility — bridle is imperative profile-switching, agentbrew is declarative sync). The rebuild-on-top scenario costs ~28K new Rust LOC to save ~11.5K Rust LOC of reuse — math fails before you add that rebuilding throws away agentbrew's 79K-line test suite. The only useful ecosystem contribution is a one-time PR to `harness-locate` adding the Cursor / Windsurf / Codex / Devin path tables — file as a nice-to-have, don't block on it.

**Ideas worth absorbing:**
1. **Declarative whole-machine profile system** — full profiles spanning state.yaml + Agentfile + shared-rules. Think "named snapshots of your entire agent config." ~300 LOC. **Deferred under the delegate-first strategy pivot** ([VISION.md](VISION.md)). (Note: agentbrew's MCP-only profile subcommand was removed 2026-04-24 — per-context scoping now delegates to per-project Agentfile + mcpm.sh.)
2. **Interactive install multi-select UX** — when `agentbrew install <github-url>` discovers multiple skills/MCPs, present a grouped multi-select picker instead of installing everything or requiring flags. ~200 LOC. **Deferred** — to be contributed upstream to skills CLI per `contribute-interactive-multiselect-to-skills-cli` in TASKS.md.
3. **Cross-check `harness-locate` path tables** against `src/core/agents.yaml` — DONE 2026-04-26. Sanity check passes: agentbrew is correct on every documented case where Bridle disagrees (notably OpenCode `skills/` vs `skill/`), with 8 narrow coverage gaps and 2 env-var-override gaps tracked as scout tasks. See [`docs/audits/harness-locate-cross-check.md`](audits/harness-locate-cross-check.md).

**Do NOT:**
- Rewrite agentbrew in Rust for bridle's TUI — the 45-agent coverage + drift machinery + test suite is not cheap to port.
- Depend on bridle at runtime — bridle's maintenance cadence is too slow and user base too small.
- Adopt bridle's profile-as-snapshot model — it conflicts with agentbrew's declarative Agentfile stance. Agentbrew profiles should be declarative overlays, not snapshots.

**What to watch for:**
- Release cadence resumes (3-month gap today)
- Adds drift detection for deployed state
- Agent count grows beyond 10
- Adds rules managed-section injection
- If bridle goes dormant permanently: do the one-shot `harness-locate` path-table audit once, don't track further

---

### vsync (nicepkg/vsync)

**What it is:** CLI tool (`npx @nicepkg/vsync sync`) that reads config from one "source" tool and writes it to target tools. Handles format conversion (e.g., Claude Code commands to Cursor prompts).

**Strengths:**
- Syncs skills, MCP servers, agents, commands in one command
- Format conversion between tools (Claude commands to Cursor workflows)
- Claude Code as default source of truth (most popular agent)
- Simple mental model: source -> targets
- Git hook integration for auto-sync on commit

**Weaknesses:**
- **Claude Code-centric** -- if you primarily use Cursor or Windsurf, you still need Claude Code as intermediary
- **No drift detection** -- syncs on demand, doesn't detect when configs diverge
- **No catalog/marketplace** -- doesn't help you discover or install new skills
- **No MCP server lifecycle** -- syncs config but doesn't manage server processes
- **No enterprise gating** -- no concept of enterprise vs personal config
- **No declarative state** -- imperative sync, not declarative desired state
- **Project-scoped only** -- syncs per-project configs, not global/user-level

**AgentBrew advantage:** Declarative YAML state, drift detection + auto-repair, catalog marketplace, global config management.

**Contribute vs Build — Keep separate.** vsync has ~40% functional overlap with agentbrew (skills + MCP + commands across 4 tools) but the architectural premise is incompatible: vsync requires Claude Code as the source of truth while agentbrew's YAML state is agent-agnostic. Adopting vsync would force every agentbrew user to install Claude Code. The project is also small (35 stars) with no drift detection. Concrete action: **none planned.** Watch for v1.3 watch mode — if it ships and proves stable, consider wrapping vsync as a read-from-Claude-Code adapter for users who already have Claude Code configured.

---

### Compound Engineering Plugin (EveryInc)

**What it is:** Every Inc's official Compound Engineering plugin (`EveryInc/compound-engineering-plugin`, 22.7K★ as of 2026-07-06). Claude Code plugin with 29 workflow skills — brainstorm, plan, work, review, compound knowledge capture (`/ce:compound`), browser QA, and the hands-off `lfg` pipeline.

**Strengths:**
- Active repo (pushed 2026-07-06) — supersedes the prior `nicepkg/compound` 404 snapshot
- Broad agent install paths: Claude Code, Codex, Cursor, and more via plugin marketplace
- **Knowledge accumulation** — `ce-compound` writes durable learnings to `docs/solutions/` / `CONCEPTS.md`
- Engineering workflow skills (brainstorm, plan, work, review, compound, ideate, design)
- Multi-agent review (security/perf/arch/complexity)
- Browser QA (`ce-dogfood`, `ce-test-browser`) and iOS testing (`ce-test-xcode`)

**Weaknesses:**
- **Plugin-first install** — upstream still centers on Claude Code plugin marketplace paths
- **No drift detection** — manual skill invocation only; no agentbrew-style auto-repair
- **No declarative config-as-code** — runtime skills, not version-controlled desired state in agentbrew's model
- **No unified catalog** — agentbrew adds the curation layer via `sources.yaml` + `catalog.yaml` pointers

**AgentBrew relationship:** Indexed as a curated source (29 catalog pointers). `agentbrew install EveryInc/compound-engineering-plugin` indexes skills; `sync` deploys selected ones across skill-capable agents. Pure curator model — zero skill content copied in-repo.

**Contribute vs Build — Complementary curated source.** Repo is live and high-quality; agentbrew references it rather than reimplementing CE workflows. Concrete action: maintain catalog pointers; revisit if CE ships declarative sync or drift detection that overlaps agentbrew core.

---

### gstack (garrytan/gstack)

**What it is:** Garry Tan's opinionated sprint pipeline for AI coding agents (120K★, 2026-06-25). 50+ skills organized as Think → Plan → Build → Review → Test → Ship → Reflect — decision discipline (`office-hours`, `autoplan`, multi-lens plan reviews) plus real-browser QA (`qa`) with regression test generation.

**Strengths:**
- **Decision gates before code** — `office-hours` and `autoplan` encode review pipelines with taste-decision surfacing
- **Real-browser QA** — `qa` reads git diff, tests affected routes, fixes bugs with atomic commits + regression tests
- **Test-first ship** — `ship` bootstraps test frameworks, audits coverage, opens PRs
- **Sprint coherence** — each skill feeds the next (design doc → plan reviews → qa test plan → ship verification)

**Weaknesses:**
- **Large surface** — 50+ skills; many are niche (iOS, design-shotgun, OpenClaw adapters)
- **Claude Code–oriented** — slash-command workflow; other agents get SKILL.md content via agentbrew sync
- **No config sync / drift detection** — skills only, not MCP/rules/commands

**AgentBrew relationship:** 18 core sprint-pipeline skills indexed in catalog; remaining niche skills discoverable via `agentbrew install garrytan/gstack`. Complements obra/superpowers (process discipline) and Compound Engineering (knowledge accumulation).

**Contribute vs Build — Complementary curated source.** Index pointers, never fork. Concrete action: expand catalog coverage for remaining gstack skills if users request niche entries (iOS, design, OpenClaw).

---

### skills CLI (Vercel Labs)

> **Detailed analysis**: [`docs/competition/vercel-skills-cli-vs-agentbrew.md`](competition/vercel-skills-cli-vs-agentbrew.md) — full architecture comparison, agent-by-agent parity, command-surface table, honest LOC shrink estimate, and the three-option decision framework.

**What it is:** The 16.7K-star official CLI for the agentskills.io ecosystem. `npx skills add <repo>` installs skills from GitHub repos to 54 agent targets. Also powers the skills.sh directory + leaderboard (91K+ skills tracked).

**Strengths:**
- **De facto standard** for skill installation (185K+ installs for find-skills alone)
- 50+ agent targets (broadest coverage), 80+ contributors, 20+ releases
- skills.sh directory with leaderboard and security risk assessment
- Handles symlinks to all agent skill directories
- Source of the agentskills.io specification
- **New: `skills update`** -- checks and updates installed skills to latest
- **New: `skills check`** -- verifies installed skills have updates available
- **New: `skills find`** -- interactive fzf-style skill search
- **New: `skills remove`** -- remove skills from specific or all agents
- **New: `skills list`** -- list installed skills with agent filtering
- **New: Lock file v3** -- `skillFolderHash` (GitHub tree SHA) for reproducible installs

**Weaknesses:**
- **Skills only** -- no MCP server management, no rules, no commands
- **No config sync** -- doesn't sync rules, MCP configs, or CLAUDE.md equivalents
- **No drift detection** -- no background monitoring, only on-demand `check`
- **No enterprise features** -- no conditional installation, no org-level config
- **No catalog aggregation** -- can search skills.sh but can't aggregate multiple sources

**AgentBrew advantage (provisional):** Full config management (skills + MCP + rules + commands), drift detection, catalog with user sources, team overlay. Agentbrew currently implements skill installation natively, but ~80% of that logic is redundant with skills CLI — the next strategic question is whether to keep it.

**Contribute vs Build — Contribute, delegation shipped, parent task retired 2026-04-28 (split shipped: delegated targets → `npx skills add`, native carve-outs in routing matrices).** For the skills-installation slice alone, skills CLI has ~80%+ functional overlap with agentbrew: same agent target set, same skills.sh ecosystem, same symlink model, and they ship a lock file and an update/check/find flow. What they don't have: drift detection, unified declarative config (skills + MCP + rules + commands), team overlay. **Slices 2–7 of the (now-retired) `delegate-skill-install-to-skills-cli` parent shipped between 2026-04-26 and 2026-04-27** across PRs #790 (slice 3 — per-agent dispatch), #804 (slice 4 — `claude-code` canary), #805 (slice 5 — full intersection), #806/#807/#808/#809 (slice 6 — carve-out rationale + env-var path overrides + rename-aware delegation), and PR #810 (slice 7 — confirmed `cloneAndIndexRemoteSource` is permanent post-delegation because native carve-outs stay documented in routing matrices). Slices 8–12 (PRs #815–#818 + the slice-12 inline closure) closed every `absorb-*-from-skills-cli` sibling under SUBSUMED / DEFER per-carve-out. Dimension 4 (error surface preservation) closed PASS 2026-04-28 — `delegateRemoteSkill` uses `execFileSync` with `stdio: "inherit"`, so skills CLI's raw subprocess output streams verbatim. Dimension 3 (sandbox / proxy / offline friction) closed PASS 2026-05-02 — the measured `npx skills add` path completed on the current enterprise macOS / Devin CLI session and with warm offline cache; cold offline cache fails fast, as expected. The native code path that survives is the cache-clone + index step in `src/add-source.ts` that feeds the native deploy for `claude-desktop` / `overlay-desktop` (~200 LOC, documented carve-outs in `agent-name-map.ts`'s `AGENTBREW_ONLY_AGENTS_RATIONALE` Record). Honest shrink estimate: ~1,000–1,500 LOC (revised from the ~2K originally claimed — see [detailed comparison](competition/vercel-skills-cli-vs-agentbrew.md#honest-loc-shrink-estimate-corrects-competitionmd-2k)). The parent retired 2026-04-28 mirroring `delegate-mcp-to-mcpm`'s PR #906 retirement.

---

### MCPM (pathintegral-institute/mcpm.sh)

> **Detailed analysis (DONE 2026-04-27):** [`docs/competition/mcpm-sh-vs-agentbrew.md`](competition/mcpm-sh-vs-agentbrew.md) — all 4 slices landed. Verdict: **Contribute (selective delegation, split-intersection model).** Project shape (933⭐, 28 contributors, MIT, Path Integral Institute org); subprocess latency baseline (~1.48s warm vs ~63ms agentbrew, 25× tax → rules out per-server-per-agent dispatch); 9 strict client-intersection / 3 small adapters (opencode, kiro, amp) as upstream contribution candidates / 2 hard carve-outs (devin, overlay-desktop); Python ecosystem viable on 3 channels (uvx, pipx with --python pin, Homebrew bottle); per-project sync gap claim was a documentation drift bug. Execution path tracked by new P0 task `delegate-mcp-to-mcpm` (modeled on `delegate-skill-install-to-skills-cli` slices 2–7). Pure-blocker fallback: if corporate proxy or Devin sandbox blocks Python subprocess, verdict downgrades to Complementary in context X.

**What it is:** 933-star (was 927; uptick over the last ~2 weeks) CLI MCP package manager with global config, profiles, and 14 client integrations (`mcpm client ls` 2026-04-26: Claude Code, Claude Desktop, Cline, Continue, Cursor, Goose CLI, Roo Code, VSCode, Windsurf, 5ire, Codex CLI, Gemini CLI, Qwen CLI, Trae). Python on PyPI; install via `pipx install mcpm`. v2.14.0 released 2026-03-27 (latest); 28 contributors; 380 servers in registry; license MIT; org governance (Path Integral Institute, not personal). Subprocess startup ~1.48s warm on the author's Apple Silicon laptop vs ~63ms for agentbrew (~25× tax) — measured detail in the deep-dive.

**Strengths:**
- 933 stars with an active release cadence -- still one of the most mature MCP managers
- Global server management (install once, use everywhere)
- Profiles for organizing servers into workflow groups
- Client integration for 14 clients (Claude Desktop, Cursor, Windsurf, Cline, Continue, Goose CLI, Roo Code, VSCode, 5ire, Codex CLI, Gemini CLI, Qwen CLI, Trae)
- Registry at mcpm.sh with 380-server searchable catalog
- Doctor command for health checks
- Direct server execution for testing
- Org-governance (Path Integral Institute) with strong external-PR receptivity signal (PR #315 merged in 6 days from a drive-by contributor)

**Weaknesses:**
- **MCP only** -- no skills, no rules, no commands
- **No drift detection** -- manual client integration
- **No declarative state** -- imperative commands, not config-as-code
- **No enterprise gating** -- no conditional config
- **Python startup tax** — ~1.48s subprocess cold-start dominates per-call cost (vs ~63ms for agentbrew); per-server-per-agent dispatch shape doesn't translate. Selective delegation or batched dispatch is the realistic shape.
- **Python 3.14 footgun** — `pipx install mcpm` fails on Python 3.14 due to `pyo3` max-supported-version cap; pin `--python python3.13`.

**AgentBrew advantage:** Full config management beyond MCP, declarative state with drift detection. MCPM is the best MCP-specific tool -- and slice 4 (2026-04-27) committed agentbrew to the **Contribute (selective delegation, split-intersection)** verdict. The execution path lives in the new P0 task `delegate-mcp-to-mcpm` (7 slices modeled on `delegate-skill-install-to-skills-cli` slices 2–7); estimated net shrink ~2,000–2,500 LOC of native MCP code, with ~1,000–1,500 LOC remaining for the `mcp sync` cross-client orchestrator, `Agentfile.yaml` `mcp:` declarative input layer, and the 2 hard carve-outs (devin, overlay-desktop).

---

### Skills Manager (xingkongliang/skills-manager)

**What it is:** Electron desktop app for managing AI agent skills with a GUI.

**Strengths:**
- Visual GUI for browsing, installing, organizing skills
- Scenarios (skill groups you can switch between)
- Tagging and filtering
- Git backup for multi-machine sync
- Supports 15+ tools
- Skill preview (renders SKILL.md in-app)

**Weaknesses:**
- **Skills only** -- no MCP, rules, commands
- **GUI-only** -- no CLI, no CI/CD integration, no automation
- **No drift detection** -- manual management
- **No enterprise features**
- **Small project** -- 1 contributor, ~50 stars
- **Electron** -- heavy runtime for a config management tool

**AgentBrew advantage:** CLI-first (automatable), full config management, drift detection.

---

### Smithery CLI (smithery-ai/cli)

**What it is:** 703-star CLI for the Smithery hosted MCP registry. `smithery mcp search`, `smithery mcp add`, `smithery skill search/add`. Includes auth, publishing, tool introspection, and skill reviews.

**Strengths:**
- Hosted registry with curated MCP servers and skills
- OAuth authentication (`smithery auth login`)
- Tool introspection (`smithery tool list/find/call`) — can call MCP tools directly from CLI
- Skill reviews and voting system (upvote/downvote with text reviews)
- Namespaces for organizations
- Publishing workflow (`smithery mcp publish`)

**Weaknesses:**
- **Registry-dependent** — requires Smithery's hosted service
- **No config sync** — installs MCP/skills but doesn't sync rules or commands
- **No drift detection** — no verification that installed servers are still configured correctly
- **No enterprise gating** — namespaces exist but no conditional config
- **No declarative state** — imperative install commands

**AgentBrew advantage:** Self-hosted state, full config sync (not just install), drift detection. Smithery's review/voting system is interesting for community trust signals.

---

### ai-rules-sync (lbb00/ai-rules-sync)

**What it is:** CLI (`ais`) that syncs AI agent rules, skills, commands, and subagents from git repos to 12 agent targets. Supports per-project and user-level sync. 27 stars.

**Strengths:**
- Git-based team sharing (single source of truth in a git repo)
- Supports 12 agents: Cursor, Copilot, Claude Code, Trae, OpenCode, Codex, Gemini, Warp, Windsurf, Cline + more
- Per-project rules (`ai-rules-sync.json`) and user-level rules
- Import/export workflow (`ais cursor rules import my-rule --push`)
- Team onboarding (`ais install` restores all rules)
- Privacy-first with `.local.json` for sensitive rules

**Weaknesses:**
- **No MCP server management** — rules/skills/commands only
- **No drift detection** — manual `ais install` only
- **No catalog/marketplace** — must know the repo URL
- **No enterprise gating**
- **Small project** — 27 stars, 1 fork
- **Rules-focused** — skills/commands support is secondary

**AgentBrew advantage:** Full config surface (includes MCP), drift detection + auto-repair, catalog marketplace. AgentBrew now has git-based rule import/export (`rules import/export`).

**Contribute vs Build — Keep separate.** ~50% overlap on rules + skills + commands sync across 10+ tools. But the last push was 2026-03-16 with 27 stars and 1 fork — upstream is effectively dormant, so contributing drift detection or declarative state would be wasted effort against a project that may not receive the PR. Concrete action: **none planned.** If the maintainer returns and signals active development, re-evaluate whether to contribute drift detection + MCP support upstream and shrink agentbrew's rules sync.

---

### block/ai-rules (block/ai-rules)

> **Detailed analysis (DONE 2026-04-27):** [`docs/competition/block-ai-rules-vs-agentbrew.md`](competition/block-ai-rules-vs-agentbrew.md) — all 4 slices landed. Verdict: **Contribute (selective delegation, wrapper-around-output model).** Latency BETTER than agentbrew (~22ms vs ~63ms — strongest of the three delegation candidates). Distribution dependency-free (single self-contained binary via curl-installer). Apache-2.0 + Block corporate backing. strict-intersection and free-capability agents delegate; native carve-outs documented in routing matrices (windsurf, augment, devin). Wrapper-around-output approach addresses ai-rules' "symlink owns the file" pattern — `cd` to temp dir, run `ai-rules generate`, wrap output in agentbrew's managed-section markers. Execution path tracked by new P0 task `delegate-rules-to-ai-rules` (modeled on `delegate-mcp-to-mcpm` slices 2–7). Pure-blocker fallback: if organization corporate proxy or Devin sandbox blocks the curl-installer, verdict downgrades to Complementary in context X. **Doc-drift correction:** previous "Go binary" claim was wrong — ai-rules is Rust (per `Cargo.toml` v1.6.0, edition 2021).

**What it is:** Rust binary CLI from Block (Square / Cash App parent) that manages AI rules, commands, and skills across 10+ agents from a single `ai-rules/` directory. `ai-rules generate` produces agent-specific files (CLAUDE.md, .cursor/rules/*.mdc, AGENTS.md, etc.). 96 stars. v1.6.0. Apache-2.0. Self-contained binary via `curl ... | bash` to `~/.local/bin/ai-rules` (~3 MB, no toolchain needed).

**Strengths:**
- **Corporate backing** — Block (Square) is a large public company, lending durable maintenance signal
- 11 agents: AMP, Claude Code, Cline, Codex, Copilot, Cursor, Firebender, Gemini, Goose, Kilocode, Roo
- Status check (`ai-rules status`) for sync drift detection
- Single Rust binary — no runtime dependencies, no Rust toolchain required for end users
- MCP config generation for compatible agents
- Clean UX: `init` → edit rules → `generate` → `status`
- **Subprocess latency ~22ms warm — FASTER than agentbrew's ~63ms.** Per-call delegation has *negative* tax. Strongest latency signal of any of the three delegation candidates (skills CLI / mcpm / ai-rules)
- Apache-2.0 — no CLA gate

**Weaknesses:**
- **Rules-focused** — no MCP server lifecycle, no catalog, no marketplace
- **No skill installation** — generates rule files, doesn't install skills from repos
- **No MCP profiles, scenarios, or server execution**
- **No drift auto-repair** — `status` detects drift but doesn't fix it
- **No enterprise gating** — no conditional config
- **Project-scoped only** — no global/user-level config management
- **96⭐, mid-stage** — smaller than skills CLI (15.9K) or mcpm (933) but corporate-backed

**AgentBrew advantage:** Full config surface (skills + MCP + rules + commands + permissions), auto-repair, catalog marketplace, MCP execution, enterprise gating. ai-rules is a lightweight rules-only tool that delegating to would let agentbrew shrink ~445 LOC of `src/sync/rules-sync.ts` while keeping the orchestration surface (detection, drift, multi-surface coordination, per-source merging) as agentbrew's permanent scope.

**Contribute vs Build — TBD (slice 4)**, but slice 1 evidence leans strongly **Contribute (selective delegation).** Original "Keep separate (ecosystem mismatch)" verdict assumed Go binary + Rust toolchain friction, which doesn't exist — ai-rules ships a self-contained binary. Slice 1 measurements show latency is FASTER than agentbrew, distribution is dependency-free, and Block's corporate Apache-2.0 backing signals durable maintenance. The remaining gates (slices 2–4): agent coverage diff (initial sketch: 4 strict intersection / 4 agentbrew-only carve-outs / 7 ai-rules-only that gain rules support on delegation), rules-format preservation, drift integration shape, and upstream receptivity (contributor graph + recent merged PRs). Concrete action: **complete the deep-dive evaluation through slice 4**, then file `delegate-rules-to-ai-rules` if the verdict holds.

---

### skillfile (eljulians/skillfile)

**What it is:** Rust CLI (`cargo install skillfile`) that manages AI skills and agents via a declarative `Skillfile` manifest with lock file pinning and a patch system. 115 stars, 6 contributors. Started March 9, 2026. 100% Rust, Apache-2.0. 4 crates: cli, core, deploy, sources. Pre-built binaries on GitHub Releases.

**Strengths:**
- **Lock file with exact SHA pinning** — `Skillfile.lock` pins every entry to an exact commit SHA. Diffable in code review. `skillfile install` on a fresh clone reproduces the exact same bytes. This is genuinely better than any competitor's approach.
- **Patch system** — `skillfile pin <skill>` captures your edits as unified diff patches stored in `.skillfile/patches/`. Patches survive upstream updates via `skillfile install --update`. Conflict resolution via `skillfile resolve`. No other tool has this.
- **Per-project declarative manifest** — `Skillfile` lives in project root, committed to git. Team members run `skillfile install` and get identical skills. Clean line-oriented format (no YAML/TOML).
- **Multi-registry search** — Searches agentskill.sh, skills.sh, and skillhub.club in parallel across a large skill corpus. Interactive TUI and `--json` output.
- **Rust binary** — Single binary, no runtime dependency. ~3.4 MB. Fast.
- **Personal platform config** — `~/.config/skillfile/config.toml` for per-user platform preferences in shared repos (avoids merge conflicts).
- **Clean spec** — SPEC.md formally defines the format, lock file, patch directory, and cache structure.
- **`--dry-run` for install** — Preview what would be fetched/deployed before committing.

**Weaknesses:**
- **Skills only** — no MCP server management, no rules, no commands
- **8 agents only** — Claude Code, Codex, Copilot, Cursor, Factory, Gemini CLI, OpenCode, Windsurf (vs agentbrew's agent matrix)
- **No drift detection** — install-and-forget, no verification that skills are still present
- **No auto-repair** — no background sync
- **No catalog** — no curated starter set, relies entirely on 3rd-party registry search
- **No enterprise features** — no conditional config, no team repos
- **No MCP profiles, scenarios, or server execution**
- **No security risk assessment** — proxies 3rd-party scores in search results but no own analysis
- **No usage analytics, ratings, or TUI dashboard**
- **Small** — 115 stars, still early. May not survive.
- **Requires GitHub token** — hits 60 req/hr rate limit without `GITHUB_TOKEN`

**AgentBrew advantage:** every supported agent vs 8. Full config surface (skills + MCP + rules + commands). Drift detection + auto-repair. Curated catalog. Team config. MCP execution. Everything skillfile doesn't do.

**Skillfile advantage:** Lock file + SHA pinning + patch system + per-project manifest. These are genuinely novel reproducibility primitives that no competitor has. AgentBrew should absorb these ideas.

**Strategic assessment:** Skillfile is not a direct threat — it's a **skill package manager** (like npm for packages) while AgentBrew is a **config sync engine** (like chezmoi for dotfiles). They solve different problems but overlap on skill installation. The right move is to absorb skillfile's three best ideas: (1) lock file with SHA pinning, (2) patch system for skill customization, (3) per-project `Skillfile`-style manifest. These fill real gaps in AgentBrew without requiring us to give up any existing advantages. See TASKS.md for implementation tasks.

**Contribute vs Build — Keep separate (ecosystem mismatch; one absorbed idea is a ghost feature — see note).** ~30% overlap on skill installation with genuinely novel primitives. Agentbrew already shipped one of skillfile's best ideas natively (`lock.ts` — audit-trail SHA tracking, see the Matrix note that this is tracking-not-enforcement). **But `patch.ts` and `project-manifest.ts` are ghost features — the Gap Analysis claims them as "shipped 2026-03" but neither file exists in `src/` today.** See [`docs/competition/vercel-skills-cli-vs-agentbrew.md` § Follow-ups discovered](competition/vercel-skills-cli-vs-agentbrew.md#follow-ups-discovered-while-writing-this-doc) for the verification; both claims need correction via a separate audit task. Ecosystem mismatch remains (Rust binary vs Node.js CLI). Concrete action: **none planned for delegation.** File a follow-up to audit every Gap Analysis ✅ claim against the actual codebase (see also capabilities.ts and discover.ts — also claimed but not found).

---

### knowhub (yujiosaka/knowhub)

**What it is:** Lightweight CLI that syncs "resources" (local files, directories, or remote URLs) into output locations. Designed for AI agent knowledge files. 40 stars, inactive since July 2025.

**Strengths:**
- Simple config-driven sync (`.knowhubrc`)
- Copy or symlink modes
- Remote URL support (fetch rules from HTTP)
- Dry-run mode
- Plugin system for custom transformations
- Overwrite control per resource

**Weaknesses:**
- **Generic file sync** — not agent-aware, no format conversion
- **No MCP management**
- **No catalog/discovery**
- **No drift detection** — runs on demand only
- **Inactive** — last push July 2025
- **No agent-specific logic** — treats all targets as plain directories

**AgentBrew advantage:** Agent-aware sync with format conversion, MCP management, drift detection, catalog. knowhub is too generic for the agent config problem.

---

### install-mcp (supermemoryai/install-mcp)

**What it is:** Simple CLI (`npx install-mcp <package> --client <name>`) for one-shot MCP server installation into any client. 182 stars.

**Strengths:**
- Dead simple UX — single command installs an MCP server
- Supports 8 clients: Claude, Cline, Roo-Cline, Windsurf, Witsy, Enconvo, Cursor, Warp
- OAuth authentication for remote servers
- Header support for auth tokens
- Auto-detects npm packages, scoped packages, full commands, and remote URLs

**Weaknesses:**
- **Install-only** — no management, no removal, no updates
- **No sync** — installs to one client at a time
- **No skills, rules, or commands**
- **No drift detection**
- **Slowing** — last push Jan 2026

**AgentBrew advantage:** Everything beyond one-shot install. install-mcp is a thin wrapper around config file editing.

---

### OpenViking (volcengine/OpenViking)

**What it is:** Open-source "Context Database" for AI agents from Volcengine (ByteDance). NOT a config sync tool. It's a server-based system that manages agent context (memory, resources, skills) via a virtual filesystem paradigm (`viking://` protocol). Think RAG replacement with hierarchical organization, tiered loading, and auto-evolving memory. 23.3K stars. Python server + Rust CLI. Apache-2.0.

**Core concepts:**
- **Filesystem paradigm** — Maps memories, resources, skills to virtual directories under `viking://` protocol. CLI uses `ov ls`, `ov tree`, `ov find`, `ov grep` — feels like a real filesystem
- **Tiered context loading (L0/L1/L2)** — L0 abstract (~100 tokens) for quick relevance check, L1 overview (~2K tokens) for planning, L2 full content loaded on demand. Dramatically reduces token consumption
- **Directory recursive retrieval** — Intent analysis → vector positioning → directory drill-down → recursive refinement. Claims 43-49% improvement over flat RAG with 83-96% token cost reduction
- **Visualized retrieval trajectory** — Observable retrieval paths for debugging context quality
- **Automatic session memory** — Extracts long-term user preferences and agent task experience from sessions. Agent "gets smarter with use"

**Tech stack:** Python server (`openviking-server` on port 1933), Go (AGFS components), Rust CLI (`ov`). Requires embedding model API (OpenAI, etc.) and VLM for vision. Heavy dependencies (Python 3.10+, Go 1.22+, C++ compiler).

**Integrations:** OpenClaw memory plugin, OpenCode memory plugin, VikingBot (built-in agent framework with `ov chat`).

**Strengths:**
- 23.3K stars — serious ByteDance engineering investment
- Tiered context loading is genuinely novel — no other tool formalizes L0/L1/L2 for agent context
- Filesystem metaphor is intuitive for developers (ls, tree, find, grep)
- Directory recursive retrieval measurably outperforms flat RAG
- Observable retrieval trajectories solve the "RAG black box" problem
- Auto-evolving memory from sessions is forward-looking
- Well-documented with Chinese and English docs

**Weaknesses:**
- **NOT a config sync tool** — doesn't sync skills, rules, MCP, or commands across agents
- **Heavy infrastructure** — requires server deployment, embedding API, VLM API, Go compiler, C++ compiler
- **ByteDance ecosystem-centric** — primary integrations are OpenClaw and Volcengine services
- **No agent config management** — doesn't know about .cursorrules, CLAUDE.md, etc.
- **Overkill for static skills** — designed for dynamic retrieval, not deploying SKILL.md files
- **No drift detection** — different problem domain entirely
- **No CLI one-liner** — requires server + config + API keys to get started

**Competitive relationship:** OpenViking and AgentBrew solve **different problems**:
- OpenViking = **runtime context retrieval** (RAG++, memory, resource indexing for agent conversations)
- AgentBrew = **config-time deployment** (skills, MCP, rules, commands synced to agent config directories)

They are **complementary, not competing**. An agent could use both: AgentBrew deploys its skills/config, while OpenViking provides runtime memory and resource retrieval. OpenViking could be added to the AgentBrew MCP catalog as a context/memory server.

**Ideas worth absorbing:**
1. **Tiered context loading for skill browsing** — if agentbrew ever needs a `skill <name>` command again (deleted 2026-04-24 alongside `skill-info.ts`/`skill-display.ts`), the right shape is L0 (one-line in `catalog list`), L1 (frontmatter + metadata), L2 (full SKILL.md render). For now `agentbrew catalog show <name>` covers the browsing case without a separate tiered renderer.
2. **MCP catalog entry** — Add OpenViking as an MCP server in the catalog for teams that want persistent agent memory.

---

### MCP Dock / Dockmaster / Server Manager

**What they are:** GUI applications for managing MCP servers across tools.

**Strengths:**
- Visual one-click install/configure
- Curated registries
- Multi-client sync

**Weaknesses:**
- **MCP only** -- no skills, rules, commands
- **GUI-only** -- no automation/CI
- **No drift detection, no declarative state**

---

## Consolidated Comparison Matrix

| Capability | AgentBrew | vsync | Compound | skills CLI | MCPM | Smithery | ai-rules-sync | block/ai-rules | skillfile | OpenViking | Caliber | Bridle |
|-----------|-----------|-------|----------|-----------|------|---------|---------------|----------------|-----------|------------|---------|--------|
| **Skills sync** | All (agent matrix) | 4 agents | 10+ agents (copilot, gemini, windsurf, kiro, qwen, openclaw +) | 50+ agents | -- | Many | 10+ agents (Cursor, Copilot, Claude, Trae, OpenCode, Codex, Gemini, Warp, Windsurf, Cline, Universal) | 10+ agents | 8 agents | -- (runtime retrieval) | 5 agents (LLM-generated) | 7 harnesses (GitHub-fetched) |
| **MCP sync** | Per MCP routing matrix | 4 agents | 10+ agents (copilot, gemini, windsurf, kiro, qwen, droid) | -- | 10+ clients (Claude Desktop, Cursor, Windsurf, VS Code, Continue, Goose, Roo Code, 5ire) | Many | -- | Partial (config gen) | -- | -- | 2 agents project-local | 6 harnesses (JSON/JSONC/YAML format-aware) |
| **Rules sync** | Per rules routing matrix | -- | -- | -- | -- | -- | 10+ agents | 10+ agents | -- | -- | 5 agents LLM-generated | Path-discovery only (no deploy) |
| **Commands sync** | Per commands routing matrix | 4 agents | 10+ agents | -- | -- | -- | 10+ agents | 10+ agents | -- | -- | -- | 2 agents raw-copy |
| **Permissions sync** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | Partial (Claude settings.json) | -- |
| **Catalog / marketplace** | Built-in + sources + MCP Registry | -- | Plugin marketplace | skills.sh | mcpm.sh registry | Smithery registry | -- | -- | 3 registries (110K+) | -- | -- (live LLM-ranked remote) | -- (GitHub URL required) |
| **Drift detection** | Auto (platform-generic) | -- | -- | -- | Doctor (manual) | -- | -- | `status` (manual) | -- | -- | Pre-commit + session-end | -- |
| **Auto-repair** | On sync/init | -- | -- | -- | -- | -- | -- | -- | -- | -- | Score-regression auto-revert | -- |
| **Declarative config** | YAML state (git-backed) | -- | -- | -- | -- | -- | JSON config | Markdown source dir | ✅ Skillfile manifest | JSON config | -- (imperative + LLM) | -- (imperative profile cmds) |
| **Lock file** | agentbrew.lock (SHA tracking, not enforced — enforcement deferred under delegate-first strategy; see [VISION.md](VISION.md)) | -- | -- | ✅ Lock file v3 (skillFolderHash) | -- | -- | -- | -- | ✅ Skillfile.lock (SHA pinning, enforced) | -- | -- | -- |
| **Patch system** | -- (claimed ✅ pin/unpin/resolve but `patch.ts` does not exist — see Gap Analysis) | -- | -- | -- | -- | -- | -- | -- | ✅ pin/unpin/resolve | -- | -- | -- |
| **Per-project manifest** | -- (claimed ✅ but `project-manifest.ts` does not exist — see Gap Analysis) | -- | -- | -- | -- | -- | -- | -- | ✅ Skillfile | -- | -- | -- |
| **Multi-registry search** | ✅ mdskills.ai + GitHub + npm | -- | -- | ✅ skills.sh | ✅ mcpm.sh | ✅ Smithery | -- | -- | ✅ 3 registries | -- | -- (external LLM-ranked) | ✅ MCP Community Registry API |
| **MCP server sharing** | -- (out of scope: use `ngrok` / `cloudflared` / `ssh -R` after `mcpm run`) | -- | -- | -- | ✅ `mcpm share` | -- | -- | -- | -- | -- | -- | -- |
| **Enterprise gating** | -- | -- | -- | -- | -- | Namespaces | -- | -- | -- | -- | -- | -- |
| **Config-as-code** | YAML state + Node CLI | -- | -- | -- | -- | -- | JSON + git | Markdown + Go CLI | Skillfile + Rust CLI | JSON + Python server | Project files + Node CLI | Profile dirs + Rust CLI |
| **CLI automation** | Full CLI | Full CLI | bunx CLI | npx CLI | Full CLI | Full CLI | Full CLI | Full CLI | Full CLI | Full CLI (`ov`) | Full CLI + GitHub Action | Full CLI + ratatui TUI |
| **Source of truth** | Agent-agnostic repo | Claude Code | Claude Code | N/A (installer) | Global config | Hosted registry | Git repo | Local `ai-rules/` dir | Per-project Skillfile | `viking://` server | Your codebase (LLM-analyzed) | Profile snapshots per harness |
| **Search / browse** | `catalog --search` + interactive browse | -- | -- | `npx skills search` | `mcpm search` | `smithery search` | -- | -- | ✅ TUI + 3 registries | `ov find` + `ov grep` | `caliber skills --query` (LLM) | Interactive multi-select on install |
| **Health check** | `agentbrew status --fix` | -- | -- | -- | `mcpm doctor` | -- | -- | -- | -- | `ov status` | `caliber score` (100-pt) | `bridle status` (harness install state) |
| **MCP profiles** | ⚠ Deleted 2026-04-24 — delegated to per-project Agentfile + mcpm.sh per VISION.md. See CHANGELOG.md. | -- | -- | -- | ✅ Virtual profiles | -- | -- | -- | -- | -- | -- | ✅ Whole-harness profiles |
| **MCP server execution** | ⚠ Deleted 2026-04-27 (slice 5b of `delegate-mcp-to-mcpm`, PR #851) — delegated to `mcpm run` | -- | -- | -- | ✅ `mcpm run` | ✅ `smithery tool call` | -- | -- | -- | `openviking-server` | -- | -- |
| **Skill scenarios** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ Profile system (whole-harness snapshots) |
| **Skill versioning** | ✅ Pin + update | -- | -- | -- | -- | -- | -- | -- | ✅ SHA-locked | -- | Codebase-derived (no pinning) | -- |
| **Security risk** | -- | -- | -- | ✅ Socket/Snyk scores | -- | -- | -- | -- | Proxied scores | -- | -- (scoring is quality, not security) | -- |
| **Usage analytics** | -- (deleted 2026-04-24 — `atime`-based telemetry unreliable on `noatime`/`relatime` filesystems) | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ PostHog telemetry (opt-out) | -- |
| **Reviews / ratings** | -- | -- | -- | -- | -- | Upvote/downvote | -- | -- | -- | -- | -- | -- |
| **TUI dashboard** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ ratatui (dashboard + cards) |
| **Team config** | ✅ Git-based team repo | -- | -- | -- | -- | -- | ✅ Git-based | -- | Per-project Skillfile | -- | Commit configs + GitHub Action | -- |
| **Rule import/export** | ✅ `rules import/export` | -- | -- | -- | -- | -- | ✅ `ais import --push` | -- | -- | -- | -- | -- |
| **Skill publish / package** | -- | -- | -- | Via skills.sh submission | -- | Smithery registry | -- | -- | -- | -- | ✅ `caliber publish` (summary) | -- |
| **Skill update/check** | ✅ `skill update` | -- | -- | ✅ `skills update/check` | -- | -- | -- | -- | ✅ `install --update` + `status --check-upstream` | -- | ✅ `caliber refresh` (LLM-driven) | -- |
| **npx one-liner** | -- (needs npm publish) | `npx @nicepkg/vsync` | `bunx` | `npx skills` | `pip install` | `npx @smithery/cli` | `npx ai-rules-sync` | `curl \| bash` | `cargo install` | `pip install openviking` | `npx @rely-ai/caliber` | `npx bridle-ai` |
| **Auth / OAuth** | -- | -- | -- | -- | -- | OAuth login | -- | -- | -- | API key (embedding) | Multi-provider (Anthropic, OpenAI, Vertex, Claude CLI, Cursor ACP, OpenCode, MiniMax) | -- |
| **Tiered context (L0/L1/L2)** | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ Abstract/Overview/Detail | ✅ Path-scoped rule frontmatter (Claude + Copilot) | -- |
| **Runtime memory** | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ Auto session memory | ✅ Session learning → `CALIBER_LEARNINGS.md` | -- |
| **Semantic retrieval** | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ Directory recursive | -- | -- |
| **LLM dependency** | None | None | None | None | None | None | None | None | None | Embedding + VLM API | **Required (BYO key or Claude CLI proxy)** | None |
| **Codebase fingerprint** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ `src/fingerprint/` (1,915 LOC, cached) | -- |
| **Deterministic scoring** | -- | -- | -- | -- | -- | -- | -- | -- | -- | -- | ✅ 100-pt, 6 categories | -- |

---

## Gap Analysis -- What AgentBrew Still Lacks

### Recently Closed Gaps ✅

| # | Gap | Closed How | When |
|---|-----|-----------|------|
| 1 | ~~More sync targets~~ | Done (was 10). Added Trae, Junie, Continue, Warp, Cline, Roo Code, Goose, + 16 more initially; later absorbed IBM Bob, Deep Agents, Firebender from skills CLI (PR #700, 2026-04-24), then mirrored 8 more Skills CLI targets and delegated Devin on 2026-05-02. | 2026-03 / +3 on 2026-04-24 / +8 on 2026-05-02 |
| 2 | ~~MCP profile management~~ | **⚠ Deleted 2026-04-24 — delegated to per-project Agentfile + mcpm.sh per VISION.md. See CHANGELOG.md.** Originally: `mcp profile create/list/activate/deactivate/delete` | 2026-03 / deleted 2026-04-24 |
| 5 | ~~Per-project config overlay~~ | `.agentbrew.yaml` per-project config (deleted 2026-04-24, replaced by per-project `Agentfile.yaml`) | 2026-04-24 |
| 6 | ~~Skill versioning / pinning~~ | `skill-versions.ts` — pin, update, track versions | 2026-03 |
| 7 | ~~Security risk assessment~~ | `security-risk.ts` — trust classification for skills (deleted 2026-03) | 2026-03 |
| 8 | ~~Skill scenarios / groups~~ | `scenario.ts` — switch skill sets per workflow (deleted 2026-03) | 2026-03 |
| 9 | ~~Direct MCP server execution~~ | `mcp run <name>` — test servers before committing | 2026-03 |
| 10b | ~~Git-based rule import/export~~ | `rules import/export` — share rules via git repos | 2026-03 |
| 12 | **⚠ Deleted 2026-04-24 — broken on common filesystems.** `usage.ts`, `status --usage`, and `clean --unused` removed. `atime`-based skill telemetry was always `undefined` on macOS SSDs (default `noatime`/`relatime` mounts) and the MCP side used config-file `mtime`, which `agentbrew sync` rewrites on every run — so "last used" meant "last time sync touched this file," not "last agent use." `clean --unused` then took that wrong data and offered to delete items >30 days old by default. Cleanup landed in PR #695. | 2026-04-24 |
| 13 | ~~Team sharing (org-level)~~ | `team-config.ts` — git-based team repo config (deleted 2026-04-24, replaced by clone+symlink Agentfile pattern documented in README) | 2026-04-24 |
| 15 | ~~Skill reviews / ratings~~ | `ratings.ts` — stars, install counts, notes (deleted 2026-03) | 2026-03 |
| -- | ~~TUI dashboard~~ | `tui.tsx` — ink-based tabbed terminal dashboard (deleted 2026-03) | 2026-03 |
| -- | ~~MCP Registry integration~~ | `mcp-registry.ts` — search + info from MCP Community Registry (deleted 2026-04-27 by `delegate-mcp-to-mcpm-slice-5a`; resolution now goes through mcpm) | 2026-03 |
| 1e | **⚠ Claim disputed — `patch.ts` does not exist in `src/`** | Originally listed as shipped (`patch.ts` — pin/unpin/resolve/pinned). Verified 2026-04-19: no such file in the codebase. Needs a dedicated audit task; see [`docs/competition/vercel-skills-cli-vs-agentbrew.md`](competition/vercel-skills-cli-vs-agentbrew.md#follow-ups-discovered-while-writing-this-doc). | 2026-04-19 |
| 19 | **⚠ Claim disputed — `project-manifest.ts` does not exist in `src/`** | Originally listed as shipped (`.agentbrew-skills.yaml`, `manifest init/show/install`). Verified 2026-04-19: no `project-manifest.ts`, no grep hits for `.agentbrew-skills.yaml`. Needs a dedicated audit task. | 2026-04-19 |
| 20 | ~~Multi-registry parallel search~~ | `registry-search.ts` (429 LOC + 511-line test) built a mdskills.ai/GitHub/npm multi-adapter search with dedup + relevance sorting, but was **never wired into a CLI command** — only its own tests imported it. Deleted 2026-04-24. Canonical path for external-registry catalog integration is `catalog-registry-source` (P3). | 2026-04-24 |
| -- | **⚠ Deleted 2026-04-24 — out of scope.** `mcp-share.ts` removed; users delegate to `ngrok` / `cloudflared` / `ssh -R` after `mcpm run <name>` (the agentbrew `mcp run` wrapper itself was later deleted in slice 5b of `delegate-mcp-to-mcpm` (PR #851), 2026-04-27). The SSE bridge + `localtunnel` shipped but was unusable to browser clients (CORS 403 on every non-localhost `Origin`), had zero real-e2e coverage, and was not documented in the README. Cleanup landed in PR #692; see VISION.md "What We're NOT Building". | 2026-04-24 |
| 1d | ~~Lock file with SHA pinning~~ → SHA tracking only | `lock.ts` — YAML lock file at `~/.config/agentbrew/agentbrew.lock`. CLI: `lock`, `lock --verify`. Auto-locks on install. Tracking only — `sync` does not enforce pins. Enforcement was originally scoped as a follow-up but **deferred under the delegate-first strategy pivot** ([VISION.md](VISION.md)). | 2026-03 |
| 17 | ~~Per-project MCP configs~~ | `project-mcp-sync.ts` syncing `.agentbrew.yaml` to per-agent MCP files was deleted 2026-04-24 alongside the legacy format. Per-project MCP servers now flow through the standard `Agentfile.yaml` `mcp:` block via `applyAgentfile()` — same target paths (`.cursor/mcp.json`, `.mcp.json`, `.windsurf/mcp.json`), one declarative path. | 2026-04-24 |
| 14 | ~~Auth for remote MCP servers~~ | `types.ts` — `url`+`headers` on `McpServer`/`McpServerEntry`. `adapters.ts` emits URL entries. CLI: `mcp add --url --headers`. Registry: auto-detects SSE/HTTP packages. | 2026-03 |
| 3 | ~~Format conversion (commands)~~ | `transforms.ts` — `toGeminiFormat` (md→TOML). `command-sync.ts` — `remapFilename`, `commandFileExt` per agent. Gemini CLI wired with `.toml` output. | 2026-03 |
| 18 | **⚠ Claim disputed — `discover.ts` does not exist in `src/`** | Originally listed as shipped (`discover.ts` — scans `~/.*` for agent signals; `agentbrew discover` CLI; 14 tests). Verified 2026-04-24: no such file in the codebase, no `discover` CLI command. Agent detection lives in the sync runner's startup path (scans `agents.yaml` against filesystem presence), not in a standalone module. The claim of a 14-test dedicated file is false. | 2026-04-24 |
| 16 | **⚠ Claim disputed — `capabilities.ts` does not exist in `src/`** | Originally listed as shipped (`capabilities.ts` — frontmatter `capabilities` + `<!-- capability: name -->` markers; per-skill overrides in state.yaml; filtered copies on sync; `capabilities list/enable/disable/reset` CLI; 26 tests). Verified 2026-04-24: no such file in the codebase, no `capabilities` CLI command, no frontmatter `capabilities` field handled anywhere in the sync code. The claim of a 26-test dedicated feature is false. | 2026-04-24 |
| 11 | ~~Skill preview / render~~ | `skill-info.ts` + `skill-display.ts` (634 LOC + 1,240-line test) shipped markdown rendering, frontmatter parsing, and `showSkillInfo`/`listAllSkills`. The `skill`/`skill <name>` top-level CLI was retired in commit `c6c8452`; the render code was never rewired to any other command and only its own tests imported it. Deleted 2026-04-24 alongside the retired `cli-skills.ts` shim (11 LOC) that still advertised the migration. Users browse skills via `agentbrew catalog show <name>`. | 2026-04-24 |
| -- | ~~Skill validation~~ | `validate.ts` — validates SKILL.md spec compliance: dir naming, frontmatter parsing, required fields, type checks, description quality, cross-refs. CLI: `validate` (errors+warnings), `validate --verbose`. Exit code 1 for CI. 40 tests. |
| -- | ~~Skill publish pipeline~~ | `catalog/publish.ts` — validate → manifest → package → push (deleted 2026-03) | 2026-03 |
| -- | ~~Agent Skills npm packaging~~ | `skills/package.ts` — npm packaging per agentskills.io spec (deleted 2026-03) | 2026-03 |
| 4 | ~~Full GUI / web dashboard~~ | `gui.ts` + `gui-html.ts` — catalog dashboard (deleted 2026-03) | 2026-03 |

### Remaining Gaps

#### Critical

| # | Gap | Who Has It | AgentBrew Status | Impact |
|---|-----|-----------|-----------------|--------|
| 1b | **npx one-liner install** | skills CLI, Smithery, ai-rules-sync, install-mcp, block/ai-rules, skillfile — all have it | publish.yml ready, npm publish configured | Biggest onboarding friction vs every competitor |

#### Minor

_No remaining minor gaps._

---

## What AgentBrew Has That No Competitor Matches (Combination)

No single competitor combines all of these:

| # | AgentBrew Advantage | Nearest Competitor Gap |
|---|---------------------|----------------------|
| 1 | **Declarative config-as-code (YAML state)** | vsync and Compound are imperative -- run a command, hope it works. No diffable desired state. No rollback. |
| 2 | **Drift detection + auto-repair** | No competitor detects when agent configs diverge from source of truth and auto-fixes. MCPM has `doctor` but it's manual and MCP-only. block/ai-rules has `status` but no auto-fix. |
| 3 | **Agent-agnostic source of truth** | vsync and Compound require Claude Code as the source. AgentBrew's source is a git repo -- works even if you don't use Claude Code. |
| 4 | **Full config surface** (skills + MCP + rules + commands) | Every competitor covers 1-2 of these. None covers all four. |
| 5 | **Catalog marketplace with user sources + MCP Registry** | skills CLI has skills.sh but no custom sources. MCPM has registry but MCP-only. AgentBrew aggregates built-in catalog + user git repos + MCP Community Registry. |
| 6 | **Health checks + status** (`agentbrew status --fix`, `agentbrew status`) | Only MCPM has a doctor command (MCP-only). No competitor has comprehensive health checks across all config types. |
| 7 | **Single CLI for everything** (`init`, `install`, `catalog`, `sync --pull`, `status --fix`) | Competitors require combining 3+ tools (npx skills + vsync + mcpm + manual editing). |
| 8 | **MCP server execution + registry** | MCPM has run + profiles. Only Smithery has registry + tool call. AgentBrew has run + registry in one tool. (MCP profiles deleted 2026-04-24 — delegated to per-project Agentfile + mcpm.sh.) |
| 9 | **Team config** | No competitor offers git-based team configuration repos that auto-sync baseline MCP servers, rules, and sources to all team members. |
| 10 | **Lock file (SHA tracking)** | Only skillfile has true enforced SHA pinning + a patch system. AgentBrew's lock today records SHAs but does not enforce them; an investigation task (`investigate-sha-lock-enforcement`) will decide whether to implement enforcement or retire the claim. |

---

## Implementation Priority Matrix

| Priority | Gaps | Est. Effort | Rationale |
|----------|------|-------------|-----------|
| **P0 -- Next sprint** | #1b (npx one-liner — manual: `npm publish --access public`) | 1 day | Every competitor has npx. Build verified, just needs npm auth. |

---

## What NOT to Build

- **Another skills.sh** -- AgentBrew should contribute to the skills.sh directory ecosystem, not compete with it. Installation is done natively but the shared directory convention and skill format are respected.
- **Another MCP registry** -- Use mcpm.sh registry or MCP Community Registry, don't duplicate
- **IDE extension** -- Stay CLI-first. IDEs have their own marketplace UX. AgentBrew is infrastructure.
- **Desktop app** -- Skills Manager and MCP Dock prove GUI is low-value for this use case
- **Bidirectional sync** -- Config should flow from source of truth to agents, never the reverse. One-way is a feature, not a limitation.

---

## Related Docs

- **`docs/VISION.md`** -- Project direction and philosophy
- **`README.md`** -- Quick start, catalog overview, supported agents
- **`TASKS.md`** -- Active task queue
- **`docs/COMPETITION.md`** -- This file (competitive analysis)
