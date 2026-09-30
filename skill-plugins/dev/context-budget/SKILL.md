---
name: context-budget
description: >
  Investigate agentbrew + Cursor context budget using automated metrics.
  Use when the user asks about context size, token budget, trimming shared rules,
  ccusage, session-report, or optimizing always-on agent config. Triggers on
  "context budget", "token audit", "measure context", "why is context full",
  or before claiming a TASKS.md trim/token task.
---

# context-budget

Automated measurement for **static config** (agentbrew lint, projected deployed rules) and **optional runtime** (ccusage, session-report). Cursor's context ring has **no API** — document manual readings under `~/.config/agentbrew/metrics/manual-snapshots/`.

For **daily Cursor habits** (model mix, new-chat rules, @ scoping, MCP discipline, `.cursorignore`), load the **`cursor-token-playbook`** skill first — then return here for metrics-driven trim work.

## Investigation workflow (run in order)

1. **Read the latest snapshot**

   ```bash
   cat ~/.config/agentbrew/metrics/latest.json
   ```

2. **Refresh metrics**

   ```bash
   agentbrew measure context
   # or: bash scripts/measure-context-budget.sh (from agentbrew repo)
   # or: npm run measure:context
   ```

3. **Lint = actionable static failures**

   ```bash
   agentbrew lint
   ```

   Failures name duplicate headings, section token budgets, and projected deployed size over budget.

4. **Claude-heavy runtime (optional)**

   ```bash
   bunx ccusage weekly
   # multi-provider daily (Cursor local DB, OpenRouter, quotas): openusage daily --json
   # Cursor API history: bunx tokscale  (after tokscale cursor login && tokscale cursor sync)
   # or: session-report skill for HTML transcript analysis (~/.claude/projects)
   ```

5. **Optional repo token tree (Repomix — no install required via npx)**

   ```bash
   bash scripts/audit-context-tree.sh .
   # equivalent: npx -y repomix --token-count-tree .
   ```

6. **Compare history**

   ```bash
   ls -lt ~/.config/agentbrew/metrics/context-budget-*.json | head
   ```

   Diff `projectedDeployedTokens`, `topSections`, and inventory counts week over week.

7. **Pick or file TASKS.md work**

   Search TASKS.md for `token-budget`, `trim-shared-rules`, `instructions-file-size`. File new tasks with measured evidence from `latest.json` (quote numbers).

8. **Cursor context ring (manual)**

   In the IDE, note the ring percentage when a session feels tight. Save a one-line snapshot:

   ```bash
   mkdir -p ~/.config/agentbrew/metrics/manual-snapshots
   echo "$(date -Iseconds) ring=72% note=after heavy skill load" >> ~/.config/agentbrew/metrics/manual-snapshots/cursor-ring.log
   ```

## What each plane measures

| Plane | Tool | Automated? |
|-------|------|------------|
| Static deployed rules | `agentbrew measure context` / lint | Yes |
| Shared-rules bytes | snapshot `static.sharedRulesBytes` | Yes |
| MCP/skills/agents inventory | snapshot `inventory.*` | Yes |
| Claude session usage | ccusage / openusage / tokscale JSON | Optional (graceful skip) |
| Repo file token tree | Repomix `--token-count-tree` | Optional (`scripts/audit-context-tree.sh`) |
| Transcript deep-dive | session-report skill | Manual invoke |
| Cursor IDE ring | manual-snapshots/ | No API |

## Recurring cadence

See `RECURRING.md` → **context-budget-weekly-audit** (weekly). Automated refresh also runs on:

| Trigger | Interval | Mode |
|---------|----------|------|
| **SessionStart hook** (`context-budget-measure`) | 6h | background, static-only (`--quick`) |
| **`agentbrew sync --pull`** (post-sync) | 24h | inline, static-only |
| **Cron/launchd** | weekly | full (`scripts/measure-context-budget.sh`) |

Read `~/.config/agentbrew/metrics/latest.json` (`measuredAt` field) to see when metrics last refreshed.

## Tomorrow playbook (automated)

Run one command each morning — no manual math:

```bash
agentbrew measure context
```

Check `alerts` in `latest.json` (or the human summary). When `low-soft-headroom` fires:

1. **Do not** add always-on rules/skills until headroom is back above ~1,800 tokens.
2. Trim the largest `topSections` entry (today often **Git and delivery** or **Communication**).
3. Move long prose into skill `references/` — load on demand, not in shared-rules.
4. Re-run `agentbrew measure context` and confirm `softTokenHeadroom` recovered.
5. **Proactively tell the user to start a new chat** when headroom is low **and** the session is long or post-sync/ship-it — stale threads burn tokens re-loading bloated system prompt; pair with `cursor-token-playbook` § "When to tell the user".

SessionStart hook warns automatically when headroom is low (even if measurement was skipped as fresh). Post-sync re-checks `latest.json` daily. When the hook or alerts fire at session start on an already-long thread, nudge a new chat before the next deliverable.

## Constraints

- **GET, don't build** — use ccusage, openusage, tokscale, session-report, and Repomix; do not write custom JSONL parsers or dashboards.
- **Optional skill validation** — invoke the `skill-validator` skill before growing built-in skills; `agentbrew lint` remains the CI gate.
- **Do not guess token counts** — cite `latest.json` or fresh `agentbrew measure context` output.
- **Trim via TASKS.md** — large sections need explicit trim tasks (e.g. `trim-shared-rules-md-to-under-8k-tokens`), not drive-by deletes.

## Manual Cursor context ring baseline

1. When a session feels tight, note the IDE context ring percentage.
2. Append one line (timestamp, ring %, short note) — do not build custom parsers:

   ```bash
   mkdir -p ~/.config/agentbrew/metrics/manual-snapshots
   printf '%s ring=NN%% note=short reason\n' "$(date -Iseconds)" >> ~/.config/agentbrew/metrics/manual-snapshots/cursor-ring.log
   ```

3. Re-run `agentbrew measure context` — output references `metrics/manual-snapshots/`; optional JSON sidecars (`cursor-ring-YYYY-MM-DD.json`) are fine for structured diffs.

## Related

- **`cursor-token-playbook`** — model mix, chat lifecycle, @ scoping, MCP discipline, daily workflow
- `agentbrew-status` skill — drift and MCP health
- `load-project-context` — project docs (separate from global rules budget)
- `prefer-reuse-over-reinvent` — before adding new always-on rules/skills
