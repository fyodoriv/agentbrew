# Install a Skill

> I find a skill and install it — every agent gets it immediately.

```bash
agentbrew catalog                              # browse what's available
agentbrew catalog --search "review"            # search by keyword
agentbrew install commit                       # install from catalog
agentbrew install --recommended                # install all recommended items
agentbrew install vercel-labs/agent-skills      # add a GitHub repo as source
agentbrew install react-best-practices         # install from that source
```

## Global vs local install

Skills can be installed at two scopes:

```bash
agentbrew install debug                        # global (default) — all agents get it
agentbrew install debug --global               # explicit global (same as default)
agentbrew install debug --local                # project-local — only this repo
```

**Global** (default): Copies the skill to `~/.config/agentbrew/installed-skills/<name>/` and syncs it to every agent via symlinks on `agentbrew sync`. This is the existing behavior and remains the default.

**Local** (`--local`): Copies the skill files into `.agentbrew/skills/<name>/` in the current project directory and adds the skill as a source in the project's `Agentfile.yaml`. The skill is only active when agents work in this repo — it doesn't pollute the global config.

Local installs are ideal for:
- Project-specific skills that shouldn't leak to other repos
- Skills you want to check into version control alongside the project
- Team conventions — teammates get the skill automatically via the Agentfile

`agentbrew status` shows both scopes: global installed skills and project-local skills detected in `.agentbrew/skills/`.

## How it works

`install` clones the source repo, copies the skill to `~/.config/agentbrew/installed-skills/<name>/`, locks the source SHA, then auto-syncs to all agents via symlinks. State is only written after the copy succeeds — a failed fetch never leaves a partial entry.

Skills you created manually (as directories or symlinks) in any agent's skills folder are preserved — agentbrew only manages its own symlinks.

## Catalog

| Type | Count | Examples |
|------|-------|---------|
| **Skills** | 130+ (27 recommended) | debug, plan, commit, review, pr, refactor, iterate, semgrep, codeql, taste |
| **MCP servers** | 18 (3 recommended) | context7, playwright, tasks-mcp, github, postgres, brave-search |
| **Rules** | 7 (all recommended) | conventional-commits, test-before-commit, verify-before-completion |

Sources: [Vercel](https://github.com/vercel-labs/skills), [Anthropic](https://github.com/anthropics/skills), [obra/superpowers](https://github.com/obra/superpowers), [Supabase](https://github.com/supabase/agent-skills), [Trail of Bits](https://github.com/trailofbits/skills), and more.
