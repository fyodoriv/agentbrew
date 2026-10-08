---
name: cli-design
description: Review CLI commands for npm/brew convention compliance and default-behavior opportunities
argument-hint: "[path-to-cli-entry]"
triggers:
  - user
  - model
---

Review the CLI defined in $1 (default: ./src/cli.ts) for design quality. Apply these principles:

## 1. Follow package-manager conventions

npm, yarn, brew, and uv established strong conventions. Audit for:

- **install/remove always update the manifest** (like `npm install` updates `package.json`). If there's a declarative config file, every mutation command should write to it by default — not require a flag.
- **No `--save` anti-pattern**: if most users want a behavior, make it the default. Add `--no-X` to opt out instead of `--X` to opt in.
- **File format uses standard extension**: manifest files should use `.yaml`, `.json`, or `.toml` — not extensionless names — so linters and IDE support work automatically.

## 2. Run more by default

For each flag that's opt-in, ask: "would most users want this?" If yes, flip it:

| Pattern | Before | After |
|---------|--------|-------|
| Parallel execution | `--parallel` to opt in | Default. `--sequential` to opt out |
| Auto-fix on dashboard | Report drift, suggest command | Fix automatically, report what was fixed |
| Manifest update | `--save` flag or separate write | Always write to manifest |
| Discovery/detection | `--discover` flag | Always show brief summary |

## 3. Combine redundant commands

Look for `--help` / `--help-all` splits, `doctor` / `status --fix` overlaps, `update` / `sync --pull` duplicates. If two commands do nearly the same thing, merge them — one visible command with a flag, the other hidden as an alias.

## 4. Declarative config as source of truth

If there's a declarative config file (Agentfile, package.json, Brewfile):
- `init --from-state` should capture the FULL current state into the file
- The file should support ALL features (not just a subset like "mcp + sources but not skills")
- Global config is authoritative (items removed from file are removed from state)
- Project config is additive (never removes global items)
- `--config <path>` flag for pointing at a config outside cwd

## 5. Output

Produce a list of concrete changes with rationale, ordered by impact.
