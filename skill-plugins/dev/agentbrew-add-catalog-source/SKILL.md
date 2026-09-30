---
name: agentbrew-add-catalog-source
description: >
  Add a new skill, MCP server, or rule to agentbrew's shipped catalog so every
  agentbrew user sees it. Use when the user says "add to the catalog", "add an
  overlay entry", "ship this skill to every team-overlay user", or "PR a new source
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

  YES → the team overlay's catalog-overlay.yaml
        Owner MUST be an approved team namespace in that overlay.
        Visible only after `agentbrew team set <overlay-url>`.

  NO  → src/catalog.yaml
        Source is a public repo or truly generic built-in. Visible
        to every user regardless of state.team.
```

**Never mix.** An organization-specific entry in `src/catalog.yaml` violates AGENTS.md
rule #8 and breaks the reversal path. The team overlay owns its
`catalog-overlay.yaml` decision tree and maintenance procedure.

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
                                # OR github.example.com for overlay entries
     category: Development      # or Code Quality, Workflow, etc. — see existing
     recommended: false         # only set true if there's a user-visible rationale
     # rationale: required ONLY when recommended: true
   ```

4. Run the validator(s):

   ```bash
   # For overlay entries, run the overlay repo's catalog validator.
   yaml-lint catalog-overlay.yaml

   # For generic entries, the loadCatalog tests cover the schema:
   npx vitest run src/catalog/catalog.test.ts
   ```

5. Verify local:

   ```bash
   # Generic catalog — should now include your skill.
   agentbrew team unset && agentbrew catalog --json | jq '.skills | length'

   # Overlay — jq length increases for new catalog entries, stays the same
   # for same-name overrides.
   agentbrew team set <overlay-url>  && agentbrew catalog --json | jq '.skills | length'
   ```

   If either count surprises you, you've leaked organization behaviour into shared
   code. Stop and re-read the overlay repo's `catalog-overlay.yaml` header.

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

For overlay MCP servers add a `setup:` block with per-env-var instructions
— use the overlay repo's existing MCP entries as references.

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

## For a new whole-repo source (team overlay only)

Instead of listing every skill in a repo, point to the whole repo and let
agentbrew auto-register it:

```yaml
repo_sources:
  - source: team-namespace/new-skills-registry
    description: What lives in the repo.
    # auto_update defaults to true; opt out with auto_update: false
```

On `agentbrew team set <overlay-url>` the repo auto-registers with `origin: catalog` and
`agentbrew sync` soft-updates it on a 30-min TTL. On `agentbrew team unset` it's
removed symmetrically (user-added duplicates survive). This is the
canonical way to expand the overlay — see `docs/VISION.md` "Curator, not
host" for the strategic framing. Prefer this over per-skill entries
whenever a repo has more than ~2 skills.

## After the PR merges

1. Run `agentbrew sync --pull` locally — the new entry should appear in
   `agentbrew catalog`.
2. For overlay additions, confirm the skill actually deploys on an
   organization-signalled machine (e.g. `agentbrew team status` shows `enabled`
   and the source repo is listed by `agentbrew catalog --sources`).
3. If the skill is `recommended: true`, users on their next `agentbrew
   install --recommended` will pick it up automatically.

## Rules

- **Never vendor content into `skill-plugins/dev/`** unless it documents
  agentbrew itself (see `skill-plugins/dev/README.md` bucket 1 vs 2).
- Every entry must have a `description` that includes "Don't use for X".
  Skills with vague descriptions get invoked at the wrong time.
- `recommended: true` requires a `rationale` field explaining why this skill
  is worth the user-visible promotion.
- Check for duplicates by name before adding. Overlay entries can override
  generic ones (same name, overlay wins) — that's intentional — but two
  entries in the SAME file with the same name is a validator failure.
- Every PR needs a project ticket in the title. Format: `feat: catalog add
  <name> PROJ-XXX` or similar.

## Constraints (Do NOT)

- **Do NOT copy SKILL.md files into agentbrew** — the source repo owns the
  content. Agentbrew just references it.
- **Do NOT add an organization-specific entry to `src/catalog.yaml`** — it'll be
  visible to non-organization users and breaks the reversal path.
- **Do NOT skip the validator** — the overlay repo's validator enforces the
  approved-owner allowlist; bypassing it lands invalid data.
- **Do NOT set `recommended: true` without a `rationale`** — recommendations
  drive the `install --recommended` default, which affects every user.
