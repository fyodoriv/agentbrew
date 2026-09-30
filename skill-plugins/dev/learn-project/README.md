# learn-project

**Teach me, then quiz me** — one orchestrator over `tutor-setup` + `tutor`.

## User documentation

**Start here:** [`docs/learn-project.md`](../../../docs/learn-project.md) — prerequisites, quick starts, pipeline, pedagogy, troubleshooting.

## Maintainer artifacts

| File | Role |
|------|------|
| `SKILL.md` | Agent orchestration spec (phases 0–6) |
| `evals/evals.json` | 20 eval scenarios |
| `../../../src/skills/learn-project-contract.test.ts` | Contract tests |

```bash
npm test src/skills/learn-project-contract.test.ts
```

## Invoke

```text
Tutor me on <topic/repo/initiative>
```

Default staging root: `./.learn-project/`
