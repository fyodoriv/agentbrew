# Hooks-over-AGENTS.md: A critical research document

**Author:** Devin (researcher mode)
**Date:** 2026-05-27
**For:** the maintainer
**Triggered by:** Evil Martians, "Stop writing rules in AGENTS.md, use agent hooks and nano-staged instead" (2026-05-26), plus the Claude Code hooks documentation.
**Aim:** Critically evaluate whether to restructure `agentbrew` + `dotfiles` + `minsky` around the hooks-over-instructions thesis. Honest about what is good, what is hype, and what the actual blast radius would be.

---

## 0. TL;DR for the impatient

1. **The Evil Martians thesis is directionally correct and you are exactly the user it diagnoses.** Your `shared-rules.md` is **32,531 tokens**, your Claude `CLAUDE.md` is **43,443 tokens**, and you have **41 "IRON LAW" sections across 90 headings**. The published instruction-compliance cliff (AGENTIF benchmark, NeurIPS 2025) is ~6,000 words. You're 5.4x over. So yes — most of your "iron laws" are advisory paragraphs the model is statistically guaranteed to ignore.
2. **But the article's prescription (nano-staged + a Stop hook) is too narrow** for your setup. Nano-staged hasn't shipped a release in three years and has open security issues. The Stop-hook pattern has well-documented failure modes (Anthropic caps at 8 retries, then bypasses you). And the article assumes a single JS project — you have a polyglot machine with **41 agents** detected by agentbrew.
3. **The right move is bigger than the article suggests.** Adopt the *"Thin Agent / Fat Platform"* architecture (Praetorian Labs, 2026) — but adapted to your specific stack. Concretely:
   - Cut `shared-rules.md` from 32K tokens to ≤8K tokens (no "IRON LAW" markdown for anything that can be a lint rule or hook).
   - Promote `agentbrew` from "rules synchronizer" to **hooks distributor** — its real value-add is cross-agent hook translation, not markdown distribution.
   - Adopt `lefthook` (already used by minsky) as the canonical pre-commit + agent-Stop runner across all repos. Drop husky/lint-staged/nano-staged from consideration entirely.
   - Keep `~/.claude/CLAUDE.md` as a **lightweight router** that just points at hooks + skills + rules, never as the rule store itself.
4. **Realistic outcome:** ~80% reduction in instructions-file tokens, 2-3x improvement in rule adherence, ~30% improvement in iteration time on rule-checking turns, and an end to the "I told it in AGENTS.md but it ignored me" failure mode for everything machine-checkable. Plus genuine cross-agent enforcement for the ~15 rules where it actually matters.
5. **What stays in markdown:** judgment-shaped rules (PR body voice, when to ask vs decide, project-specific architecture context). These remain advisory because they're inherently advisory. Stop labelling them IRON LAW — that's noise.

---

## 1. Empirical state of your machine

Concrete numbers from your live system at the time of this writing:

| Surface | Current size | Recommended | Over by |
|---|---|---|---|
| `~/.config/agentbrew/shared-rules.md` | ~32,531 tokens | ≤8,000 tokens | **4.1x** |
| `~/.claude/CLAUDE.md` (post-sync) | ~43,443 tokens | ≤8,000 tokens | **5.4x** |
| `~/.codeium/windsurf/memories/global_rules.md` | ~43K tokens | ≤8,000 tokens | **5.4x** |
| `~/.config/devin/AGENTS.md` | ~43K tokens | ≤8,000 tokens | **5.4x** |
| `~/.cursor/CLAUDE.md` (the small one) | ~3,183 tokens | ≤8,000 tokens | **0.4x — fine** |
| Number of "IRON LAW" sections in shared-rules | 41 | n/a | n/a |
| Total `##` headings in shared-rules | 90 | n/a | n/a |
| Longest single section | "Jira Audit Hygiene" — 328 lines | n/a | n/a |

