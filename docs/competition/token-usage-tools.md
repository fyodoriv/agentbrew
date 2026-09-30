# Token usage tools — build/wrap decision (2026-06)

Research for `agentbrew measure context` and the `context-budget` skill. Verdict per [VISION.md](../../VISION.md): **GET, don't IMPLEMENT** — wrap mature CLIs; keep static reduction in `agentbrew lint` / `agent-bloat-lint`.

## Evaluated tools (top 5)

| Tool | Repo | Stars / activity | Measures | Fit for agentbrew | Overlap with measure context / bloat-lint |
|------|------|------------------|----------|-------------------|-------------------------------------------|
| **ccusage** | [ryoppippi/ccusage](https://github.com/ryoppippi/ccusage) | ~15.3k★, active May 2026 | **Runtime** — local JSONL/session logs for 15+ coding CLIs | **CLI wrap** (shipped) | Runtime Claude/Codex/etc.; no static config |
| **tokscale** | [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale) | ~3.7k★, active Jun 2026 | **Runtime** — multi-agent token + cost; Cursor via API cache | **CLI wrap** (shipped) | Cursor IDE when `tokscale cursor login && sync`; complements ccusage |
| **OpenUsage.sh** | [janekbaraniewski/openusage](https://github.com/janekbaraniewski/openusage) | ~67★, active May 2026 | **Runtime + quota** — 34 providers; Cursor via local SQLite (no login) | **CLI wrap** (shipped Jun 2026) | Multi-provider `daily --json`; fills Cursor gap without Workos token |
| **LiteLLM proxy** | [BerriAI/litellm](https://github.com/BerriAI/litellm) | large, infra-focused | **Runtime** — proxy-side spend DB + Admin UI | **Document only** | Team routing layer; not a drop-in for local agent logs |
| **clawmeter** | [tnunamak/clawmeter](https://github.com/tnunamak/clawmeter) | ~3★, Mar 2026 | **Quota** — rate-limit windows (Claude 5h/7d, OR credits) | **Skill reference** | Complements runtime cost; no static bloat checks |

Also reviewed: OpenRouter one-off monitors (~150 LOC Python), Repomix (repo tree — already in `scripts/audit-context-tree.sh`), session-report skill (transcript deep-dive), Claude Code built-in `/usage` and `/context` (in-session only, not scriptable).

## Top 3 recommendations

1. **ccusage** — default runtime rollup for coding-agent JSONL (already integrated). Use `bunx ccusage claude daily --json` or all-sources `bunx ccusage daily`.
2. **OpenUsage.sh** — multi-provider daily rollup + quotas; **Cursor without browser session token**. Wrapped as `openusage daily --json --since <today>` in `measure context`.
3. **tokscale** — cross-tool history + Cursor API export when local DB is insufficient; requires `tokscale cursor login && tokscale cursor sync`.

**Static reduction** stays native: `agentbrew measure context` (projected rules), `agentbrew lint` / `agent-bloat-lint` (sections, skills, MCP, `.mdc`).

## Not absorbed

- **LiteLLM** — deploy when team routes all LLM traffic through a proxy; out of scope for personal laptop sync CLI.
- **OpenUsage.ai / dashboards** — separate products; point users at upstream.
- **Custom JSONL parsers** — constitutional violation per `context-budget` skill.

## Integration map

| Plane | Owner | Tool |
|-------|-------|------|
| Static deployed rules | agentbrew | `measure context`, `lint`, bloat-lint |
| Claude/Codex session logs | ccusage | subprocess in `measure context` |
| Multi-provider daily | OpenUsage.sh | subprocess in `measure context` |
| Cursor API history | tokscale | subprocess in `measure context` |
| Repo file tree | Repomix | `scripts/audit-context-tree.sh` |
| Transcripts | session-report skill | manual invoke |
| Cursor context ring | manual | `metrics/manual-snapshots/` |

## Revisit

Quarterly with `re-research-stale-competitors` — watch ccusage vs OpenUsage feature overlap; contribute upstream if both parse the same logs.
