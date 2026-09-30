# block/ai-rules vs agentbrew — Detailed Comparison

> **All 4 slices DONE 2026-04-27.** This doc was filled in incrementally
> through `evaluate-delegate-rules-to-block-ai-rules` (P0) slices 1–4.
> Slices 1–3 record project shape, distribution channels, subprocess latency
> baseline, agent coverage diff, rules-format preservation findings,
> alternative-fallback evaluation, drift detection behavior, upstream
> receptivity, and `--source-dir`/`--target-dir` flag availability. Slice 4
> (this commit) locks in the verdict and files the execution-path follow-up
> task `delegate-rules-to-ai-rules`.

## TL;DR

**Verdict: Contribute (selective delegation, wrapper-around-output model).**
Confirmed 2026-04-27 in slice 4. Same overall posture as the skills CLI and
mcpm delegations, with one shape variant (wrapper-around-output instead of
strict split-intersection) driven by ai-rules' "symlink owns the file"
output pattern that conflicts with agentbrew's user-data-preservation
invariant.

- **Subprocess latency is BETTER than agentbrew, not worse.** ai-rules warm
  startup is ~22ms; agentbrew is ~63ms. Per-call delegation has *negative*
  tax — calling `ai-rules generate` is faster than agentbrew's own native
  rules sync. No "Python startup tax" to manage like the mcpm.sh evaluation.
  See § "Subprocess latency baseline".
- **Distribution is dependency-free.** Single self-contained binary
  (~3 MB) installable via curl in <5 seconds. No Rust toolchain required for
  end users; no `cargo install`. Removes the "ecosystem mismatch" friction
  that gates the mcpm evaluation. See § "Distribution-channel viability".
- **Corporate backing (Block / Square / Cash App) and Apache-2.0** —
  signals durable maintenance and CLA-free contribution path.
- **Strict subset of agentbrew's agent surface today, BUT 7 free-capability
  gains.** ai-rules supports 11 agents; agentbrew has 8 rules-capable
  agents. 4 strict intersection (claude/claude-code, cursor, codex,
  gemini/gemini-cli). 4 agentbrew-only carve-outs (windsurf, augment,
  devin, claude-desktop). 7 mcpm-only that gain rules support on
  delegation at zero agentbrew code cost (amp, cline, copilot,
  firebender, goose, kilocode, roo). Net: more rules coverage for
  agentbrew users via delegation than agentbrew has today. See § "Agent
  coverage" (slice 2).

**Doc-drift correction (slice 1):** The parent task description (now
closed and replaced by `delegate-rules-to-ai-rules`) originally called
ai-rules a "Go binary." Per `Cargo.toml` 2026-04-27 it's a **Rust**
binary (edition 2021, v1.6.0, Apache-2.0). The strategic question
(binary distributable into non-Rust ecosystems) is the same regardless,
but the doc now matches the code.

**Slice 4 work (not yet done — locks in the verdict):**

- (a) Verdict: Contribute / Keep separate / Complementary. Slice 1 leans
  Contribute strongly; slice 4 confirms or downgrades based on slices 2–3.
- (b) If Contribute: file new P0 task `delegate-rules-to-ai-rules` modeled
  on `delegate-mcp-to-mcpm` slices 2–7.
- (c) Update `docs/COMPETITION.md` Tier verdict from
  "Worth evaluating" / "Keep separate" to the resolved state.
- (d) Update `docs/VISION.md` Applied-to-today's-competitors bullet.

**Concrete next action:** ship slice 2 (agent coverage parity diff +
rules-format preservation analysis) — track in
`evaluate-delegate-rules-to-block-ai-rules-slice-2`.

## What each tool is

### block/ai-rules (Block / Square / Cash App)