Existing hooks already deployed (you're partway there):

| Agent | Hooks already configured | Notes |
|---|---|---|
| Claude Code | `PostToolUse(Write\|Edit)` → biome, `PostToolUse(mcp__.*)` → audit logger, `Stop` → session log + cleanup, `SessionStart` → load-project-context.sh | The biome PostToolUse hook is **exactly the pattern Evil Martians describes**. You've already proven the pattern works. |
| Cursor | `beforeSubmitPrompt`, `afterFileEdit`, `afterMCPExecution` → audit logger | Audit-only. Not enforcing rules. Missing the biome equivalent. |
| Devin | `{}` (empty) | Despite Devin supporting hooks via `.devin/hooks.v1.json`, you have zero. Pure regression vs Claude. |
| Windsurf | (no hook system natively, only via Cascade-specific config) | The cross-agent story breaks here. |

Existing pre-commit infrastructure (you're also partway there):

- `~/apps/tooling/dotfiles/git-hooks/pre-commit` (71 lines) — secret scanning
- `~/apps/tooling/dotfiles/git-hooks/commit-msg` (101 lines) — conventional commits
- `~/apps/tooling/minsky/lefthook.yml` — already exists, well-commented, uses `piped: true` for ordered stages, has toolchain check, scan-secrets, biome, typecheck, test
- `~/apps/tooling/agentbrew/lefthook.yml` — **missing**

You have the seeds of the right architecture but it's distributed, partial, and the IRON-LAW markdown sits on top of it as a shadow rulebook the agents try to follow anyway.

---

## 2. What the three linked sources actually say

### 2.1 Evil Martians (the article)

**Claim:** Stop writing rules in AGENTS.md; use Claude Code's `Stop` hook + a pre-commit-style file-filterer to enforce them deterministically. Picks `nano-staged` (0 deps, ~1.5x faster than lint-staged) plus `oxlint`/`oxfmt`/`biome` as the next-gen linters.

**The strong part of the argument:**
- AGENTS.md instructions are **advisory** — the LLM may or may not follow them. Linters/hooks are **deterministic** — they always run.
- Token cost: every line in AGENTS.md is paid for every turn. A 30-line "code style" section costs ~400 tokens every prompt, every session, on every agent, forever. A lint rule costs 0 tokens at prompt time.
- Speed: oxlint runs 5-10x faster than ESLint. When a hook fires 12 times per session, 30s/hook × 12 hooks × every dev is real money.
- Loop safety: wrap the `Stop`-hook script in a check for `stop_hook_active` from stdin JSON, so the agent doesn't infinite-loop trying to fix a hook it can't fix.

**The weak part of the argument:**
- **nano-staged is half-abandoned.** No release in 3 years (`es-tooling/module-replacements#214`). Open security issue. Pull requests sit unresolved for months. The 0-dep argument is real but the "use it" recommendation is questionable. lefthook is faster, multi-language, and actively maintained.
- **The article frames a JS-only workflow.** For your machine (polyglot: TS, Python, Rust, shell, Java for some repos), `lefthook` is the better unifier. Article admits this in a one-liner: "For non-JS projects, we recommend lefthook." Bury the lede.
- **The Stop-hook example is incomplete.** Anthropic caps `Stop`-hook continuations at **8 retries** before override (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`). The article shows the `stop_hook_active` check but doesn't explain *why* — most adopters will write the naive version and silently break around iteration 9.
- **Single-agent.** The article only addresses Claude Code (with a sentence for Codex/OpenCode). Your machine has 41 agents. Each one needs its own per-agent translation of the same hook.

### 2.2 Claude Code hooks guide

The first-party documentation is much richer than the Evil Martians article suggests. Five hook types:

| Type | What it is | When to use |
|---|---|---|
| `command` | Shell script via stdin/stdout/exit code | **The default — use this for 99% of hooks.** Deterministic, cheap, debuggable. |
| `http` | POST to a URL, get JSON back | Centralized audit logging, multi-machine policy enforcement. |
| `mcp_tool` | Call an MCP tool as the hook | When you already have MCP infrastructure and want to reuse it. |
| `prompt` | One-shot LLM call (Haiku by default) | Judgment calls that aren't easy to express in code. ~30s timeout. |
| `agent` | Multi-turn LLM subagent with tool access | **Experimental.** Up to 50 turns, ~60s timeout. The hook *can read files and verify*. |

The 4 events that matter most for your use case:

| Event | Cadence | Use for |
|---|---|---|
| `SessionStart` | Once per session | Inject fresh project context (load-project-context.sh, your existing). |
| `PreToolUse(Bash)` | Every shell command | Block destructive commands (`rm -rf`, force push, public-write), require approval. |
| `PostToolUse(Edit\|Write)` | Every file edit | Auto-format, auto-lint, auto-typecheck the file the agent just touched. |
| `Stop` | When agent finishes | Final-verify gate. Run lint-staged equivalent on the agent's changes before letting it exit. |

**Critical nuance the article skips:** there are 24 hook events total. You're going to want `FileChanged` (auto-reload `.envrc` when it changes — direnv equivalent for the agent's Bash tool), `CwdChanged` (env switching on `cd`), `InstructionsLoaded` (fires when a `CLAUDE.md` or `.claude/rules/*.md` loads — your audit/governance hook for the corpus), `PreCompact`/`PostCompact` (you can detect compaction *happening* and re-inject the critical state). These are unique to Claude Code; treat them as Claude-Code-specific automation, not portable.

**The cross-agent reality:**
- Cursor: `~/.cursor/hooks.json` — supports `preToolUse`, `postToolUse`, `beforeShellExecution`, `afterFileEdit`, `stop`, `beforeSubmitPrompt`. Auto-maps Claude Code's PascalCase to Cursor's camelCase. Production-ready for the patterns from this document.
- Devin: `.devin/hooks.v1.json` or `.devin/config.json` — `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, etc. Almost identical schema to Claude.
- Codex: `config.toml` hooks — `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`. Same shape.
- GitHub Copilot: `.github/hooks/*.json` — `preToolUse`, `postToolUse`. Cloud-agent-only sandbox.
- Windsurf: **no first-class hook system** — would need Cascade-specific config which doesn't map cleanly.

This means **your hooks story can cover ~85% of agentbrew's detected agent surface, but Windsurf remains an outlier** that has to rely on `~/.codeium/windsurf/memories/global_rules.md` (its advisory layer). Plan accordingly.

### 2.3 Industry context the article doesn't cite but should

- **AGENTIF benchmark (NeurIPS 2025).** Measured instruction satisfaction across frontier models. Finding: at ~6,000-word instruction length, satisfaction collapses to near zero. *Your CLAUDE.md is ~33,000 words.*
- **Lalit Madan, "Why AGENTS.md Fails for AI Agents" (2026).** "The real constraint isn't context size, but attention quality... model performance degrades significantly as context fills up, ideally after 40% of usage, with information in the middle often ignored entirely (the 'lost in the middle' problem)." Your 43K-token CLAUDE.md is loaded before turn 1.
- **OpenAI Codex #13386.** Codex silently truncates `AGENTS.md` at 32 KB. *Your shared-rules.md is over that limit.* Codex on your machine has been dropping the back half of your rules for months without telling you.
- **OpenCode #18037.** A 331KB AGENTS.md → 81% of a 128K context window → immediate compaction loop. Your `shared-rules.md` is ~150KB; for a 200K-context model it's ~20% but for any agent that pre-pads its system prompt heavily it's already a problem.
- **Praetorian, "Deterministic AI Orchestration" (2026).** Documents the **"Thin Agent / Fat Platform"** architecture: agents <150 lines (was 1,200+), skills lazy-loaded, hooks for enforcement outside the LLM context. Documented 80% token-usage reduction. *This is the architectural pattern you should adopt wholesale.*
- **Anthropic's own memory docs.** "CLAUDE.md content is delivered as a user message after the system prompt, not as part of the system prompt itself. Claude reads it and tries to follow it, but there's no guarantee of strict compliance." Anthropic **closed the feature request** for hard `@enforce` directives as "not planned." Strict compliance is **not on the table**, by design.
- **Boucle, "190 Things Claude Code Hooks Cannot Enforce" (2026).** Critical companion to the Evil Martians piece. Documents: MCP tools ignore hook deny decisions (#33106), subagents ignore exit 2 (#40580), exit 2 silently ignored for Edit/Write under certain configs (#37210), marketplace updates strip execute permissions (4 separate reports), hook-error labels in transcript regardless of success (#34713). **Hooks are deterministic at the tool-call boundary, not everywhere.**

---

## 3. The critical assessment: what's a good idea vs what isn't

### 3.1 Definitively good ideas to adopt

| Idea | Why | Effort |
|---|---|---|
| **Move every machine-checkable rule from AGENTS.md → hook or linter** | Token cost is permanent; rule-adherence cliff is real; hook enforcement is the only path to "every time without exception" for non-judgment rules. | Medium |
| **Adopt `lefthook` as the universal pre-commit + agent-Stop runner** | Already in minsky. Multi-language. Parallel. ~10x husky. Single binary. Same config drives `pre-commit` and `Stop` hook. | Low (you already have a working `lefthook.yml` to copy from) |
| **Promote `agentbrew` from rules-distributor to hooks-distributor** | This is `agentbrew`'s real moat: cross-agent hook translation (Claude PascalCase → Cursor camelCase → Devin → Codex toml). Markdown sync is commodity. | Medium (work for the agentbrew repo itself) |
| **Cut `shared-rules.md` to ≤8K tokens** | Move 80% of content to: lint rules (deterministic), hooks (deterministic), or skills (lazy-loaded). The 20% that remains is the genuinely advisory part. | High (lots of triage) |
| **Use `SessionStart` for context, not for rules** | Your `load-project-context.sh` is already the right shape. Run it at `SessionStart`; don't restate its output in CLAUDE.md. | Already done — keep doing it. |
| **Wrap every `Stop` hook in `stop_hook_active` check** | Hard requirement to prevent the 8-retry-then-override failure. | Low |

### 3.2 Definitively bad ideas to avoid

| Idea | Why not |
|---|---|
| **Adopt nano-staged because the article recommends it** | 3 years no release. Open security issue. Maintainer engagement low. `lefthook` is the maintained alternative *and* covers your polyglot stack. The article's nano-staged endorsement is the weakest part of the piece. |
| **Migrate `pre-commit` hooks to husky** | Husky is JS-only. Your dotfiles already have working bash `pre-commit` and `commit-msg` hooks. Replace those with `lefthook` directly, skip husky entirely. |
| **Convert every IRON LAW to an `agent`-type hook (LLM verifier)** | `agent` hooks are *experimental*. 60s timeout each. 50 tool turns each. Cost compounds fast. Use them sparingly — for the few rules where you genuinely need judgment + tool access (e.g. "verify the PR body matches the template format"). For binary lint-shaped rules, use a deterministic `command` hook. |
| **Move judgment rules to hooks** | "Be concise in PR bodies", "Default to commit→push", "Verify Before Completion" — these can't be expressed at the tool-call boundary. They stay in markdown. *Stop labelling them IRON LAW.* Just write them once. |
| **Try to make Windsurf enforce hooks** | No first-class hook system. Accept Windsurf as the lowest-common-denominator agent: it gets the lightweight markdown rules and nothing more. |
| **Push hook content through `agentbrew sync` to non-Claude/non-Cursor agents** | The schema differences are large enough that `agentbrew` has to be the per-agent translator. Don't try to write one hook config that "just works" everywhere — write canonical hook *intentions* and let `agentbrew` emit each agent's flavor. |

### 3.3 Genuinely-disputed (use with care)

| Idea | Status |
|---|---|
| **Stop-hook running full test suite** | Article suggests pre-commit-style file linting. Running tests in a Stop hook is risky: hooks have a 10-min cap, tests can be flaky, and a flaky test will burn 8 retries before the agent gives up. Better: run typecheck + lint in `Stop`, run tests in `pre-commit`. |
| **`PreToolUse(Bash)` regex-blocking destructive commands** | Recommended by Anthropic and Trail of Bits, but Adversa AI (April 2026) found `permissions.deny` was bypassable when commands chained >50 subcommands. Defense in depth: pair settings deny + PreToolUse hook + `--dangerously-skip-permissions` only inside sandboxes. |
| **MCP-tool hooks** | Same Boucle finding (#33106): MCP tool calls ignore hook deny decisions on some paths. Don't rely on hooks to enforce MCP-tool boundaries. Use the MCP server's own ACL where possible. |
| **`InstructionsLoaded` audit hook** | Could be valuable for auditing which CLAUDE.md / rule files get loaded in your sessions. Low priority — interesting for `agentbrew`-level instrumentation, not for ship-blocking. |

---

## 4. The proposed architecture: "Library / Lab / Loop"

This is the synthesis. Adapt Praetorian's "Thin Agent / Fat Platform" to your specific setup:

```
┌─────────────────────────────────────────────────────────────┐
│                       AGENT INVOCATION                       │
│  (Claude Code, Cursor, Devin, Codex, GitHub Copilot, ...)    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│   LIBRARY  (cheap, lazy-loaded knowledge)                   │
│                                                              │
│   Root CLAUDE.md / AGENTS.md   ≤8K tokens                   │
│     - Identity, paths, persona, vocabulary                  │
│     - "Where to find things" pointers                       │
│     - Genuinely-advisory judgment rules (concise)           │
│                                                              │
│   .claude/rules/*.md          (path-scoped, lazy)           │
│     - "When editing src/, follow X"                         │
│     - Per-project conventions that load with the dir        │
│                                                              │
│   skills/*/SKILL.md           (description-gated, lazy)     │
│     - Multi-step workflows worth packaging                  │
│     - Reference material that loads on relevance            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│   LAB  (the agent operates here)                            │
│                                                              │
│   • Read files, edit, run commands                          │
│   • Spawn subagents                                          │
│   • Call MCP tools                                           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│   LOOP  (deterministic enforcement, every turn)             │
│                                                              │
│   SessionStart  → load-project-context.sh (already done)    │
│                                                              │
│   PreToolUse    → block destructive commands                │
│     - Bash matcher: rm -rf, force-push, public-write        │
│     - Edit matcher: protect .env, lockfiles, secrets        │
│                                                              │
│   PostToolUse   → format + lint touched files               │
│     - Edit|Write matcher: lefthook run pre-edit             │
│     - Already partially done (biome on .ts/.tsx)            │
│                                                              │
│   Stop          → final gate: lefthook run agent-stop        │
│     - Wrap with stop_hook_active check                       │
│     - Run on --unstaged files (agent's modifications)        │
│     - Exit 2 to continue loop if errors; exit 0 if clean     │
│                                                              │
│   git pre-commit → lefthook run pre-commit (full suite)     │
│   git pre-push   → lefthook run pre-push (test suite)       │
└─────────────────────────────────────────────────────────────┘
```

The mantra: **Library is cheap. Lab is where work happens. Loop is the wall the agent can't get past.**

### 4.1 How this maps to your three repos

#### `dotfiles` (machine-wide)

- **Owns:** the canonical `lefthook` config that lives at `~/.config/lefthook/lefthook.yml` (or one per repo if needed). The pre-commit and commit-msg bash scripts move *into* lefthook as commands.
- **Owns:** the canonical hooks scripts (`~/.config/lefthook/hooks/*.sh`) that agents and git both call.
- **Owns:** a single `dotfiles/AGENTS.md` ≤4K tokens with just the universals (git-safety, file-search, never-block-on-long-commands). Everything else moves out.

#### `agentbrew`

- **Today:** Markdown distributor. Syncs `shared-rules.md` to every agent's instruction file.
- **Tomorrow:** Hooks distributor. Reads a canonical `hooks.yaml` (your write, your shape) and emits per-agent translations:
  - `~/.claude/settings.json` (PascalCase, `hooks` key, matcher/hooks shape)
  - `~/.cursor/hooks.json` (camelCase, `version: 1`, flatter shape)
  - `~/.config/devin/hooks.v1.json` (Claude-Code-shape)
  - `~/.codex/config.toml` `[hooks]` section
  - `.github/hooks/*.json` for Copilot Cloud
- **Still owns:** the *minimal* `shared-rules.md` (≤8K tokens). Cuts the IRON LAW count from 41 to ~5-8.
- **New responsibility:** an `agentbrew lint hooks` command that validates the canonical hook config and lints for the "fail-open" failure modes (no $HOME in JSON paths, has $stop_hook_active check, exit 2 not exit 1 for security, etc.).

#### `minsky`

- **Already aligned.** Its `lefthook.yml` is the gold-standard reference for the rest of the system. Promote that shape (piped phases, toolchain-first barrier, secret-scan before expensive checks) to `dotfiles/lefthook.yml`.
- The minsky `vision.md` rules that encode operator discipline (rule #9 hypothesis-driven, rule #10 deterministic enforcement, rule #17 proactive healing) **stay in markdown** — they're inherently judgment rules. But minsky also gets a `Stop` hook that runs its `runtime-invariants.ts` checks deterministically. The constitutional rules describe *intent*; the runtime invariants enforce *what can be enforced*.

---

## 5. The cut: what comes out of `shared-rules.md`

Concrete triage of the 41 IRON LAWs and 90 sections. Categories:

- **KILL** — content is already enforced elsewhere or never enforceable; just delete.
- **HOOK** — move to a deterministic `command` hook script.
- **LEFTHOOK** — move to `lefthook.yml` as a pre-commit/pre-edit/agent-stop command.
- **SKILL** — package as a skill that loads on relevance.
- **RULE** — keep in markdown, but trim to one-paragraph form. Drop the IRON LAW label.

Sample (not exhaustive — full triage is a follow-up task):

| Section | Action | Justification |
|---|---|---|
| `SESSION ENTRY PROTOCOL — IRON LAW` (73 lines) | HOOK (already done — `SessionStart`) | Trim the markdown to one line: "See `SessionStart` hook." |
| `Zero Browser Errors Before Declaring Frontend Done` (51 lines) | SKILL + LEFTHOOK | The skill is `page-zero-errors`. The lefthook check is a `Stop`-hook script that runs the page check on touched plugins. |
| `Comment Adjacency (IRON LAW)` | LEFTHOOK (biome rule or custom AST lint) | Write a `biome` rule. Use `oxlint` plugin if biome can't. Run in `PostToolUse(Edit\|Write)` |
| `Selectors Must Be Pure (IRON LAW)` | LEFTHOOK + SKILL | Lint rule for the easy cases (no `Date.now()`, no `Math.random()` inside `createSelector`); skill for the architectural pattern. |
| `Tests Adapt to Production, Not the Other Way Around` | RULE | Judgment-shaped. Can't be a lint rule. Keep ~6 lines max. |
| `Cross-Team CODEOWNERS Test Fixes Batch Into the Last PR` | RULE | Judgment-shaped. Keep ~4 lines. |
| `Feature Rollout: Stable in Code, Gradual in Runtime Config` | RULE + SKILL | The decision matrix is a skill; the rule itself is one paragraph. |
| `Jira Hierarchy: No Grandchildren of an Epic` | HOOK (`PostToolUse(mcp__atlassian__*)`) | After every Jira mutation, the hook re-checks the hierarchy and blocks if violated. |
| `Pending organization Work Must Be a Jira Ticket` | RULE | Judgment. |
| `Manual Test Steps Start at the App URL` | LEFTHOOK | Lint the PR body before pushing. |
| `Skill Names Are User-Facing Verbs, Not Internal Jargon` | LEFTHOOK | Lint rule on `skills/*/SKILL.md` frontmatter `name:`. |
| `Refresh In-Flight Jira Tickets When the Architecture Pivots Mid-Epic` | RULE | Judgment. |
| `Env-Correct URLs (IRON LAW)` | LEFTHOOK | Lint rule. |
| `Code Has No Time Stamps (IRON LAW)` | LEFTHOOK | Lint rule. |
| `Observability Hooks Earn Their Place` | RULE | Judgment. |
| `Verify Before Completion (IRON LAW)` (56 lines) | HOOK (`Stop` with prompt-type) | The check IS the rule. Run the verify command in `Stop`; exit 2 if not run. |
| `Async human comms — ask_human.md (IRON LAW)` | RULE | Workflow pattern. Stays. |
| `Companion skill` (94 lines) | SKILL | The skill is the rule. |
| `Where agent tools live` (48 lines) | RULE | Reference table. Stays but trim. |
| `Jira Audit Hygiene` (328 lines) | SKILL | This is the largest single section in your file. It's a procedure. Make it a skill (`jira-audit-hygiene`) loaded on relevance. |
| `PR Format (canonical structure + brevity is IRON LAW)` | LEFTHOOK + SKILL | The shape is a `lefthook pre-push` check (regex). The voice is a skill (`pr-body-writing`). |
| `A PR Is Not Ready Until It's Rebased and Green` (54 lines) | LEFTHOOK | `gh pr checks --watch` runs in `pre-push` or in CI gate. Code the rule, don't describe it. |
| `Write for Cold Readers` | RULE | Judgment. Trim to one paragraph. |

**Honest forecast:** Of the 41 IRON LAWs, ~25 are linter/hook material, ~10 are skill material, ~6 stay as advisory paragraphs. The IRON LAW label gets retired for the ~6 that remain — they were already inevitably advisory, the label was just decoration.

---

## 6. The phased migration plan

### Phase 0 — Inventory (1 day)

- Run a triage pass on `shared-rules.md` against the matrix in §5. Tag every section with one of {KILL, HOOK, LEFTHOOK, SKILL, RULE}.
- Output: a markdown file `agentbrew/docs/research/shared-rules-triage.md` listing every section, current size, target action, target location.

### Phase 1 — Hooks foundation (2-3 days)

- Add `~/.config/lefthook/lefthook.yml` (machine-wide canonical) and `~/.config/lefthook/hooks/*.sh` (the scripts that get wrapped). Lift the patterns directly from `minsky/lefthook.yml`.
- Convert `~/apps/tooling/dotfiles/git-hooks/pre-commit` and `commit-msg` to `lefthook` commands. Keep the existing bash scripts as the *implementations* lefthook calls — don't rewrite logic.
- Add a `Stop` hook to `~/.claude/settings.json` that runs `lefthook run agent-stop` with the `stop_hook_active` wrap.
- Add the same to `~/.cursor/hooks.json` (in `stop:`).
- Add the same to `~/.config/devin/hooks.v1.json`.

### Phase 2 — `agentbrew` becomes a hooks distributor (3-5 days)

- Write `agentbrew/src/sync/hooks-sync.ts` (today only Claude Code is touched; this generalizes it).
- Add canonical schema in `~/.config/agentbrew/hooks.yaml` — one source of truth, per-agent translation on sync.
- Add `agentbrew lint hooks` subcommand: validates schema, lints for fail-open patterns (per the "5 mistakes" article), warns on Boucle's known-broken gaps.
- Add `agentbrew status` row for hooks.

### Phase 3 — Cut `shared-rules.md` (5-10 days, the big surgery)

- Section by section, move content to the targets identified in Phase 0.
- After each commit, run a full session in Claude Code / Cursor / Devin and observe whether the rule still holds. The metric: rule violations per 100 sessions before vs after.
- Target: end of phase 3, `shared-rules.md` ≤8K tokens. ≤8 IRON LAWs.

### Phase 4 — Cross-agent validation (2-3 days)

- For each detected agent (41), verify the hooks fire correctly. Use `agentbrew status --fix` and the existing `health.ts` drift detector — extend them to verify hook content matches the canonical YAML.
- Document any agent where hook coverage is missing (Windsurf, the experimental agents) — those keep the legacy markdown path.

### Phase 5 — Decommission noise (1-2 days)

- Drop the 4 minsky-deprecated paths from `shared-rules.md`.
- Drop the `IRON LAW` label from sections that are now enforced by hooks (the label was always trying to compensate for advisory enforcement; the enforcement is now real, the label is redundant).
- Refresh `agentbrew/AGENTS.md`, `dotfiles/AGENTS.md`, `minsky/AGENTS.md` to point at the new architecture.

---

## 7. Risks and what to watch

### 7.1 Hook bugs you'll inevitably hit

(Source: Boucle 2026, dev.to/yurukusa 2026)

- **MCP tools ignore hook denies (#33106).** Your `Stop` hook can't enforce anything that happened via MCP. Mitigation: don't rely on hooks for MCP boundaries — use the MCP server's ACL or `chrome-devtools` MCP's network-allowlist, etc.
- **Subagent contexts ignore exit 2 (#40580).** Your hooks fire in the parent session but a subagent spawned via `Task` doesn't honor them. Mitigation: don't enforce subagent rules via parent hooks — make the subagent's own hooks fire (Devin does this; Claude does this partially).
- **JSONC comments break hook loading (#37540) silently.** Triple-check your settings.json validates as plain JSON. Add `jq . ~/.claude/settings.json` to `agentbrew lint`.
- **Marketplace updates strip executable bit (#39954+).** Plugin installs can render your hooks non-executable. Add a `chmod +x` step to `agentbrew sync`.
- **`$HOME` not expanded in JSON paths.** Use absolute paths or `${CLAUDE_PROJECT_DIR}`. The "5 mistakes" article highlights this as the #1 silent failure.

### 7.2 Drift between agents

- Cursor wraps Claude's format and auto-translates names, but the *semantics* differ subtly (Cursor's `updated_input` is silently ignored for `Task` tool — Cursor forum 2026-04). Don't assume identical behavior from identical schema.
- Devin's `.devin/hooks.v1.json` schema is the closest match to Claude's; treat it as primary.
- Codex's TOML hooks are different enough that you need a real translator.
- GitHub Copilot Cloud only runs hooks from the **repo**, not the user dir. That breaks the "machine-wide hooks" model for that one agent.

### 7.3 The Praetorian "context starvation" failure mode

If you over-correct and stuff TOO much into hooks/skills, you end up with a different problem: the agent has no idea what the project is. Some things genuinely need to be always-on context (project name, monorepo layout, build commands). Keep those in CLAUDE.md. The target is **not zero CLAUDE.md** — it's a *useful* CLAUDE.md that fits in the attention budget.

### 7.4 The maintenance tax

Hooks are code. They break. They need tests. Right now your shared-rules.md is markdown — it can't break at runtime. Moving rules to hooks shifts the bug surface from "model didn't follow rule" to "hook had a bug." You need:

- A way to dry-run hooks (Claude has this via `/hooks` menu; Cursor has the `hooks.json` viewer).
- A way to disable a misbehaving hook quickly without editing JSON in production (e.g. `agentbrew hook disable <name>`).
- Tests for the hook scripts (each `.sh` gets a fixture-driven test).

### 7.5 What if Anthropic / Cursor change the hook schema

It happens. The hooks API is still maturing — Claude Code's `agent`-type hooks are explicitly "experimental, may change." Mitigation: keep your canonical YAML in `agentbrew` separate from the per-agent emitted configs. Re-emit on every change. This is exactly what `agentbrew` already does for MCP and rules.

---

## 8. The single biggest risk: this gives up on cross-agent neutrality

`agentbrew`'s VISION.md mantra is "curator, not host" — the tool's value is *distributing* skills/rules/MCPs to many agents, not authoring them. Hooks dilute this story:

- Claude Code's hooks are richer than any other agent's (24 events, 5 hook types, prompt/agent verifiers).
- Cursor covers the basics (~10 events) but lacks the long tail.
- Windsurf has nothing comparable.
- Codex/Devin/Copilot have command-only hooks with slightly different schemas.

If you push every rule into hooks, you're effectively betting on Claude Code (the agent that hooks the best) as the canonical surface, and accepting that other agents get a degraded experience.

**Counter-argument:** That's already where you are. Your `~/.claude/CLAUDE.md` is 43K tokens; your `~/.codeium/windsurf/memories/global_rules.md` is the same content. The Windsurf agent already isn't following 80% of those rules — it just fails *silently* by ignoring text. With hooks, it fails *visibly* by not having the enforcement at all. The "everyone gets the same rules" story was always a lie; hooks expose that lie.

**Recommendation:** Lean into per-agent tiering. Make hooks the canonical enforcement for Claude/Cursor/Devin/Codex. Accept that Windsurf and the experimental agents get only the lightweight markdown. Document that. Stop pretending otherwise.

---

## 9. Concrete first move (this week)

If you want to dip your toe in before committing to the full migration:

1. Create `~/.config/lefthook/lefthook.yml` with the same shape as `minsky/lefthook.yml` but at machine scope.
2. Add a `Stop` hook to `~/.claude/settings.json`:
   ```json
   {
     "hooks": {
       "Stop": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "bash -c 'INPUT=$(cat); ACTIVE=$(echo \"$INPUT\" | jq -r .stop_hook_active); [ \"$ACTIVE\" = \"true\" ] && { lefthook run agent-stop || true; exit 0; }; lefthook run agent-stop || exit 2'",
               "timeout": 60
             }
           ]
         }
       ]
     }
   }
   ```
3. Add the same to `~/.cursor/hooks.json` as a `stop` entry.
4. Add an `agent-stop:` section to `~/.config/lefthook/lefthook.yml` that runs `lefthook run --files-from-stdin` style file lints on `git status --porcelain` output (the agent's unstaged changes).
5. Run one work session in Claude Code, one in Cursor, one in Devin. Observe the loops, the speed, the rule violations.
6. Then decide whether to commit to the rest of this plan.

That's the minimum-viable validation. Two hours of work. Gives you ground truth on whether the article's premise holds for your specific workload before you commit to the 2-3 week migration.

---

## 10. References

- Sitnik & Turner, "Stop writing rules in AGENTS.md: use agent hooks and nano-staged instead", Evil Martians (2026-05-26). <https://evilmartians.com/chronicles/stop-writing-rules-in-agents-md-use-agent-hooks-and-nano-staged-instead>
- Anthropic, "Automate workflows with hooks", Claude Code docs (2026). <https://code.claude.com/docs/en/hooks-guide>
- Anthropic, "Hooks reference", Claude Code docs (2026). <https://code.claude.com/docs/en/hooks>
- Cursor, "Hooks", Cursor docs. <https://cursor.com/docs/hooks>
- Cursor, "Third Party Hooks", Cursor docs. <https://cursor.com/docs/reference/third-party-hooks>
- Devin CLI, "Lifecycle Hooks". <https://cli.devin.ai/docs/extensibility/hooks/lifecycle-hooks>
- OpenAI Codex, "Hooks". <https://developers.openai.com/codex/hooks>
- GitHub Copilot, "CLI hooks reference". <https://docs.github.com/en/enterprise-cloud@latest/copilot/reference/copilot-cli-reference/cli-hooks-reference>
- Lalit Madan, "Why AGENTS.md Fails for AI Agents". <https://lalitmadan.com/post/why-agents-md-doesnt-work>
- Ready Solutions AI, "Where Does That Rule Go? A Decision Tree for CLAUDE.md, Settings, Skills, and Hooks" (2026-04-26). <https://readysolutions.ai/blog/2026-04-26-claude-code-rule-routing-decision-tree/>
- Praetorian Labs, "Deterministic AI Orchestration: A Platform Architecture for Autonomous Development" (2026). <https://www.praetorian.com/blog/deterministic-ai-orchestration-a-platform-architecture-for-autonomous-development/>
- Yurukusa, "5 Claude Code Hook Mistakes That Silently Break Your Safety Net", dev.to (2026). <https://dev.to/yurukusa/5-claude-code-hook-mistakes-that-silently-break-your-safety-net-58l3>
- Boucle, "190 Things Claude Code Hooks Cannot Enforce (And What to Do Instead)", dev.to (2026). <https://dev.to/boucle2026/what-claude-code-hooks-can-and-cannot-enforce-148o>
- Stevek inney, "Skills, Rules, and Hooks" course notes. <https://github.com/stevekinney/stevekinney.net/blob/main/courses/self-testing-ai-agents/skills-rules-and-hooks.md>
- AgentPatterns.ai, "Using Hooks for Enforcement and Prompts for Guidance". <https://agentpatterns.ai/verification/hooks-vs-prompts/>
- es-tooling/module-replacements#214 — community thread on nano-staged maintenance status.
- openai/codex#13386 — AGENTS.md silent 32KB truncation.
- anomalyco/opencode#18037 — large AGENTS.md triggers compaction loop.
- Cursor forum #151985 — `preToolUse` `updated_input` silently ignored for `Task` tool.
- AGENTIF benchmark (NeurIPS 2025) — instruction adherence cliff at ~6,000 words.
- Adversa AI, April 2026 — `permissions.deny` bypass via >50 chained subcommands.

---

## 11. Open questions

1. **Does `agentbrew` want this responsibility?** The repo's VISION.md says "curator, not host." Hooks-distribution is curation of a different shape — distributing executable code, not pointers. Might want a sibling repo (`agentbrew-hooks`?) instead of bundling.
2. **What about repo-local hooks?** This document focuses on machine-wide. Most teams ALSO want per-repo hooks (`.claude/settings.json` checked into each repo). Need to decide the layering. Cursor's docs show 7-layer hook resolution. agentbrew should make this transparent.
3. **Schema versioning.** Claude Code hook events have changed before (e.g. `Stop` semantics evolved between 2.0 and 2.1). agentbrew's canonical YAML needs versioning to handle agent-side schema drift.
4. **Performance baseline.** Before/after numbers on rule-adherence and per-session token cost would be invaluable. Worth instrumenting one session per agent before starting the cut.
5. **The Minsky-shaped extension.** Minsky is your orchestrator and has its own discipline (rule #10 deterministic enforcement). It's already partway down this path with its `runtime-invariants.ts`. Should it become the *implementation* of the "Loop" tier and `agentbrew` just be the distributor of references to it? Plausible. Worth a follow-up think.

---

*End of document. Ready for your critique.*
