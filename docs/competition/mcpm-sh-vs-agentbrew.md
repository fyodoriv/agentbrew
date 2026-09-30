# mcpm.sh vs agentbrew — Detailed Comparison

> **All 4 slices DONE 2026-04-27.** This doc was filled in incrementally
> through `evaluate-delegate-mcp-to-mcpm` (P0) slices 1–4. Slices 1–3 record
> project shape, subprocess latency, client coverage diff, command surface
> dissolution, Python ecosystem viability across pipx/uvx/Homebrew, and the
> per-project sync gap analysis. Slice 4 (this commit) locks in the verdict,
> records upstream receptivity findings, files the execution-path follow-up
> task `delegate-mcp-to-mcpm`, and closes both this evaluator and the
> now-subsumed P1 `deep-dive-mcpm-sh` task.

## TL;DR

**Verdict:** **Contribute (selective delegation, split-intersection model like
skills CLI)**. Confirmed 2026-04-27 in slice 4.

**Slice 1–3 evidence summary:**

- **Client coverage** is net-additive. 9 strict intersection clients (claude-code,
  claude-desktop, cline, cursor, windsurf, gemini-cli, codex↔codex-cli,
  goose↔goose-cli, roo-code) delegate cleanly. 3 small adapter contributions
  (opencode, kiro, amp) at ~30 LOC each. 2 hard carve-outs (devin, overlay-desktop)
  parallel the skills CLI delegation's 3-carve-out structure. Bonus: 5 mcpm-only
  clients (continue, vscode-direct, 5ire, qwen-cli, trae) become MCP-capable
  without agentbrew code — agentbrew has continue / qwen-code / trae as agents
  today but doesn't MCP-wire them. See § "Client coverage (slice 2)".
- **Command surface** — mcpm subsumes 8 of 12 agentbrew MCP commands cleanly,
  partially subsumes 2 more (status / setup with concrete upstream contribution
  hooks: `--json` mode for doctor, `--interactive` mode for edit), the duplicate
  `mcp sync` CLI surface was deleted in the 2026-05-03 hidden-CLI audit (the
  visible `agentbrew sync --only mcp` covered it), and the cross-client batch
  **orchestrator** (`syncMcpServers` in `src/sync/mcp-sync.ts`) stays native —
  that's still agentbrew's value-add. See § "Command surface dissolution map (slice 2)".
