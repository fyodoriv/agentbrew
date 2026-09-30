# Agent bloat lint

`agentbrew lint` runs static bloat checks via `src/agent-bloat-lint.ts` (integrated with existing `rules-hygiene.ts` shared-rules checks).

## Prior art

| Source | What we adopted |
|--------|-----------------|
| [agentskills.io/specification](https://agentskills.io/specification) | `description` ≤ 1024 chars |
| audit-skill SK-020..SK-025 (enterprise plugin; progressive-disclosure budgets) | 3500/5000 token soft/hard targets, 500 line warning, progressive disclosure |
| [skill-tools](https://github.com/skill-tools/skill-tools) | ESLint-style spec + quality lint for SKILL.md |
| [sklint](https://github.com/sven1103-agent/sklint) | CI-ready agentskills.io validator |
| [rulix](https://github.com/danielcinome/rulix) | Per-artifact token budgets in `validate` |
| PR #1297 / `rules-hygiene.ts` | Shared-rules section budgets, baseline growth vs `docs/shared-rules.md` |

## Rule table

| Rule id | Surface | Threshold | Severity |
|---------|---------|-----------|----------|
| `skill-description-max` | SKILL.md | description > 1024 chars | error |
| `skill-body-soft` | SKILL.md | body > 3500 tokens | warning |
| `skill-body-hard` | SKILL.md | body > 5000 tokens | warning |
| `skill-lines` | SKILL.md | > 500 lines | warning |
| `skill-no-progressive-disclosure` | SKILL.md | > 5000 tokens, no `references/` | warning |
| `skill-baseline-growth` | built-in skills | > ~200 tokens vs `docs/skill-baselines.json` | error (warn if trim task open) |
| `command-soft` | commands | > 4000 chars | warning |
| `command-hard` | commands | > 8000 chars | error |
| `mdc-file-soft` | `.mdc` | > 8000 bytes | warning |
| `mdc-file-hard` | `.mdc` (always-applied) | > 12000 bytes | error |
| `mdc-broad-glob` | `.mdc` | `**/*`, `**`, `**/*.md`, `**/**` | warning |
| `mdc-always-apply-broad` | `.mdc` | alwaysApply + broad glob | error |

Shared-rules duplicate headings, section token budgets, and **core** growth vs `docs/shared-rules.md` remain in `rules-hygiene.ts` (same `agentbrew lint` run). Baseline growth ignores sync-managed `<!-- rule: -->` and `<!-- agentfile-rules: -->` blocks so recommended catalog installs do not false-positive against the committed core backup.

## CI

GitHub Actions job **node** in `.github/workflows/ci.yml` runs `node dist/cli.js lint` after `npm run build`. The step fails the build on any lint **error** (warnings alone do not fail). In CI, repo-owned artifacts are checked (`skill-plugins/dev/*`, `templates/rules/*.mdc`); deployed paths under `~/.config/agentbrew/` and `~/.cursor/rules/` are skipped when absent.

## Baselines

- **Shared rules:** `docs/shared-rules.md`
- **Built-in skills:** `docs/skill-baselines.json` (token + line counts for `skill-plugins/dev/*`)

Update `docs/skill-baselines.json` in the same PR when intentionally growing a built-in skill, or link an open trim/context-budget task in `TASKS.md`.

**Optional delegated validators (not CI gates):** `skill-validator` skill or upstream CLI for frontmatter/spec checks before publishing skills; `agentbrew lint` remains authoritative in CI.

**Optional audit tools:** `scripts/audit-context-tree.sh` wraps Repomix `--token-count-tree`; runtime usage via `bunx ccusage`, `openusage daily --json`, or `bunx tokscale` (see `context-budget` skill and [`competition/token-usage-tools.md`](competition/token-usage-tools.md)).
