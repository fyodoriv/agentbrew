---
name: agentfile-init
description: >
  Create an Agentfile.yaml for any project — detects the tech stack, suggests MCP servers
  from the catalog, and writes a ready-to-sync config. Use when the user says "set up
  agentbrew", "create agentfile", "add agentbrew to this project", or starts working in
  a repo that has no Agentfile. Don't use for adding a single MCP server (use agentbrew-add-mcp).
---

## What You Do

Create an `Agentfile.yaml` at the project root that declares MCP servers, skills, and sources for the project. After creating it, run `agentbrew sync` to deploy to all agents.

## Process

### 1. Check if Agentfile already exists

```bash
ls Agentfile.yaml Agentfile.yml Agentfile 2>/dev/null
```

If one exists, read it and ask the user if they want to update it rather than overwrite.

### 2. Detect the project stack

Read the project root to identify the tech stack:

```bash
ls package.json Cargo.toml pyproject.toml go.mod requirements.txt Gemfile build.gradle pom.xml 2>/dev/null
cat package.json 2>/dev/null | head -30
ls -d .github/ .gitlab-ci.yml Jenkinsfile 2>/dev/null
ls TASKS.md 2>/dev/null
```

Identify:
- **Language/framework**: Node.js, Python, Rust, Go, Ruby, Java, etc.
- **CI system**: GitHub Actions, GitLab CI, Jenkins
- **Database**: Check for Postgres, MySQL, MongoDB references in config/env files
- **Error tracking**: Sentry, Datadog, Splunk references
- **Task management**: TASKS.md present?
- **Agent guide**: AGENTS.md present? If yes, read it before writing repo-local
  guidance; if no, note that the project needs one.

### 3. Select MCP servers from catalog

Map the detected stack to relevant MCP servers. Always include `context7` (live docs).

| Stack signal | MCP server | Why |
|---|---|---|
| Any project | `context7` | Live docs for any library |
| TASKS.md present | `tasks-mcp` | Programmatic task management |
| GitHub repo | `github` | PR/issue management |
| Postgres in deps/env | `postgres` | Database queries |
| Sentry in deps/env | `sentry` | Error tracking |
| Splunk references | `splunk` | Log queries |
| Jenkins CI | `jenkins` | Build management |
| Notion references | `notion` | Doc access |
| Need web search | `brave-search` | Research |
| Browser testing needed | `playwright` | UI automation |

### 4. Write the Agentfile

Create `Agentfile.yaml` with this structure:

```yaml
# Agentfile — project agent configuration
# Run `agentbrew sync` to deploy to all agents.

mcp:
  - context7
  - tasks-mcp       # only if TASKS.md exists
  - github           # only if GitHub repo
  # add others based on stack detection
```

**Rules:**
- Use catalog shorthand names (just the string) for catalog servers
- Only include servers the project actually needs — don't over-provision
- Add a comment explaining non-obvious choices
- Put `context7` first (every project benefits from live docs)

### 5. Sync and verify

```bash
agentbrew sync --dry-run
```

Review the dry-run output with the user. If it looks good:

```bash
agentbrew sync
```

### 6. Update the agent guide when needed

If the repo has an `AGENTS.md`, make sure it mentions the Agentfile lifecycle:
what the root Agentfile declares, when to run `agentbrew sync`, and how it
differs from generated per-agent config. If the repo lacks an agent guide and is
an agent-tool project, create one using the reusable checklist in the agentbrew
source repo: `docs/agent-guide-baseline.md`.

Do not copy the checklist verbatim into every repo. Link to the baseline for the
shape, then write repo-specific facts.

### 7. Commit

```bash
git add Agentfile.yaml
git commit -m "feat: add Agentfile for agentbrew project config"
```

## Agentfile Reference

The full Agentfile supports these fields:

```yaml
# Catalog shorthand — just the name, agentbrew resolves the command
mcp:
  - context7
  - github

# Full spec for custom/non-catalog servers
mcp:
  - name: my-internal-server
    command: node
    args: ["./server.js"]
    env:
      API_KEY: "${MY_API_KEY}"

# Skills to install from catalog
skills:
  - debug
  - plan

# Skill sources (GitHub repos or local paths)
sources:
  - obra/superpowers
  - user/custom-skills
  - ./skill-plugins/dev

# Shared rules (inline or file path)
rules: ./shared-rules.md

# Install all recommended items
recommended: true
```

## Common Patterns

**Minimal (any project):**
```yaml
mcp:
  - context7
```

**Node.js web app:**
```yaml
mcp:
  - context7
  - tasks-mcp
  - github
  - playwright
```

**Python data service with Postgres:**
```yaml
mcp:
  - context7
  - tasks-mcp
  - github
  - postgres
```

**Enterprise project with full tooling:**
```yaml
mcp:
  - context7
  - tasks-mcp
  - github
  - sentry
  - jenkins
  - splunk
  - playwright
```
