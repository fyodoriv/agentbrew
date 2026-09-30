# Team Overlays

> I work somewhere with internal skills, MCP servers, or auth-bound tools that don't belong in a public catalog. I want one command to layer my team's curated set on top of agentbrew, and one command to remove it cleanly.

```bash
agentbrew team set <overlay-repo-url>    # install + activate one team overlay
agentbrew team unset                      # remove (symmetric)
agentbrew team status                     # show current team
```

## When to use this

When your team or company has:

- Internal skills repos (not on public GitHub)
- MCP servers that need org-specific env vars (auth tokens, internal hostnames)
- Curated lists of recommended tools beyond the generic catalog
- Special MCP-format adapters (e.g. for desktop apps with custom config files)

You don't need this if you're using agentbrew standalone — the base tool stays fully functional with no team set. Generic users see no company-specific content anywhere in output, catalog, or state.

## Worked example

An overlay repo named `agentbrew-<org>` is the recommended shape. It registers your org's skill repos as sources, ships an MCP-format adapter for any custom desktop app, and can run a detect script that fires when your GitHub Enterprise host is configured. The `Agentfile.yaml` below shows the full schema.

## What an overlay repo looks like

An overlay is just a git repo with an `Agentfile.yaml` at root. agentbrew clones it on `team set`, reads the Agentfile, and merges its contents into local state with `origin: "team:<label>"`.

```yaml
# Agentfile.yaml at the root of your overlay repo
name: Acme Engineering            # label for this team
mcp:                              # MCP servers added by this overlay
  - acme-internal-mcp
sources:                          # skill source repos to register
  - git@github.acme.com:platform/acme-skills.git
rules: |                          # team-wide rules appended to shared-rules.md
  ## Team Rules
  - Use conventional commits
  - Run tests before push

# Optional overlay fields:
catalogOverlay: ./catalog-overlay.yaml   # extra catalog entries merged when this team is active
detect: ./bin/detect.js                  # auto-detect signals; runs on `team set`, prints what fired
adapters:                                # MCP-format plugins shipped with the overlay
  - ./adapters/acme-desktop
```

agentbrew core knows nothing about the Acme-specific URLs above. It loads this same schema for any overlay.

## What `team set` does

```
$ agentbrew team set git@github.acme.com:platform/agentbrew-acme.git
✓ Cloning overlay to ~/.cache/agentbrew/teams/acme/
✓ Reading Agentfile.yaml
✓ Registering sources (1): acme/acme-skills
✓ Adding MCP servers (1): acme-internal-mcp
✓ Loading catalog overlay (<count> additional entries from overlay catalog)
✓ Running detect script: 2 signals matched (github.acme.com, ACME_SSO env var)
✓ Team "acme" active

  Run `agentbrew sync` to deploy overlay skills to your agents.
```

Each step is idempotent. Re-running `team set` with the same URL is a no-op. Re-running with a **different** URL cleanly replaces the previous team — see "One team at a time" below.

## What `team unset` does

```
$ agentbrew team unset
✓ Removing entries with origin "team:acme"
✓ Sources: 1 removed, 0 retained (you had no user-added overlap)
✓ MCP servers: 1 removed
✓ Catalog overlay: unloaded
✓ Team unset
```

Symmetric reversal. Every entry tagged `origin: "team:<label>"` goes away. User-added entries (`origin: "user"`) survive untouched. Already-installed overlay skills stay deployed in your agent config directories — `team unset` controls what the catalog *shows*, not what's *installed*. Run `agentbrew remove <name>` per item if you also want to delete deployed content.

## What `team status` shows

```
$ agentbrew team status
Team: acme
URL:  git@github.acme.com:platform/agentbrew-acme.git
Last sync: 2026-05-13 07:42 (12 min ago)
Sources:    1 active
MCP:        1 active
Catalog overlay: <count> entries (from team overlay catalog)
```

Or, when no team is set:

```
$ agentbrew team status
No team overlay set.
Run `agentbrew team set <url>` to install one.
```

## Generic-mode users (no team overlay)

If you don't use an overlay, you never run `team set`. `agentbrew catalog`, `browse`, `install --recommended`, and `sync` all work standalone on just the generic catalog. State never references any company. Output never mentions any company.

If you want to use agentbrew's curation pattern for your own org, the path is:

1. Create a git repo with an `Agentfile.yaml` at root (see "What an overlay repo looks like")
2. Add `bin/quickstart` and `bin/uninstall` scripts for one-line setup (see [US 28](28-quickstart-uninstall.md))
3. Share the repo URL with teammates
4. Teammates run `agentbrew team set <your-url>`

Any organization can replicate this.

## One team at a time

By design, only **one** team overlay can be active per machine. `team set <new-url>` cleanly replaces any existing team in a single operation:

```
$ agentbrew team set git@github.globex.com:platform/agentbrew-globex.git
✓ Existing team "acme" detected — replacing
✓ Removing entries with origin "team:acme"
✓ Cloning new overlay to ~/.cache/agentbrew/teams/globex/
[…]
✓ Team "globex" active
```

This avoids merge conflicts between competing team policies and matches dotfiles' single `EXTRA_OVERLAY_ROOT` design .

## 3-tier Agentfile merge

When a team is active, agentbrew composes three Agentfile scopes:

| Scope | Path | Tagged with |
|-------|------|-------------|
| **Global** | `~/.config/agentbrew/Agentfile.yaml` | `origin: "global"` |
| **Team** | `~/.cache/agentbrew/teams/<label>/Agentfile.yaml` | `origin: "team:<label>"` |
| **Project** | `<repo>/Agentfile.yaml` | `origin: "project"` |
| **User adds** (via `agentbrew install`) | n/a | `origin: "user"` |

Merge order: **lists union in scope order** (global → team → project); **scalars use most-specific-wins** (project beats team, team beats global). Removal is symmetric per scope — `team unset` removes only `origin: "team:..."` entries; project deactivation removes only `origin: "project"`.

## Reversal property (for contributors)

agentbrew core has zero knowledge of any specific company. All company-specific content lives in overlay repos outside agentbrew. Adding support for a new company is a new overlay repo — no agentbrew PR required.

Contributors editing agentbrew core should never introduce hardcoded references to any specific company — every overlay capability must be parameterized through the `team` command and the `Agentfile.yaml` schema above. The `tests/oss/no-internal-refs.test.ts` lint test enforces this with a ratcheting allowlist that's empty for `src/` post-split.
