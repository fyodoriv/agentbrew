# Cross-Repo Discovery

> I commit an Agentfile to my project repo. My teammates clone it, run `agentbrew sync`, and get the same MCP servers, skills, rules, commands, hooks, and agent personas — zero manual config.

## The problem

MCP servers, skills, and rules are configured globally per-machine. When a team works on a project that needs specific tools (a database MCP server, project-specific coding rules, custom commands), each developer must set them up manually. There's no way to say "this project needs these agent resources" and have it flow to the whole team.

## The Agentfile

An `Agentfile.yaml` at the repo root declares everything the project needs:

```yaml
# Agentfile.yaml
mcp:
  - context7                          # catalog shorthand
  - playwright
  - name: project-db                  # custom MCP server
    command: npx
    args: [tsx, ./tools/db-server.ts]
    env:
      DATABASE_URL: ${DATABASE_URL}

sources:
  - ./skills                          # local skill directory
  - our-org/shared-skills             # GitHub repo

commands:
  - ./.claude/commands                # project-specific slash commands

agents:
  - ./.claude/agents                  # project-specific agent personas

hooks:
  - event: PreToolUse
    matcher: Bash
    command: bash ./hooks/check-bash.sh

rules: |
  Use our internal auth library for all API calls.
  Never import from legacy/ modules — use modern/ equivalents.
```

## How it works

### 1. Developer sets up the project

```bash
cd my-app/
# Create an Agentfile (or use agentbrew init --from-state)
vim Agentfile.yaml

# Sync deploys everything to all agents
agentbrew sync
```

`agentbrew sync` reads the Agentfile from the current directory and:
- Registers MCP servers → deployed to Claude, Cursor, Codex, etc.
- Adds skill sources → skills symlinked to all agents
- Merges rules → injected into every agent's instruction file
- Adds command sources → commands deployed to all agents
- Adds lifecycle hooks → hooks deployed to supported agents
- Adds agent sources → personas deployed to all agents

### 2. Teammate clones and syncs

```bash
git clone git@github.com:our-org/my-app.git
cd my-app/
agentbrew sync
```

The teammate gets the exact same agent setup. No manual configuration, no "did you add the context7 MCP server?" Slack messages.

### 3. Verify with status

```bash
agentbrew status
```

Shows all resources with their source:

```
  MCP servers: 5 registered
    context7        catalog
    playwright      catalog
    project-db      agentfile (my-app/Agentfile.yaml)

  Skills: 12 installed
    api-patterns    source: my-app/skills
    shared-lint     source: our-org/shared-skills

  Rules: global + project (my-app/Agentfile.yaml)
```

## Resource types

### MCP servers (`mcp:`)

Catalog shorthands or full specs. Merged into global state — available in all agents regardless of which directory you're in. Env vars use `${VAR}` substitution so secrets stay out of the committed file.

**Already works today** via `sync-runner.ts` → `applyAgentfile(cwd)`.

### Skill sources (`sources:`)

Local directories or GitHub repo URLs containing SKILL.md files. Added to `state.sources` and symlinked to all agents on sync.

**Already works today** — Agentfile `sources` field merges into state.

### Rules (`rules:`)

Inline rules or a path to a rules file. Merged with global rules — project rules augment, never replace. Injected into every agent's instruction file (CLAUDE.md, Augment guidelines, etc.).

**Already works today** — Agentfile `rules` field flows through rules-sync.

### Commands (`commands:`)

List of directories containing Markdown command files. Deployed to all agents, auto-transformed per agent format.

### Agent personas (`agents:`)

List of directories containing agent persona definitions (`.md` files). Deployed to all agents that support personas (Claude Code, Cursor, Codex, etc.).

### Lifecycle hooks (`hooks:`)

List of hook entries with event, matcher, and command/prompt. Deployed to native hook surfaces for agents that support them, including Claude Code settings, Cursor hooks.json.

## Merge priority

When multiple sources provide the same resource, the priority is:

1. **Project Agentfile** (highest — committed to repo, team-agreed)
2. **User state** (personal overrides in `~/.config/agentbrew/state.yaml`)
3. **Global Agentfile** (`~/.config/agentbrew/Agentfile.yaml`, typically a symlink into a team dotfiles repo)
4. **Built-in defaults** (agentbrew package defaults)

The older `agentbrew team set <repo>` merge layer was removed in 2026-04-24 (see [CHANGELOG](../../CHANGELOG.md)). The global-Agentfile-symlinked-from-a-git-repo workflow described above replaces it one-for-one.

## Best practices

- **Commit the Agentfile** to your repo. It's the declarative source of truth.
- **Use catalog shorthands** for well-known MCP servers (`context7`, `playwright`).
- **Use `${VAR}` for secrets** — never commit API keys or tokens.
- **Keep rules concise** — project rules should be project-specific, not duplicating global rules.
- **One Agentfile per repo** — place it at the repo root next to `package.json` or `Cargo.toml`.
