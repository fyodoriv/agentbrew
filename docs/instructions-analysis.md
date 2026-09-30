# Instructions Analysis: Benefits, Costs, and Token Overhead

An honest assessment of agentbrew's instruction files — what they buy you, what they cost, and whether the tokens are justified.

> **Numbers in this doc are approximations.** Per AGENTS.md "Counter Precision",
> the line counts, byte sizes, and token estimates here use `N+` floors instead
> of point measurements. The template, the user's shared rules, and the cursor
> rules dump all change over time; precise counts go stale within weeks. The
> percentages and threshold recommendations stay correct as the file grows.
> If you need an exact byte count, run `wc -c` against the live file — but the
> recommendations in this doc do not depend on knowing it.

## What Instructions Are

AgentBrew deploys a canonical template (`templates/AGENTS.md`) to every agent that supports a global rules file. The template is wrapped in HTML comment markers so user content outside the markers is never touched.

**Source:** `templates/AGENTS.md`

**Targets:** agents with `rulesFile` defined:

| Agent | Target File |
|-------|-------------|
| Claude Code | `~/.claude/CLAUDE.md` |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md` |
| Augment | `~/.augment/guidelines.md` |
| Devin | `~/.config/devin/AGENTS.md` |
| Codex | `~/.codex/AGENTS.md` |
| Gemini CLI | `~/.gemini/GEMINI.md` |

Other agents (the majority — see `src/core/agents.yaml`) receive skills and MCP servers but **no instructions** (they lack a `rulesFile` in `agents.yaml`).

## What Lands in Context

The deployed file is not just the template. It contains **two marker-wrapped sections** stacked in one file:

```
<!-- agentbrew:instructions:start -->
[templates/AGENTS.md — the base template]
<!-- agentbrew:instructions:end -->

