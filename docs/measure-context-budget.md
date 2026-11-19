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

## Troubleshooting: `claude -p` says the prompt is too long

A headless `claude -p` call can fail with "Prompt is too long" when `~/.claude`
is heavy. Every installed skill description, rule, command, and MCP server
instruction counts toward the first prompt, even for a one-line request.

1. Run `agentbrew measure context` and read `static.projectedDeployedTokens`.
2. Run `agentbrew lint` and trim the skills or rules it flags.
3. For one unattended call, use a scratch `HOME` or a minimal settings file so
   the call loads only what it needs.
