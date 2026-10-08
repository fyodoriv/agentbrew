# Skill Routing Policy

> Where new rules and skills belong, and when content should move OUT of an
> always-loaded shared-rules.md file. Read this BEFORE adding any rule that's
> longer than 5 lines to a shared instruction file.

## TL;DR

Every rule has one canonical home. The home is chosen by **who needs it, and when**:

| If the rule applies to... | Home | Example |
|---|---|---|
| Every task in every repo, every session | `shared-rules.md` inline (always-loaded) | Git Safety, Commit Format, Verify Before Completion |
| A workflow that recurs across repos but isn't always relevant | An **agentbrew skill** in `skill-plugins/dev/` (lazy-loaded on description match) | Jira hygiene, code review, GDoc editing |
| One team's stack or one product area | That team's **skill registry** (e.g. a `<team>-skills` repo) | Team-specific component patterns, internal experiment platform rules |
| One specific tool, dashboard, or release process | That tool's **plugin skills folder** (e.g. `<tool>/.agents/skills/`) | Tool-specific deploy steps, dashboard navigation |
| One specific repo | That repo's `AGENTS.md` / `CLAUDE.md` / `.agents/skills/` | Per-repo build commands, repo-specific MCP setup |
| A language or file pattern | A **per-file rule** in `~/.config/agentbrew/rules/` with `globs:` metadata | TypeScript conventions, React patterns, test file rules |

## Why this matters: the token budget

`shared-rules.md` is **always loaded into every agent's context, every session**.
agentbrew's warning threshold is **8,000 tokens** (~32 KB of source text).
A 47k-token shared-rules.md costs ~5.9% of a 200K context window before any
work begins — and that's the per-session tax on every Claude / Cursor /
Codex / Gemini interaction.

The fix isn't "delete rules" — it's "move them where they belong so they
load on-demand, not always-on."

## The decision tree

Read top to bottom. The first "yes" is the home.

```
1. Does the rule apply to literally EVERY task in EVERY repo on EVERY agent
   session? (Examples: Git Safety, Commit Format, "Verify Before Completion",
   "Public Impersonation Ban", "Agent Attribution Footer".)
   ─ yes  → shared-rules.md (always-loaded). Keep it under 1 paragraph.
   ─ no   → continue.

2. Is it a workflow that recurs across many repos but only when you're doing
   that kind of work? (Examples: managing Jira tickets, reviewing PRs,
   editing Google Docs, structuring RFCs, writing skills.)
   ─ yes  → agentbrew skill in `skill-plugins/dev/`. The agent loads it
            when the description matches the user's request.
   ─ no   → continue.

3. Is it about a team's specific stack, framework, or product area?
   (Examples: a team's React component patterns, an internal experiment
   platform's allocation rules, a custom feature-flag system.)
   ─ yes  → That team's skill registry repo. Many orgs publish a
            `<team>-skills` or `<team>-engineering-skills` repo with its own
            registry pattern. Reference it as an agentbrew skill source.
   ─ no   → continue.

4. Is it about a specific tool's release process, dashboard navigation,
   deploy pipeline, or admin UI?
   ─ yes  → That tool's `.agents/skills/` folder (or equivalent). The tool's
            repo owns the skill; agentbrew registers it as a skill source.
   ─ no   → continue.

5. Is it about ONE specific repository (build commands, repo-local MCP setup,
   repo-specific testing conventions)?
   ─ yes  → That repo's `AGENTS.md` (or `CLAUDE.md` if Claude Code only) or
            `.agents/skills/<name>/SKILL.md`. Lives WITH the code.
   ─ no   → continue.

6. Is it triggered by a specific language or file pattern? (Examples:
   TypeScript-only rules, React component rules, *.test.ts patterns.)
   ─ yes  → Per-file rule in `~/.config/agentbrew/rules/<name>.md` with
            `globs:` frontmatter. Cursor loads these only when
            editing matching files.
   ─ no   → Reconsider. If the rule fits none of the above, it may be
            documentation, not a rule. Move to a docs file (e.g. ARCHITECTURE.md).
```

## Before you create a new skill: GREP

agentbrew's vision is **curator, not host** — it references skills that live
in source repos, never duplicates them. Before authoring a new skill, search
EVERY source for existing coverage:

```bash
# 1. agentbrew's built-in dev skills
ls ~/apps/agentbrew/skill-plugins/dev/ | grep -i <topic>

# 2. Other skill sources registered in state.yaml
agentbrew catalog --sources list

# 3. Locally checked-out skill registries
fd SKILL.md ~/apps/ | xargs grep -l -i <topic>

# 4. The agentbrew catalog (potential remote sources you could install)
agentbrew catalog | grep -i <topic>
```

If a skill already covers the topic, **extend it** with a new section rather
than creating a sibling. Fragmenting topics across multiple skills makes the
agent's lazy-loading less effective (it may load only one of three relevant
skills and miss the others).

The exception: when the new content is genuinely orthogonal to the existing
skill (e.g. an existing `jira` skill is about CREATING tickets, and the new
content is about AUDITING tickets — those are different enough). When in
doubt, default to extending.

