---
name: cursor-token-playbook
description: >
  Daily Cursor token optimization habits — model mix, chat lifecycle, scoping,
  MCP discipline, .cursorignore, and measure-context checks. Use when the user
  asks how to save tokens, reduce context, pick models, start a new chat, or
  optimize Cursor usage. Triggers on "token playbook", "save tokens", "context
  too full", "which model", "new chat or continue", or after ship-it measure
  context shows low headroom.
---

# cursor-token-playbook

Operator playbook for **session habits** (Cursor IDE + agentbrew). Static config measurement lives in the **`context-budget`** skill — load that for audits and trim tasks.

## Model mix (default week)

| Share | Model / mode | When |
|-------|----------------|------|
| **~70%** | Fast Composer (default agent model) | Implementation, edits, tests, ship-it delivery, scoped refactors |
| **~20%** | Strong model (Opus / max effort) | Stuck after one fast pass, architecture, subtle bugs, security review |
| **~10%** | Ask mode (read-only) | Explaining code, comparing options, planning — no edits |

**Escalation ladder:** Ask (understand) → fast Composer (try fix) → strong model (only if still blocked). Do not start every task on the strongest model.

## New chat vs continue

| Start **new chat** | **Continue** same chat |
|--------------------|-------------------------|
| New repo, feature, or unrelated task | Same feature branch / same bug / same PR thread |
| Context ring > ~60% or responses degrade | Under ~40% ring with focused @ scope |
| After `agentbrew sync` changed rules, MCP, or skills | Mid-implementation with working mental model |
| After attaching huge logs or dumping full test output | Small follow-up on code already in thread |
| User says "fresh context" or ship-it merged config changes | Clarifying question on last agent edit |

**Rule of thumb:** one chat ≈ one deliverable (one PR scope). Split parallel work across parallel chats instead of one megathread.

## When to tell the user (proactive)

Agents **MUST** surface a new-chat nudge when any trigger matches — evaluate each turn or at natural boundaries (delivery report, task complete, topic shift). One sentence is enough; do not repeat every turn.

| Trigger | Tell the user |
|---------|----------------|
| Deliverable shipped / ship-it report | New chat for the next task |
| Topic/repo pivot | Fresh chat — old context bleeds in |
| Ring > ~60% or ~30–60 min heavy session | New chat before next deliverable |
| Re-reads same files / forgets constraints | Thread stale — @-scope in new chat |
| After sync/apply changed rules/MCP/skills | **Start a new chat** so updated rules load |
| `low-soft-headroom` in `latest.json` | New chat; load `context-budget` before adding rules |

**Do not nudge** for same PR thread, mid-debug, or single follow-up edit.

## Cursor habits (biggest wins)

1. **Scope with @** — `@file` / `@folder` / `@symbol` instead of "read the whole repo". Never paste multi-thousand-line logs; attach the failing snippet + command output tail.
2. **Ask vs Agent** — Ask for research and questions; Agent only when you need edits. Ask burns fewer tool loops.
3. **Fewer MCP servers** — each enabled server adds tool schema to context. Disable servers unused this week (`agentbrew status`, MCP panel). Prefer one data plane per domain.
4. **`.cursorignore`** — copy `~/apps/tooling/dotfiles/templates/project.cursorignore` to repo root as `.cursorignore`. Keeps `node_modules`, `dist`, vendor trees, fixtures, and `.git` out of agent context.
5. **Parallel chats** — one chat per workstream; avoids cross-contamination and ring bloat.
6. **Measure, don't guess** — `agentbrew measure context` → read `~/.config/agentbrew/metrics/latest.json` (`static.softTokenHeadroom`, `topSections`, `alerts`).
7. **Restart after config sync** — after `agentbrew sync` or dotfiles apply that touched rules/MCP/skills, **new chat** so stale system prompt isn't carried.

## Daily workflow (5 minutes)

```bash
# Morning or before a heavy session
agentbrew measure context
cat ~/.config/agentbrew/metrics/latest.json | jq '.static.softTokenHeadroom, .alerts, .static.topSections[:3]'

# If alerts include low-soft-headroom → load context-budget skill before adding rules/skills
# Optional runtime planes (graceful skip OK):
#   openusage daily --json --since $(date +%F)
#   tokscale cursor sync   # after tokscale cursor login
```

During work: @-scope files, prefer fast Composer, escalate model only when stuck, new chat per deliverable.

After **ship-it** or **agentbrew sync --pull**: new chat + quick `agentbrew measure context` to confirm headroom.

## Static config guardrails

When `softTokenHeadroom` < ~1,800 tokens (see `latest.json` alerts):

- Do not add always-on rules or skills until trimmed.
- Run `agentbrew lint` and follow **`context-budget`** investigation workflow.
- Move long prose to skill `references/` — load on demand.

## Related

- **`context-budget`** — metrics, lint, ccusage/openusage/tokscale, TASKS.md trim tasks
- **`agentbrew-status`** — MCP drift and sync health
- **`~/apps/tooling/dotfiles/docs/cursor-token-playbook.md`** — human-readable mirror of this playbook
- **`~/apps/tooling/dotfiles/templates/project.cursorignore`** — per-repo ignore scaffold