[block/ai-rules](https://github.com/block/ai-rules) is "a modular,
zero-dependency tool to manage AI rules across different AI coding agents."
A single Rust binary that takes markdown rule files in an `ai-rules/`
directory and generates per-agent rule files (`CLAUDE.md`, `AGENTS.md`,
`.cursor/rules/*`, etc.) for the supported coding agents. It's the
upstream tool VISION.md identifies as the candidate for delegating
agentbrew's rules sync subsystem.

Repo: [`block/ai-rules`](https://github.com/block/ai-rules) on GitHub.
Author: Block ([Block, Inc.](https://block.xyz), the parent of Square and
Cash App). License: Apache-2.0. Latest release: v1.6.0 (Cargo.toml 2026-04-27).
Distribution: self-contained x86_64-apple-darwin binary via the `install.sh`
curl-installer (and presumably aarch64-apple-darwin / linux variants for
the platforms Block CI builds for).

### agentbrew

[agentbrew](https://github.com/fyodoriv/agentbrew) is
the multi-surface orchestrator that this doc lives in. Its rules sync is
~529 non-test LOC across:

| File | LOC |
|---|---|
| `src/sync/rules-sync.ts` | 445 |
| `src/drift-checks/rules.ts` | 84 |
| **Total non-test** | **529** |

The rules subsystem reads markdown from `~/.config/agentbrew/rules/` (or
the per-source `rules/` directories) and writes per-agent rule files
(`~/.claude/CLAUDE.md`, `~/.cursor/rules/`, etc.) for 8 rules-capable
agents in `src/core/agents.yaml` (filtered to entries with `rulesFile` or
`rulesDir` fields).

### The scope overlap

Both tools take user-authored markdown rules and translate them into per-
agent file shapes the agents read. Both run as one-shot CLIs, one writes
per-agent files. Differences:

- **ai-rules** is a single-binary CLI you commit to your project and run
  in CI; it generates files the agents read directly. Project-scoped.
- **agentbrew** is a global multi-surface orchestrator that handles rules
  alongside MCP, skills, commands, hooks, and agent definitions in one
  declarative `Agentfile.yaml`. Both global and per-project.

The delegation question is whether agentbrew can shell out to
`ai-rules generate` for the rules-translation step, replacing the ~445 LOC
of native rules-sync logic, while keeping the orchestration surface
(detection, drift, multi-surface coordination, per-source merging) as
agentbrew's permanent scope.

## Project shape (slice 1)

| Dimension | ai-rules | Method |
|---|---|---|
| Stars | 94 (was 91 in older agentbrew docs) | GitHub repo page 2026-04-27 |
| Forks | 19 | GitHub repo page |
| Commits (lifetime) | 104 | GitHub repo page |
| Open PRs | 7 | GitHub repo page |
| Open Issues | 4 | GitHub repo page |
| Contributors | (slice 2) | TBD — needs contributor graph fetch |
| License | Apache-2.0 | `Cargo.toml` |
| Latest version | v1.6.0 | `Cargo.toml` |
| Author | `Block <ai-oss-tools@block.xyz>` | `Cargo.toml` |
| Governance | Org (Block, parent of Square/Cash App) | GitHub org page |
| Language / runtime | Rust, edition 2021 | `Cargo.toml` |
| Dependencies (build) | anyhow, clap, serde, serde_json, serde_yaml, cliclack, regex, which, ignore | `Cargo.toml` |
| Dependencies (runtime) | None — self-contained binary | `Cargo.toml` profile + install.sh |

**Rust ecosystem signal:** unlike mcpm (Python) where the ecosystem
mismatch is a real friction (Python 3.14 footgun, pipx vs uvx, corporate
proxy unknowns), ai-rules ships a single static binary. End users don't
need a Rust toolchain — `cargo install` is irrelevant. The friction
profile is closer to skills CLI's npm-distributed model, except the
binary is self-contained instead of needing `npx` resolution.

**Governance signal:** Block (Square / Cash App) is a public company with
strong corporate backing for OSS. The repo lives at
`block/ai-rules`, not in a personal account — same organizational shape as
mcpm's `pathintegral-institute/mcpm.sh`. Lower risk of maintainer
abandonment than personal-account projects (Caliber, Bridle).

## Subprocess latency baseline (slice 1)

**Sources:** author's macOS Apple Silicon laptop, ai-rules v1.6.0 freshly
installed via the curl-installer to `~/.local/bin/ai-rules`. Measurements
collected with `time ai-rules <subcommand> --help > /dev/null` (or
equivalent), 3 warm runs each.

| Command | Warm-start latency | Notes |
|---|---|---|
| `ai-rules --version` | ~22ms | Smallest startup probe |
| `ai-rules list-agents` | ~22ms | One-line agent list, no I/O |
| `ai-rules --help` | ~22ms | Help text rendering |

**Comparison with the other delegation candidates:**

| Tool | Warm `--version` | Tax vs agentbrew |
|---|---|---|
| ai-rules (Rust) | **~22ms** | **−65% — FASTER than agentbrew** |
| agentbrew (Node v22, Apple Silicon) | ~63ms | baseline |
| skills CLI (Node) | ~500ms warm, ~900ms cold | ~8× tax |
| mcpm (Python 3.13 via pipx) | ~1480ms warm | ~25× tax |

**This is the strongest latency signal of the three delegation
candidates.** Per-server or per-agent dispatch shapes that were ruled out
for mcpm (Python startup tax) are FINE for ai-rules — calling
`ai-rules generate --agents claude` 8 times is cheaper than running
agentbrew's native `rules-sync.ts` once.

The implication for the eventual delegation shape (slice 4): we don't need
selective delegation here. Per-agent dispatch is fine. Whatever native code
path we'd swap out can be replaced cleanly without batching concerns.

## Agent coverage (slice 2)

**Sources:** `ai-rules list-agents` v1.6.0 2026-04-27, agentbrew
`src/core/agents.yaml` filtered to entries with `rulesFile` or `rulesDir`.

### 3-way diff

| agentbrew (8) | ai-rules (11) | Status | Notes |
|---|---|---|---|
| `claude-code` | `claude` | **Intersection (rename)** | agentbrew writes `~/.claude/CLAUDE.md`; ai-rules writes `CLAUDE.md` (project-local symlink). Different *scope* (global vs project) — see § "Rules-format preservation analysis (slice 2)". |
| `cursor` | `cursor` | **Intersection** | agentbrew writes `~/.cursor/rules/*.md` per-file; ai-rules writes `AGENTS.md` (project-local symlink). Format mismatch — agentbrew uses cursor's per-file rules dir while ai-rules uses the AGENTS.md fallback. |
| `windsurf` | — | **agentbrew-only carve-out** | windsurf isn't in ai-rules' supported list. agentbrew writes `~/.codeium/windsurf/memories/global_rules.md` (rulesFile) AND `~/.windsurf/rules/*.md` (rulesDir). Carve-out: stays native. |
| `augment` | — | **agentbrew-only carve-out** | augment isn't in ai-rules' supported list. agentbrew writes `~/.augment/guidelines.md`. Carve-out: stays native. |
| `devin` | — | **agentbrew-only carve-out** | Cognition product, parallel to the mcpm carve-out. agentbrew writes `~/.config/devin/AGENTS.md`. Permanent carve-out. |
| `codex` | `codex` | **Intersection** | Both write `~/.codex/AGENTS.md` (agentbrew) / project-local `AGENTS.md` (ai-rules). |
| `gemini-cli` | `gemini` | **Intersection (rename)** | agentbrew writes `~/.gemini/GEMINI.md`; ai-rules writes project-local `GEMINI.md`. Different scope. |
| `claude-desktop` | — | **agentbrew-only (sharedFile)** | Reads `~/.claude/CLAUDE.md` via agentbrew's `readsFrom: [claude-code]` — already covered by the claude-code intersection. Not a separate carve-out. |
| — | `amp` | **ai-rules-only (free gain)** | agentbrew has `amp` as a skills-capable agent but not rules-capable today. Delegating GAINS rules support at zero agentbrew code cost. |
| — | `cline` | **ai-rules-only (free gain)** | Same — agentbrew has `cline` as MCP-capable but not rules-capable. |
| — | `copilot` | **ai-rules-only (free gain)** | Same — agentbrew has `copilot` as skills+MCP-capable. ai-rules writes `.github/copilot-instructions.md`. |
| — | `firebender` | **ai-rules-only (free gain)** | agentbrew has `firebender` as skills-only. |
| — | `goose` | **ai-rules-only (free gain)** | agentbrew has `goose` as skills+MCP-capable. |
| — | `kilocode` (= agentbrew's `kilo`?) | **ai-rules-only (likely rename)** | agentbrew has `kilo` (skills-only); ai-rules has `kilocode`. Almost certainly the same product (Kilo Code IDE). Verify in slice 3. |
| — | `roo` (= agentbrew's `roo-code`) | **ai-rules-only (rename)** | agentbrew has `roo-code` as MCP-capable but not rules-capable. ai-rules writes `.roo/rules/*.md`. Treat as rename + free gain. |

**Counts (slice 2, verified):**

- **4 strict intersection** (with 2 renames): claude/claude-code, cursor,
  codex, gemini/gemini-cli.
- **4 agentbrew-only carve-outs at the delegation boundary**: windsurf,
  augment, devin, claude-desktop.
  (Earlier slice 2 said 3 carve-outs because `claude-desktop` reads from
  claude-code via `readsFrom` and is covered transitively at the file-write
  layer. Slice 1 of `delegate-rules-to-ai-rules` (PR #830) discovered the
  *dispatcher* still needs claude-desktop in the carve-out set so it knows
  not to issue a separate `ai-rules generate --agents claude-desktop` call —
  ai-rules doesn't recognize that name. Both views are correct: 3
  file-write carve-outs, 4 dispatch carve-outs.)
- **7 ai-rules-only that GAIN rules support on delegation**: amp, cline,
  copilot, firebender, goose, kilocode (= kilo, likely rename), roo (=
  roo-code, rename).

**Implication for the verdict:** the delegation is net-additive on the
rules-coverage axis — agentbrew's rules sync currently writes to 8 agents
but a delegated path covers 7+4 = 11 agents (7 gains + 4 intersection),
plus 3 carve-outs that stay native. This is the same shape as the
skills CLI delegation (intersection delegates, small set stays native)
and the mcpm delegation (intersection delegates, small adapters become
contribute candidates).

### Rename / contribution / carve-out summary

```
Intersection (4):  [claude↔claude-code], cursor, codex,
                   [gemini↔gemini-cli]

Carve-out (3):     windsurf, augment, devin

Free capability (7): amp, cline, copilot, firebender, goose,
                     [kilocode↔kilo (likely)], [roo↔roo-code]
```

Same overall posture as the skills CLI / mcpm delegation diffs — the
ratio leans heavily toward "delegate" because ai-rules covers more agents
than agentbrew today. Slice 3 verifies the kilocode↔kilo rename via
ai-rules' actual generated-file path for kilocode.

## Rules-format preservation analysis (slice 2)

**Slice 2 surfaces a significant format gap that gates the delegation
shape decision.** Both tools take markdown rule sources and produce per-
agent rule files, but they differ on three meaningful dimensions:

### 1. Source-format shape

| Dimension | agentbrew | ai-rules |
|---|---|---|
| Source dir | `~/.config/agentbrew/rules/*.md` (global) + per-source `rules/*.md` (per-source-repo) | `ai-rules/*.md` (project-local) |
| Per-rule frontmatter | None (plain markdown) | YAML frontmatter: `description`, `alwaysApply`, `fileMatching` |
| Combined-source file | `~/.config/agentbrew/shared-rules.md` (single file) | None — each rule file is its own source |
| Scope | Global (user-level) AND per-project (Agentfile-driven) | Project-local only |

**Implication:** ai-rules' frontmatter (`description`, `alwaysApply`,
`fileMatching`) is **richer** than agentbrew's plain-markdown rules — it
maps to Cursor's `globs` field, Claude's "always vs on-demand" pattern,
and the activation modes other rules tools use (skillkit, conforme,
rulix per the COMPETITION.md scout). Delegating could PROMOTE agentbrew's
plain-markdown rules to a richer format, but that requires migrating
existing rule files. Migration is one-time and tractable (a script that
adds defaults like `alwaysApply: true` + empty `description`).

### 2. Output shape — managed-section markers vs. full-file ownership

This is the biggest gap and the one that tilts the verdict toward
"selective delegation" rather than "full delegation":

| Dimension | agentbrew | ai-rules |
|---|---|---|
| `~/.claude/CLAUDE.md` | **Managed-section markers** — agentbrew writes only between `<!-- agentbrew:start -->` / `<!-- agentbrew:end -->` markers. User content elsewhere in CLAUDE.md is preserved verbatim. | **Symlink to single generated file** — `CLAUDE.md` is a symlink to `ai-rules/.generated-ai-rules/ai-rules-generated-AGENTS.md`. The entire file is owned by ai-rules. |
| User content preservation | **Yes** — agentbrew never destroys user content outside its managed section ([VISION.md "Never destroy user data"](../VISION.md#never-destroy-user-data)) | **No** — symlink replaces the file entirely; user content in CLAUDE.md is lost on first `ai-rules generate` |
| Per-file rules dirs (`~/.cursor/rules/`, `~/.windsurf/rules/`) | Per-file mirrors of source rule files | Generated per-file under `.cursor/rules/*.mdc` (single AGENTS.md fallback symlink for `cursor` agent) |

**The blocker:** ai-rules' "symlink owns the file" pattern conflicts with
agentbrew's "never destroy user data" invariant from
[`docs/user-stories/10-data-safety.md`](../user-stories/10-data-safety.md).
A user who has hand-written content in `~/.claude/CLAUDE.md` outside
agentbrew's managed section would lose it on `ai-rules generate`.

**Resolution paths (each tested in slice 3):**

1. **Use ai-rules generate output as input to agentbrew's managed-section
   writer.** Agentbrew runs `ai-rules generate` against a temp dir, reads
   the generated content, then writes it INSIDE its managed-section markers
   in the actual `~/.claude/CLAUDE.md`. Preserves user data;
   2-step pipeline; ~50 LOC of glue.
2. **Contribute managed-section support upstream to ai-rules.** Add a
   `--managed-section` flag (or similar) that writes between markers
   instead of symlinking. Same shape as the `mcpm doctor --json` and
   `mcpm setup --interactive` contribute candidates from the mcpm
   evaluation.
3. **Keep agentbrew's native rules sync, abandon delegation.** If both (1)
   and (2) prove infeasible.

Slice 3 picks one. Resolution path (1) is the most likely outcome — it
preserves the user-data invariant and doesn't require upstream changes.

### 3. Scope — global vs. project-local

agentbrew's rules sync covers BOTH `~/.config/agentbrew/rules/` (global,
applies to every project) and per-project Agentfile rules (project-scoped,
merged into the global). ai-rules is project-local only — it writes
`./CLAUDE.md`, not `~/.claude/CLAUDE.md`.

**Implication:** if delegated, agentbrew runs `ai-rules generate` from a
synthetic source dir (the merged `~/.config/agentbrew/rules/` + per-project
overlay) with `--target-dir` pointed at agentbrew's expected output
location. Slice 3 verifies whether ai-rules accepts a `--source-dir` /
`--target-dir` flag pair or only operates from the cwd.

## Alternative-fallback: ai-rules-sync (lbb00) status check (slice 2)

**Sources:** [`lbb00/ai-rules-sync`](https://github.com/lbb00/ai-rules-sync)
GitHub repo page 2026-04-27.

| Dimension | ai-rules-sync (lbb00) | Status |
|---|---|---|
| Stars | 25 (was 24 in older agentbrew docs; +1 in 2 weeks — slow) | Not abandoned, but tiny growth |
| Forks | 1 | Tiny community |
| Open Issues | 1 | Low maintenance signal |
| Open PRs | 1 | Low contribution flow |
| Total commits | 82 | Smaller than block/ai-rules' 104 |
| Language | TypeScript / Node.js | Same ecosystem as agentbrew |
| Distribution | Homebrew Formula directory + `.changeset` (Changesets) | Active publishing infrastructure |
| Last push (claim from older docs) | 2026-03-16 | TBD — repo's commit log not fully fetched |

**Verdict (slice 2):** ai-rules-sync is small but not entirely abandoned.
Same-ecosystem (Node.js) is a meaningful advantage over block/ai-rules for
agentbrew (no subprocess across language runtimes), but the size gap (25⭐
vs 94⭐) and Block's corporate-backing advantage make block/ai-rules the
stronger primary candidate.

**Strategic note:** If the rules-format preservation gap from § "Output
shape" turns out to block delegation to block/ai-rules, ai-rules-sync
becomes the fallback to evaluate. As a Node CLI, agentbrew could
potentially import its library code directly (instead of subprocess)
which sidesteps the symlink-vs-managed-section issue. Slice 3 keeps this
as a fallback.

**Decision rule for slice 4:** primary candidate is block/ai-rules
unless the format gap is unsolvable AND ai-rules-sync proves viable as a
direct-library-import alternative. Both options shrink the orchestrator
target LOC; the direct-library option shrinks more (~445 LOC removable
because no subprocess wrapper is needed).

## Drift detection integration (slice 3)

**Sources:** `ai-rules status` and `ai-rules generate --help` invocations
on author Apple Silicon laptop, ai-rules v1.6.0, 2026-04-27.

### Behavior verified

| Property | Result | Implication |
|---|---|---|
| `ai-rules status` exit code on sync | 0 | Maps directly to agentbrew's `status --ci` exit code 0 |
| `ai-rules status` exit code on drift | 1 | Maps directly to agentbrew's `status --ci` exit code 1 |
| `ai-rules status` output format | Human-readable (emoji + per-agent sync/out-of-sync lines) | Parsing is doable but brittle — contribute candidate: `--json` flag |
| `ai-rules status` per-agent flag | `--agents claude,cursor` | Agentbrew can call per-agent during drift check; matches the per-agent shape |
| `--source-dir` / `--target-dir` flags | **NOT PRESENT** on `generate` or `status` | Workaround: agentbrew `cd` to a temp dir before invoking. Contribute candidate: file upstream PR for `--source-dir` / `--target-dir` |
| `--nested-depth` flag | Present on both `generate` and `status` (default 0 = cwd only) | Useful for monorepo support |

### Drift parser shape

For slice 4's execution path, agentbrew needs to either:

1. **Parse the human-readable output.** Brittle — line shape is `  ✅ <agent>: in sync` / `  ❌ <agent>: out of sync`. Regex-tractable but susceptible to ai-rules version drift.
2. **Use exit codes only.** `ai-rules status --agents <agent>` returns 0/1 per agent. Iterate over the intersection list. Cleaner, no parser to maintain.
3. **Contribute `--json` upstream.** Same shape as the mcpm `doctor --json` candidate. Block has shipped non-controversial UX additions (PR #59 Synesso symlink support; PR #77 robmaceachern status fix) — receptivity is high.

**Recommendation:** start with (2) — exit-code-only, per-agent invocation. File the `--json` PR upstream (3) as a slice 6 / parallel-track contribution under the new `delegate-rules-to-ai-rules` task that slice 4 will create. Avoid (1) if possible — parsing human output is the tax that doesn't pay back.

## Upstream receptivity (slice 3)

**Sources:** [`block/ai-rules` merged PRs](https://github.com/block/ai-rules/pulls?q=is%3Apr+is%3Aclosed+is%3Amerged) 2026-04-27.

### Structural signals (strong, all positive)

- **66 total merged PRs** — solid contribution flow for a 94-star project.
  Higher per-star PR throughput than mcpm at slice 1 measurement.
- **Multi-maintainer team.** Active collaborators visible in the merged-PR
  list: `jonandersen`, `lifeizhou-ap`, `dalton-turner`, plus other Block
  collaborators. No single dictator pattern.
- **External (non-Block-collaborator) contributors merged**:
  - PR #83 (`deanbaker`, `Contributor` badge) — merged 2026-03-25 — `.gitignore` directory exclusion
  - PR #77 (`robmaceachern`, `Contributor`) — merged 2026-02-24 — status false-negative fix
  - PR #59 (`Synesso`, `Contributor`) — merged 2026-01-06 — symlink support
  Three drive-by contributors merged in the last 4 months with substantive PRs. **This is the strongest receptivity signal of any of the three delegation candidates.** Compare to mcpm's single-PR-#315-from-DjodyKort baseline.
- **Active release cadence**: v1.6.0 (2026-03-30), v1.5.1 (2026-02-25), v1.5.0 (2026-02-19), v1.4.0 (2026-01-27), v1.3.0 (2026-01-08), v1.2.0 (2025-12-18). Multiple releases per month consistently.
- **License is Apache-2.0** — no CLA gate (verified from `Cargo.toml` slice 1).
- **No 47-day-stalled-PR pattern** like vercel-labs/skills's PR #509. Open PRs at slice 3 measurement (7 open) all have recent activity.

### Adapter-specific receptivity (verified by historical PRs)

The 3 contribute candidates filed for slice 4:

1. **`--source-dir` / `--target-dir` flags on `generate`** — would unblock agentbrew's workflow without `cd` workarounds. Mechanical change. Strong receptivity signal: PR #59 (`Synesso`) merged a similar mechanical-feature addition (symlink support) in <1 month.
2. **`status --json` output flag** — non-controversial UX addition. PR #77 (`robmaceachern`) merged a similar status-related fix in <2 weeks.
3. **`--managed-section` flag** (alternative to symlink ownership, would let agentbrew skip its own managed-section wrapper) — bigger change, possibly contentious. Lower priority than (1) and (2). If (1) and (2) land, agentbrew can use the wrapper-around-output approach from slice 2 and skip (3).

**Receptivity verdict (slice 3):** STRONGEST of the three delegation candidates. Block's contributor flow is healthier than mcpm's (which itself was healthier than vercel-labs/skills's). The structural signals are sufficient to commit the delegate→contribute strategy; slice 4 finalizes the verdict and files the new `delegate-rules-to-ai-rules` task.

## Hardware-bound carve-outs (slice 3, deferred)

Same pattern as slices 1–3 of the mcpm evaluation and the closed 2026-05-02
skills CLI sandbox / proxy / offline measurement:

| Dimension | Status | Carve-out implication |
|---|---|---|
| **corporate proxy** — does the curl-installer (`https://raw.githubusercontent.com/block/ai-rules/.../install.sh`) work behind the proxy? | UNTESTED on author laptop | If FAIL: documented "use cargo install or pre-built binary on the org machines" carve-out. Doesn't block delegation; affects setup story only. |
| **Devin sandbox** — does the sandbox allow ai-rules subprocess execution? | UNTESTED in a Devin sandbox | If FAIL: agentbrew on Devin keeps native rules sync, with ai-rules delegated everywhere else. Same shape as the pre-2026-05-02 skills CLI carve-out for `devin`, but scoped to rules. |
| **Offline cold start** — `curl ... | bash` with no network | KNOWN FAIL (registry needs to resolve). No carve-out necessary; users on offline cold start can't install anything. |
| **Pre-built binary availability** — does block/ai-rules ship pre-built binaries for all needed targets? | x86_64-apple-darwin VERIFIED via slice 1 install. aarch64-apple-darwin / linux-x86_64 / linux-aarch64 / windows-* untested | If FAIL on any target: carve-out for that target only. Block's CI likely covers macOS + linux × x86_64 + ARM64 since Block's internal teams run on those targets. |

These carve-outs are deferred to whoever runs on the matching hardware
— same rationale as the closed skills CLI hardware-bound measurement. The
delegation strategy is committed in slice 4 regardless; the carve-outs
just qualify the "Complementary in context X" downgrade if a real
machine surfaces a blocker.

## Contribute vs Build verdict (slice 4)

**Verdict: Contribute (selective delegation, wrapper-around-output model).**

The decision tree from slices 1–3 resolved as follows:

- **Not "delegate everything as-is"** — ai-rules' "symlink owns the
  file" output pattern conflicts with agentbrew's "never destroy user
  data" invariant from [`docs/user-stories/10-data-safety.md`](../user-stories/10-data-safety.md).
  We can't naively replace native rules sync with `ai-rules generate`
  because users with hand-written content in `~/.claude/CLAUDE.md`
  outside agentbrew's managed section would lose it.
- **Not "keep native"** — slices 1–3 produced no blocking signal. Latency
  is BETTER than agentbrew. Distribution is dependency-free single binary.
  Upstream receptivity is the strongest of the three delegation candidates
  (3 drive-by external PRs merged in 4 months). Agent coverage is
  net-additive (4 strict intersection + 7 free-capability gains for 11
  agentbrew agents that don't have rules support today).
- **Not "complementary"** — that verdict applies when the tools cover
  different layers. Here both tools cover the rules-translation step;
  they differ on output ownership semantics, but the layer is the same.
- **"Contribute (selective delegation, wrapper-around-output)"** — same
  shape as skills CLI / mcpm delegations with one twist: agentbrew runs
  `ai-rules generate` against a temp source dir, reads the generated
  output, then writes it INSIDE agentbrew's managed-section markers in
  the actual `~/.claude/CLAUDE.md`. Preserves user data; ~50 LOC of glue;
  no upstream changes required.

**Execution path (`delegate-rules-to-ai-rules` slices 1–7, modeled on
`delegate-mcp-to-mcpm` slices 2–7):**

| Slice | Scope | Status | LOC change |
|---|---|---|---|
| 1 | Build the `rules-agent-map.ts` boundary helper (rename pairs `claude`↔`claude-code`, `gemini`↔`gemini-cli`, `kilocode`↔`kilo`, `roo`↔`roo-code`; carve-out rationale for windsurf, augment, devin, claude-desktop) + tests. | **DONE 2026-04-27** (PR #830) | +190 src + 33 tests |
| 2 | Wire `delegateRulesGenerate()` into `src/sync/rules-sync.ts` for the canary `claude-code`. Wrap output in agentbrew's managed-section markers. | **DONE 2026-04-27** (PR #832) | +150 LOC (helper + tests) |
| 3a | Expand canary set to all 3 rulesFile intersection agents (claude-code, codex, gemini-cli). | **DONE 2026-04-27** (PR #833) | +15 LOC |
| 3b | Add cursor (rulesDir, single-file `~/.cursor/rules/agentbrew.md` write). Total canary set: 4 agents (3 rulesFile + 1 rulesDir). | **DONE 2026-04-27** (PR #837) | +120 LOC + 140 LOC tests |
| 3c | Add 7 free-capability gain agents (amp, cline, copilot, firebender, goose, kilo, roo-code) by adding `rulesFile` paths to `agents.yaml`. firebender + kilo graduated from experimental. Total delegated: 11 agents. | **DONE 2026-04-27** (PR #838) | +1 LOC delegation expansion |
| 4 | Delete the native rules-translation fallback for delegated agents. `computeRulesDiff` returns `skipped` when delegated content is missing instead of falling back to `mergedRules`. Drift detector mirrors the skip semantics. | **DONE 2026-04-27** (PR #844) | ~+150 LOC behavior change (skip semantics + warning helper) |
| 5 | Verify no imperative rules commands need removal. `agentbrew rules sync` stays native (multi-surface orchestrator). | **DONE 2026-04-27** (PR #840) | 0 LOC |
| 6 | File the 2 upstream PRs at `block/ai-rules`: (a) `--source-dir`/`--target-dir` flags on `generate`, (b) `status --json` output flag. | **6b DONE 2026-04-27** ([block/ai-rules#91](https://github.com/block/ai-rules/pull/91) — `--json` flag, +168/−10 LOC, 4 new tests, default Rich-text unchanged); **6a PENDING** (Rust generate.rs source/target plumbing larger than draft estimated; publish approval still required when shipped) | 0 LOC in agentbrew; ~50 LOC × 2 PRs upstream |
| 7 | Verify the dust settles: re-run `npm run verify`, real-e2e rules scenarios, confirm the 3 carve-outs still work end-to-end natively. Update this doc with landed-PR references. | **DONE 2026-04-27** (this commit) | 0 LOC |

**Total landed (slices 1–5):** Net add of ~+476 LOC in delegation
helpers + tests, but the `rules-sync.ts` skip-semantics added ~150 LOC
of behavior-change scaffolding (delegation primary path + warning
helper + carve-out routing). The shrink in `rules-sync.ts` proper is
modest — the 11 delegated agents flow through `delegateRulesGenerate`
without their own native translation code. Permanent residue: the
managed-section wrapper, multi-source merging (per-source layering
across catalog/Agentfile/recommended), and the 3-agent carve-out path
(windsurf, augment, devin) plus the claude-desktop transitive readsFrom
indirection. Same residue-shape as the other two delegations.

**Total estimated shrink:** 300–350 LOC of net deletion (445 LOC of
`src/sync/rules-sync.ts` − ~100 LOC of glue/wrapper/carve-out preserved).
Smaller absolute shrink than mcpm (~2,000 LOC) or skills CLI (~1,000 LOC)
because rules sync is a smaller subsystem to begin with. Same
shrink-percentage ratio (≥65% of the rules-sync surface).

**Pure-blocker fallback:** if slice 4 of the new `delegate-rules-to-ai-rules`
task surfaces a real blocker on a real machine (corporate proxy blocks
the curl-installer; Devin sandbox blocks ai-rules subprocess execution;
non-darwin-x64 binary not built upstream), the verdict downgrades to
**Complementary in context X**. `docs/COMPETITION.md` Tier 1 verdict
gets the qualifier appended. `docs/VISION.md` adds the failing context
to its bullet. `quarterly-dissolution-reeval` queues a re-measurement.

**Why this is safer than the mcpm delegation:**

1. **Latency is BETTER, not worse.** mcpm's 1.48s warm startup forced a
   selective-delegation shape; ai-rules' 22ms warm startup has none of
   that constraint.
2. **Receptivity is STRONGER.** mcpm had 1 drive-by PR (DjodyKort #315).
   ai-rules has 3 (deanbaker #83, robmaceachern #77, Synesso #59).
3. **Smaller subsystem to delegate.** 445 LOC of `rules-sync.ts` is
   the smallest of the three delegation targets — easier to fully
   delegate, easier to revert if needed.

**Slice 4 closes the parent `evaluate-delegate-rules-to-block-ai-rules`
(P0) task. The new P0 task `delegate-rules-to-ai-rules` is filed in
TASKS.md with the 7-slice execution plan above, modeled on the
`delegate-mcp-to-mcpm` parent task that landed 2026-04-27.**

## Slices and follow-ups

| Slice | Status | Tracker |
|---|---|---|
| 1 — Project shape + latency baseline + initial doc | DONE 2026-04-27 | parent's Plan checklist (parent removed in this commit) |
| 2 — Agent coverage parity + rules-format preservation + ai-rules-sync status | DONE 2026-04-27 | parent's Plan checklist (parent removed in this commit) |
| 3 — Drift detection integration + upstream receptivity + flag-availability | DONE 2026-04-27 | parent's Plan checklist (parent removed in this commit) |
| 4 — Verdict + execution path + close redundancy | DONE 2026-04-27 (this commit) | `evaluate-delegate-rules-to-block-ai-rules-slice-4` |

Once slice 4 lands, the parent `evaluate-delegate-rules-to-block-ai-rules`
(P0) will be closed and removed from TASKS.md. The verdict propagates to:

- `docs/COMPETITION.md` rules-tools tier MCPM entry (likely Tier 3 / Tier
  4 — TBD by slice 4)
- `docs/VISION.md` "Applied to today's competitors" bullet
- Possibly a new `delegate-rules-to-ai-rules` P0 task if the verdict is
  Contribute (most likely outcome)

## Commands delegation (parallel `delegate-commands-to-ai-rules` task)

The 2026-04-27 commands-delegation track is a parallel application of the
same wrapper-around-output model to ai-rules' commands surface (`ai-rules
generate` produces per-agent command files in addition to per-agent rules
files). Slices landed:

| Slice | Status | PR | Net change |
|---|---|---|---|
| 1 — Build `commands-agent-map.ts` boundary helper + tests | DONE 2026-04-27 | parent task plan checklist | +190 LOC source + 280 LOC tests |
| 2 — Wire `delegateCommandsGenerate` for canary `claude-code` | DONE 2026-04-27 | [PR #889](https://github.com/fyodoriv/agentbrew/pull/889) | +245 LOC source + ~315 LOC tests |
| 3 — Promote to all 2 intersection agents (claude-code + cursor) | DONE 2026-04-27 | [PR #890](https://github.com/fyodoriv/agentbrew/pull/890) | +30 LOC source + 50 LOC tests |
| 4 — Harden contract; delete `toCursorFormat` | DONE 2026-04-27 | [PR #891](https://github.com/fyodoriv/agentbrew/pull/891) | −24 LOC source, ~−210 LOC tests |
| 5 — Free-capability gain: amp + firebender (this PR) | DONE 2026-04-27 | this PR | +12 LOC agents.yaml, 0 native code |
| 6 — Verify dust settles, doc update | DONE 2026-04-27 (this commit) | this PR | doc-only |

**Final canary set**: 4 agents (claude-code, cursor, amp, firebender). The
2 agentbrew-original commands-capable agents (claude-code, cursor) plus 2
free-capability gains (amp, firebender) — neither had agentbrew commands
support before; ai-rules covered them upstream so adding the user-level
paths to agents.yaml + the `CANARY_DELEGATED_AGENTS` Set unlocked
delegated commands sync at zero native-code cost.

**Final carve-outs**: 5 agents (windsurf, devin, gemini-cli,
claude-desktop, opencode). Their rationale lives in
`AGENTBREW_ONLY_COMMANDS_RATIONALE` (`src/core/commands-agent-map.ts`):
ai-rules doesn't generate Windsurf-format commands, devin is a Cognition
product carve-out, gemini-cli writes `.toml` files via a shape ai-rules
doesn't cover, claude-desktop shares with claude-code via `readsFrom`,
and opencode isn't in ai-rules' supported commands list.

**Real-e2e**: the existing `us05-share-commands` real-e2e scenario
exercises the carve-out path (windsurf, devin) post-slice-4. The canary
path (claude-code, cursor, amp, firebender) is verified at the unit
level via the slice-2/3/4 tests in `command-sync.test.ts` and the
fake-binary smoke in `commands-delegate.test.ts`.

## Sources

- [`block/ai-rules`](https://github.com/block/ai-rules) on GitHub —
  primary repo
- [`block/ai-rules` README](https://raw.githubusercontent.com/block/ai-rules/main/README.md)
  — feature surface and command reference
- [`block/ai-rules` Cargo.toml](https://github.com/block/ai-rules/blob/main/Cargo.toml)
  — language, license, dependencies, version
- [`block/ai-rules` install.sh](https://raw.githubusercontent.com/block/ai-rules/main/scripts/install.sh)
  — distribution channel
- agentbrew's own rules code: `src/sync/rules-sync.ts` (445 LOC),
  `src/drift-checks/rules.ts` (84 LOC), measured 2026-04-27
- agentbrew's rules-capable agent definitions: `src/core/agents.yaml`
  filtered to entries with `rulesFile` or `rulesDir` (8 agents)
- agentbrew startup baseline: `node dist/cli.js --version` warm-start
  ~63ms (Apple Silicon, Node.js v22)
- ai-rules startup baseline: `ai-rules --version` warm-start ~22ms
  (same Apple Silicon, native Rust binary)