## Anti-patterns

These are the most common ways shared-rules.md gets bloated. Each one has a
fix.

### 1. Copy-pasted template content

**Symptom**: Your `shared-rules.md` repeats rules that already exist in
agentbrew's `templates/AGENTS.md` (Git Safety, Commit Format, TASKS.md spec).
**Cost**: ~250 tokens per duplicate section.
**Fix**: Delete the copy; let the template handle it. Add only project-specific elaborations.

### 2. Inline examples for every rule

**Symptom**: Each rule has 5–10 concrete examples enumerated inline.
**Cost**: 50–80% of the rule's tokens go to examples that an agent could
generate itself from the rule.
**Fix**: Keep one canonical example. Link to a `docs/<rule>-examples.md` for the rest.

### 3. The same rule restated in three sections

**Symptom**: "Never use `git reset --hard`" appears under Git Safety, Multi-Agent
Coordination, AND Before Every Commit.
**Cost**: 3× the tokens; risks divergence over time.
**Fix**: State once, cross-reference from other sections.

### 4. Skill descriptions inlined in shared-rules

**Symptom**: Each installed skill gets a 10-line description in shared-rules.md.
**Cost**: 40 skills × 10 lines = 400 lines (~9k tokens).
**Fix**: Use categories (`development workflow skills installed;
8 for review; 6 for planning`). agentbrew's `compressSkillsListing()` does this
automatically on deploy.

### 5. Language- or file-specific rules inlined

**Symptom**: "When working on TypeScript, use strict typing" lives in
shared-rules.md and loads even when the user is editing Markdown.
**Cost**: Variable, but compounds across every TypeScript / React / test
section.
**Fix**: Move to per-file rules in `~/.config/agentbrew/rules/<name>.md` with
`globs:` frontmatter. Cursor will load these only when editing
matching files.

### 6. Treating shared-rules as a knowledge base

**Symptom**: Multi-paragraph explanations of architecture, system design,
historical context.
**Cost**: Knowledge belongs in docs, not rules. Rules should be imperative
("Do this" / "Never do that"). Bloats context with non-actionable prose.
**Fix**: Move to `ARCHITECTURE.md` (project) or `docs/<topic>.md`. Replace with
a one-line pointer.

### 7. One-off context inlined as a rule

**Symptom**: "When deploying to the [specific service] dashboard, click X then
Y" lives in shared-rules.md as a "rule".
**Cost**: This is a runbook, not a rule. It only applies in one workflow,
maybe once a month.
**Fix**: Move to a skill in the tool's `.agents/skills/` folder. Lazy-load
when the user actually deploys that service.

### 8. Conditional or temporary rules without expiration

**Symptom**: "Until version 2.x ships, do X" rules that stay long after 2.x
shipped.
**Cost**: Adds cognitive load and stale guidance.
**Fix**: Set a calendar date or PR number for expiry. Add to TASKS.md a P3
task to remove the rule after the trigger.

## Concrete example: trimming a bloated shared-rules.md

Suppose `shared-rules.md` is currently 47k tokens (~2,000 lines). A typical
trim ratio:

```
Before (47k tokens, ~2,000 lines)
├── Universal IRON LAWs                        ~3,500 tokens  → keep inline
├── Workflow skills (Jira, GDoc, PR review)   ~12,000 tokens  → move to agentbrew skills
├── Product/team-specific (product X, framework X)~8,000 tokens   → move to <team>-skills repo
├── Tool-specific (dashboard X, deploy Y)     ~6,000 tokens   → move to tool's skill folder
├── Language/file-pattern triggered            ~4,000 tokens  → move to ~/.config/agentbrew/rules/
├── Copy-pasted template duplicates            ~3,000 tokens  → delete (template covers it)
├── Inline examples + restatements             ~6,000 tokens  → compress / dedupe
└── Skills listing enumeration                 ~4,500 tokens  → category-counts via compressSkillsListing()

After (~3,500 tokens, ~150 lines)
```

That's an 92% reduction. The rules are still ALL available — they're now loaded
on-demand when the agent recognizes the relevant topic, rather than burning
context every session.

## When you DO need to extend shared-rules.md

These additions are legitimately always-on:

- New universal safety rule (e.g. a new git footgun discovered).
- New universal verification gate (e.g. a new lint that must run every commit).
- New public-impersonation surface to ban.
- New always-required PR-body field.

Even then, prefer **one new line that points at a skill** to a multi-paragraph
section. The shared-rules.md should be skimmable in 60 seconds.

## Why "update rules first"

This document IS the rule. Before moving content out of an existing
shared-rules.md, the routing policy must be codified so:

1. Future agents (and yourself in a different session) can replay the
   decision.
2. The decision is reviewable — there's a written-down "why" for every move.
3. New rules that arrive in the future get routed correctly the first time
   instead of accumulating in shared-rules.md.

See `templates/AGENTS.md` (the cross-agent baseline rule) for the short
imperative pointer to this doc.
