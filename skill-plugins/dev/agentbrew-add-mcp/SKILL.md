---
name: agentbrew-add-mcp
description: >
  Add an MCP server to agentbrew so all agents can use it. One command registers it —
  Claude, Codex, Kiro configs auto-generate on sync. Use when the user says "add MCP
  server", "connect to X", or "I want all agents to use Y tool".
---

## What You Do

Register one MCP server. Agentbrew syncs it to every agent's native config format.

## Step 0: Pick the right layer (OSS catalog vs. company plugin)

Before adding, decide where the entry lives. Wrong layer = future portability bug.

**Litmus test**: can a fresh contributor outside the org install + use the MCP with no
internal credentials, no VPN, no internal-registry mirror, no marketplace entitlement?

| Answer | Layer | Where it lives | Activation |
|---|---|---|---|
| **Yes** — works anywhere | OSS-portable | `agentbrew/src/catalog.yaml` (catalog) + `dotfiles/Agentfile.yaml` (activation) | `agentbrew install <name>` or list under `mcp:` |
| **No** — needs internal infra | Company plugin | `agentbrew-<org>/mcp/servers.yaml` (declared in `agentbrew-plugin.yaml`) | `agentbrew plugin add <url>@<signed-tag>` |

Examples:
- `context7`, `playwright`, `tasks-mcp`, `mcp-atlassian` (public) → OSS catalog
- `acme-jira-mcp` (`@acme/jira-mcp` from `registry.npmjs.example.com`) → company plugin
- `acme-search-mcp`, `acme-platform-mcp`, `Acme Portal MCP Remote`, `slack-acme`,
  `acme-google-drive-mcp` → company plugin
- Any MCP whose `url:` is `*.api.example.com` or whose package is on
  `registry.npmjs.example.com` → company plugin

**Never** put an organization-specific entry in `agentbrew/src/catalog.yaml` or
`dotfiles/Agentfile.yaml`. The agentbrew rule #8 ("company content lives in the company plugin
repo") and dotfiles rule #2 ("Keep contents OSS-portable") guard the OSS side; they catch
some leaks via lint but the boundary is a contributor responsibility.

Reference: `agentbrew-<org>/AGENTS.md` §2 and `dotfiles-<org>/AGENTS.md` §2 codify the
boundary with a sample table per repo.

## Step 1: Wire it up

### From the catalog (recommended)

Once the entry exists in the OSS catalog (Step 0), one command installs:

```bash
agentbrew install jira-mcp          # resolves through the OSS catalog
agentbrew install --recommended     # install everything flagged recommended:true
```

Browse what's available with `agentbrew catalog --mcp`. Company MCP servers
come from a signed plugin instead: `agentbrew plugin add <url>@<signed-tag>`
installs them, and sync renders a launcher that resolves their secrets at
start. (agentbrew 1.0 removed `agentbrew team set` and the overlay catalog.)

### Adding a new catalog entry

If the MCP isn't in any catalog yet, decide which layer per Step 0, then:

1. OSS: edit `agentbrew/src/catalog.yaml`. Schema: see existing entries
   (`playwright`, `context7`). Required fields: `name`, `description`,
   `command` + `args` OR `url`, `category`, `recommended`, `rationale`, `note`.
   Optional `setup:` block walks users through env-var creation.
   Company: add the server to the plugin's `mcp/servers.yaml` with every env
   value as a reference (`env:`, `keychain:`, `op://`) and an exact runtime
   version, declare its name in `capabilities.mcp_servers`, and run
   `agentbrew plugin test`.
2. Open a PR.
3. After merge: OSS entries resolve on the next `agentbrew sync --pull`; a company
   plugin release reaches users through `agentbrew plugin update <name> <signed-tag>`.
4. The shorthand in any Agentfile (`- jira-mcp`) now resolves through the new OSS entry.

### Inline `agentbrew install --command ... --args ... --env ...` is a footgun

The flag form (`agentbrew install <name> --command npx --args ... --env KEY=VAL`) adds
the server to `~/.config/agentbrew/state.yaml` directly, bypassing both catalogs. This is
fine for **throwaway local exploration** of a new MCP, but never the right way to ship
a tool the team should know about — there's no catalog entry, no per-user setup
prompts, no `agentbrew install <name>` discovery flow, no migration path when the
package or auth model changes. Always promote a local install to a catalog entry
within the same session.

