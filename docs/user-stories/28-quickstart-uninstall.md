# One-liner Setup + Symmetric Uninstall

> My company has a private plugin and I want a single command that installs agentbrew AND configures it with our company setup. Same for uninstall — one line restores my machine to vanilla.

**Metric**: `story_fail_rate` for US27 in [`metrics.md`](../metrics.md): the install pair is `plugin add` and `plugin remove`.

**E2E**: [`us27-us28-us29-team-overlay-and-packs.test.ts`](../../real-e2e/scenarios/us27-us28-us29-team-overlay-and-packs.test.ts)

<!-- runnable: false reason="needs a reachable, signed plugin repo" -->
```bash
# install
agentbrew plugin add <url>@<signed-tag> --signer "<ssh-public-key>" && agentbrew sync

# uninstall — symmetric reversal
agentbrew plugin remove <name> && agentbrew sync
```

`plugin add` writes one lock entry; `plugin remove` deletes the checkout and every artifact that entry lists, and the next `sync` drops the plugin's skills, commands, native Claude plugin, and MCP launchers. User-added entries are never touched. A company can still wrap these two commands in its own bootstrap script, for example to install Node or set proxy variables first.

Before 1.0, each overlay shipped `bin/quickstart` and `bin/uninstall` scripts around `agentbrew team set` and `team unset`. Those commands were removed in agentbrew 1.0; see README "Migrating from team overlays (1.0)".

## Related

- [US 27: Company plugins](27-team-overlay.md)
