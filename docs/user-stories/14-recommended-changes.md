# Recommended Changes After Upgrade

> I upgraded agentbrew and there are new recommended skills. How do I get them?

## Get new recommended items

```bash
agentbrew install --recommended   # idempotent — installs new, skips existing
```

This is safe to re-run at any time. It installs items that are now recommended but weren't when you first set up. Items you already have are skipped.

## What happens on upgrade

When you upgrade agentbrew (`agentbrew upgrade` or `npm i -g agentbrew@latest`):

- **New recommended items**: NOT auto-installed. You choose when to add them by running `install --recommended`.
- **Removed recommended items**: stay installed. If an item is downgraded from Tier 1 to Tier 2, it remains on your system — nothing is removed without your action.
- **New sync capabilities**: auto-activated. If agentbrew adds support for a new agent or a new sync type (e.g., instructions sync), it works on the next `agentbrew sync` — no re-init needed.
- **New agent definitions in agents.yaml**: auto-detected. If agentbrew adds support for a new agent (e.g., Gemini CLI MCP), detected agents get the new sync automatically.

## See what's recommended now

```bash
agentbrew catalog   # browse all items, ★ marks recommended
agentbrew install   # shows top 5 recommended items not yet installed
```
