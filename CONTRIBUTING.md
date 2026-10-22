# Contributing to AgentBrew

The catalog (`src/catalog.yaml`) is how AgentBrew discovers and installs skills, MCP servers, and rules. Contributions welcome — here's how to add yours.

## Report problems and ideas

**Fyodor, the author of agentbrew, is glad to get every report.** If something in
agentbrew did not work as expected, or could work better, please say so. A short
report from a real user is the most useful contribution there is, and it is
always welcome, even when you are not sure it is a bug.

### Your agent will offer to do it for you

If you use agentbrew with an AI coding agent (Claude Code, Codex, and others),
the agent is told to offer a report when agentbrew fails, surprises it, or could
clearly work better. This holds in every setup: a clone or a fork of this repo
(this repo's `AGENTS.md` says so), or agentbrew installed through agentbrew
(the always-loaded agent rules and the `report-upstream` skill say so).

The agent never posts anything on its own. It works in these steps:

1. It writes a short draft: what ran, what was expected, what happened, the
   version, and a suggested fix.
2. It runs `agentbrew report --title "<title>" --body-file <draft.md> --repo fyodoriv/agentbrew`.
   This posts nothing. It replaces private details with placeholders: your
   home folder path, your user name, email addresses, tokens and API keys,
   private keys, IP addresses, internal host names, and the private patterns
   of your local leak gate, if you have one. Then it re-scans the result and
   prints a checklist like this:

   ```
   Safety check (nothing has been posted):
     ✓ none found: tokens, API keys, and private keys
     ✓ 1 replaced with a placeholder: your home folder path
     ✓ none found: email addresses
     ✓ re-scan of the final text: nothing private left
   ```

3. It shows you the exact title and body, and any similar issue that already
   exists, and asks: "Post this issue to github.com/fyodoriv/agentbrew? It is public.
   (yes / edit / no)".
4. Only after your yes does it post (`agentbrew report ... --yes`). A refused
   or failed re-scan (`✗`) is never posted.
5. If the fix looks small, it asks a second question: "Want me to make a PR
   that fixes it?" Only after that second yes does it make the change, run
   the repo gate (`npm run verify`), and open the PR with `agentbrew contribute`
   (it forks the repo for you).

A run with nobody at the keyboard only saves the draft
(`~/.local/state/agentbrew/reports/`) and names it in the run report.

### Do it by hand

Open an issue at https://github.com/fyodoriv/agentbrew/issues/new with the same
content: what you ran, what you expected, what happened, and the version.
Please leave out secrets, tokens, and private paths.

### Turn the offers off

Run `agentbrew report --off`. Agents then stop offering reports on this
machine. `agentbrew report --on` turns them back on.
## Open a PR from your own machine

You do not need push access. From a clone of agentbrew (or any repo agentbrew helps you work on, such as dotfiles or a skill source):

```bash
git switch -c fix/short-name          # never work on main
# edit, then run the gate: npm run verify (agentbrew) or make check (dotfiles)
git commit -m "fix: what changed"
agentbrew contribute --dry-run        # shows each git and gh step
agentbrew contribute                  # forks, pushes to the fork, opens the PR
```

`agentbrew contribute` needs the GitHub CLI signed in (`gh auth login`). It forks the upstream repo to your account (once), adds the fork as a remote, pushes your branch there, and runs `gh pr create --repo <upstream> --head <you>:<branch>`. The PR title and body come from your commit message unless you pass `--title` and `--body-file`. If you want to show how agentbrew behaves on your machine, attach `agentbrew metrics --share metrics.md` to the PR.

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

**With a token** (add `headers` for a URL server or `env` for a command, plus `setup`):

```yaml
- name: github
  description: "Official GitHub MCP server (hosted by GitHub) — PRs, issues, repos, commits, branches."
  url: "https://api.githubcopilot.com/mcp/"
  headers:
    Authorization: "Bearer ${GITHUB_TOKEN}"
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
