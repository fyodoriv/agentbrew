# Agentfile & Project Config

> I commit an Agentfile to my repo. My teammates clone it, run `agentbrew sync`, and get the same agent setup.

**Metric**: `story_fail_rate` for US16 in [`metrics.md`](../metrics.md): failed `agentfile` runs and `models` sync errors.

**E2E**: [`us16-agentfile-project-config.test.ts`](../../real-e2e/scenarios/us16-agentfile-project-config.test.ts)

## The Agentfile

An `Agentfile` is a declarative manifest — like `Brewfile` for Homebrew or `package.json` for npm. It lives at the repo root and describes what your project needs:

```yaml
# Agentfile
mcp:
  - context7                          # catalog shorthand
  - playwright
  - name: my-server                   # full spec for custom servers
    command: npx
    args: [tsx, ./mcp-server.ts]
    env:
      API_KEY: ${API_KEY}

sources:
  - vercel-labs/skills
  - ~/my-company/skills

rules: |
  Use conventional commits.
  Run tests before committing.
```

Catalog items use shorthand names (`- context7`). Custom servers use full specs. Secrets use `${VAR}` substitution — values come from the environment, not the committed file.

## Generate from your current setup

```bash
agentbrew init --from-state     # creates Agentfile from current state
```

This dumps your registered MCP servers, sources, and rules into a clean Agentfile. Catalog items are written as shorthands; custom servers get the full spec.

## Project detection

When you run `agentbrew` in a directory with agent assets, it detects them automatically:

```
$ cd my-project && agentbrew

  agentbrew status
    Agents: 3 detected ...

  Project agent assets:
    Agentfile — declarative manifest
    <count> skill(s) in .claude/skills/
    AGENTS.md — project instructions
```

**What it scans for** (fast — only `existsSync` checks):

- `Agentfile`, `Agentfile.yaml`, `Agentfile.yml`
- `.claude/skills/`
- `.claude/commands/`
- `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md`

## Per-project MCP overrides

Add a `mcp:` block to your project's `Agentfile.yaml` to register MCP servers that only apply when working in this repo:

```yaml
# Agentfile.yaml at the repo root
mcp:
  - context7
  - name: project-docs
    command: npx
    args: ["-y", "@acme/docs-mcp"]
```

Run `agentbrew sync` from the repo root to apply. Project servers merge into your global config — project overrides personal. See [US 23: Cross-repo discovery](23-cross-repo-discovery.md) for the global-Agentfile pattern teammates use to share config.

## Per-file rules

Place rule files in `~/.config/agentbrew/rules/` to deploy them as per-file rules to agents that declare a `rulesDir` (none in the core list today):

```markdown
---
description: "TypeScript conventions"
globs: ["**/*.ts"]
---
Use strict TypeScript. No `any`.
```

These complement the global shared rules (injected via markers) — per-file rules support activation triggers and glob patterns.