<!-- agentbrew:start -->
[~/.config/agentbrew/shared-rules.md — user's shared rules]
<!-- agentbrew:end -->
```

**Approximate sizes (current deployment):**

| Section | Size | Share of File |
|---------|------|---------------|
| Instructions (template) | ~8 KB+, ~2,000+ tokens | ~30-40% |
| Managed rules (user) | ~13 KB+, ~3,500+ tokens | ~50-60% |
| Markers + whitespace | tiny | ~1% |
| **Total per agent** | **~25 KB+, ~6,000+ tokens** | **100%** |

The template-vs-rules ratio shifts as either side grows. When the template added the Public Impersonation Ban and Counter Precision sections, its share grew; when users delete bloated rules, theirs shrinks. The file always sums to ~100%; what matters for analysis is which side is larger and whether either has crossed a bloat threshold.

### Context Window Impact

| Model | Context Window | Instructions Overhead |
|-------|---------------|----------------------|
| Claude (200K) | 200,000 tokens | ~3% |
| GPT-4 (128K) | 128,000 tokens | ~5% |
| Gemini (1M) | 1,000,000 tokens | <1% |

On agents that also load a **project-level** AGENTS.md (like this repo's ~10 KB+ file), total overhead rises to ~8K+ tokens — still under 5% of a 200K context window.

## Do They Add Extra Tokens for No Good Reason?

**Partially yes — but agentbrew already removes most of it on deploy.** Three sources of unnecessary tokens are catalogued below; recommendations 1, 2, and 4 in the [Recommendations](#recommendations) section are already implemented in the sync pipeline (`deduplicateByHeading`, `warnIfOverTokenBudget`, `stripCursorRulesSection`). The numbers below describe the **pre-transform** waste; the **deployed** file is smaller because agentbrew strips overlapping headings, hides the cursor-rules dump, and warns when the result still exceeds the threshold.

### 1. Duplication Between Instructions and Rules (~250+ tokens wasted)

Several sections appear in **both** the template and the user's shared rules:

| Section | In Template | In Rules | Verdict |
|---------|-------------|----------|---------|
| Git Safety (Multi-Agent) | yes | yes (more detailed) | **Duplicated.** Rules version typically wins on detail. |
| Before Every Commit | yes | yes | **Duplicated.** Nearly identical. |
| Commit Format | yes | yes (adds JIRA ticket line) | **Duplicated.** Rules adds project specifics. |
| Dependency Policy | yes | yes (more detailed) | **Duplicated.** Rules version is typically several times longer. |
| Task Queue | yes | yes (adds format spec) | **Duplicated.** Rules adds project specifics. |

This duplication is a **user-side problem**, not a template problem. The template ships generic guidance. If the user's `shared-rules.md` repeats the same topics with project-specific detail, both get injected. Agentbrew does not deduplicate across sections.

**Wasted:** ~250+ tokens. **Fix:** Users should remove generic rules from `shared-rules.md` when they overlap with the template, or the template should be trimmed to avoid covering topics users typically customize.

### 2. The Skills Listing (~800+ tokens of low-value context)

The managed rules section includes a full skill inventory:

```markdown
## Skills (`~/.claude/skills/` — agentskills.io format)

**Orchestrator — AI Team Pipeline** (say "run the team" or "full pipeline"):
- `orchestrator-pipeline-runner` — Run the full team pipeline...
- `orchestrator-researcher`, `orchestrator-alternatives-analyst`...
[40+ skill names with descriptions]
```

This catalog consumes ~800+ tokens and is **marginally useful.** Agents already discover skills through their skill directories. The listing serves as a "menu" so the agent knows what's available without reading every skill file, but could be replaced by a shorter summary or on-demand lookup.

**Wasted:** Debatable. Useful for discoverability, but ~800+ tokens for a static list that changes infrequently.

### 3. Auto-Synced Cursor Rules in Non-Cursor Agents (~2,500+ tokens)

The managed rules section includes a full dump of Cursor-format rules:

```markdown
## Auto-Synced Cursor Rules

### code-style
# Code Style
## TypeScript
- Strict typing — no `any`, no type casting...

### commits-and-ci
# Commits & CI
## Git Safety (Multi-Agent) — CRITICAL...

### react-patterns
# React Patterns...

### restricted-imports
# Restricted Imports...

### testing
# Testing...
```

These are **Cursor-specific rule files** (`.mdc` format) that have been serialized into the shared rules. They consume ~2,500+ tokens and contain **further duplication** — the `commits-and-ci` rule repeats Git Safety and Commit Format a third time.

For Cursor, this content is redundant because the same rules already exist as per-file rules in `~/.cursor/rules/`. For other agents, the content is useful but verbose.

**Wasted:** ~500-1,000+ tokens of duplication within the Cursor rules section alone.

### Total Waste Estimate

| Source | Approximate Tokens | Avoidable? |
|--------|--------------------|------------|
| Template/rules duplication | ~250+ | Yes — deduplicate shared-rules.md |
| Skills listing | ~800+ | Partially — could be shorter |
| Cursor rules in non-Cursor agents | ~2,500+ | Partially — useful content, but duplicated internally |
| Duplication within Cursor rules | ~500+ | Yes — Git Safety appears multiple times total |
| **Total potentially wasted** | **~1,500-2,500+** | Out of ~6,000+ total |

**Bottom line:** ~25-40% of the deployed content is duplicated or low-signal. The template itself is lean and high-value. The bloat comes from the user's shared rules repeating template topics and from Cursor rules being serialized wholesale.

## Benefits That Justify the Cost

### 1. Behavioral Consistency Across Agents (High Value)

Without instructions, each agent invents its own conventions:
- One agent uses `git add .`, another uses `git add <files>` — in a multi-agent repo, the first one stages everyone's changes.
- One agent commits on `main`, another creates branches.
- One agent runs `find`, another runs `fd` (which respects `.gitignore`).

The template's critical rules prevent **data loss** (Git Safety), **broken builds** (Before Every Commit), and **noisy diffs** (Commit Format). These sections earn their tokens through avoidance of costly mistakes.

**ROI:** A single `git reset --hard` that wipes another agent's uncommitted work costs far more than ~6,000+ tokens of context.

### 2. Write Once, Deploy Everywhere (Moderate Value)

Every agent has its own file format and location:
- Claude Code: `~/.claude/CLAUDE.md`
- Windsurf: `~/.codeium/windsurf/memories/global_rules.md`
- Augment: `~/.augment/guidelines.md`
- Codex: `~/.codex/AGENTS.md`

Without agentbrew, a user who adds a rule (e.g., "use `fd` instead of `find`") must edit 6 different files in 6 different directories. With agentbrew, they edit `templates/AGENTS.md` or `shared-rules.md` once and run `agentbrew sync`.

### 3. Drift Detection and Auto-Repair (High Value)

Agents and their extensions frequently overwrite config files. Agentbrew detects drift (content mismatch between source and deployed file) and auto-repairs every 30 minutes. Without this, instructions silently disappear and agents revert to default behavior.

The marker system (`<!-- agentbrew:instructions:start/end -->`) enables safe replacement of only the managed section. User content outside markers survives every sync.

### 4. Team Standardization (Moderate Value)

`shared-rules.md` supports three merge layers: team rules (from a git repo) → user rules → project rules. This means a team lead can set baseline conventions, individual developers can add personal preferences, and projects can override for their specific needs.

### 5. Project-Level Context (High Value)

The template teaches agents about the task queue format (`TASKS.md`), the Agentfile convention, and the "tickets are prompts" philosophy. This enables a workflow where agents autonomously pick up tasks, follow conventions, and produce consistent output — without per-session prompting.

## Recommendations

### For agentbrew (the product)

1. **Deduplicate on deploy.** ✅ **Implemented.** `deduplicateByHeading()` in `src/sync/instructions-content.ts` removes template sections whose headings already appear in the user's managed rules block. Wired into `mergeInstructionsWithManagedSection()`, so the deployed file never carries both copies. Eliminates ~250+ tokens of pure duplication.

2. **Warn on bloated shared-rules.md.** ✅ **Implemented.** `warnIfOverTokenBudget()` in `src/sync/instructions-sync.ts` runs after every `agentbrew sync` and emits a warning naming the largest H2 sections when the deployed file crosses `DEFAULT_TOKEN_WARNING_THRESHOLD` (~8K tokens, configurable via the constant in `instructions-content.ts`). `instructionsSyncStatus()` colors the deployed token count yellow when the file is over budget. `agentbrew lint` now also fails duplicate `##` headings, repeated subsection markers inside one section, and any single shared-rules section above 5k tokens. Future-improvement: surface the threshold via `state.yaml` so users can raise it without a code change.

3. **Consider tiered loading.** ⏳ **Open.** The COMPETITION.md doc notes that competitors use L0/L1/L2 tiers — a small abstract for relevance, a moderate planning chunk, full content on demand. Agentbrew could adopt a similar approach: deploy a compact version by default, with a pointer to the full rules file for agents that support on-demand loading. No agentbrew skill picks this up today; it's a future contribution candidate.

4. **Split Cursor rules from shared rules.** ✅ **Implemented.** `stripCursorRulesSection()` in `src/sync/instructions-content.ts` removes the `## Auto-Synced Cursor Rules` block before each deploy. `src/sync/rules-sync.ts:323-326` chains `compressSkillsListing()` then `stripCursorRulesSection()` so the deployed `shared-rules.md` never carries the Cursor-specific rule dump. Cursor itself still gets the rules — they're emitted as per-file `.mdc` files under `~/.cursor/rules/` by the rules-sync engine, not via the global shared-rules path. The drift checker in `src/drift-checks/rules.ts:73-79` applies the same transforms before comparing on-disk content, so the dedup is invisible to status.

### For users

1. **Audit your shared-rules.md.** If it repeats topics from the template (Git Safety, Commit Format, etc.), remove the duplicates from your rules file and let the template handle the baseline.

2. **Trim the skills listing.** If you have many skills, consider reducing the listing to categories instead of enumerating every skill. Agents can discover skills from their skill directories.

3. **Use per-file rules for language-specific guidance.** Instead of dumping TypeScript, React, and testing conventions into the global rules file, use `~/.config/agentbrew/rules/` with glob patterns. Per-file rules only activate when the agent is working on matching files, saving context on unrelated tasks.

## Summary

| Aspect | Assessment |
|--------|------------|
| Template size (~2,000+ tokens) | **Justified.** High-value safety and consistency rules. |
| Shared rules size (~3,500+ tokens) | **User-controlled.** Can be trimmed. |
| Duplication overhead (~1,500-2,500+ tokens) | **Avoidable.** Product and user-side fixes possible. |
| Context window impact (3-5%) | **Acceptable** for 200K+ models. Tight for 32K models. |
| Benefits vs. cost | **Net positive.** Preventing one `git reset --hard` or one inconsistent commit format across agents pays for months of token overhead. |

The template earns its tokens. The bloat comes from user-side rules accumulation and cross-section duplication — both fixable without changing the architecture.
