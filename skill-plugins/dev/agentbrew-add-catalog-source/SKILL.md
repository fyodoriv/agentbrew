---
name: agentbrew-add-catalog-source
description: >
  Add a new skill, MCP server, or rule to agentbrew's shipped catalog so every
  agentbrew user sees it. Use when the user says "add to the catalog", "add a
  company plugin entry", "ship this skill to every company-plugin user", or "PR a new source
  into agentbrew". Don't use for adding a skill to your own setup (use
  agentbrew-add-skill) or creating a skill from scratch (use Anthropic skill-creator or Superpowers writing-skills).
---

## What You Do

Land a curated entry in agentbrew's catalog so every user picks it up on the
next `agentbrew sync --pull` or `npm install -g agentbrew@latest`. Agentbrew
is a **curator, not a host** (see [docs/VISION.md](../../../docs/VISION.md))
— catalog entries are pointers to source repos; skill content never gets
copied into agentbrew.

## Decision tree — which catalog file?

```
Is the skill / MCP server / rule authored inside a specific organization and
referencing internal systems (github.example.com, internal observability,
internal portal)?

  YES → the company plugin repo (agentbrew-plugin.yaml)
        Owner MUST be the company's own plugin repo, released as a signed tag.
        Visible only after `agentbrew plugin add <url>@<tag>`.

  NO  → src/catalog.yaml
        Source is a public repo or truly generic built-in. Visible
        to every user, with or without plugins.
```

**Never mix.** An organization-specific entry in `src/catalog.yaml` violates AGENTS.md
rule #8 and breaks the reversal path. The company plugin owns its own
content, capabilities, and release process. (agentbrew 1.0 removed team
overlays and their `catalog-overlay.yaml` merge.)

## For a new skill

1. Confirm the `SKILL.md` lives in the source repo (not here). If it doesn't,
   commit it upstream first. **Never vendor content into
   `skill-plugins/dev/`** unless it documents agentbrew itself (see
   [skill-plugins/dev/README.md](../README.md)).
2. Pick the right catalog file using the decision tree above.
3. Add the entry:

   ```yaml
   - name: your-skill-name
     description: >
       One-line description. Start with an action verb. Include
       "Don't use for X" so the agent knows when NOT to invoke it.
     source: owner/repo         # GitHub shorthand, owner/repo on github.com
                                # company content goes in the plugin repo instead
     category: Development      # or Code Quality, Workflow, etc. — see existing
     recommended: false         # only set true if there's a user-visible rationale
     # rationale: required ONLY when recommended: true
   ```

4. Run the validator(s):

   ```bash
   # For company plugin content, run the core's plugin checks.
   agentbrew plugin test <plugin-checkout>

   # For generic entries, the loadCatalog tests cover the schema:
   npx vitest run src/catalog/catalog.test.ts
   ```

5. Verify local:

   ```bash
   # Generic catalog — should now include your skill.
   agentbrew catalog --json | jq '.skills | length'

   # Company plugin — the shared catalog count stays the same; the plugin
   # diff lists the new content.
   agentbrew plugin update <name> <new-signed-tag>
   ```

   If either count surprises you, you've leaked organization behaviour into shared
   code. Stop and re-read the decision tree above.

## For a new MCP server

Same as skills but under `mcp_servers:` in the catalog file:

```yaml
- name: my-server
  description: Short description.
  command: npx
  args: ["-y", "@my/mcp-server"]
  env:
    MY_TOKEN: "${MY_TOKEN}"
  setupLink: https://example.com/setup
```

For company MCP servers, use the plugin's `mcp/servers.yaml` instead: every
env value is a reference (`env:`, `keychain:`, `op://`), the runtime is pinned
to an exact version, and the server name is declared in `capabilities.mcp_servers`.

## For a new rule

Rules go under `rules:` with inline content (rules are the one exception
to "pointers only" because shared-rules.md is itself a single-file target):

```yaml
- name: my-rule
  description: One-line description.
  content: |
    The rule text. Keep it short and actionable.
  category: git              # or security, testing, etc.
  recommended: false
```

## For a new whole-repo source

For a public repo with many skills, point to the whole repo in
`src/catalog.yaml` and let agentbrew auto-register it:

```yaml
repo_sources:
  - source: owner/skills-registry
    description: What lives in the repo.
    # auto_update defaults to true; opt out with auto_update: false
```

`agentbrew sync` soft-updates it on a 30-min TTL. Prefer this over per-skill
entries whenever a repo has more than ~2 skills. For company skills, put the
skill folders in the company plugin's `skills/` dir instead; every skill in it
deploys from the locked, signed plugin checkout.

## After the PR merges

1. Run `agentbrew sync --pull` locally — the new entry should appear in
   `agentbrew catalog`.
2. For company plugin additions, confirm the skill actually deploys after
   `agentbrew plugin update` and `agentbrew sync` (`agentbrew plugin list`
   shows the new ref).
3. If the skill is `recommended: true`, users on their next `agentbrew
   install --recommended` will pick it up automatically.

## Rules

- **Never vendor content into `skill-plugins/dev/`** unless it documents
  agentbrew itself (see `skill-plugins/dev/README.md` bucket 1 vs 2).
- Every entry must have a `description` that includes "Don't use for X".
  Skills with vague descriptions get invoked at the wrong time.
- `recommended: true` requires a `rationale` field explaining why this skill
  is worth the user-visible promotion.
- Check for duplicates by name before adding: two
  entries in the SAME file with the same name is a validator failure.
- Every PR needs a project ticket in the title. Format: `feat: catalog add
  <name> PROJ-XXX` or similar.

## Constraints (Do NOT)

- **Do NOT copy SKILL.md files into agentbrew** — the source repo owns the
  content. Agentbrew just references it.
- **Do NOT add an organization-specific entry to `src/catalog.yaml`** — it'll be
  visible to non-organization users and breaks the reversal path.
- **Do NOT skip the validator** — `agentbrew plugin test` and the catalog tests
  catch what `plugin add` and `sync` would refuse; bypassing them lands invalid data.
- **Do NOT set `recommended: true` without a `rationale`** — recommendations
  drive the `install --recommended` default, which affects every user.
