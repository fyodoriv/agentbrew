# Tiered Context Loading for agentbrew

> Research status: **Complete** — Recommendation: **Defer**
> Last updated: 2026-04

## Executive Summary

Tiered context loading (L0/L1/L2) is a promising idea borrowed from OpenViking's runtime RAG architecture, but it does not map cleanly onto agentbrew's static file deployment model. The current token overhead is low (3-5% of a 200K context window), existing mitigations already address the worst bloat, and the agents most likely to benefit don't expose the APIs needed for selective on-demand loading. The better path is fixing the real bloat sources — serialized Cursor rules and growing shared-rules.md — without adding a new architecture.

**Recommendation: Defer.** Revisit if shared-rules regularly exceeds 8K tokens or if agents ship a "load file on demand" mechanism.

## 1. What Is Tiered Context Loading?

The term comes from **OpenViking** (Volcengine/ByteDance, 15.6K stars), a "context database" server for AI agents using a virtual filesystem paradigm (`viking://` protocol) with three tiers:

| Tier | Size | Purpose |
|------|------|---------|
| **L0** | ~100 tokens | Abstract summary — quick relevance check |
| **L1** | ~2,000 tokens | Overview/outline — used for planning |
| **L2** | Full content | Loaded on demand when detail is needed |

OpenViking claims 43-49% retrieval quality improvement over flat RAG with 83-96% token cost reduction.

**Critical distinction**: OpenViking's tiers are a *runtime retrieval system* using vector search + directory traversal to retrieve context dynamically. This is fundamentally different from agentbrew's model which deploys Markdown files to disk and lets agents load them at context start.

## 2. Current State

### Token Costs

| Section | Est. Tokens | % of File |
|---------|-------------|-----------|
| Instructions template | ~1,500 | 25% |
| Managed rules (user) | ~4,450 | 74% |
| Markers + whitespace | ~30 | 1% |
| **Total per agent** | **~6,000** | **100%** |

### Context Window Impact

| Model | Context Window | Instructions Overhead |
|-------|---------------|----------------------|
| Claude Sonnet (200K) | 200,000 tokens | **3.0%** |
| GPT-4o (128K) | 128,000 tokens | **4.7%** |
| Gemini 1.5 Pro (1M) | 1,000,000 tokens | **0.6%** |

## 3. Agent Capability Matrix

### Agents with `rulesFile` (always-loaded, no selectivity) — 6 agents

claude-code, windsurf, augment, devin, codex, gemini-cli load the entire target file at session start. There is no API to load additional sections on demand. For these agents, tiered loading cannot be enforced by agentbrew.

### Agents with `rulesDir` (glob-based per-file rules) — 2 agents

Cursor and Windsurf support per-file rules with `type: always|auto|agent|manual` — this IS tiered loading natively. `type: always` = L0, `type: auto` triggered by glob = L1, `type: agent` = L2. agentbrew already deploys to these directories.

### Agents with neither — 38 agents

No instruction loading at all — they only receive skills and MCP servers. Instructions don't apply regardless of tier design.

## 4. Existing Token-Reduction Machinery

agentbrew already ships significant mitigation:

- **`compressSkillsListing()`**: Replaces 40 skill names (~800 tokens) with category+count summary (~50 tokens)
- **`deduplicateByHeading()`**: Removes template sections duplicated in user's shared-rules (~270 tokens saved)
- **`stripCursorRulesSection()`**: Strips ~2,500 tokens of Cursor-specific rules from non-Cursor agents
- **`warnIfOverTokenBudget()`**: Emits warning when deployed file exceeds 8,000 tokens

## 5. Why Not to Implement

1. **rulesFile agents can't load on demand** — the 6 agents that load instructions have no mechanism for selective section loading. Tiered loading reduces to "deploy a shorter file" — just trimming, not a new architecture.

2. **rulesDir agents already have it** — Cursor/Windsurf per-file rules IS the L0/L1/L2 model. Users just need guidance on structuring rules.

3. **OpenViking's approach doesn't transfer** — they control a retrieval server that intercepts context requests. agentbrew doesn't sit in that path.

4. **Implementation cost is high** — estimated 300-500 new source lines against a <20K target, for a 3-5% overhead reduction.

5. **Reliability > efficiency at this cost** — a system that reliably delivers 6,000 tokens beats one that delivers 100 tokens and hopes the agent requests more.

## 6. What to Do Instead

1. **Document Cursor/Windsurf tiered rules** — help users structure rules across `always-on` vs context-triggered files
2. **Consider an `agentbrew instructions analyze` command** — expose `measureSections()` as a CLI command showing token budget breakdown
3. **Shrink template by moving repo-specific content to per-file rules** — some "Critical Rules" content is agentbrew-specific, not universal

## 7. Revisit Triggers

- shared-rules.md regularly exceeds 8K tokens for significant user segment
- A major agent ships a "load additional context file" mechanism
- Template grows beyond 5K tokens (currently ~1,734)
- Context windows drop significantly (popular 32K model becomes dominant)
