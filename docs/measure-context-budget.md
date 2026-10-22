# Measuring context budget

Run:

```bash
agentbrew measure context
agentbrew lint
```

Artifacts:

- `~/.config/agentbrew/metrics/latest.json` — `static.projectedDeployedTokens`, `static.softTokenHeadroom`
- Dated snapshots under `~/.config/agentbrew/metrics/context-budget-*.json`

Shared-rules committed baseline for growth lint: `docs/shared-rules.md` in this repo.
Built-in skill baselines: `docs/skill-baselines.json`. Rule ids and thresholds: `docs/agent-bloat-lint.md`.

**Optional runtime tools** (graceful skip when not installed): `bunx ccusage claude daily --json`, `openusage daily --json --since $(date +%F)`. See [`docs/competition/token-usage-tools.md`](competition/token-usage-tools.md).
