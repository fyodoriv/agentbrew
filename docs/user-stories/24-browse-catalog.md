# Browse the Catalog

> I want to see what skills, MCP servers, and rules are available before I install anything.

```bash
agentbrew catalog                         # full catalog, grouped by type
agentbrew catalog --search review         # keyword search across names + descriptions
agentbrew catalog --skills                # skills only
agentbrew catalog --mcp                   # MCP servers only
agentbrew catalog --rules                 # rule sets only
agentbrew catalog --sources               # skill source repos only
agentbrew catalog show <name>             # full details for one item
agentbrew catalog --json                  # machine-readable, for scripts
agentbrew catalog --markdown              # markdown table, for docs
```

## What's in the catalog

The catalog is a curated directory of agent resources — skills, MCP servers, and rule sets — each pointing at a source repo. AgentBrew doesn't host content; every catalog entry is a reference. Running `agentbrew catalog` gives you an overview of what's available so you can pick items to install without guessing names.

| Type | What it is | Where it comes from |
|------|------------|---------------------|
| **Skills** | Short Markdown documents that teach agents how to do something (`debug`, `refactor`, `review`) | Curated GitHub repos — Vercel, Anthropic, Trail of Bits, obra/superpowers, and more |
| **MCP servers** | Background services that extend agent capabilities (`context7` for live docs, `playwright` for browser control) | npm packages, git repos, or self-hosted URLs |
| **Rule sets** | Multi-rule Markdown files deployed to every agent's instruction file | Curated defaults shipped with agentbrew |
| **Sources** | GitHub repos you can register as skill providers | Any repo with `SKILL.md` files |

When a team overlay is active (`agentbrew team set <url>`), the overlay's `catalog-overlay.yaml` adds a second tier of recommended items pointing at the org's internal source repos — see [US 27: Team overlays](27-team-overlay.md) for the schema and lifecycle.

## Recommended vs. optional

Every catalog entry has a `recommended` flag. Items marked recommended are what `agentbrew install --recommended` installs — the opinionated starter set that makes first-run produce a working setup without the user choosing anything.

```
$ agentbrew catalog --skills

Skills (see `src/catalog.yaml` — recommended flag marks the starter set):

  ⭐ debug                  — Structured debugging workflow (investigate → fix → verify)
  ⭐ plan                   — Decompose features into spec + tasks
  ⭐ commit                 — Pre-commit checks, lint, test, conventional message
     audit-ci              — Audit Customer Interactions for best-practice violations
     ...
```

The ⭐ marks recommended entries. Everything else is installable on demand by name.

## Finding things

Search is a case-insensitive substring match across the entry's `name` and `description`:

```
$ agentbrew catalog --search security

Skills:
  semgrep                — Run Semgrep static analysis on a codebase
  codeql                 — CodeQL taint-tracking and security vulnerability scan
  supply-chain-risk-auditor — Flags dependencies at heightened takeover risk

MCP servers: (no matches)
```

Narrow by type with `--skills`, `--mcp`, `--rules`, or `--sources` — combine with `--search` for targeted lookups.

## See full details for a single item

```bash
agentbrew catalog show semgrep
```

Shows the description, tags, source repo URL, install command, and — for MCP servers — required env vars and setup instructions. This is what you read before running `agentbrew install <name>` to know what you're getting.

## Output formats

For the terminal, the default grouped output is what you want. For scripts and docs, use `--json` or `--markdown`:

```bash
agentbrew catalog --json | jq '.skills[] | select(.recommended) | .name'
agentbrew catalog --markdown >> README.md
```

The JSON format is stable — fields are `name`, `description`, `source`, `category`, `recommended`, `type`. Safe to parse from CI or tooling.

## Once you've found something

```bash
agentbrew install semgrep          # installs to every detected agent
agentbrew install --recommended    # installs every ⭐ item in one command
```

See [US 02: Install a skill](02-install-skill.md) and [US 03: Add MCP server](03-add-mcp-server.md) for the install flow. Any catalog item — skill, MCP server, rule — is installed with the same `agentbrew install <name>` command; the tool looks up the item and dispatches to the right installer.

## Why a curated catalog matters

Without defaults, first-run is a blank page — the user has to know what to install before they can use the tool. The catalog is what makes "zero to configured in two minutes" possible: `agentbrew install --recommended` takes the curated opinions and deploys them everywhere, and you only hand-pick items when you know what you want beyond the defaults.
