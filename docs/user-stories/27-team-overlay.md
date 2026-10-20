# Company Plugins

> I work somewhere with internal skills, rules, MCP servers, or hooks that don't belong in a public catalog. I want one command to install my company's set from a signed release, see what it may do before I accept it, and one command to remove it cleanly.

**Metric**: `story_fail_rate` for US27 in [`metrics.md`](../metrics.md): failed `plugin` runs.

**E2E**: [`us27-us28-us29-team-overlay-and-packs.test.ts`](../../real-e2e/scenarios/us27-us28-us29-team-overlay-and-packs.test.ts)

<!-- runnable: false reason="needs a reachable, signed plugin repo" -->
```bash
agentbrew plugin add <url>@<signed-tag> --signer "<ssh-public-key>"   # verify, show capabilities, ask once
agentbrew plugin list                                                # ref, commit, tree per plugin
agentbrew plugin update <name> <signed-tag>                          # diff, then apply on confirm
agentbrew plugin rollback <name>                                     # back to the previous version
agentbrew plugin remove <name>                                       # everything it emitted goes
```

Team overlays (`agentbrew team set`) were removed in agentbrew 1.0. `agentbrew team ...` now prints the migration steps and exits 1. See README "Migrating from team overlays (1.0)".

## When to use this

When your company has:

- Internal skills, rules, or commands
- MCP servers that need company secrets (passed by reference, never written to agent configs)
- Hooks the company wants every engineer to run

You don't need this if you use agentbrew standalone. With no plugin installed, nobody sees company content in output, catalog, or state.

## What a plugin repo looks like

A git repo with `agentbrew-plugin.yaml` at its root. Start one with `agentbrew plugin new <dir> --name <name>` and check it with `agentbrew plugin test <dir>`. The schema is `src/plugins/agentbrew-plugin.schema.json`.

```yaml
schema: 1
name: acme
version: 1.0.0
capabilities:                       # deny by default
  agents: [claude]
  repos: { include: ["git.acme.example/**"] }
  hooks: [Stop]
  mcp_servers: [acme-jira]
contributes:
  rules: rules/
  skills: skills/
  commands: commands/
  hooks: hooks/hooks.json
  mcp_servers: mcp/servers.yaml      # env values are references: env:, keychain:, op://
  leak_patterns: leak-patterns.yaml
```

## What `plugin add` does

1. Clones the tag into `~/.local/share/agentbrew/plugins/<name>`.
2. Verifies the SSH tag signature against `~/.config/agent-plugins/allowed_signers` (shared with dotfiles).
3. Validates the manifest, the capabilities, and the MCP entries. It runs no plugin code.
4. Shows the capabilities and the signer, and asks once.
5. Writes the commit, tree hash, capabilities hash, and signer into `agentbrew.lock`.

On every `agentbrew sync`, skills and commands come straight from the locked checkout. Rules apply only in included repos and never go into global rules files. Claude Code gets a native plugin with the hooks, MCP launchers, and a session hook for the rules. A checkout that drifts from the lock stops `sync`.

## Shipping to your team

1. Create the plugin repo with `agentbrew plugin new`.
2. Release with a signed tag: `git tag -s v1.0.0 -m v1.0.0`.
3. Share the repo URL, the tag, and the signer's public key.
4. Teammates run `agentbrew plugin add <url>@v1.0.0 --signer "<key>"`.
5. Admins can print a Claude Code managed-settings fragment with `agentbrew plugin policy <name>`.
