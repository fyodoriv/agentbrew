# Contributing to AgentBrew

The catalog (`src/catalog.yaml`) is how AgentBrew discovers and installs skills, MCP servers, and rules. Contributions welcome — here's how to add yours.

## Design philosophy

**Prefer CLI commands over MCP servers.** CLI commands (synced to `~/.config/agentbrew/commands/`) work with all configured agents via shell access. MCP servers only work with MCP-capable agents. Use MCP when it provides a meaningfully better experience (streaming, structured tool calls, persistent connections). Otherwise, CLI first.

## Adding a Skill

```yaml
- name: my-skill
  description: "One-line description of what this skill does."
  source: github-org/repo-name
  category: development
  recommended: false
```

| Field | Description |
|-------|-------------|
| `name` | Kebab-case skill name matching the directory name in the source repo |
| `description` | One-line description (max ~100 chars). Start with what it does, not "A skill that..." |
| `source` | `built-in` for skills in `skill-plugins/`, or `github-org/repo-name` for external |
| `category` | See [Categories](#categories) below |
| `recommended` | `true` = Tier 1 (every developer benefits), `false` = Tier 2 (strong or specialized) |
| `rationale` | (required if recommended) One sentence: why does every developer benefit from this? |

Quality bar: valid `SKILL.md` with YAML frontmatter, specific description, public GitHub source, tested on at least one agent.

## Adding an MCP Server

**Stdio server** (most common — launched as a subprocess):

```yaml
- name: my-server
  description: "What this server provides — key capabilities in one line."
  command: npx
  args: ["-y", "@scope/package@latest"]
  category: development
  recommended: false
```

**SSE/HTTP server** (remote, URL-based):

```yaml
- name: remote-api
  description: "Description of what the remote API provides."
  url: https://api.example.com/mcp
  category: development
  recommended: false
```

**With environment variables** (add `env` + `setup`):

```yaml
- name: github
  description: "GitHub API — PRs, issues, repos, commits, branches."
  command: npx
  args: ["-y", "@modelcontextprotocol/server-github"]
  env:
    GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
  category: development
  recommended: false
  setup:
    GITHUB_TOKEN:
      description: "Personal access token for GitHub API"
      link: "https://github.com/settings/tokens?type=beta"
      steps:
        - "Create a fine-grained personal access token"
        - "Grant 'Contents' and 'Pull requests' permissions"
        - "export GITHUB_TOKEN=ghp_..."
```

| Field | Description |
|-------|-------------|
| `name` | Short kebab-case name |
| `description` | One-line description (be specific — "GitHub API" not "a server for GitHub") |
| `command` | Server launch command (usually `npx` or `uvx`) |
| `args` | Array of command arguments |
| `url` | (alternative to command/args) SSE/HTTP server URL |
| `env` | Environment variables. Use `${VAR_NAME}` for user-provided values — these get substituted from the shell environment at sync time |
| `setup` | (required if `env` has `${VAR}` references) Per-variable setup instructions with description, link, and steps. Powers `agentbrew setup` interactive wizard |
| `category` | See [Categories](#categories) below |
| `recommended` | `true` only for universally useful servers — keep this list very small |
| `rationale` | (required if recommended) One sentence: why does every developer benefit from this? |

## Adding a Rule

```yaml
- name: my-rule
  description: Short description
  category: code-quality
  recommended: false
  content: |
    The rule text. Keep it concise — 3-5 lines.
    Rules are injected into every agent's rules file on sync.
```

## Categories

Skills: `browser`, `cicd`, `code-quality`, `creative`, `database`, `deployment`, `design`, `development`, `docs`, `git`, `memory`, `meta`, `ml`, `mobile`, `observability`, `orchestration`, `planning`, `productivity`, `quality`, `reasoning`, `search`, `security`, `setup`, `task-management`, `testing`, `utility`, `workflow`, `writing`

MCP servers: `browser`, `cicd`, `database`, `development`, `docs`, `memory`, `observability`, `productivity`, `reasoning`, `search`, `task-management`

## Submitting

1. Fork the repo and create a branch: `feat/catalog-add-<name>`
2. Add your entry to `src/catalog.yaml` in the appropriate section (recommended items first, then alphabetical by category)
3. Run `npm run verify` to check everything passes
4. Verify with `npm run dev -- catalog show <name>` that your entry displays correctly
5. Open a PR on [github.com/fyodoriv/agentbrew](https://github.com/fyodoriv/agentbrew) with a clear description of what the item does and why it's useful

## Conventions

- **Tier 1 (`recommended: true`)**: Benefits every developer regardless of stack. Keep this list small (~25 items).
- **Tier 2 (`recommended: false`)**: Strong or specialized items. Most contributions land here.
- **Ordering**: Recommended items first, then alphabetical by category within each section.
- **Descriptions**: Be specific. "React patterns" is too vague. "React and Next.js performance rules from Vercel Engineering" is good.
- **No company-internal URLs or dependencies** in the default catalog. Org-specific items are delivered via team config.
- **Test on at least one agent** before submitting. Run `agentbrew sync --dry-run` to verify your entry deploys correctly.
