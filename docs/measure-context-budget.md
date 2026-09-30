# Measuring context budget

Run:

```bash
agentbrew measure context
agentbrew lint
```

Artifacts:

- `~/.config/agentbrew/metrics/latest.json` — `static.projectedDeployedTokens`, `static.softTokenHeadroom`, `inventory.cursorMdc`
- Dated snapshots under `~/.config/agentbrew/metrics/context-budget-*.json`

**Cursor context ring:** manual only. Append lines to `~/.config/agentbrew/metrics/manual-snapshots/cursor-ring.log` (see `skill-plugins/dev/context-budget/SKILL.md`).

Shared-rules committed baseline for growth lint: `docs/shared-rules.md` in this repo.
Built-in skill baselines: `docs/skill-baselines.json`. Rule ids and thresholds: `docs/agent-bloat-lint.md`.

**Optional runtime tools** (graceful skip when not installed): `bunx ccusage claude daily --json`, `openusage daily --json --since $(date +%F)`, `bunx tokscale --today --client cursor --json`. See [`docs/competition/token-usage-tools.md`](competition/token-usage-tools.md).