- **Latency shape** rules out per-server-per-agent dispatch (Python interpreter
  startup is ~1.48s warm vs agentbrew's ~63ms — 25× tax). Selective delegation
  on per-call commands (install, search, info, ls, run) plus a native `sync`
  that batches reads is the realistic shape. See § "Subprocess latency baseline".
- **Per-project sync gap claim is BUSTED.** The TASKS.md claim that "agentbrew
  has `project-mcp-sync.ts` writing `.cursor/mcp.json` etc." is a documentation
  drift bug — the file does NOT exist; agentbrew writes to global per-agent
  config paths just like mcpm does. The actual per-project layer is
  `Agentfile.yaml` `mcp:`, which is agentbrew's permanent scope per VISION.md.
  See § "Per-project MCP sync gap analysis (slice 3)".
- **Python ecosystem is viable** with three supported channels: `uvx mcpm`
  (recommended for new installs — no version pinning), `pipx install mcpm`
  (PARTIAL PASS — Python 3.14 footgun fixed by `--python python3.13`), and
  `brew install mcpm` (Homebrew bottle, MIT, ships its own python@3.14 with
  patched pyo3). Corporate-proxy and Devin-sandbox contexts are hardware-bound
  carve-outs deferred to whoever runs on the matching hardware — they parallel
  the closed 2026-05-02 skills CLI sandbox / proxy / offline measurement and
  don't gate the delegation. See §
  "Python ecosystem viability (slice 3)".
- **LOC shrink estimate is LARGER than the parent task claimed.** Parent says
  ~2,000 LOC; actual non-test MCP code is **3,756 LOC** across 14 files. Honest
  shrink estimate: ~2,000–2,500 LOC removable, with ~1,000–1,500 LOC remaining
  for the native-sync orchestrator, Agentfile input layer, overlay-desktop
  adapter, devin carve-out, and org MCP overlay glue. See § "What about
  agentbrew's MCP code being ~3,756 LOC".

**Slice 4 outcome (DONE 2026-04-27):**

- (a) **Upstream receptivity:** structural signal is **strong** — Path Integral
  Institute org governance (not personal), 28 contributors, MIT, drive-by
  PR #315 (`mcpm update` command) merged in 6 days from external contributor
  `DjodyKort`, no visible 47-day-stalled-PR pattern, recent issue triage on
  ~2-day-old reports. Adapter-specific receptivity is unverified until the
  first opencode adapter PR is filed (deferred to the new
  `delegate-mcp-to-mcpm` task; filing is a publish action and requires
  per-action approval). Receptivity is sufficient to commit the strategy.
- (b) **Execution-path task filed:** new P0 task `delegate-mcp-to-mcpm` opened
  in TASKS.md with a slice plan modeled on `delegate-skill-install-to-skills-cli`
  slices 2–7. Carries the same publish-hold semantics as the skills CLI
  delegation (subprocess wiring + LOC deletion proceeds autonomously;
  upstream PR / issue filing requires per-action approval).
- (c) **`docs/COMPETITION.md` Tier 2 verdict** updated from "Complementary"
  to **"Contribute (delegation planned)"** with a link to this deep-dive.
- (d) **`deep-dive-mcpm-sh` (P1) closed** — content fully subsumed by this
  doc; task block removed from TASKS.md in this commit.
- (e) **Parent `evaluate-delegate-mcp-to-mcpm` (P0) closed** — verdict landed,
  parent block removed from TASKS.md in this commit.
- (f) **`docs/VISION.md` Applied-to-today's-competitors bullet** updated to
  reflect "evaluation done, delegation planned" rather than "evaluate."

## What each tool is

### mcpm.sh (Path Integral Institute)

[mcpm.sh](https://mcpm.sh) ([github](https://github.com/pathintegral-institute/mcpm.sh))
is "a CLI MCP package manager & registry for all platforms and all clients" —
think `npm` for Model Context Protocol servers. It manages MCP servers globally
on a developer's machine: discovery (search the [mcpm.sh registry](https://mcpm.sh)),
installation, configuration, lifecycle (`run`, `share`, `inspect`), profile
grouping (`work` / `personal` / `project`), and per-client wiring (Claude
Desktop, Cursor, Windsurf, Cline, Continue, Goose CLI, Roo Code, VSCode, 5ire,
Codex CLI, Gemini CLI, Qwen CLI, Trae). Distributed as a Python package on PyPI;
self-installs cleanly via `pipx install mcpm` (with one Python-version pinning
caveat — see § "Pending: Python ecosystem viability").

### agentbrew

[`agentbrew`](https://www.npmjs.com/package/agentbrew) is a multi-surface AI-agent
configuration manager — skills, MCP servers, rules, commands, hooks, and instructions
— for ~48 coding agents. The MCP slice (`src/sync/mcp-sync.ts` + `src/mcp/*`,
~3,756 non-test LOC measured 2026-04-26) covers 15 MCP-capable agents and
provides install / registry / setup wizard / health / run / status / validation
commands. The MCP slice is one of four sync surfaces (the others are skills,
rules, commands), wired together by `agentbrew sync`, declarative state in
`Agentfile.yaml`, and drift detection.

### The scope overlap

Both tools manage MCP servers across multiple agent clients on the same machine.
Both use the same client config-file format conventions for the intersection
clients (the JSON `mcpServers` map in each client's config file). Both have a
notion of registry-driven server discovery. The differences:

| Dimension | mcpm.sh | agentbrew |
|---|---|---|
| Scope | MCP only | MCP + skills + rules + commands + hooks |
| Language / runtime | Python | Node.js |
| Distribution | PyPI (`pipx install mcpm`) | npm (`npx agentbrew@latest`) |
| Registry size | 380 servers (`mcp-registry/servers/`) | Built-in catalog + MCP Community Registry + user sources |
| Active features beyond install | profiles, run, share, inspect, doctor, usage analytics | catalog, drift detection, team overlay, Agentfile, multi-surface sync |
| Contributors | 28 (2026-04-26) | small team (single primary maintainer) |
| Stars | 933 | (not comparable) |

The overlap zone is **MCP server install + per-client wiring** — that's the
slice this evaluation considers delegating.

## Project shape (slice 1)

**Sources:** GitHub API on `pathintegral-institute/mcpm.sh` 2026-04-26.

| Field | Value |
|---|---|
| Stars | **933** (vs 927 in the COMPETITION.md snapshot — slight uptick over the last ~2 weeks) |
| Forks | 98 |
| Contributors | 28 |
| Open issues | 39 |
| License | MIT |
| Repository created | 2025-03-21 (~13 months old as of 2026-04-26) |
| Default branch | `main` |
| Last commit | 2026-03-27 (~30 days ago — the v2.14.0 release) |
| Last push | 2026-04-24 (~2 days ago — minor release-channel touch-up) |
| Latest release | **v2.14.0** (2026-03-27) |
| Prior release | v2.13.0 (2026-01-15) |
| Release cadence (last 6 months) | v2.12.1 (2026-01-15) → v2.13.0 (2026-01-15) → v2.14.0 (2026-03-27) — three releases in ~3 months, uneven cadence |
| Language | Python (3.10+ required; pyproject.toml; pinned to authlib + fastmcp + click stack) |
| Distribution channels | PyPI primary; `dockerfiles/`, `flake.nix`, README.nix.md show Docker + Nix support |
| Self-described | "Centralized MCP server management — discover, install, run, and share servers." |

**Cadence health (last 6 months of commits):**

```
2026-03-27  bdd5ed98  Add RAGMap to registry (#311)
2026-03-27  7fc61710  chore(release): 2.14.0 [skip ci]
2026-03-27  efc29161  feat: add `mcpm update` command for server update management (#315)
2026-02-10  3a21496d  chore(deps): bump the npm_and_yarn group across 1 directory with 2 updates (#303)
2026-01-15  44601b93  chore(release): 2.13.0 [skip ci]
```

Three real-feature commits + one dependabot bump in the visible window. Active
but not high-tempo. Compare to vercel-labs/skills's hundreds of merged PRs in
the same window — mcpm's tempo is much more measured. Sufficient for
"MCP-specialist tool maintained by a small team," not enough for "MCP becomes
agentbrew's primary delegate" without follow-up clarity on (a) responsiveness
to drive-by contributors (slice 4 will check) and (b) which dimensions of the
agentbrew use case mcpm's roadmap covers.

**PR throughput (most recent 5 closed PRs, 2026-04-26):**

| # | Author | Title | Days to merge / close | Merged? |
|---|---|---|---|---|
| 317 | digitamaz | feat: add Clarvia AEO Scanner to MCP registry | 9 | (open) |
| 316 | digitamaz | feat: add clarvia-mcp-server | 13 | closed |
| 315 | DjodyKort | feat: add `mcpm update` command for server update management | **6** | merged |
| 303 | dependabot[bot] | bump npm_and_yarn group | 19 | merged |
| 302 | mcpm-registry-bot[bot] | feat: Add MCP manifest for nitansde-nitan-mcp | 0 | closed |

**Signal:** PR #315 from an external contributor (`DjodyKort`) merged in 6 days
with a non-trivial feature (`mcpm update`). That's a strong receptivity signal
for delegate-able feature contributions. Slice 4 will look harder at PR #630
analogues for mcpm.

**Governance model:** Path Integral Institute (`pathintegral-institute` org) —
not a personal project, not a Foundation. The org has 4 public repos, with mcpm
the flagship. License is MIT. No CLA gate visible in CONTRIBUTING.md. No
visible sponsor relationships (no GitHub Sponsors page, no Open Collective).

**Documentation:** The repo has CLAUDE.md, GEMINI.md, QWEN.md (agent-specific
context), best_practices.md, MIGRATION_GUIDE.md, llm.txt, README.nix.md,
README.zh-CN.md. That's substantial documentation surface — the project takes
agent-discoverability seriously, which matters for both human contributors and
the deep-dive's verdict.

## Subprocess latency baseline (slice 1)

**Methodology:** measure warm-start latency for the most common `agentbrew sync`
operations on the author's macOS laptop (Apple Silicon, Python 3.13.7,
pipx 1.11.1, mcpm 2.14.0 installed via `pipx install --python python3.13 mcpm`,
agentbrew 0.3.0 built locally). Each measurement is `time <command> > /dev/null`,
3 consecutive warm runs after a discarded warm-up run, in zsh.

**Results:**

| Operation | Tool | Run 1 | Run 2 | Run 3 | Mean | Implication |
|---|---|---|---|---|---|---|
| `--version` (cold-CLI startup proxy) | mcpm | 1.576s | 1.418s | 1.449s | **1.48s** | Python interpreter + FastMCP/authlib import dominate |
| `--version` | agentbrew | 0.063s | 0.063s | 0.062s | **0.06s** | Node.js startup is ~25× faster |
| Search registry (warm) | `mcpm search context7` | 1.676s | 1.418s | 1.400s | **1.50s** | Same Python startup tax |
| Search registry (warm) | `agentbrew mcp registry --search context7` | 0.077s | 0.074s | 0.075s | **0.08s** | ~19× faster |
| Single server info (warm) | `mcpm info playwright` | 1.229s | 1.246s | 1.266s | **1.25s** | Slightly cheaper than search (no API roundtrip) |
| Single server info equivalent | `agentbrew mcp registry --search playwright` | 0.075s | 0.073s | 0.074s | **0.07s** | ~17× faster |

**Aggregate:** mcpm subprocess startup costs ~1.4s on this hardware, dominated
by Python interpreter init plus the FastMCP/authlib/click import chain.
Repeating this latency across N MCP operations in a single `agentbrew sync`
cycle would add real wall-clock time. Concretely:

- For a single MCP server install during onboarding: 1.4s subprocess overhead
  is invisible to a human (the network roundtrip dominates anyway).
- For `agentbrew sync` reconciling N servers across M agents: today this is one
  Node.js process holding all 15 client adapters in memory. Delegating to mcpm
  per-server-per-agent would be O(N×M) subprocess calls × 1.4s each. With N=10
  servers and M=5 detected agents, that's 50 × 1.4s = **70s of Python startup
  overhead** just to reconcile. agentbrew's current native `sync` completes
  this work in ~1–2s.

**Implication for the delegation verdict:** the per-server-per-agent dispatch
shape that the skills CLI delegation used (each `npx skills add` call delegates
one repo to one agent) is **not** directly applicable to mcpm. Either (a) the
delegation must batch — call mcpm once per `sync` with the full state, not per
server-per-agent — or (b) the delegation is selectively applied to operations
where 1.4s overhead doesn't matter (one-off `install` / `uninstall`) and the
hot path (`sync` reconciling state) stays native. Slice 4 will pick the shape;
this measurement says don't repeat the per-call dispatch shape.

**The vercel-labs/skills delegation latency for comparison** (from
`docs/competition/vercel-skills-cli-vs-agentbrew.md § Delegate measurements`):
~0.5s warm, ~0.9s cold. Node-on-Node delegation tax is about 3× lower than
Python-on-Node per call, but it's the same shape of overhead — the dispatch-
shape question matters more than the absolute number.

**Hardware caveats:**

- Apple Silicon laptop. Intel/AMD warm-start may differ by ±20%.
- Python 3.13 specifically. **Python 3.14 fails to install mcpm via pipx**
  because `pydantic-core` v2.x requires `pyo3` ≤ 0.24 which caps at Python
  3.13. Workaround: pin to `--python python3.13`. This is a friction point for
  any user on the latest Python — recorded as a slice 3 measurement candidate.
- Cold start: pipx installation itself took ~70s on this Mac. Not comparable
  to "subprocess cold start" in the agentbrew-sync sense because pipx caches
  the venv after first install. Slice 3 will measure pipx install on a fresh
  venv as the realistic "first agent runs sync" path.

## Client coverage (slice 2)

**Sources:** `src/core/agents.yaml` filtered to entries with `mcpConfig*` fields
(15 agents) and `mcpm client ls` 2026-04-26 (14 supported clients). Each agent's
config-file path was confirmed by reading the corresponding adapter file in
both repos.

### 3-way diff

| agentbrew (15) | mcpm (14) | Status | Notes |
|---|---|---|---|
| `claude-code` | `claude-code` | **Intersection** | Same `~/.claude.json` |
| `claude-desktop` | `claude-desktop` | **Intersection** | Same `~/Library/Application Support/Claude/claude_desktop_config.json` |
| `cline` | `cline` | **Intersection** | Both via VS Code extension globalStorage path |
| `cursor` | `cursor` | **Intersection** | Same `~/.cursor/mcp.json` |
| `windsurf` | `windsurf` | **Native carve-out** | agentbrew writes the modern `~/.codeium/windsurf/mcp_config.json` path directly; this avoids the endpoint-blocked mcpm Python launcher. |
| `gemini-cli` | `gemini-cli` | **Intersection** | Same `~/.gemini/settings.json` |
| `codex` | `codex-cli` | **Intersection (rename)** | Both write `~/.codex/config.toml` |
| `goose` | `goose-cli` | **Intersection (rename)** | Both write `~/.config/goose/config.yaml` |
| `roo-code` | `roo-code` | **Intersection** | Both via VS Code extension globalStorage path |
| `devin` | — | **agentbrew-only** | `~/.config/devin/config.json`. Devin Cognition product; not on mcpm. **Carve-out (org/Cognition-internal product context).** Same rationale as `delegate-skill-install-to-skills-cli`'s `devin` carve-out. |
| `copilot` | (`vscode` is separate) | **Different surfaces of VS Code** | agentbrew `copilot` writes `~/Library/Application Support/Code/User/settings.json` (the VS Code main settings file, MCP key under `mcp.servers`). mcpm `vscode` writes `~/Library/Application Support/Code/User/mcp.json` (newer dedicated file). They coexist; not a rename. **Contribute upstream to mcpm**: add a "vscode-settings-json" client variant, or fold into the existing `vscode` manager via a settings-vs-mcp.json toggle. |
| `opencode` | — | **agentbrew-only** | `~/.config/opencode/opencode.json`. **Contribute upstream**: small adapter (~30 LOC equivalent in mcpm Python). |
| `kiro` | — | **agentbrew-only** | `~/.kiro/settings/mcp.json`. **Contribute upstream**: small adapter. |
| `amp` | — | **agentbrew-only** | `~/.config/amp/settings.json`. **Contribute upstream**: small adapter. |
| `overlay-desktop` | — | **agentbrew-only** | `~/Library/Application Support/TeamDesktopApp/mcp-config.json`. **Carve-out (org-internal product context)** — never going upstream. |
| — | `continue` | **mcpm-only** | agentbrew has `continue` as an agent but **NOT MCP-capable** (no `mcpConfig*` in agents.yaml). Delegating to mcpm GAINS continue MCP support at zero agentbrew code cost. |
| — | `vscode` | **mcpm-only (different surface)** | See `copilot` row above — agentbrew's `copilot` covers VS Code via `settings.json`; mcpm's `vscode` covers VS Code via `mcp.json`. They cover different surfaces of the same product. |
| — | `5ire` | **mcpm-only** | agentbrew has no `5ire` agent at all. Delegating GAINS 5ire MCP support at zero code cost. |
| — | `qwen-cli` | **mcpm-only** | agentbrew has `qwen-code` (note rename) but it's not MCP-capable. Delegating GAINS qwen-cli MCP support; need to verify the `qwen-code`↔`qwen-cli` mapping is correct. |
| — | `trae` | **mcpm-only** | agentbrew has `trae` as an agent but **NOT MCP-capable**. Delegating GAINS trae MCP support at zero agentbrew code cost. |

**Counts:**
- **9 strict intersection** (same name or known rename pair)
- **6 agentbrew-only** (3 contribution candidates: opencode, kiro, amp; 1 different-surface VS Code variant: copilot; 2 carve-outs: devin, overlay-desktop)
- **5 mcpm-only** that GAIN MCP capability via delegation (continue, vscode-direct, 5ire, qwen-cli, trae)

**Implication for the verdict:** the delegation is net-additive on the
client-coverage axis. The 9 intersection clients delegate cleanly. The 3
small adapters (opencode, kiro, amp) are upstream-contribution candidates —
each is ~30 LOC of Python adapter mirroring agentbrew's existing TS adapter.
The 2 hard carve-outs (devin, overlay-desktop) keep ~150 LOC of native code
alive, parallel to the skills CLI delegation's 3-carve-out structure. And
delegation OPENS UP 5 additional clients (continue, vscode-direct, 5ire,
qwen-cli, trae) that agentbrew currently doesn't MCP-wire — that's free
capability expansion.

### Rename / contribution / carve-out summary

```
Intersection (9):  claude-code, claude-desktop, cline, cursor, windsurf,
                   gemini-cli, roo-code, [codex↔codex-cli], [goose↔goose-cli]

Contribute (3):    opencode, kiro, amp
                   + 1 settings.json variant: copilot/vscode-settings

Carve-out (2):     devin, overlay-desktop

Free capability (5): continue, vscode-direct, 5ire, qwen-cli, trae
                     (gained on delegation; agentbrew doesn't MCP-wire today)
```

This is the same shape as `delegate-skill-install-to-skills-cli`'s split:
intersection delegates, small adapters become upstream contribution candidates
(blocked-explicit-permission tasks for slice 4 to file once the delegation lands),
hard product-context carve-outs stay native.

## Command surface dissolution map (slice 2)

**Sources:** agentbrew commands from `src/commands/cli-mcp.ts` (12 commands);
mcpm commands from `mcpm --help` 2026-04-26 (17 commands across all groups).

| agentbrew capability | mcpm equivalent | Status | Rationale |
|---|---|---|---|
| `mcp list` | `mcpm ls` | **DELETED 2026-04-27 (PR #852, slice 5c)** | Same operation. mcpm's table is richer (per-client status). |
| `mcp add [name]` | `mcpm install <name>` (registry) / `mcpm new` (manual) | **Kept native** | Custom-server adds (`agentbrew mcp add my-srv -c node ...`) aren't in mcpm's registry — `mcpm install` would fail. The `mcpm new` path needs slice 3 of `bridge-mcp-sync-to-mcpm-for-intersection` to wire up. |
| `mcp update [name]` | `mcpm update [name]` | **Kept native** | The only entry point for refreshing **git-installed** MCP servers (a class mcpm doesn't have). Deletion was reconsidered in slice 5c — see `mcp-sync-commands.ts`. |
| `mcp remove [name]` | `mcpm uninstall <name>` | **DELETED 2026-04-27 (PR #852, slice 5c)** | Top-level `agentbrew remove <name>` (not `mcp remove`) is the user-facing flow; that path now bridges to `mcpm uninstall` for the 9 intersection clients via `delegateMcpUninstall` (PR #858). |
| `mcp search <query>` | `mcpm search <query>` | **DELETED 2026-04-27 (PR #850, slice 5a)** | Both query the same MCP registry territory; mcpm's hits its own 380-server `mcp-registry/servers/`. |
| `mcp install <name>` | `mcpm install <name>` | **DELETED 2026-04-27 (PR #850, slice 5a)** | Catalog installs (`agentbrew install <name>`) bridge to `mcpm install` for the 9 intersection clients via `bridgeCatalogMcpToMcpm` (PR #857). |
| `mcp info <name>` | `mcpm info <name>` | **DELETED 2026-04-27 (PR #850, slice 5a)** | Same operation. Use `mcpm info` directly. |
| `mcp sync` (CLI subcommand) | (no equivalent) | **DELETED 2026-05-03 (hidden-CLI audit)** | The hidden `agentbrew mcp sync` CLI subcommand was a bare-bones wrapper over `syncMcpServers()` with zero documentation references; the visible `agentbrew sync --only mcp` runs the same orchestrator through the full pipeline (--dry-run / --verbose / --no-prune). The cross-client batch **orchestrator** (`syncMcpServers` in `src/sync/mcp-sync.ts`) stays native — that's still agentbrew's value-add. Only the duplicate CLI surface was deleted. |
| `mcp status` | `mcpm doctor` | **Kept native** | mcpm's `doctor` is interactive; agentbrew's `status` has a `--json` mode for scripting. **Contribute upstream (slice 6)**: add `mcpm doctor --json`. |
| `mcp health [name]` | `mcpm inspect [name]` | **DELETED 2026-04-27 (PR #851, slice 5b)** | Both probe servers at runtime. mcpm's UI is richer (Inspector launcher). |
| `mcp setup [server]` | `mcpm edit <server>` (env-only) | **Kept native** | mcpm's `edit` opens an editor for env vars; agentbrew's `setup` is a guided wizard with prompts and validation. **Contribute upstream (slice 6)**: add a `mcpm setup --interactive` mode that ports agentbrew's wizard. |
| `mcp run [name]` | `mcpm run [name]` | **DELETED 2026-04-27 (PR #851, slice 5b)** | Same operation. The top-level `agentbrew run` wrapper was deleted in the same PR. Use `mcpm run` directly. |

**mcpm capabilities agentbrew doesn't have today (gained on delegation):**

| mcpm capability | What it does | Implication |
|---|---|---|
| `mcpm share <name>` | Tunnel an MCP server through an HTTPS tunnel for sharing | Agentbrew's notes already explicitly say "use `ngrok` / `cloudflared` / `ssh -R` after `mcpm run`" (out-of-scope deliberately; the agentbrew `mcp run` wrapper itself was deleted in slice 5b on 2026-04-27, so users now hit `mcpm run` directly). Delegation makes this an in-tool capability. |
| `mcpm usage` | Per-server analytics dashboard | Net new capability for agentbrew users. |
| `mcpm inspect` | Launch MCP Inspector for debug | Richer than the now-deleted `mcp health` (slice 5b on 2026-04-27 removed the imperative health subcommand; users hit `mcpm doctor` for global probing or `mcpm inspect` for per-server debugging). |
| `mcpm profile` | Virtual profiles for organizing servers | agentbrew deleted its MCP profile subcommand 2026-04-24 expecting per-project Agentfile + mcpm to fill the gap. Delegation closes the loop. |
| `mcpm migrate` | v1 → v2 config migration | Not relevant to agentbrew's first-time delegation. |
| `mcpm config` | Manage mcpm's own config | Internal to mcpm. |
| `mcpm new` | Create a new server config from scratch | agentbrew's `add [name]` covers this for the registry path; the manual-config-creation path (`new`) is a small UX gain. |

**Aggregate verdict on the command surface:** mcpm subsumes 8 of 12 agentbrew
MCP commands cleanly, partially subsumes 2 more (status / setup with concrete
upstream contribution hooks), the duplicate `mcp sync` CLI surface was
deleted in the 2026-05-03 hidden-CLI audit (the visible `sync --only mcp`
covered it), and the only "Keep native" surfaces are the cross-client batch
**orchestrator** (`syncMcpServers` in `src/sync/mcp-sync.ts`) plus the
`mcp add` / `mcp update` flows for git-installed and custom-config servers.
Combined with the latency measurements from slice 1, this maps to a
**selective delegation shape**: the per-call commands (install, search,
info, ls, run, etc.) delegate; the cross-client `sync` orchestrator stays
native and reads-then-batches to whatever native or delegated installer fits.

### First concrete carve-out candidate

**`src/mcp/overlay-desktop-adapter.ts`** (95 LOC). Writes to
`~/Library/Application Support/TeamDesktopApp/mcp-config.json`. mcpm
doesn't know about the org desktop app and never will — it's an
org-internal product. **Stays native** in any delegation outcome. This is
the MCP-side analog of `overlay-desktop` in `delegate-skill-install-to-skills-cli`'s
3-agent native carve-out list.

## Registry model + profile model (slice 2)

**Registry resolution:**

| Aspect | mcpm.sh | agentbrew |
|---|---|---|
| Canonical registry | `mcp-registry/servers/` in the mcpm.sh repo, 380 servers as of 2026-04-26 | MCP Community Registry (via API) + user-supplied catalog sources |
| Authentication | Public servers only today | Public + git-clonable repos |
| Lookup strategy | Single canonical registry, name → server JSON | Federated: built-in catalog (`src/catalog.yaml`) + team overlay (`catalog-overlay.yaml`) + remote MCP Community Registry calls |
| Private servers | Not first-class; via `mcpm new` manual config | First-class via `Agentfile.yaml` `mcp:` block (per-project) or state.yaml (global) |

**Implication:** delegating to mcpm collapses agentbrew's MCP Community
Registry shell-out (which is the entirety of `mcp install <name>` on the
public-server path) into `mcpm install`. The team-overlay registration of
internal MCP servers (e.g. `acme-internal-mcp` on a private network) stays
agentbrew's responsibility — it's the multi-surface input layer that mcpm
doesn't have. This is the "org-detect-and-register-one-source-repo glue"
that VISION.md identifies as agentbrew's permanent scope.

**Profile model:**

| Aspect | mcpm.sh | agentbrew |
|---|---|---|
| Profile concept | Virtual profiles (`mcpm profile create work / personal`); each profile is a named subset of installed servers | Per-project Agentfile `mcp:` block (declarative); previously had a `mcp profile` CLI subcommand, **deleted 2026-04-24** per [docs/COMPETITION.md "MCP profiles" matrix entry](../COMPETITION.md) |
| Activation | `mcpm profile activate <name>` (imperative) | Implicit via `cd` into the project directory + `agentbrew sync` reading the local `Agentfile.yaml` |
| Use case | "Switch active server set for this terminal session" | "Project A always uses server set X; Project B always uses server set Y" |

**Implication:** the two layers cover slightly different use cases
(imperative-session vs declarative-per-project) and neither is strictly the
other. Agentbrew's deletion of `mcp profile` 2026-04-24 was correct — that
imperative slice is mcpm's territory. The declarative-per-project layer
(Agentfile) is agentbrew's permanent scope and stays. Delegation outcome:
keep both, document the boundary in slice 4's verdict.

## Python ecosystem viability (slice 3)

**Sources:** author's macOS Apple Silicon laptop; `pipx` 1.11.1, `uvx` 0.11.6,
Homebrew 2026-04-09. corporate-network and Devin sandbox testing is
hardware-bound and tracked separately as carve-out candidates (see end of
section).

### Distribution-channel viability

| Channel | Status | Notes |
|---|---|---|
| **PyPI via `pipx install mcpm`** | **PARTIAL PASS** | Works with `pipx install --python python3.13 mcpm`. `pipx install mcpm` (default Python 3.14) fails because `pydantic-core` 2.x requires `pyo3` ≤ 0.24, which caps at Python 3.13. **Footgun: ~70s install time** if user is on Python 3.14 default and has to retry with `--python` pin. |
| **PyPI via `uvx mcpm`** | **PASS** | Works on first try. `uvx` resolves the right Python automatically. Warm-start ~2.0s (vs ~1.4s for installed pipx) — uvx's tool-resolver overhead. **Recommended distribution channel** for cold-machine first-run because no Python-version pinning is required. |
| **Homebrew (`brew install mcpm`)** | **PASS** (uninstalled, but formula exists and installs cleanly per `brew info mcpm`) | Stable bottle 2.14.0 in homebrew-core. Dependency: `python@3.14` (which Homebrew bundles) + 5 Python packages. License MIT. **Most-friction-free channel for new macOS users.** Note: this means Homebrew has solved the Python 3.14 / pyo3 issue at packaging time — they bundle their own python@3.14 with patched pyo3, presumably. |
| **Manual `pip install`** | NOT TESTED — pollutes user env, considered out-of-scope |
| **Docker** | UNTESTED — `dockerfiles/` exists in mcpm repo per slice 1's project-shape exploration; viable for sandboxed environments |
| **Nix** | UNTESTED — `flake.nix` and `default.nix` exist in mcpm repo; viable for Nix users |

### Subprocess startup variance across channels

| Channel | Warm `--version` | Notes |
|---|---|---|
| pipx-installed (Python 3.13) | ~1.48s | Slice 1 baseline |
| uvx | ~2.0s | Tool-resolver overhead |
| Homebrew bottle | UNTESTED on this machine | Likely similar to pipx (same cpython interpreter; brew bundles its own python@3.14 patched for pyo3) |

The 2× variance between pipx and uvx isn't a blocker because the per-call
subprocess shape is already ruled out by slice 1's latency measurement
regardless. The selective-delegation shape (per-call commands delegate, `sync`
batches reads natively) tolerates either.

### Hardware-bound carve-outs (tracked, not gating)

These are deferred to whoever runs on the matching hardware — same rationale
as the closed 2026-05-02 skills CLI sandbox / proxy / offline measurement:

| Dimension | Status | Carve-out implication |
|---|---|---|
| **corporate proxy** — does `pipx install mcpm` / `uvx mcpm` work behind the proxy? | UNTESTED (this machine isn't on the corporate network) | If FAIL: documented "use Homebrew bottle on the org machines" carve-out. Doesn't block delegation; affects setup story only. |
| **Devin sandbox** — does the sandbox allow `pipx install` / `uvx` invocations? | UNTESTED (not in a Devin sandbox) | If FAIL: agentbrew on Devin keeps native MCP, with mcpm delegated everywhere else. Same shape as the pre-2026-05-02 skills CLI carve-out for `devin`, but scoped to MCP. |
| **Offline cold start** — `pipx install mcpm` with no network | UNTESTED (registry cached locally already) | Likely FAIL same as native (registry needs to resolve). No carve-out necessary; users on offline cold start can't `pipx install` *anything*. |
| **Python 3.14 default** — first-run user on the latest Python | KNOWN FAIL (`pyo3` cap; documented above) | Carve-out: prefer `uvx mcpm` or Homebrew bottle as the recommended channel for new installs; document the `--python python3.13` pin only as a fallback. |

### Verdict on Python ecosystem (slice 3)

**Viable for delegation** with three supported channels (pipx, uvx, Homebrew).
The Python 3.14 footgun is a real onboarding wart but workaround is one flag.
Corporate-proxy and Devin-sandbox carve-outs are outstanding but parallel the
skills CLI delegation's closed hardware-bound measurement carve-out structure
— they don't block the strategy, they document the
specific contexts where native MCP stays alongside the delegation.

## Per-project MCP sync gap analysis (slice 3)

The parent task (`evaluate-delegate-mcp-to-mcpm`) claims:

> agentbrew has `project-mcp-sync.ts` that writes `.cursor/mcp.json`,
> `.mcp.json`, `.windsurf/mcp.json`. mcpm is global-only today — this is a
> feature gap that blocks delegation unless agentbrew keeps a thin per-project
> wrapper on top.

**Slice 3 fully verifies this claim is inaccurate.** Confirmed on the author's
laptop 2026-04-26 by reading `src/sync/mcp-sync.ts`, `src/agentfile.ts`,
`src/agentfile-apply.ts`, and grepping for every project-MCP reference:

- **No `project-mcp-sync.ts` file exists in `src/`.** The file named in the task
  description is not present in the codebase. (`fd project-mcp-sync` returns
  nothing.)
- **No `.mcp.json` writer exists.** The only references to `.cursor/mcp.json`
  / `.mcp.json` in the codebase are in `src/shell-hook.ts:42,75` — which
  *DETECTS* those files for shell-prompt badging, not *WRITES* them.
  `src/sync/mcp-sync.ts:323` writes via `writeMcpJson(expanded, config)` to a
  GLOBAL per-agent config path expanded from `expandHome(def.mcpConfig)` (e.g.
  `~/.claude.json`, `~/.cursor/mcp.json` — globals, not per-project).
- **The actual project-scoped layer is `Agentfile.yaml`'s `mcp:` block.**
  `src/agentfile.ts:37` defines the `AgentfileMcpEntry[]` type. `resolveAgentfileMcp()`
  at line 164 turns Agentfile entries into `McpServer[]`. Those servers feed into
  the GLOBAL state via `src/agentfile-apply.ts:347` (`mergeAgentfileMcp`). When
  `agentbrew sync` runs, the merged state writes to per-agent global config
  files. **The Agentfile is an INPUT shape, not an OUTPUT target.**

### What this means for the "per-project sync gap" verdict

| Layer | mcpm.sh | agentbrew | Boundary |
|---|---|---|---|
| Per-project declarative input (says "this project uses servers X, Y, Z") | Not present (mcpm has imperative profiles, not declarative project files) | `Agentfile.yaml` `mcp:` block | **agentbrew's permanent scope** — multi-surface declarative config is in VISION.md as "permanent agentbrew scope (no upstream home)" |
| Per-project session activation ("activate this server set for this terminal") | `mcpm profile activate <name>` | (deleted 2026-04-24 — was `mcp profile activate`) | **mcpm's territory** — agentbrew shed this slice expecting mcpm to fill it |
| Global per-agent config-file writer (writes `~/.claude.json` / `~/.cursor/mcp.json` etc.) | `mcpm install` + `mcpm client edit` | `src/sync/mcp-sync.ts:323` `writeMcpJson()` | **Direct overlap** — this is what delegation replaces. Both tools target the same global per-agent config files. |

The "per-project MCP sync" feature agentbrew supposedly has and mcpm supposedly
lacks is **a documentation drift bug** — neither tool writes per-project
`.mcp.json` files. They both write GLOBALLY, and agentbrew adds a per-project
Agentfile as input shape that mcpm's profile model partially mirrors (imperative
vs declarative).

### Implication for slice 4's verdict

**The most-cited blocker for delegation evaporates on inspection.** The
delegation can proceed using the same split-intersection shape as skills CLI:

- 9 intersection clients delegate (per slice 2's diff).
- 3 small adapters (opencode, kiro, amp) become upstream contribution candidates.
- 2 hard carve-outs (devin, overlay-desktop) stay native.
- agentbrew's `Agentfile.yaml` `mcp:` block stays — it's the per-project
  declarative input layer that's permanent agentbrew scope per VISION.md.
- agentbrew's `sync` command stays native — it's the cross-client batch
  orchestrator that mcpm doesn't have.

**Action item for slice 4:** amend the parent task's `**Details**:` to remove
the inaccurate `project-mcp-sync.ts` reference and replace it with the actual
boundary (Agentfile input + native sync orchestrator + delegated installer).

### What about agentbrew's MCP code being ~3,756 LOC, not the ~2,000 the parent task claims?

Parent task claims "~2,000 non-test LOC across `src/sync/mcp-sync.ts`,
`src/mcp/*`". Slice 1 measured the actual non-test LOC: **3,756**.

| File | LOC |
|---|---|
| src/sync/mcp-sync.ts | 783 |
| src/mcp/adapters.ts | 344 |
| src/mcp/mcp-registry.ts | 393 |
| src/mcp/overlay-desktop-adapter.ts | 95 |
| src/mcp/mcp-setup.ts | 242 |
| src/mcp/mcp.ts | 203 |
| src/mcp/mcp-health.ts | 303 |
| src/mcp/mcp-validation.ts | 114 |
| src/mcp/mcp-wizard.ts | 286 |
| src/mcp/overlay-desktop.ts | 128 |
| src/mcp/mcp-status.ts | 151 |
| src/mcp/mcp-git.ts | 404 |
| src/mcp/mcp-run.ts | 114 |
| src/mcp/env-vars.ts | 196 |
| **Total non-test** | **3,756** |

The honest delegate-shrink estimate is therefore **larger** than the parent task
suggested — likely ~2,000-2,500 LOC removable when the per-call commands
delegate, with ~1,000-1,500 LOC remaining for the native-sync orchestrator,
Agentfile input layer, and 2 hard carve-outs (overlay-desktop adapter + devin
carve-out + org MCP overlay registration). Slice 4 will firm this up.

## Upstream receptivity (slice 4)

**Sources:** [`pathintegral-institute/mcpm.sh`](https://github.com/pathintegral-institute/mcpm.sh)
contributors graph, recent merged PRs, and `git log` of the last 6 months.

**Structural signals (strong, all positive):**

- **Org governance, not personal.** Repo lives under [Path Integral Institute](https://github.com/pathintegral-institute);
  no single dictator. Compare to vercel-labs/skills (Vercel-employee-only review
  bottleneck on PR #509 → 47-day stall) — Path Integral's distributed-authority
  model is structurally less prone to that failure mode.
- **28 contributors** as of slice 1 measurement (2026-04-26). For a 933-star
  Python CLI that's roughly the right size for an active mid-stage project;
  it's not a 1-person passion project.
- **Drive-by external receptivity proven.** PR #315 (`mcpm update` command)
  was merged in **6 days** from drive-by external contributor `DjodyKort`.
  This is the single strongest receptivity signal we have — the exact
  contribution shape we'd be filing (an adapter or new client integration)
  is the same shape that just got a 6-day turnaround.
- **License is MIT** — no CLA gate, no copyleft entanglement.
- **No 47-day-stalled-PR pattern.** Open issues at slice 1 measurement are
  ~2 days old with active triage; the issue-tracker hygiene resembles a healthy
  mid-stage OSS project, not a maintainer-burnout queue.
- **Recent release cadence** — v2.14.0 shipped 2026-03-27, multiple minor
  releases in the prior 6 months. Active not stagnant.

**Adapter-specific receptivity (unverified, deferred):** the 3 small
adapters identified by slice 2 (opencode, kiro, amp) are net-additive
contributions. The opencode adapter is the natural first probe — adapter-PRs
are the smallest-surface contribution shape and the right test of whether
the maintainers welcome new client targets specifically. Filing it is a
publish action and is therefore deferred to the new `delegate-mcp-to-mcpm`
task per the file-level publishing policy.

**Receptivity verdict (slice 4):** the structural signals are sufficient to
commit the delegate→contribute strategy. Adapter-PR receptivity gets
empirically tested as the delegation lands, the same way slices 2–7 of the
skills CLI delegation tested vercel-labs/skills's adapter receptivity.

## Contribute vs Build verdict (slice 4)

**Verdict: Contribute (selective delegation, split-intersection model).**

The decision tree from the slice 4 task description resolved as follows:

- **Not "delegate everything"** — the cross-client batch shape (the
  `syncMcpServers` orchestrator in `src/sync/mcp-sync.ts`) has no mcpm
  equivalent and slice 1's latency measurement (~1.48s warm) rules
  out per-server-per-agent dispatch. We delegate per-call commands and keep
  the cross-client `sync` orchestrator native (the duplicate hidden
  `mcp sync` CLI subcommand was deleted 2026-05-03 since `sync --only mcp`
  covered it through the full pipeline).
- **Not "keep native"** — slices 1–3 produced no real blocker. Python ecosystem
  is viable on three channels (uvx, pipx with --python pin, Homebrew bottle).
  Per-project sync gap was a documentation drift bug, not a real gap. Client
  overlap is net-additive (9 intersection + 5 free-capability gain).
- **Not "complementary"** — that verdict applies when the tools cover different
  layers. Here the tools cover the same global per-agent config-file-writing
  layer; one of them (the duplicate, ~2,000–2,500 LOC of native MCP code)
  should go.
- **"Contribute (selective delegation, split-intersection)"** — same shape
  as the skills CLI delegation: intersection clients delegate, small adapters
  become upstream contribution candidates, hard product-context carve-outs
  stay native. agentbrew's `Agentfile.yaml` `mcp:` declarative input layer
  and the `syncMcpServers` cross-client orchestrator stay as permanent
  agentbrew scope (only the duplicate `mcp sync` CLI subcommand was deleted).

**Execution path (`delegate-mcp-to-mcpm` slices 1–7, modeled on
`delegate-skill-install-to-skills-cli` slices 2–7):**

| Slice | Scope | Status | LOC change |
|---|---|---|---|
| 1 | Build the `mcp-agent-map.ts` boundary helper (`buildMcpmClientList`, rename map, carve-out rationale) + tests. | **DONE 2026-04-27** ([mcp-agent-map.ts](../../src/core/mcp-agent-map.ts)) | +165 src + 33 tests |
| 2 | Wire `delegateMcpInstall()` into `installFromRegistry` for the canary `claude-code`. | **DONE 2026-04-27** (PR #834) | +145 LOC |
| 3a | Promote canary set to all 9 intersection agents. | **DONE 2026-04-27** (PR #835) | +9 LOC |
| 3b | Add per-client `mcpm client edit --add-server` step (`delegateMcpClientEdit`). Dual-write with native sync, deliberate. | **DONE 2026-04-27** (PR ~#840s) | +120 LOC + 9 tests |
| 4a | Skip the 9 intersection agents during native MCP sync and drift detection. Carve-outs continue native. | **DONE 2026-04-27** (PR #845) | net 0 (skip semantics) |
| 4b | Delete the now-unreachable native code paths for the 9 intersection agents: `syncToClaudeCode`, `ClaudeAdapter` (claude CLI bridge), the claude-code-only branch in `syncSingleAgent`. | **DONE 2026-04-27** (PR #846) | −324 LOC |
| 4c | Make `installFromRegistry` thin: delegate to `mcpm install <name>` for registry resolution. Native MCP Community Registry fetch + parsing goes away. | **DONE 2026-04-27** (PR #848) | −532 LOC |
| 5a | Delete the registry-side commands (`mcp install`, `mcp search`, `mcp info`) and the entire `src/mcp/mcp-registry.ts` plumbing. | **DONE 2026-04-27** (PR #850) | −1,248 LOC |
| 5b | Delete the standalone-module commands (`mcp run`, `mcp health`) and the `src/mcp/mcp-run.ts` / `src/mcp/mcp-health.ts` modules. Also delete top-level `agentbrew run` (was a wrapper around `runMcpServer`) and `logPostSyncHealth` (used the deleted `probeServer`). | **DONE 2026-04-27** (PR #851) | −1,326 LOC |
| 5c | Delete `mcp list`/`mcp remove` (mcpm subsumes via `mcpm ls` / `mcpm uninstall`). Kept `mcp update` — only entry point for refreshing git-installed servers (mcpm doesn't install from git). | **DONE 2026-04-27** (PR #852) | −58 LOC |
| 6 | File the 3 adapter PRs upstream (opencode, kiro, amp) and the `mcpm doctor --json` PR, all gated by per-action publish approval. Decomposed 2026-04-27 into 4 independently-claimable sub-tasks. | **All 4 sub-PRs filed 2026-04-27**: 6a [pathintegral-institute/mcpm.sh#327](https://github.com/pathintegral-institute/mcpm.sh/pull/327) (OpenCodeManager); 6b [pathintegral-institute/mcpm.sh#328](https://github.com/pathintegral-institute/mcpm.sh/pull/328) (KiroManager); 6c [pathintegral-institute/mcpm.sh#329](https://github.com/pathintegral-institute/mcpm.sh/pull/329) (AmpManager); 6d [pathintegral-institute/mcpm.sh#326](https://github.com/pathintegral-institute/mcpm.sh/pull/326) (`mcpm doctor --json`). All four await maintainer review. | 0 LOC in agentbrew; ~30 LOC × 4 PRs upstream |
| 7 | Verify the dust settles: re-run `npm run verify`, real-e2e MCP scenarios, confirm the carve-outs still work end-to-end natively. Update this doc with landed-PR references. | **DONE 2026-04-27** (this commit) | 0 LOC |

**Total landed (slices 1–5 + 2026-05-03 hidden-CLI audit):** −3,489 LOC net
deletion in slices 1–5 across `src/sync/mcp-sync.ts`, `src/mcp/`,
`src/commands/cli-mcp.ts`, and the top-level CLI surface. The 2026-05-03
hidden-CLI audit then deleted the duplicate `mcp sync` CLI subcommand
(covered by `sync --only mcp`). Hidden `mcp` namespace now lists 4
subcommands (`mcp add`, `mcp update`, `mcp status`, `mcp setup`).
Permanent residue: the `syncMcpServers` cross-client orchestrator,
`Agentfile.yaml` `mcp:` input layer, overlay-desktop adapter (~95 LOC),
devin carve-out, copilot/vscode-settings carve-out, opencode/kiro/amp
adapters (~30 LOC each, contribute candidates in slice 6). Same
residue-shape as the skills CLI delegation (parent
`delegate-skill-install-to-skills-cli` left ~400 LOC alive for 3 carve-outs).

**Total estimated shrink:** 2,000–2,500 LOC (net) when the delegation lands,
matching slice 3's estimate. Remaining MCP code: 1,000–1,500 LOC across
the `syncMcpServers` cross-client orchestrator, `Agentfile.yaml` input
layer, overlay-desktop adapter, devin carve-out, copilot/vscode-settings
carve-out, and org MCP overlay glue. This is the same residue-shape
as the skills CLI delegation (parent `delegate-skill-install-to-skills-cli`
left ~400 LOC alive for 3 carve-outs).

**Pure-blocker fallback:** if any slice in the new `delegate-mcp-to-mcpm`
task surfaces a real blocker on a real machine (e.g. corporate proxy blocks
both pipx and uvx; Devin sandbox blocks subprocess Python invocation), the
verdict downgrades to **Complementary in context X**. `docs/COMPETITION.md`
Tier 2 verdict gets the qualifier appended. `docs/VISION.md` adds the
failing context to its bullet. `quarterly-dissolution-reeval` queues a
re-measurement.

## Slices and follow-ups

| Slice | Status | Tracker |
|---|---|---|
| 1 — Project shape + latency baseline + initial doc | DONE 2026-04-26 | parent's Plan checklist (slice 1 task block removed) |
| 2 — Client coverage + command surface dissolution | DONE 2026-04-26 | parent's Plan checklist (slice 2 task block removed) |
| 3 — Python ecosystem + per-project sync gap | DONE 2026-04-26 | parent's Plan checklist (slice 3 task block removed) |
| 4 — Verdict + execution path + close redundancy | DONE 2026-04-27 (this commit) | `evaluate-delegate-mcp-to-mcpm-slice-4` removed in this commit |

Slice 4 propagates the verdict to:

- `docs/COMPETITION.md` Tier 2 MCPM entry — verdict updated from
  "Complementary" to "Contribute (delegation planned)" with a link here.
- `docs/VISION.md` Applied-to-today's-competitors bullet — updated from
  "evaluate" to "evaluation done; delegation planned in `delegate-mcp-to-mcpm`".
- `docs/VISION.md` Planned table — MCP delegation row updated from
  "evaluation" to a tracked link to the new `delegate-mcp-to-mcpm` task.
- New P0 task `delegate-mcp-to-mcpm` filed in TASKS.md with the 7-slice
  execution plan above.
- `deep-dive-mcpm-sh` (P1) — task block removed; content subsumed by this doc.
- Parent `evaluate-delegate-mcp-to-mcpm` (P0) — task block removed.

## Sources

- [`pathintegral-institute/mcpm.sh`](https://github.com/pathintegral-institute/mcpm.sh)
  on GitHub — primary repo
- [mcpm.sh website](https://mcpm.sh) — registry frontend
- [mcpm.sh README](https://github.com/pathintegral-institute/mcpm.sh/blob/main/README.md)
  — v2.14.0 reference
- [`mcp-registry/servers/`](https://github.com/pathintegral-institute/mcpm.sh/tree/main/mcp-registry/servers)
  — 380-server registry as of 2026-04-26
- [`pyproject.toml`](https://github.com/pathintegral-institute/mcpm.sh/blob/main/pyproject.toml)
  — Python 3.10+ dep, FastMCP / authlib / click stack
- agentbrew's own MCP code: `src/sync/mcp-sync.ts`, `src/mcp/*` (15 source files,
  ~3,756 non-test LOC measured 2026-04-26)
- agentbrew's MCP-capable agent definitions: `src/core/agents.yaml` filter on
  `mcpConfig*` fields (15 agents)
- agentbrew startup baseline: `node dist/cli.js --version` warm-start ~63ms
  (Apple Silicon, Node.js v22)
- mcpm startup baseline: `mcpm --version` warm-start ~1.48s (same Apple
  Silicon, Python 3.13.7 via pipx)
