---
name: agentbrew-add-skill
description: >
  Add a skill source to agentbrew so it deploys to all agents. Handles GitHub
  repos, local folders, and catalog installs. Use when the user says "add a
  skill", "install skill", or "I want all agents to have X". Don't use for
  creating skills from scratch (use Anthropic skill-creator or Superpowers writing-skills).
---

## What You Do

Add a skill source so agentbrew tracks and syncs it to every agent. One
registration = all agents get the skill on next sync.

## From Catalog (preferred — curated, security-screened)

```bash
agentbrew catalog --skills          # browse available skills
agentbrew install <skill-name>      # install one skill
agentbrew install --recommended     # install all recommended at once
```

After install, agentbrew automatically syncs to all agents.

## From GitHub Source

```bash
agentbrew install user/repo             # add all skills in the repo
agentbrew install user/repo --list      # preview available skills first
agentbrew install user/repo --skill <name>   # install one specific skill
```

The repo must contain directories with `SKILL.md` files. The source is tracked
in `~/.config/agentbrew/state.yaml` and refreshed on `agentbrew sync --pull`.

## From Local Folder

```bash
agentbrew install /path/to/skills-folder    # folder containing skill dirs
```

Use this for skills you're developing locally or from a dotfiles repo.
Agentbrew symlinks from the source — edits to the source are live immediately.

## Verify & Sync

```bash
agentbrew catalog --sources    # list all tracked sources with skill counts
agentbrew status --verbose     # confirm skills deployed per agent (was `skills status`)
agentbrew sync                 # re-deploy if something looks off
agentbrew sync --pull          # fetch latest from remote sources then deploy
```

## After Adding a Skill

1. Run `agentbrew status --verbose` to confirm the skill appears under each agent
2. Check the skill is invokable: look for it in `~/.claude/skills/` (or equivalent)
3. If it's not appearing, run `agentbrew sync` to force a re-deploy

## Rules

- Every skill directory must contain a `SKILL.md` with valid frontmatter
- Skill names must be kebab-case matching the directory name
- Check `agentbrew catalog --sources` before adding — avoid duplicate sources
- Never add a source you haven't reviewed — skills run with full agent permissions
- For team setups, prefer catalog or GitHub sources over local paths (portability)

## Constraints (Do NOT)

- **Do NOT add unreviewed GitHub sources** — skills execute with full agent permissions and can instruct the agent to run arbitrary commands
- **Do NOT add duplicate sources** — check `agentbrew catalog --sources` first; duplicate sources cause skill conflicts and confuse agents
- **Do NOT use local paths in team/shared configs** — local paths don't resolve on other machines; use GitHub sources or catalog installs instead
- **Do NOT skip `agentbrew status --verbose`** after adding — a skill that failed validation won't appear in agents and will silently not work