## Add Manually

You need: **name**, **command**, and optionally **args** and **env vars**.

```bash
agentbrew mcp add filesystem -c npx -a "-y" "@modelcontextprotocol/server-filesystem" ~/projects
agentbrew mcp add github -u https://api.githubcopilot.com/mcp/ -H 'Authorization=Bearer ${GITHUB_TOKEN}'
```

For GitHub, prefer `agentbrew install github`: the catalog entry points at
GitHub's hosted server. The old `@modelcontextprotocol/server-*` packages for
GitHub and Postgres are archived; do not add them.

## Add from a Git Repo

Clones the repo, builds if needed, auto-detects the entrypoint, and syncs. Pass `--env KEY` for each env var
the server needs; agents read its value from their environment. With `--yes` or no terminal, a missing value
fails with the key's name instead of a prompt, so an agent can run the command itself.

```bash
agentbrew mcp add my-server --git https://github.com/org/my-mcp-server
agentbrew mcp add my-server --git https://github.com/org/my-mcp-server --ref v1.2.0

# Pull latest changes and re-sync (a branch install only)
agentbrew mcp update my-server
```

`mcp update` follows only a branch pin. On a tag or commit pin, such as `--ref v1.2.0`,
it exits 1. To move a tag or commit pin, run `mcp add` again with a new `--ref`:
`agentbrew mcp add my-server --git https://github.com/org/my-mcp-server --ref v1.3.0`.

Repos are cached at `~/.config/agentbrew/mcp-repos/<name>`. Entrypoint detection checks
`dist/index.js`, `build/index.js`, `index.js`, `run_server.py`, `server.py`, and
`package.json` `bin`/`main` in that order.

## Add from Catalog

```bash
agentbrew catalog --mcp
agentbrew install playwright
```

## Sync & Verify

```bash
agentbrew sync         # deploys to all detected agents
                       #   - native carve-outs: AGENTBREW_ONLY_MCP_AGENTS (see
                       #     src/sync/mcp-sync-carveout-matrix.test.ts)
                       #   - mcpm intersection clients delegate via mcpm install +
                       #     mcpm client edit (matrix in the same test file; PR #857
                       #     catalog/install bridge)
mcpm ls                # show what mcpm has wired into each intersection client
                       #   (the `agentbrew mcp list` wrapper was deleted in slice 5c — cli-removed-commands-allowlist: historical deletion note
                       #    of `delegate-mcp-to-mcpm`, PR #852)
```

Targets:
- **Native carve-outs** — agentbrew writes the config file directly:
  Kiro (`~/.kiro/settings/mcp.json`),
  Copilot (`~/Library/.../Code/User/settings.json`), OpenCode, Amp, Overlay Desktop.
- **mcpm-managed (`MCP_INTERSECTION_AGENTS`)** — agentbrew bridges to `mcpm`:
  Claude Code (`~/.claude.json`), Codex,
  Claude Desktop, Cline, Gemini CLI, Goose, Roo Code.

## Remove

```bash
agentbrew remove <name>          # top-level — auto-detects type, removes everywhere
                                 #   (the `agentbrew mcp remove` wrapper was deleted — cli-removed-commands-allowlist: historical deletion note
                                 #    in slice 5c of `delegate-mcp-to-mcpm`, PR #852)
                                 # PR #858 wired `mcpm uninstall` + `mcpm client edit
                                 # --remove-server` per intersection client
```

## Rules

- One registration = all agents. Never edit individual agent configs directly.
- Use environment variables for API keys — never hardcode secrets.
- Test the server works before adding: `npx @scope/mcp-server --help`
- For git-installed servers, pin a `--ref` for reproducibility in team setups.

## Constraints (Do NOT)

- **Do NOT edit agent MCP configs directly** (`~/.claude.json`, `~/.kiro/settings/mcp.json`, etc.) — agentbrew overwrites them on sync
- **Do NOT hardcode API keys or secrets** in the `agentbrew mcp add` command — use `-e KEY` and set the value in your environment
- **Do NOT add a server without testing it first** — a broken MCP server silently breaks tool availability in all agents
- **Do NOT skip `--ref`** for git-installed servers in team setups — unpinned sources break reproducibility when the repo updates
