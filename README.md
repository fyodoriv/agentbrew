# agentbrew

[![npm version](https://img.shields.io/npm/v/agentbrew.svg)](https://www.npmjs.com/package/agentbrew)
[![license](https://img.shields.io/npm/l/agentbrew.svg)](LICENSE)

**One CLI that syncs skills, MCP servers, rules, and commands across every AI coding agent on your machine.**

Claude Code, Codex, Copilot, Goose, Kiro, Amp, and more — see the agent matrix below. Declarative `Agentfile`, drift detection, auto-repair. Companies ship private skills, rules, MCP servers, and hooks as signed plugins.

**Install or update with your AI agent (one step):** open Claude Code (or Codex) and say:

```text
Install or update agentbrew on this machine by following https://github.com/fyodoriv/agentbrew/blob/main/INSTALL.md (it updates an existing clone). Then run `agentbrew sync` so every agent gets the current rules. Audit the skills and commands already on this machine against these repos and propose adopt or merge for each one. From now on, extend these repos instead of building local copies. At the end, list anything that could work better and offer an issue or PR for each.
```

The agent explains what will change, asks your preferences, backs up your current agent settings, installs, heals drift, and restores the backup by itself if anything critical fails. Undo later with `bash scripts/install.sh restore`. Details: [`INSTALL.md`](INSTALL.md).

Or set it up in one line (clone, back up, install, heal, verify; it ends with the doctor, `agentbrew status --ci`):

```bash
git clone https://github.com/fyodoriv/agentbrew.git ~/agentbrew && bash ~/agentbrew/scripts/install.sh run  # ends with the doctor
```

Or try it without a clone:

```bash
npx agentbrew              # try it — detects agents, installs recommended set, schedules drift repair
npm install -g agentbrew   # or install globally for faster startup + tab completion
```

Requires Node.js 20.11+ and git.

**First run:** In an interactive terminal, `agentbrew` auto-runs `init` — detects agents, installs recommended items, schedules background drift repair. In CI, pipes, and agents, it changes nothing and prints the command to run (`agentbrew init`). Opt out with `AGENTBREW_NO_AUTO_INIT=1`. `agentbrew config set autoRepair off` turns the background repair job off for good (`AGENTBREW_NO_AUTO_SYNC=1` does it for one run), and `AGENTBREW_NO_SHELL_HOOK=1` leaves your shell rc file alone (the one-step installer applies your answers).

**One command after that:** `agentbrew` (no arguments) in the shell, or `/agentbrew` in an agent ([`commands/agentbrew.md`](commands/agentbrew.md)). It ships in the package, and every `agentbrew sync` deploys it, to Claude Code too without `ai-rules`.

Your own `~/.config/agentbrew/commands/agentbrew.md` or an Agentfile dir overrides it. `agentbrew config set builtinCommands off` or `agentbrew remove agentbrew` turns it off. With your own version present, `remove` deletes only yours.

It prints the state, what needs you, and a `Next:` line with the exact command for each fix. It reads local files only and changes nothing.

`agentbrew config` shows each setting with its value and source; `agentbrew config set <key> <value>` checks a value and saves it. Agents find every other command with `agentbrew actions --json`: one list generated from the CLI, with each command's arguments and whether it needs the user's own terminal or a yes first. agentbrew has no UI of its own, so every action runs through the CLI and agents; `src/action-parity.test.ts` fails when a command misses the agent path.

**Who it is for:** developers who use more than one AI coding agent and want one place to manage skills, MCP servers, rules, and commands.
**Documentation:** start at the [documentation map](docs/README.md). Contributors and coding agents: read [`AGENTS.md`](AGENTS.md) first.

## Use cases

- You use more than one AI coding agent and want the same skills, MCP servers, rules, and commands in all of them.
- You set up a new machine and want your whole agent setup back from one `Agentfile.yaml`.
- An agent update broke your config and you want it found and repaired without you.
- Your company ships private skills, rules, MCP servers, and hooks to every developer as a signed plugin.
- You want to know how big your always-loaded agent context is and where agent time goes.

## Features

Most developers use multiple AI coding tools. Each stores config in its own format (JSON, TOML, YAML, markdown). Add an MCP server: edit several config files. Add a skill: copy into each agent's skill directory.

Something breaks silently: nobody notices until a tool stops working.

- **One source of truth, every agent gets it.** Install once, deploy to every agent in its native format. Custom servers get the same treatment as catalog items.
- **Self-healing.** Background drift checks every 30 minutes. If an agent update or manual edit breaks the deployed config, it auto-repairs.
- **Never destroys your data.** Manual edits, user-added servers, custom rules — all survive every sync, update, and auto-repair.
- **Declarative.** Commit an `Agentfile.yaml` to your dotfiles; a fresh machine bootstraps in one command.
- **Curated 200+-item catalog.** It holds skills from [Vercel][], [Anthropic][], [obra/superpowers][], [Every Compound Engineering][], [gstack][], [Supabase][], [Trail of Bits][], [slavingia/skills][], and [awesome-design-md][]. The team overlay adds more when enabled.
- **Rollback is always available.** Every sync snapshots pre-state; `sync --rollback` restores it.

[Vercel]: https://github.com/vercel-labs/skills
[Anthropic]: https://github.com/anthropics/skills
[obra/superpowers]: https://github.com/obra/superpowers
[Every Compound Engineering]: https://github.com/EveryInc/compound-engineering-plugin
[gstack]: https://github.com/garrytan/gstack
[Supabase]: https://github.com/supabase/agent-skills
[Trail of Bits]: https://github.com/trailofbits/skills
[slavingia/skills]: https://github.com/slavingia/skills
[awesome-design-md]: https://github.com/VoltAgent/awesome-design-md

**What belongs in agentbrew.** agentbrew deploys agent config for work in any repo. A feature that reads or writes a user's career data, such as a standup report or a daily status update, belongs to careerbrew. agentbrew only deploys careerbrew's commands from careerbrew's own source (see "Commands that a repo owns" under [Agentfile](#agentfile)).

## Proof

<!-- proof:start -->
Every number below comes from `docs/proof/metrics.json`. `npm run docs:proof` writes that file and this section.
Each headline row is a field outcome: `real use` numbers come from the local, content-free event log that every real `agentbrew sync` and scheduled repair writes ([`docs/observability.md`](docs/observability.md)). Nothing is uploaded; each machine aggregates its own log.

| Claim | Theory | Metric | Result | Source |
|---|---|---|---|---|
| Sync is fast enough to run often | Under 2 s keeps a tool inside a user's flow (Nielsen 1993, response-time limits) | `sync` time, goal 2,000 ms or less | 933 ms (median of the last 20 of 349 syncs over 9 days) | `docs/proof/metrics.json`, real use |
| Sync works reliably | A low failure share is what makes background sync safe | failed `sync` runs, goal 5% or less | 0% (349 syncs, 2026-10-18 to 2026-10-27) | `docs/proof/metrics.json`, real use |
| Self-healing: the scheduled repair runs cleanly | A repair loop only helps when its own runs succeed | failed scheduled repairs, goal 5% or less | 3.6% (307 scheduled repairs, 2026-10-18 to 2026-10-27) | `docs/proof/metrics.json`, real use |
| Self-healing: drift gets fixed | Drift found and fixed by the loop is the outcome the claim promises | drift items the repair fixed | 38.9% (14 of 36 drift items seen by 307 repairs) | `docs/proof/metrics.json`, real use |

Field data comes from 1 machine(s), each named by a salted hash: `m-c525f1fce3` (349 syncs, 307 repairs, as of 2026-10-27).

Engineering health (from the code and the local gate, not field proof):

- agents with a full sync surface: 14 agents (agents with more than a skills folder in agents.yaml); local run, 2026-10-27, m-c525f1fce3 (darwin arm64)
- catalog entries: 253 items (skills, MCP servers, CLI tools, plugins, rules in src/catalog.yaml); local run, 2026-10-27, m-c525f1fce3 (darwin arm64)
- passing `npm run verify` runs: not measured yet; local run, 2026-10-27, m-c525f1fce3 (darwin arm64)
- uncached gate time, goal 300,000 ms or less: not measured yet; local run, 2026-10-27, m-c525f1fce3 (darwin arm64)
- user files changed by a sync on a seeded home, goal 0: not measured yet; local run, 2026-10-27, m-c525f1fce3 (darwin arm64)
- seconds from a cold install to a clean `agentbrew status --ci`, goal 120 or less: 10 s (scripts/install.sh run to a clean agentbrew status --ci); local run, 2026-10-27, m-c525f1fce3 (darwin arm64), scratch HOME

Median `agentbrew sync` time per day (real use, ms):

```mermaid
xychart-beta
  title "Median sync time per day (ms)"
  x-axis ["10-18", "10-19", "10-20", "10-21", "10-22", "10-23", "10-25", "10-26", "10-27"]
  y-axis "ms"
  bar [1201, 951, 923, 780, 1184, 6108, 9229, 1012, 954]
```

Drift items the scheduled repair saw (real use). One item can count in more than one run. Honest gap: most were not fixed by the repair run that saw them.

```mermaid
pie title Drift items found by scheduled repair
  "Repaired" : 14
  "Not fixed by that run" : 22
```
<!-- proof:end -->

## Personal and corporate machines

agentbrew works the same way on both. What changes is what a company plugin adds and where your data may go.

| | Personal machine | Corporate machine (your work laptop) |
|---|---|---|
| Setup | this repo and your own Agentfile | the same, plus your company's signed plugin (`agentbrew-<org>`) |
| Company content | none | only from the company plugin: its skills, rules, MCP servers, and hooks. This public repo never names a company |
| Your data | stays on this machine; agentbrew has no server and sends nothing anywhere | the same. **Company names and internal links stay private**: they live only in the plugin and in a local pattern file, and leak gates block a push or a GitHub post that holds one |
| Plugin trust | none needed | signed tags only, and each capability is denied until the plugin declares it ([Company plugins](#company-plugins)) |

**Corporate plugins.** A company plugin is a private repo named `agentbrew-<org>`. Its companions are `careerbrew-<org>` (career workflows) and `dotfiles-<org>` (machine setup). To find yours, ask your team for its `agentbrew-<org>` link, or run `agentbrew plugin list` on a machine that already has it. To build one, run `agentbrew plugin new <dir> --name <name>` and read [Company plugins](#company-plugins).

## Install a skill or MCP server

```bash
agentbrew install debug                   # skill from the catalog (every agent)
agentbrew install context7                # live library docs MCP (recommended, all agents)
agentbrew install sourcegraph             # enterprise code search MCP (token + instance URL)
agentbrew install storybook-screenshot    # catalog CLI command + package binary
agentbrew install --recommended           # recommended skills + MCP + rules, in one shot
agentbrew install agent-usage-guard       # a Claude Code plugin from the catalog, pinned to a commit
agentbrew install verify-everything       # a bundle: a named group of catalog items, installed together
agentbrew catalog --bundles               # list bundles and their members
agentbrew install review-tasks            # tasks.md /review-tasks: audit a task queue for stale or misprioritized work
agentbrew install wrap-up                 # /wrap-up: deliver finished work, draft the rest as a leak-checked PR + task
agentbrew install review-pr               # /review-pr: review a PR with a per-run folder and a verify pass; posts only on your yes
agentbrew install sourced-calculations    # every computed number shows its inputs, sources, steps, and assumptions
agentbrew install --refresh-rules --dry-run   # preview catalog rule text updates (rules only); drop --dry-run to apply
agentbrew install @anthropic/mcp-proxy    # any npm package (auto-detected as MCP)
agentbrew install sqlite -- uvx mcp-server-sqlite   # any command as an MCP server
agentbrew install api --url https://api.example.com/mcp   # SSE/HTTP transport
agentbrew install --git https://github.com/org/mcp-server  # clone, build, auto-detect entrypoint
agentbrew install vercel-labs/skills      # add a GitHub skill repo as a source
agentbrew remove context7                 # auto-detects type, removes from all agents
agentbrew catalog --search security       # browse + search the catalog
agentbrew skills coverage --builtins      # require in-repo skill eval coverage
agentbrew skills validate                 # check SKILL.md frontmatter and body (exit 1 on errors)
```

**A removed MCP server stays removed.** `agentbrew remove <server>` records the name in `declinedMcpServers` in `state.yaml`. The recommended set and project Agentfiles (a repo's `Agentfile.yaml`, applied when you sync from that repo) skip it. Your global Agentfile, an explicit `--agentfile`, or `agentbrew install <server>` adds it back.

`remove` records the name only when the server is in agentbrew's registry; a server that is only in an agent config is not recorded. So remove it from that config, or `agentbrew install` it and then `agentbrew remove` it.

**Built-in skills stay built-in.** A name that ships in agentbrew's own `skill-plugins/dev/` and has no catalog entry (in `agentbrew install` or an Agentfile `skills:` list) always resolves to agentbrew's copy. agentbrew never searches the registry or your sources for it, and `sync --pull` never installs a team source's `recommended` skill with that name. To replace a built-in on purpose, name the source: `agentbrew install <name> --from <source>`. An Agentfile `skills:` entry always resolves as a skill, never as a catalog rule, MCP server, or CLI tool with the same name. `agentbrew install load-project-context` installs the catalog rule and says that a built-in skill shares the name (agentbrew always deploys that skill).

**Claude Code plugins from the catalog.** A `claude_plugins:` catalog entry names a repo, a full 40-character commit, and its `plugin@marketplace`. `agentbrew install <name>` clones the repo at that commit into `~/.local/share/agentbrew/claude-plugins/<name>`, registers the checkout as a directory marketplace, and enables the plugin, all through the `claude` CLI. (Claude Code itself can pin a marketplace only to a branch or tag, and both can move.) `agentbrew remove <name>` uninstalls the plugin, removes the marketplace and the checkout. `agentbrew status` reports drift: a checkout that moved, a plugin that is off, a marketplace that points elsewhere, or a catalog pin that changed. agentbrew records what it installed in `~/.config/agentbrew/claude-plugins.json` and touches only those plugins. `agentbrew catalog` (and `--search`, `--format json`) lists them with their repo and pinned commit, and `agentbrew install <name> --dry-run` previews one. A catalog Claude Code plugin is never recommended, so `install --recommended` never installs one.

**Pin a git install.** `agentbrew install --git <url> --ref <ref>` (also `mcp add --git`) checks out one exact commit:

- A short name is looked up as a tag first, then as a branch. A tag wins over a branch with the same name. To pin that branch, pass `--ref refs/heads/<name>`.
- A full commit ID works: 40 hex, or 64 hex in a SHA-256 repo. A short commit ID, or another revision such as `HEAD~1`, is refused.
- A branch pin tracks the branch, so `agentbrew mcp update` pulls it. A tag or commit pin stays on that commit: `mcp update` exits 1 on it and prints the install command, with `--ref <tag|branch|commit>`, that moves the pin.
- A failed `install --git` or `mcp update` exits 1 and registers nothing. agentbrew removes none of your files in the cache; after a re-pin whose build is refused, the cache stays at the new commit.
- Say the cache has no build output from a commit, and the build at that commit fails. That counts as a failed install or update, because the cache's build output (such as `dist/`) may come from another commit. The output comes from a commit after a successful build of it, or after any build of a fresh clone of it. A failed build at that commit may still use it.
- With no build script, an entrypoint that the checked-out commit does not contain is refused as left over from an earlier build.
- Known limit: when a successful build writes its output to a new place (`build/` instead of `dist/`), detection can still pick the old `dist/` first. Delete the old output dir in the cache.
- A ref that starts with `-`, or is not a valid git ref name, is refused before anything is cloned or fetched.
- Each server's repo is cached at `~/.config/agentbrew/mcp-repos/<name>`, and that dir is reused only for the repo that cloned it. Another URL under the same name is refused, and so is a cache dir with no `origin` remote, a symlink, or a linked worktree. To keep both repos, install the new one under another name (`agentbrew install <other-name> --git <url>`). To replace it, delete the dir.
- A trailing `.git` or `/` on a URL does not make it another repo, but the ssh and https forms of one repo do. A local path is recorded as an absolute one.

**Env vars for a git install.** `agentbrew install <name> --git <url> --env KEY` (also `mcp add --git`) gives the server env var `KEY` as a `${KEY}` reference, which agents read from their own environment. `--env KEY=VALUE` stores the value as given, so keep secrets out of it. A bare `KEY` must be upper case (letters, digits, and `_`), and `KEY=VALUE` needs a value. A re-install keeps the server's env vars and adds or replaces the ones you pass; to drop one, `agentbrew remove <name>` and install again. agentbrew checks each key in the environment of the shell that runs the install, before it clones:

- With `--yes`, or with no terminal (an agent or a script), a missing key makes the install exit 1 and name the key. It never waits on a prompt.
- In a terminal, agentbrew asks for each missing value with hidden input, then offers to save it to your shell secrets file (as `agentbrew setup` does). Agents read it there only if your shell startup sources that file. Ctrl-C exits 130.
- agentbrew prints key names only, never values.
- An unattended install (`--yes`, or no terminal on stdin or stdout) also stops git's https login prompt (`GIT_TERMINAL_PROMPT=0`, no askpass program). A private https repo then clones only with saved credentials, such as a credential helper; without them, the clone fails at once instead of waiting.
SSH runs with `-o BatchMode=yes` added to your own ssh command (`GIT_SSH_COMMAND`, `core.sshCommand`, or `GIT_SSH`), so it fails instead of asking for a passphrase or a host key.
- A token in a git URL (`https://user:token@host/...` or `https://token@host/...`) never shows in anything agentbrew prints: the CLI filters all of its stdout and stderr, so the token appears as `***`. A tool agentbrew runs with your terminal attached (`npx skills add` for a skill source) prints on its own; give such a source a credential helper instead of a token in its URL. The server's saved `gitUrl` leaves it out, while the repo cache keeps it for fetching. If you delete the cache, set up a credential helper before `mcp update`.

**GitHub MCP.** `agentbrew install github` deploys GitHub's own hosted server (`https://api.githubcopilot.com/mcp/`) with `Authorization: Bearer ${GITHUB_TOKEN}`. The old `@modelcontextprotocol/server-github` npm package is archived. On load, agentbrew moves a saved `github` entry that still names it to the hosted server.

A fresh install always writes the hosted server, even on a machine with a local `~/.local/bin/*-github-mcp` launcher: GitHub maintains the hosted server, and the catalog curates rather than hosts. The launcher is used only to repair an old entry.

One that still names the archived npm package on a machine that has a launcher, or one whose launcher path no longer exists. To use a launcher for a new install, add the server by hand with the launcher as its command.

**Official MCP Registry (opt-in).** With `AGENTBREW_MCP_REGISTRY=1`, `install` looks up a name the local catalog does not have in the [official MCP Registry](https://registry.modelcontextprotocol.io/) — for example `AGENTBREW_MCP_REGISTRY=1 agentbrew install io.github.upstash/context7 --dry-run`. Local catalog entries always win, and a registry outage falls back to the local catalog with a one-line warning. Details: [docs/competition/official-mcp-registry-vs-agentbrew.md](docs/competition/official-mcp-registry-vs-agentbrew.md).

Adding a source indexes its available skills; it does not deploy every skill from that repo. `sync` deploys skills only after you explicitly install/select them, plus legacy manual `skillSourceDirs` outside tracked source paths that are already treated as opt-in source directories. A `skillSourceDirs` entry inside the source cache that no tracked source owns prints a `state.yaml` warning, because it would deploy every skill in that cache.

`agentbrew skills validate` knows the Claude Code skill fields `effort` (`low`, `medium`, `high`, `xhigh`, `max`, or an integer), `shell` (`bash` or `powershell`), and `when_to_use` (a string). It reports a wrong value as an error, not as an unknown field.

In-repo custom skills under `skill-plugins/dev/` must ship a spec-valid `evals/evals.json`. `npm run skills:coverage` is part of `npm run verify` and fails CI when any built-in skill is missing evals, even if aggregate coverage would otherwise meet the threshold.

The bundled `writing-plans` skill produces source-backed plans with explicit
alternatives, dependency-aware work, and versioned host-boundary contracts.
Use `task-command-center` with it when the plan spans a docs hub, Jira, or
multiple repositories. It keeps Jira tasks concise: Jira fields and links own
UI metadata, explicit non-goals stay excluded, and a requested single PR
remains one delivery boundary.

High-risk prompt-like artifacts also have deterministic Promptfoo checks. Use Vitest for structural or pure-helper invariants, Promptfoo evals for policy/behavior drift in prompt-like files, and explicit exemptions only when neither layer fits. Run `npm run eval:agent-artifacts` directly, or see [Testing agent artifacts](docs/testing-agent-artifacts.md). `npm run eval:plain-language` checks sampled chat, docs, PR, code-comment, and skill-wrapper output from Claude Code and Codex against the plain-language rule; pass `--surface <name> <file>` to score your own captured output.

Source repos can declare one-time setup in `agentbrew-source.yaml`:

```yaml
bootstrap: scripts/bootstrap.sh
```

After adding the source, run `agentbrew bootstrap <source>` to execute the script from that source's local cache. Bootstrap never runs automatically during `install` or `sync`.

**Secrets.** MCP servers that need credentials print per-token instructions after install. The setup wizard fills them in interactively. It hides what you type and prints key names only, never a value or part of one; to keep a current value, press Enter:

```bash
agentbrew install composio                 # deploys Composio Connect MCP (1000+ SaaS apps)
agentbrew setup composio                   # guided wizard → saves to ~/.zshenv.secrets
```

**Claude Code permissions.** By default, `sync` turns Claude Code's permission prompts off. It sets `permissions.defaultMode` to `bypassPermissions`, sets `skipAutoPermissionPrompt: true`, and adds an `mcp__<server>__*` allow rule for every configured MCP server. Claude then runs tools without asking. To keep your own permission settings and prompts, run this. After that, `sync`, `init`, and drift repair do not change them:

```bash
agentbrew config set claudePermissions keep   # default: manage
```

On a new install, `bash scripts/install.sh run --yes --keep-claude-permissions` runs this command before setup, so the prompts are never turned off. `install.sh plan` lists this and the other Claude Code changes (hooks, `/goal` behaviour, always-loaded CLAUDE.md size) before anything changes.

`keep` does not undo what an earlier `sync` wrote. If `sync` already ran, also remove `defaultMode`, `skipAutoPermissionPrompt`, and any `mcp__*` allow rules you do not want from `~/.claude/settings.json`.

**Scopes.** `install` is global by default (applies to every agent). Use `--local` / `--project` to install into the current repo's `.agentbrew/skills/` — ideal for project-specific conventions or team-shared skills.

**Delegated skill install networking.** Remote skill sources are installed through Vercel's `skills` CLI for agents it supports. That subprocess may need egress to `registry.npmjs.org` (to resolve the `skills` package), GitHub or the source Git host (to fetch the skill repo), and `skills.sh` (for risk-assessment metadata). If a proxy blocks any of those hosts, configure npm/git proxy settings first; agentbrew will still fall back to its native scanner when the subprocess fails.

A cold offline `agentbrew init` still finishes: it detects agents, writes MCP config, and skips each skill source it cannot clone with a `source unreachable` warning (retested 2026-10-16, see [`docs/decisions/first-run-offline-warmup.md`](docs/decisions/first-run-offline-warmup.md)). Run `agentbrew init` or `agentbrew sync --pull` again when online to fetch the skipped skills. If a source is cloned but the skills CLI is not in the npm cache, the install fails with `ENOTCACHED` and falls back to the native path. To skip the skills CLI fully on an offline machine, set the machine-local override, and switch it back to `auto` when online again:

```bash
agentbrew config set skillInstallMode native
```

Re-running `agentbrew init` keeps this setting and every other one you set in `state.yaml` (for example `claudePermissions`, `team`, `hooks`, `declinedMcpServers`, and the model keys). Init rebuilds only the detected agents and merges the MCP server list.

#### Fallback failure modes

Every delegation failure prints `Delegated skill install networking` at the top of the error block — that's the anchor to this section. The fallback automatically engages: native registration still runs, the source still lands in `state.sources`, and only the selected skill is marked for deployment through agentbrew's own scan instead of `npx skills add`. The 4 failure modes below cover what the operator typically sees in the wild:

| Symptom | Likely cause | What to do |
|---|---|---|
| `tunneling socket could not be established, statusCode=407` | Corporate HTTP proxy blocked the `registry.npmjs.org` / GitHub egress. | Configure `npm config set proxy` + `git config --global http.proxy`, OR run `agentbrew config set skillInstallMode native` to skip delegation. |
| `connect ETIMEDOUT <ip>:443` | Network egress hangs (firewall drops on the proxy, VPN required for one of the three hosts). | Verify VPN connection, retry. If repeating, run `agentbrew config set skillInstallMode native` — see also the [skill-install-fallback section in TASKS.md](TASKS.md). |
| `npm error 404 Not Found - GET https://registry.npmjs.org/<package>` | The `skills` CLI's published package shape changed, OR the source repo's manifest is wrong. | Update agentbrew (`npm install -g agentbrew@latest`). If still 404 after update, file an issue with the failing source URL. |
| `getaddrinfo ENOTFOUND registry.npmjs.org` (or `ENOTCACHED` / `ECONNREFUSED`) | Registry unreachable: cold offline, DNS broken, or first-run-without-cache. | Run `npx --yes skills --version` once online to warm the cache, then offline retries work. For permanently-offline machines, run `agentbrew config set skillInstallMode native`. |

The above list is anchored to the 4 failure-mode scenarios pinned in `src/add-source.test.ts` (`fallback failure-mode: …`). If a new failure mode shows up in the wild, add a test row in `src/add-source.test.ts` AND a row here so the doc + code surfaces stay aligned.

## Agentfile

A declarative manifest — like `Brewfile` for Homebrew. Catalog items use shorthand names; custom servers use the full spec. Both sync identically.

```yaml
# Agentfile.yaml
recommended: true               # install all curated defaults

mcp:
  - context7                    # catalog shorthand
  - playwright
  - name: my-server             # custom spec
    command: npx
    args: [tsx, ./mcp-server.ts]
    env:
      API_KEY: ${API_KEY}       # substituted from shell env at sync time

skills:
  - semgrep
  - codeql
  - property-based-testing

sources:
  - vercel-labs/skills           # GitHub skill repos
  - trailofbits/skills
  - ./skill-plugins/dev          # local paths resolve relative to Agentfile

rules: ./shared-rules.md         # file path or inline text
commands: [./.claude/commands]   # extra command source dirs for this repo
hooks:
  - event: PreToolUse            # lifecycle hooks synced to supported agents
    command: bash /path/to/hook.sh
    matcher: Bash
  - event: Stop
    command: bash /path/to/verify.sh
    agents: [claude-code]        # only these hook targets get the entry
    asyncRewake: true            # Claude Code control fields: async, asyncRewake, once, if, statusMessage

defaultModel: claude-opus-5-5    # default model for every agent with a file-managed model setting
defaultEffort: xhigh             # reasoning effort, for agents that store it separately
modelOverrides:
  codex: null                    # null = skip; keep that agent's own model
                                 # (a string swaps in that provider's id for the same model)
```

`${VAR}` substitutes from your shell environment at sync time; `${VAR:-default}` provides a fallback.

```bash
agentbrew init --from-state              # generate an Agentfile from the current setup
agentbrew agentfile merge base.yaml overlay.yaml --output ~/.config/agentbrew/Agentfile.yaml
```

**Global vs. project.** The global Agentfile (`~/.config/agentbrew/Agentfile.yaml`) is authoritative — items you remove from it are removed from state on next sync. MCP servers that `agentbrew init` found already set up in your agents stay, unless the Agentfile listed them and later dropped them. The project Agentfile (`./Agentfile.yaml`) is additive — it can add items for that repo but never removes the global config. `install` and `remove` always update the global file (like `npm install` updating `package.json`); pass `--project` for project scope.

A sync run from a linked worktree (a `git worktree add` copy) of a checkout that is already a source skips that worktree's project Agentfile and prints one warning. Run sync from the main checkout instead, so a short-lived worktree does not shadow it. An entry an older version registered stays until you remove that worktree and sync from the main checkout.

Agentfile `commands:` directories are extra source dirs for the same command sync pipeline as `~/.config/agentbrew/commands` and agentbrew's built-in commands (`/agentbrew`). Built-in commands rank lowest: the global folder and any Agentfile dir override them, and your own version beats everything. Sync never copies them into your folder.

Sync never overwrites a command you created or edited in `~/.config/agentbrew/commands`; `agentbrew commands list` shows commands from all configured source dirs. Each `commands:` and `agents:` dir records the Agentfile that declared it.

A sync removes dirs that the same Agentfile no longer declares. This covers the global Agentfile, `--agentfile`, and the project Agentfile in the current directory. `--no-prune` turns it off.

Dirs from other Agentfiles or added by hand are never removed. State written before ownership existed is kept as is, and a dir that is still declared is claimed on the next sync. So remove an old dropped dir by hand once.

**Commands that a repo owns.** Never hand-copy a repo-owned command into `~/.config/agentbrew/commands/`. Declare the repo's command folder in that repo's `Agentfile.yaml` (for example `commands: [./commands]`). Then run `agentbrew sync` in the repo, or list its parent folder in `workspaceRoots` (see [Workspaces](#workspaces)). A hand copy is a second source with no owner, and it drifts from the repo's version.

**Default model.** `defaultModel` deploys one model id to every detected agent that has a file-managed model setting: Claude Code (`~/.claude/settings.json` `model`) and Codex (`~/.codex/config.toml` `model`). `modelOverrides` handles per-agent differences: a string swaps in that provider's id for the same model. `null` skips the agent (useful when a model isn't available on that agent's provider/gateway yet — drop the override line once it is).

`defaultEffort` is written next to the model for agents that keep reasoning effort in its own key: Claude Code (`effortLevel`) and Codex (`model_reasoning_effort`). A skipped agent keeps its own effort too. `agentbrew init` writes the recommended default — `claude-opus-5-5` at `xhigh` effort, with Codex skipped — into a new Agentfile unless the machine already has a `defaultModel`.

Drift-repair re-applies the default every 30 minutes, so a manually flipped model reverts on the next tick. Before that tick, `agentbrew status` lists the agent as `models` drift with the expected model, and `agentbrew status --fix` repairs it; agents are set-when-present, meaning removing `defaultModel` from the Agentfile stops managing models without rewriting anything.

**Work day.** `/work` lives in [careerbrew](https://github.com/fyodoriv/careerbrew), not in agentbrew (#610). Install careerbrew and run `agentbrew sync`: its Agentfile (`commands: [./commands]`) deploys careerbrew's `/work`. Add day steps with `careerbrew config set work_steps "/a, /b"`. An Agentfile `workSteps:` key is still accepted, but agentbrew ignores it, and the next sync removes old `workSteps` from `state.yaml`.

**Merging overlays.** `agentbrew agentfile merge` builds one normalized Agentfile from multiple inputs. List-like fields (`mcp`, `skills`, `sources`, `commands`, `agents`, `hooks`, `excludeAgents`, `workSteps`) merge in file order; duplicate MCP, hook, or `workSteps` entries (same step name) keep their original position but use the later definition. A hook is a duplicate when its `event`, `matcher`, and `agents:` list all match, so same-event hooks for different agents stay separate. A later file's hooks replace every earlier hook with the same key. Inside one file, hooks with the same key but different commands all stay, because agents run every hook that matches; an exact copy is dropped. `rules` are additive and path-based rules are expanded before writing the merged file. Scalar metadata fields (including `defaultModel` and `defaultEffort`) use the later file; `modelOverrides` merges per agent with the later file winning.

### Workspaces

If you keep many repos, each with its own `Agentfile.yaml`, one sync can apply all of them. List the workspace folders in the global Agentfile:

```yaml
workspaceRoots:
  - ~/apps/tooling
  - acme            # a name from `tasks workspaces` (~/.config/tasks-md/workspaces.json)
```

Or pass them per run: `agentbrew sync --workspaces ~/apps/tooling,~/apps/acme`, or `--workspace-name acme`. Each direct child folder of a workspace that holds an Agentfile is a repo, named `<workspace>::<repo>`. Sync merges every repo Agentfile, then the global (or `--agentfile`) Agentfile last, into `~/.config/agentbrew/generated/workspace-Agentfile.yaml` and applies that.

The base Agentfile wins every conflict. Between repos the later one wins, and sync warns when two repos declare an MCP server, `defaultModel`, or `defaultEffort` differently, naming both repos. A repo's `task_backend`, `repo`, and `project` stay with that repo.

`agentbrew status --workspaces ...` (or with `workspaceRoots:` declared) lists each workspace's repos, their MCP servers and skills, and which ones are deployed. With no workspaces declared, sync works as before.

Use `agentbrew sync --dry-run` to validate and preview Agentfile changes, including downstream per-agent sync changes for Agentfile-only MCP servers, sources, commands, agents, rules, and hooks, without updating `state.yaml` or installing anything. Add `--agentfile <path>` to preview an explicit dotfiles Agentfile before making it authoritative.

## Sync

One command translates the source of truth into every agent's native format.

- **MCP servers** → JSON (Claude, Kiro), TOML (Codex), YAML (Goose); exact definitions are reconciled into mcpm so backend changes cannot leave stale same-name servers
- **MCP permissions** → `permissions.allow` entries for agents that declare `mcpPermissionsConfig` (none in the core list today)
- **Skills** → symlinks for explicitly installed skills and opt-in source dirs outside tracked sources. When two remote sources ship an installed skill with the same name, the source listed later in `state.yaml` wins (if its cache no longer has the skill, the earlier one does). `sync --pull` refreshes only that copy, and `agentbrew status` shows a `Name clash` line naming the skill, the source it is installed from, and the skipped source. `status --json` lists the same under `skillNameClashes`. A real folder with a `SKILL.md` where a managed symlink belongs is a stale copy: agents load it instead of the source. `agentbrew status` reports it as skills drift, and sync moves it to `~/.config/agentbrew/backups/skill-copies/<time>/<agent>/<name>` and links the source. A folder without `SKILL.md` stays as it is
- **Rules** → marker-injected sections in each agent's rules file. Catalog-owned per-file rules in `templates/rules/` refresh into `~/.config/agentbrew/rules/` on every `agentbrew sync --only rules` (no current agent reads a per-file rules dir, so they are not deployed further). Catalog rule blocks in `shared-rules.md` (`<!-- rule: <name> -->`) refresh on `sync --pull` only while the body still matches the hash agentbrew recorded at install. Edited or unrecorded blocks are kept with a warning, and `install --refresh-rules` replaces them and installs nothing else (add `--dry-run` for a diff); `agentbrew status --verbose` lists each kept or refreshable block
- **Commands** → Markdown auto-transformed per agent. When an agent's config folder exists but its commands folder does not, sync creates the commands folder. When the config folder is missing too, sync prints the exact `mkdir -p` command to run. Two command source dirs (Agentfile `commands:` dirs and plugins) or two Agentfile `agents:` dirs may ship a file with the same name. Then the dir listed later in `state.yaml` wins, the same rule as skills. Sync warns, and `agentbrew status` shows a `Name clash` line naming the command or agent, the winning dir, and the skipped one (`status --json`: `commandNameClashes`, `agentNameClashes`). The built-in agents folder `~/.config/agentbrew/agents` always wins, and built-in commands rank lowest (see Agentfile `commands:` above). A command you made or edited yourself in `~/.config/agentbrew/commands` loses to an Agentfile or plugin dir with the same name (your file stays on disk). So sync and `status` name that clash too, with the global folder as the skipped one; agentbrew's own merged copies there never count. Sync also keeps a deployed command file it did not write last (you edited it, or it is not in agentbrew's manifest). When that file differs from its source, every sync and `sync --dry-run` warns and prints the `rm <file> && agentbrew sync` command that takes the source version.
- **Hooks** → native hook files (Claude Code settings)
- **Models** → the Agentfile's `defaultModel` written to each agent's model setting (Claude Code settings.json, Codex config.toml)
- **Instructions** → one canonical `~/.config/agentbrew/AGENTS.md` (agents.md standard); agents whose `rulesFile` is `AGENTS.md` get a symlink, proprietary filenames (`CLAUDE.md`, `guidelines.md`, `global_rules.md`, `GEMINI.md`) still receive copy+merge with deduplication against managed rules
- **Helper scripts** → the scripts the instructions tell agents to run (`load-project-context.sh`, `verify-vision-trace.sh`, and `competitor-spot-check.sh` from `templates/scripts/`, plus the `scripts/check-pr-vision-trace.mjs` CI gate) install into `~/.config/agentbrew/scripts/`. Sync writes a script only when it is missing or agentbrew wrote it and nobody changed it since. It keeps any other file at that path; `agentbrew sync --verbose` lists the kept copies, and `agentbrew status --verbose` names each kept, missing, or outdated script with its path

### Attention-friendly language

By default, managed agents write agent-authored natural-language text so a
reader with little time or attention can scan it. This covers user-facing text,
docs, prompts, status updates, and code comments. An explicit user request for
another style wins. To make it strict on your machine, add a line such as "a
request for another style does not override it" to your own shared rules.

Agents must put the answer first, use short paragraphs and direct sentences,
keep one idea per sentence or bullet, and use headings, bullets, or numbered
steps when they improve scanning. They must surface blockers and the next
action. Required formats and verbatim code, commands, logs, JSON, and user text
stay unchanged.

```bash
agentbrew sync                  # deploy + prune stale items (the one healing command)
agentbrew sync --pull           # apply the Agentfile to state, fetch latest from sources, install newly requested skills, then deploy everything (hook scripts and models included)
agentbrew sync --pull --dry-run # list what would be pulled; fetch and write nothing
agentbrew sync --dry-run        # preview Agentfile + sync changes without applying
agentbrew sync --only mcp       # sync one surface; installs skills only with --only skills
agentbrew sync --rollback       # restore from last pre-sync snapshot
```

Every sync creates a timestamped snapshot. Pruning only touches entries agentbrew deployed — user-added items are always preserved.

When an Agentfile is in effect (`--agentfile`, the global Agentfile, or a project Agentfile), the Agentfile decides the skill set. A plain `sync` installs the catalog recommended set only on a machine with no Agentfile; an Agentfile asks for it with `recommended: true`. A skill you remove from the Agentfile is pruned from its source on the next sync or `sync --pull`.

Skills you installed by hand stay. An authoritative sync keeps a source that backs a skill the Agentfile lists, even when `sources:` does not name it.

It also keeps a source that `agentbrew install` added for a skill no Agentfile listed, so a hand install from a new source stays linked. A source cache that cannot fast-forward (for example, after upstream rewrote history) is reset to upstream; local-only commits stay on a `salvage/<date>-<sha>` branch.

## Shared semantic memory

Enable one loopback-only `mcp-memory-service` daemon for every agent instead of starting a Python/ONNX process per chat:

```bash
agentbrew memory enable       # wire the HTTP MCP and install/reconcile the macOS LaunchAgent
agentbrew memory doctor --ready # startup gate: initialize + initialized notification + non-empty tools/list + bootstrap
agentbrew memory doctor       # verify full MCP discovery, behavioral bootstrap, schema, and backups
agentbrew memory transport-report --json # read-only compatibility evidence before a security migration
agentbrew memory fix          # repair the LaunchAgent, wait for discovery readiness, then maintain the store
agentbrew memory sync-projects # ingest Claude project-memory files through the managed MCP client
agentbrew memory sync-projects --check # report changed project stores without contacting the daemon
agentbrew memory sync-projects --force # deliberately re-ingest every discovered store
agentbrew sync                # keeps the daemon definition and every agent's MCP URL converged
```

The managed endpoint is `http://127.0.0.1:18765/mcp`.

Readiness performs the
Streamable HTTP discovery contract in order — `initialize`,
`notifications/initialized`, then `tools/list` — and requires a non-empty tool
set. The probe preserves `MCP-Session-Id` and accepts JSON or SSE responses.
Behavioral bootstrap is enabled with a 1,536-token cap so a fresh agent session
can load relevant durable context. LaunchAgent reconciliation is idempotent: a
normal sync does not restart a healthy unchanged daemon, but configuration
drift is rewritten before MCP fanout.

If `memory fix` recovers or restarts the daemon, restart any agent that held
a stale MCP connection. agentbrew never kills agent processes. Cold login
ordering should start memory before the IDE.

The daemon runs on Python 3.13 (`uvx --python 3.13`). uvx otherwise picks the
newest Python it has, and the service's `onnxruntime` dependency has no wheels
for Python 3.15 yet. Without the pin, the install fails, nothing listens on
port 18765, and agents report `ECONNREFUSED` for the `memory` server.

In an `Agentfile.yaml`, `memory.enabled` makes the same lifecycle part of the normal one-command sync:

```yaml
memory:
  enabled: true
```

When `memory.enabled` is true, `state.yaml` must contain one valid managed
`memory` server with the loopback URL above. `agentbrew sync` repairs a missing
or malformed registration before it fans the server out to agent configs.
`agentbrew memory fix` is the one-command recovery path when the daemon also
needs to be restarted or rediscovered. Repairs keep the SQLite store, existing
memory rows, pack ledgers, and stable server metadata.

`memoryPacks` declarations from base and overlay Agentfiles are merged and
resolved relative to the file that declares each path. Discovery does not
install a pack; only an explicit `memory pack install` (or reconciliation of
an existing install ledger) writes pack records.

### Claude project-memory bridge

Claude Code keeps durable project facts in
`~/.claude/projects/<project>/memory/*.md`. Run
`agentbrew memory sync-projects` to ingest populated stores through the same
session-aware Streamable HTTP client that AgentBrew uses for pack operations.
Each store is tagged `claude-project-memory` and `project:<slug>`, so all
primary agents search the same managed daemon while Claude remains the only
local-file source.

Normal syncs use ledger fingerprints to skip unchanged stores; `--force` is
the deliberate recovery path when a full re-ingest is needed. Each new record
also carries a stable `project-source:sha256:…` tag. The readable
`project:<slug>` tag remains a hint and can collide. Recall remains global by
default; callers can use the source tag when they intentionally need a
project-scoped query.

The command is safe for the daily Dotfiles job and delivery automation.

Daemon failures are reported as skipped stores and still exit zero. It stores
only hashed file-tree fingerprints, counts, timestamps, and bounded scheduler
outcomes in local AgentBrew state; memory text and source paths stay out of
that evidence.

Use `--check` when a caller needs a non-zero result for changed
or unsynced stores. The managed Claude Code `SessionEnd` hook records a
non-blocking receipt and debounces only after a successful run, so a failed
child is retried by the next session. The daily job remains the recovery path.

The ledger lives at `$XDG_STATE_HOME/agentbrew/memory-project-sync.json`
(`~/.local/state` when `XDG_STATE_HOME` is unset or empty). Runs that overlap,
such as the daily job and a `SessionEnd` hook, take a short lock and merge
their results, so neither run loses the other's stores.

`agentbrew memory doctor` reports project-sync drift as an advisory and keeps
startup readiness separate. `agentbrew memory transport-report --json` records
the loopback, legacy session, Origin, unauthenticated-access, timeout, and
five-primary-agent evidence needed before changing transport authentication or
protocol behavior. It does not change the running daemon or agent
configuration.

## Drift detection

A background scheduler (LaunchAgent / systemd / cron) runs `agentbrew fix` every 30 minutes. If an agent update or manual edit breaks your config, it auto-repairs. The same tick does these MCP checks:

- It probes stdio and URL MCP servers through initialization plus `tools/list`. Each distinct server spec starts once, however many agents list it.
- It uses catalog-defined read-only `smokeCall` metadata, except for entries marked `probe: fast`, to avoid side-effectful scheduler probes.
- It attempts registered heal actions for common failures.
- It does not try futile heals on catalog-documented known-broken failures, but keeps them visible in `~/.cache/agentbrew/mcp-health.json`.
- It shows unresolved MCP failures in `agentbrew status`.
- It adds a "Repair MCP health failure" task for each unresolved failure to the `TASKS.md` in the current folder, or to the file named in `AGENTBREW_FOLLOWUP_TASKS_FILE`. With neither, it writes no task.

A heal counts only when the server passes the re-probe. Only failed servers with a heal attempt are re-probed, plus, after a sync heal, other failures that were not suppressed or deferred. A suppressed or deferred server starts once per tick.

Each pair keeps its last 20 heal attempts plus a total count, so the file stays small; `agentbrew status --verbose` shows the total for each pair whose history was trimmed. A server that rejects its credential or is logged out shows as `MCP login` with its login command, not as failing. A server with no ok probe for more than 24 hours becomes `mcp-stale` drift, so `agentbrew status --ci` fails on a real outage but not on a short timeout while the machine is busy.

When load per core is above 1.0, the tick does not heal timeouts. The snapshot marks each one with `healDeferred` (time and reason), and `agentbrew status` shows it as `MCP heal: N deferred`. On macOS, LaunchAgent repair uses the active Dotfiles source from its managed `~/.config/dotfiles/env.sh` file, and falls back to `DOTFILES_DIR` only when that file names no existing checkout.

A caller's shell (for example an agent shell pointing `DOTFILES_DIR` at a development checkout) never changes a plist. It accepts Dotfiles' secure shim-first PATH repair, so a Chezmoi worktree is not replaced with a guessed checkout. It also adds `LANG=C.UTF-8` to any `com.agentbrew.*` LaunchAgent without a locale, because launchd sets none and the Dotfiles `awk` shim (Homebrew gawk) then fails unanchored regex matches.

Repair rewrites the plist and reloads it; a job you disabled stays disabled. To repair manually:

```bash
agentbrew status               # configured + drift summary
agentbrew status --fix         # detailed drift check + auto-repair
agentbrew status --ci          # exit 1 on drift (CI-friendly)
agentbrew status --ci --ignore-session-env  # for health checks run by an agent
```

**Agent-session env.** `env-hygiene` drift flags vars such as `CLAUDECODE` that leak into child agent sessions. An agent session (for example Claude Code) sets `CLAUDECODE` in its own child processes. So when an agent runs `agentbrew status`, `CLAUDECODE` is in the process env, but that is not machine drift. If the caller is an agent session (`CLAUDECODE` set and no tty), or you pass `--ignore-session-env`, status prints it as a `warning:` line and does not count it as drift. If a shell startup file (`~/.zshrc`, `~/.zprofile`, `~/.bashrc`, and similar) exports `CLAUDECODE`, it is still drift: that file leaks the var into every session.

Every drift item ends with its fix (`— fix: <command>`). Each sync, scheduled repair, and error also adds one content-free line to `~/.local/share/agentbrew/logs/events.jsonl` (`AGENTBREW_EVENTS=0` turns it off). Nothing leaves the machine unless you opt in by setting a PostHog key: then `agentbrew telemetry` sends these same lines once a day as anonymous counts (`agentbrew telemetry status`, `off`, `send --dry-run`; `DO_NOT_TRACK=1` also stops it). See [`docs/observability.md`](docs/observability.md).

When the global CLI runs from a git checkout (for example after `npm link`), `agentbrew status` also checks that its `dist/` is current. Each build writes `dist/build-info.json` with the commit it came from. If the checkout later moved to a commit that changes `src/`, `templates/`, `package.json`, `package-lock.json`, or `tsup.config.ts`, status reports `CLI build: stale` with the rebuild command. `agentbrew status --fix` rebuilds in place.

The `Auto-repair` line in `agentbrew status` shows what the scheduler really does, not only whether its file exists. It says `active` only after a successful run in the last 90 minutes. Other states:

- `not running` — the LaunchAgent plist or systemd timer exists, but launchd or systemd has not loaded it.
- `disabled` — launchd has the job disabled (for example, by an endpoint safe mode). `agentbrew auto-sync install` cannot load it until `launchctl enable gui/$UID/com.agentbrew.check` clears the flag. Do that only if the job was not disabled on purpose.
- `broken` — the job points at a program that no longer exists, such as a deleted `dist/cli.js` or a Node that `brew cleanup` removed. `agentbrew auto-sync status` names the missing program too.
- `stale` — the last run is older than 90 minutes.
- `failing` — the last run exited with an error. The line names the exit code and the log file.
- `not run yet` or `unverified` — no run history exists yet, or agentbrew cannot read it (Windows Task Scheduler).

Run `agentbrew auto-sync install` to reinstall and reload the job. On macOS, agentbrew reads the job state from `launchctl print` and the last-run time from the job's log files. launchd, the user crontab, and the systemd user manager are per user, not per `HOME`.

Say `HOME` is not your home folder (a scratch `HOME` in a test or a sandbox). Then agentbrew never loads, unloads, enables, or restarts a launchd job. It never writes your crontab and never runs a changing `systemctl --user` command.

So your real jobs are untouched. Read-only checks such as `crontab -l` and `launchctl print` still run, so `status` shows your real jobs.

`auto-sync install` still writes its plist under that `HOME`; `memory enable` skips its plists. `agentbrew status --json` includes the same data in `autoRepair`.

**Which Node the job runs.** `agentbrew auto-sync install` and `agentbrew memory fix` (for the nightly memory maintenance job) write a Node path that survives a Node upgrade. They use, in order:

1. `AGENTBREW_NODE_BIN`, as written (links are not resolved), when it is a Node that runs. Use it to pick a Node on purpose, for example one your machine allows in background jobs. agentbrew also writes it into the job's environment, so a later rewrite from inside the job keeps it.
2. A link to the running Node that package managers keep current: the Homebrew keg link `<prefix>/opt/<formula>/bin/node`, fnm's `<fnm dir>/aliases/default/bin/node`, then `/opt/homebrew/bin/node` or `/usr/local/bin/node`. Node reports its own path with all links resolved, which on Homebrew is the versioned `Cellar` folder that `brew cleanup` deletes after `brew upgrade node`.
3. The running Node's own path (for example an nvm folder, or an fnm folder that is not the default). A job on fnm's `default` follows that alias when you move it.

The job's `PATH` starts with that Node's folder. When `agentbrew fix` rewrites the plist from inside the job itself, it does not unload the running job (that would kill it before the reload). It writes the plist, and a detached shell reloads the job after the run ends. An unchanged plist is not reloaded.

`agentbrew status` reports `launchagent` drift for a `com.agentbrew.*` job that runs Node in two cases. The job's Node no longer exists, or the job runs a versioned path while a link that survives upgrades points at the same Node. The repair for the memory job is `agentbrew memory fix`. `agentbrew fix` (the check job) or `agentbrew memory fix` (the memory job, reported as `memory-launchagent` drift) then rewrites the plist, so an existing job moves to the stable path on its next run.

### MCP endpoint repair

**Catalog version pins.** The catalog can pin an npm MCP package to an exact version (for example `tasks-mcp@0.10.2`). Then every sync rewrites to that version a floating copy in an agent's config (`tasks-mcp`, `tasks-mcp@latest`) and any exact pin older than the catalog's. An exact pin newer than the catalog's, a range, or a tag stays as you set it. To keep an older version, remove the server from agentbrew and manage it in that agent's own config.

Sync changes only agents agentbrew manages (detected). For an agent it does not manage, such as VS Code Copilot without `~/.copilot`, `agentbrew status` prints an `Outdated pin` line with the exact one-line edit, and `status --json` lists it under `unmanagedOutdatedPins`; neither counts as drift.

Every `agentbrew sync` sweeps each agent's JSON MCP config — the global block
and every per-project block, including Claude Code's `projects.<path>.mcpServers`
overrides — and applies three idempotent repairs:

| Repair | What it fixes |
|--------|---------------|
| Prune unresolvable command | An entry whose absolute command or script path no longer exists, typically a deleted checkout. Servers agentbrew state owns are never pruned this way. |
| Inject corporate CA | A server launched through `uv`, `uvx`, `pipx`, or `pip`, or proxied by `mcpm`, behind a TLS-inspecting proxy. Adds `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE`, and `UV_NATIVE_TLS=1`. Node runners are unaffected. |
| Withdraw quarantined | An endpoint marked unusable in state — see below. |

Set `AGENTBREW_CA_BUNDLE` to override CA discovery. The probe additionally
installs the same bundle into its own process at runtime, so a remote HTTPS MCP
is not reported as an outage just because Node ignores the system keychain.

### Remote HTTPS MCPs bypass mcpm

A server whose `url` is HTTPS on a non-loopback host is written natively into
every client's config, including the mcpm-managed intersection clients, and any
leftover `mcpm_<name>` wrapper is removed. Two reasons, either sufficient:

- **OAuth belongs to the client.** Remote MCPs such as Figma authenticate per
  client and keep the token in that client's own credential store. mcpm cannot
  run the consent flow on the client's behalf, so a proxied entry never becomes
  authorized.
- **mcpm's TLS stack is Python.** Behind a TLS-inspecting proxy, Python 3.13
  verifies strictly and rejects the corporate root with `CERTIFICATE_VERIFY_FAILED:
  Basic Constraints of CA cert not marked critical`, which no CA-bundle env var
  works around.

Loopback URLs are unaffected — local bridges keep flowing through mcpm.

Codex gets the remote entry under `[mcp_servers.<name>]` in
`~/.codex/config.toml`, with only the fields Codex accepts next to `url`:
literal headers go to `http_headers`, a `${VAR}` header to `env_http_headers`,
and `Authorization: Bearer ${VAR}` to `bearer_token_env_var`. Run
`codex mcp login <name>` once for an OAuth server. Goose (YAML) is still
read-only, so `agentbrew sync` reports a write error for goose on this path.

### Servers the probe cannot authenticate

`agentbrew`'s probe is unauthenticated by design, so a server that requires
per-client OAuth can never return `ok` no matter how healthy it is. Declare that
in the catalog with `probeSuppression` (`statuses`, `reason`, `retryPolicy`) and
the entry is kept out of the unhealthy count, skipped by the heal loop, and
excused from the `smokeCall` lint rule. `agentbrew status` stays honest about
everything else.

### Quarantining an unusable endpoint

Some endpoints cannot be repaired from this machine: a service that
authenticates the user and then denies authorization, a decommissioned host, an
entitlement only its owning team can grant. Left in place, one such endpoint
reports a failed MCP connection in every agent on every launch, which buries
the failures that are actionable.

Add a `quarantine` block to the server in `state.yaml` to keep the definition
and its evidence while holding it out of every agent config and out of mcpm:

```yaml
mcpServers:
  - name: some-remote-mcp
    url: https://example.internal/mcp
    quarantine:
      reason: gateway returns 403 for an authenticated user
      since: '2026-01-01T00:00:00.000Z'
      owner: platform-team
      evidence: 'trace 1-abc; unsubscribed in the internal MCP marketplace'
```

Every sync then reports one line naming the server, the reason, and the owner
who can lift the block. Remove the block once the endpoint works again.

## Context budget measurement

Two planes — **static** (always-on rules/skills/MCP inventory) and **runtime** (Claude session usage). Automated snapshots land in `~/.config/agentbrew/metrics/` so future agent sessions can investigate without manual setup.

```bash
agentbrew measure context          # refresh latest.json + dated history
npm run measure:context            # same, from agentbrew repo dev tree
bash scripts/measure-context-budget.sh   # cron/launchd wrapper
agentbrew lint                     # actionable static failures (duplicate headings, section budgets)
bunx ccusage claude daily --json   # optional Claude runtime (skipped gracefully if missing)
```

**What gets captured:**

- projected deployed rules tokens and soft-token headroom
- `alerts[]` (low headroom / over-threshold)
- top H2 sections from shared-rules, and the shared-rules byte count
- agent/MCP/skill/command inventory from `agentbrew status`
- optional ccusage daily JSON with `runtime.ccusage.today` rollup
- optional openusage daily JSON with `runtime.openusage.today` rollup

 The `deployed` block splits the real Claude Code rules file (`~/.claude/CLAUDE.md`) by its agentbrew markers: agentbrew instructions, personal text outside the markers, shared rules, catalog rules, and team rules.

It gives each source's share and lists any long line that appears in two sources, so you can see what to move into a skill or keep in one place. The `lintPassed`, `lintErrors`, and `lintWarnings` fields, like the `Config:` line in `agentbrew status`, use the same checks and counts as `agentbrew lint`, in every mode.

**What stays native, and why.** Runtime usage comes from standard tools: ccusage (Claude) and openusage (multi-provider). agentbrew only runs them and keeps their JSON.

The rest is agentbrew-specific, so no standard tool computes it. The projected size of the deployed rules file (`rules-hygiene.ts`), the top shared-rules sections, the agent/MCP/skill inventory from `agentbrew status`, headroom alerts, and the capture throttle.

**Automatic refresh (throttled):**

| Trigger | Min interval | Mode |
|---------|--------------|------|
| SessionStart hook (`context-budget-measure`, opt-in via hooks overlay `enabled:`) | 6h | background, `--quick` (static-only) |
| `agentbrew sync --pull` post-sync | 24h | inline, static-only |
| Cron/launchd (`scripts/measure-context-budget.sh`) | weekly | full (optional ccusage) |

Skip a scheduled capture: `HOOK_BYPASS_CONTEXT_BUDGET_MEASURE=1`. Force refresh anytime: `agentbrew measure context`.

**Agents:** load the `context-budget` skill (or `templates/rules/context-budget-hygiene.mdc` when deployed) and read `~/.config/agentbrew/metrics/latest.json` before trim work. Weekly cadence: `RECURRING.md` → `context-budget-weekly-audit`.

## Agent time measurement

agentbrew times every Claude Code tool call, so you can see which steps are slow and which slow steps repeat. The `perf-record` hooks (on by default, async, never blocking) append one row per call to `~/.local/state/agentbrew/perf/YYYY-MM.jsonl`. They also log each attempt before a call runs, so `report` counts calls that never ran (a permission prompt, a hook block, a denial) as `blocked`. A row holds only a short step key such as `npm run verify` or `Edit:ts`, never a prompt, a full command, a path, or a secret.

```bash
node ~/.config/agentbrew/scripts/agent-perf.mjs report                 # this project, last 7 days
node ~/.config/agentbrew/scripts/agent-perf.mjs report --all --days 30 --json
node ~/.config/agentbrew/scripts/agent-perf.mjs report --session latest
node ~/.config/agentbrew/scripts/agent-perf.mjs brief                  # 5-line summary for agents
```

At session start, the `perf-brief` hook gives the agent a short brief of the slowest steps. When dotfiles is installed, the `updates-landed` hook also passes on its once-a-day "updates landed, run the checkup" line (`dotfiles-updates-landed`; dotfiles keeps that state), so the agent can suggest the checkup. After a turn with 5 or more minutes of tool time, the opt-in `perf-task-review` Stop hook asks the agent for a short "Time review" once.

`AGENTBREW_PERF_REVIEW_MIN_SECS` changes the threshold. Turn it on by listing it under `enabled:` in `~/.config/agentbrew/hooks-overlay/manifest.yaml`.

The opt-in `poll-loop-hint` hook adds a hint when a Bash command polls with an `until`/`while` loop and `sleep`: run it in the background or use a blocking wait instead. `agentbrew sync` also sets the Claude Code status line to `agent-perf.mjs statusline`, unless you set your own. The `perf-review` skill explains how to read the report; the `session-report` skill covers tokens and cost.

Row schema, privacy rules, hooks, and the full command reference: [`docs/agent-perf.md`](docs/agent-perf.md).

### One local metrics report

`agentbrew metrics` puts agent tool time, hook blocks and warnings, and MCP health from the last 7 days in one report. It reads only local logs and uploads nothing. `--days N` changes the window, and `--json` prints raw numbers.

`agentbrew metrics --share metrics.md` writes an aggregate-only Markdown snapshot to attach to an issue or PR. The snapshot has no project names, paths, session ids, prompts, hook reasons, MCP server names, or hook ids from private overlays.

`agentbrew metrics share` is an opt-in weekly share of aggregate numbers only. The first run is a dry run that prints the exact payload. Pick a sink with `--sink dir:<path>`, `--sink git:<path>`, or `--sink none`; the base install has no default sink (an org overlay can set `AGENTBREW_METRICS_SINK`).

`--schedule weekly` sends once a week from the auto-repair scheduler. `AGENTBREW_EVENTS=0` turns it all off. Details: [`docs/observability.md`](docs/observability.md#weekly-metrics-share-opt-in).

## Share config across a team

Commit an `Agentfile.yaml` to a git repo; teammates clone it and symlink it as their global Agentfile.

```bash
# Each teammate:
git clone https://github.com/acme/agent-config ~/.config/agentbrew/team
ln -sf ~/.config/agentbrew/team/Agentfile.yaml ~/.config/agentbrew/Agentfile.yaml
agentbrew sync
```

Updates flow through git: `(cd ~/.config/agentbrew/team && git pull) && agentbrew sync`. CI-friendly verification: `agentbrew status --ci` (exit 1 on drift).

Or share without git: `agentbrew export -o my-setup.yaml` → teammate runs `agentbrew import --bundle my-setup.yaml`.

## Company plugins

A company gives every engineer its private agent setup as a signed plugin ([#208](https://github.com/fyodoriv/agentbrew/issues/208)). A plugin is a git repo with `agentbrew-plugin.yaml` at its root. The schema is `src/plugins/agentbrew-plugin.schema.json`; unknown keys are refused.

<!-- runnable: false reason="needs a reachable, signed plugin repo" -->
```bash
agentbrew plugin add git@git.example.com:acme/agentbrew-acme.git@v1.0.0 --signer "ssh-ed25519 AAAA..."   # shows capabilities and signer, asks once
agentbrew plugin list
agentbrew plugin trust acme --signer "ssh-ed25519 BBBB..."            # add a signer (key rotation); --revoke removes one
agentbrew plugin update acme v1.1.0                                    # diff, then apply on confirm
agentbrew plugin rollback acme                                         # re-pin the previous lock entry
agentbrew plugin remove acme
```

- The ref must be an annotated tag with an SSH signature (`git tag -s` with `gpg.format=ssh`). Lightweight or unsigned tags are refused.
- agentbrew fetches exactly `refs/tags/<ref>`, so a branch with the same name never wins. It verifies that one tag object and installs its commit. It refuses a name that looks like a 40- or 64-hex object ID. It also refuses a signed tag object whose own name differs from `<ref>` (an old release published under a new name). Only an SSH signature counts. An OpenPGP or X.509 signature is refused, even from a key in your gpg keyring, and so is a tag message with any other line that starts with `-----BEGIN `. Nothing is checked out until the signature passes. This holds for `add`, `update`, and `rollback`.
- Trusted signers live in one file shared with dotfiles: `~/.config/agent-plugins/allowed_signers` (or `$AGENT_PLUGINS_ALLOWED_SIGNERS`), in git's `gpg.ssh.allowedSignersFile` format. The principal is the plugin name, so a key trusted for one plugin is not trusted for another.
- Capabilities are deny by default. Each rule needs its agents in `capabilities.agents` (front matter `agents:`, or any declared agent), each hook event in `capabilities.hooks` (`Event` or `Event:matcher`), each MCP server in `capabilities.mcp_servers`, and a command that runs shell (`allowed-tools: Bash` or `` !`cmd` ``) needs `commands_exec: true`. Anything else fails with exit code 3 and `capability not declared: <kind> <value> (plugin <name>)`, on `plugin add` and on `sync`.
- Claude Code also gets native output, side by side with file rendering. Each plugin becomes a Claude Code plugin in a local marketplace (`~/.local/share/agentbrew/claude-marketplace`), enabled in `~/.claude/settings.json` (`extraKnownMarketplaces`, `enabledPlugins`). The native plugin carries the plugin's hooks and a `SessionStart` hook that runs `agentbrew plugin rules` for the session's repo. Removing a plugin removes both on the next sync. `plugin add`, `update`, `rollback`, and `remove` refresh the native plugin at once, so a hook a new version adds is on without waiting for the next sync.
- Plugin MCP servers (`contributes.mcp_servers`, a YAML list of `{name, command, args, env}`) name every env value as a reference: `env:<NAME>`, `keychain:<item>` (macOS `security`, else `secret-tool`), or `op://...`. Literal values are refused. `npx`/`bunx`/`pnpx` packages must be `pkg@1.2.3`, and `uvx`/`pipx` packages `pkg==1.2.3`; `@latest` or no version is refused. agentbrew writes one launcher per server under `~/.local/share/agentbrew/launchers/` that resolves the references at process start, and the native Claude Code plugin's `.mcp.json` names only the launcher. Other agents do not get plugin MCP servers yet.
- `plugin update <name> <signed-tag>` verifies the new tag and prints a diff of rules (with text diffs), skills, MCP servers, hooks, and capabilities. It applies nothing until you confirm (`--yes` skips that prompt). A capability change always asks at the terminal, even with `--yes`, and is refused without a terminal. The replaced version stays available to `plugin rollback`.
- Authoring: `agentbrew plugin new <dir> --name <name>` scaffolds a plugin repo; `agentbrew plugin test [dir]` runs the core's static checks (schema, capabilities, MCP secrets and pins, leak patterns) and exits 1 on any problem. `agentbrew plugin migrate <overlay-dir>` prints a draft `agentbrew-plugin.yaml` from a legacy team overlay plus a list of what it could not map. None of them installs anything.
- `agentbrew plugin leak-audit [--cwd <dir>]` checks tracked files against every installed plugin's `contributes.leak_patterns` (a YAML list of regexes, kept inside POSIX ERE). It prints file and line only, exits 1 on a match, and exits 2 (fail closed) when a plugin's patterns cannot be read. It runs in `npm run verify`. Sync also hands the patterns to the perf log hook, which records a matching project name as `redacted`.
- `agentbrew plugin policy <name> [--strict]` prints a managed-settings fragment for admins: the marketplace in `extraKnownMarketplaces` and `strictKnownMarketplaces`, the plugin in `enabledPlugins`, and with `--strict` also `strictPluginOnlyCustomization`. agentbrew never writes system policy.
- Revoking the signer of an installed plugin makes `agentbrew sync` fail closed until you roll back or re-add the plugin.

- `plugin add` needs a ref. It fetches the tag to `~/.local/share/agentbrew/plugins/<name>`, validates the manifest, and runs no plugin code. It fetches once and installs the exact checkout it showed for approval, even if the tag moves while you answer.
- It records the commit, tree hash, and capabilities hash under `plugins:` in `agentbrew.lock`.
- `agentbrew sync` fails closed when a plugin checkout differs from its lock entry, including an uncommitted change.
- On every `agentbrew sync`, skills and commands are read straight from the locked plugin checkout; nothing is copied into `shared-rules.md` or `state.yaml`, and removing a plugin removes them on the next sync. A plugin that drifted from its lock contributes nothing.
- Plugin rules are repo-scoped and never written to global rules files. `agentbrew plugin rules --agent <name> [--cwd <dir>]` prints the rules for one agent in one checkout. The repo is the checkout's `origin` remote as `host/path`. It must match `capabilities.repos.include` and not `exclude`; the default is nowhere. Public hosts (`github.com`, `gitlab.com`, `bitbucket.org`, `codeberg.org`) are excluded unless an include pattern names that host. Agents without a session-start hook get no plugin rules.

## Migrating from team overlays (1.0)

agentbrew 1.0 removed `agentbrew team set|unset|status` and the overlay `catalog-overlay.yaml` merge. Running `agentbrew team ...` now prints the steps below and exits 1. To move an overlay to a plugin:

<!-- runnable: false reason="needs a legacy overlay checkout and a signed plugin repo" -->
```bash
agentbrew plugin migrate ~/path/to/agentbrew-your-org   # prints a draft agentbrew-plugin.yaml + what it could not map
agentbrew plugin test ~/path/to/agentbrew-your-org      # fix every problem it lists
git -C ~/path/to/agentbrew-your-org tag -s v1.0.0 -m v1.0.0 && git -C ~/path/to/agentbrew-your-org push --tags
agentbrew plugin add git@github.example.com:your-org/agentbrew-your-org.git@v1.0.0 --signer "ssh-ed25519 AAAA..."
```

What does not carry over on its own:

- remote `sources:` (add them to the catalog)
- overlay MCP entries (write `mcp/servers.yaml` with secret references and pinned versions)
- executable MCP-format adapters and overlay agent definitions (not supported; agentbrew no longer loads plugin code)
- detect scripts, and the overlay catalog merge

 An old `team:` block in `state.yaml` is ignored.

`agentbrew sync` soft-updates **agentbrew-managed skill sources** (catalog and global Agentfile `origin: global`) when their cache is older than 30 minutes, then re-copies any installed skills from the refreshed cache before deploying symlinks. User-, project-, and agentfile-added sources refresh only on explicit `agentbrew sync --pull`. Within the TTL window, plain `sync` stays quiet (no network).

Offline or auth failures print a one-line warning and fall back to the cached copy; `sync` never crashes on a transient refresh error. `agentbrew status --verbose` labels managed sources as **always-fresh on sync**. Force a fresh pull of every source with `agentbrew sync --pull`.

## Supported agents

> Cursor and Grok support was removed on purpose on 2026-10-19, because the author is certain that the companies behind these tools support war crimes in Ukraine. This is the author’s position. Please do not add support for these tools back. Slava Ukraini!

<!-- agent-matrix:start -->
### Sync surfaces per agent

Each column is a sync module. ✓ means `agentbrew sync` writes to that surface for that agent; — means the module is skipped because the agent has no matching config path.

| Agent | Skills | MCP | Rules | Commands | Agents | Hooks |
|---|---|---|---|---|---|---|
| amp | ✓ | ✓ | ✓ | ✓ | — | — |
| augment | ✓ | — | ✓ | — | — | — |
| claude-code | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| claude-desktop | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| cline | ✓ | ✓ | ✓ | — | — | — |
| codex | ✓ | ✓ | ✓ | — | ✓ | — |
| copilot | ✓ | ✓ | ✓ | — | — | — |
| firebender | ✓ | — | ✓ | ✓ | — | — |
| gemini-cli | ✓ | ✓ | ✓ | ✓ | — | — |
| goose | ✓ | ✓ | ✓ | — | — | — |
| kilo | ✓ | — | ✓ | — | — | — |
| kiro | ✓ | ✓ | — | — | — | — |
| opencode | ✓ | ✓ | — | ✓ | — | — |
| roo-code | ✓ | ✓ | ✓ | — | — | — |

### SKILL.md feature support

Sourced from [vercel-labs/skills README](https://github.com/vercel-labs/skills#compatibility). A skill that declares a feature its target agent does not support is skipped during sync.

| Agent | allowed-tools | context-fork | hooks |
|---|---|---|---|
| amp | ✓ | — | — |
| augment | ✓ | — | — |
| claude-code | ✓ | ✓ | ✓ |
| claude-desktop | ✓ | — | — |
| cline | ✓ | — | ✓ |
| codex | ✓ | — | — |
| copilot | ✓ | — | — |
| firebender | ✓ | — | — |
| gemini-cli | ✓ | — | — |
| goose | ✓ | — | — |
| kilo | ✓ | — | — |
| kiro | — | — | ✓ |
| opencode | ✓ | — | — |
| roo-code | ✓ | — | — |

Skills-only agents are experimental. Sync only writes to their `skillsDir`, and they are not tested on real user machines beyond the author's. They are: `adal`, `aider-desk`, `antigravity`, `bob`, `codearts-agent`, `codebuddy`, `codemaker`, `codestudio`, `command-code`, `continue`, `cortex`, `crush`, `deepagents`, `dexto`, `droid`, `forgecode`, `iflow-cli`, `junie`, `kimi-cli`, `kode`, `mcpjam`, `mistral-vibe`, `mux`, `neovate`, `openclaw`, `openhands`, `pi`, `pochi`, `qoder`, `qodo`, `qwen-code`, `replit`, `rovodev`, `tabnine-cli`, `trae`, `trae-cn`, `universal`, `warp`, `zencoder`.
<!-- agent-matrix:end -->

## How agentbrew compares

<!-- competition-readme-table:start -->
<!-- Last refreshed: 2026-05-02. Source: docs/competition-snapshot.json; run `npm run docs:competition` after updating it. -->

| | AgentBrew | [skills CLI](https://github.com/vercel-labs/skills) | [MCPM](https://github.com/pathintegral-institute/mcpm.sh) | [ai-rules-sync](https://github.com/lbb00/ai-rules-sync) | [block/ai-rules](https://github.com/block/ai-rules) | [skillfile](https://github.com/eljulians/skillfile) |
|---|---|---|---|---|---|---|
| Skills sync | All agents | 50+ agents | — | 10+ agents | 10+ agents | 8 agents |
| MCP sync | Yes | — | 10+ clients | — | Partial | — |
| Rules sync | Yes | — | — | 10+ agents | 10+ agents | — |
| Commands sync | Yes | — | — | 10+ agents | 10+ agents | — |
| Hooks sync | Yes | — | — | — | — | — |
| Drift detection | Auto (30 min) | — | Manual | — | Manual | — |
| Auto-repair | Yes | — | — | — | — | — |
| Catalog | Curated | skills.sh | mcpm.sh | — | — | 110K+ skills |
| Declarative config | Agentfile | — | — | JSON | Markdown dir | Skillfile |
| Lock file | SHA tracking | Yes (v3) | — | — | — | Yes (SHA + patches) |
| Export/import | Yes | — | — | — | — | — |
<!-- competition-readme-table:end -->

See [docs/COMPETITION.md](docs/COMPETITION.md) for the full analysis. Run `npm run docs:competition` after editing `docs/competition-snapshot.json`.

## CLI reference

```
agentbrew                              The one start command: state, what needs you, Next: command
                                       (auto-init on first run in a terminal; reads only after that)
agentbrew config [--json]              Each setting with its value, source, and allowed values
agentbrew config set <key> <value>     Check one setting and save it to state.yaml
agentbrew actions [--json]             Every action with its arguments and notes (for agents)
agentbrew audit-skills [--json] [--into <repo>]
                                       Local skills/commands no source owns: merge, merge?, or adopt
agentbrew init [--force] [--skip-install] [--skip-sync]
                                       Detect agents + install recommended + sync (idempotent)
                                       --skip-install: no source fetch, no skill installs
agentbrew status [--verbose] [--fix] [--ci] [--json]
                                       Show agents, servers, sources, skills, drift
agentbrew sync [--dry-run] [--no-prune] [--only <modules>] [--rollback]
                                       Deploy + repair drift (prunes by default)
agentbrew sync --pull                  Fetch latest from sources, then deploy
agentbrew sync --agentfile <path>      Apply an Agentfile before syncing (dotfiles workflow)
agentbrew sync --workspaces <paths>    Also apply every per-repo Agentfile in these workspaces
agentbrew sync --no-prune --agentfile <path>
                                       Add/update from that Agentfile, keep existing state entries
agentbrew sync --dry-run --agentfile <path>
                                       Preview that Agentfile without changing state

agentbrew install [name]               Install from catalog, npm, source, or folder
agentbrew install @scope/pkg           npm package (auto-detected as MCP)
agentbrew install srv -- <cmd> <args>  Any command as an MCP server
agentbrew install srv -c <cmd> -a <args...>
                                       Same, with flags; a -y after -a stays in the MCP args
agentbrew install srv --url <url>      SSE/HTTP server
agentbrew install --git <url>          MCP server from a git repo
agentbrew install user/repo            GitHub skill repo (adds as a source)
agentbrew bootstrap <source>           Run a source-declared bootstrap script
agentbrew remove [name]                Remove any item (auto-detects type)

agentbrew catalog [--search <term>]    Browse available items
agentbrew lint                         Validate all config files (exit 1 on errors)
agentbrew skills validate [--builtins] [--verbose]
                                       Check SKILL.md frontmatter and body (exit 1 on errors)
agentbrew skills coverage [--builtins] [--ci]
                                       Report skill structural and eval test coverage
agentbrew rules dedupe                 Remove repeated blocks from shared-rules.md
agentbrew import [--from <agent>]      Discover MCP servers from agent configs
                                       (mcpm bridge `mcpm_*` entries are
                                       mcpm-managed — excluded from unmanaged noise)
agentbrew export [-o file]             Export portable config bundle
agentbrew setup [server]               Configure API keys for MCP servers
agentbrew setup --all [--yes] [--dry-run] [--force] [--dir <dir>]
                                       Multi-repo setup chain: sync, dotfiles,
                                       careerbrew, audit-skills; skips done steps,
                                       keeps going after a failure, lists failures.
                                       Reuses a checkout found on PATH or under
                                       --dir (default ~/apps, depth 2) before cloning
                                       Done steps: ~/.local/state/agentbrew/setup-all.json
                                       (delete it or pass --force to rerun all)

agentbrew plugin <subcommand>          Manage signed company plugins
agentbrew hook install --shell         Install shell hook for project detection
agentbrew upgrade [--check]            Check for / install CLI updates
agentbrew env {check|sanitize}         Review env vars that could leak across sessions
agentbrew completions                  Shell completions (bash, zsh, fish)
agentbrew metrics [--days N] [--json] [--share [file]]
agentbrew metrics share [--dry-run] [--send] [--sink dir:<path>|git:<path>|none] [--schedule weekly|off]
                                       Local agent time, hook, and MCP metrics;
                                       --share writes a privacy-safe snapshot
agentbrew contribute [--dry-run] [--title <t> --body-file <f>] [--draft]
                                       Open a PR from this branch upstream
                                       (forks the repo when you lack push access)
agentbrew report --title <t> --body-file <f> [--repo <owner/name>] [--yes] [--dry-run]
agentbrew report --off | --on
                                       Draft an issue for a tool's repo: scrub private
                                       details, show the exact text, post only with --yes
                                       (see CONTRIBUTING.md "Report problems and ideas")
agentbrew classify <repo-path>         Classify a repo as solo or shared (downstream
                                       safety-rail input — minsky, etc.)
                                       Override file: ~/.config/agentbrew/repo-class.yaml
```

`agentbrew --help` shows all commands grouped by category. `agentbrew actions` lists the same commands for agents, generated from the CLI parser, so a new command appears there by itself. When you add one that needs the user's own terminal (an interactive prompt, a foreground loop) or is hard to undo, add it to `TERMINAL_ONLY` or `CONFIRM` in `src/actions.ts`.

A hidden command needs a reason in `NOT_ACTIONS`. Some commands are scheduled for deletion — see [docs/VISION.md § "Shipped — being removed"](docs/VISION.md#shipped--being-removed) and [TASKS.md](TASKS.md).

`agentbrew lint` also guards instruction/rules bloat. See `docs/agent-bloat-lint.md`. It checks:

- duplicate `##` headings
- repeated subsection markers inside one shared-rules section
- sections above the shared-rules token budget
- deployed rules files projected above the 40k-character budget
- built-in skill token/line budgets (with regression vs `docs/skill-baselines.json`)
- command size caps, and `.mdc` rule template scope/size checks

## Status and roadmap

Three documents live next to each other and should be read together:

- [**docs/VISION.md**](docs/VISION.md) — what agentbrew is, the delegate→contribute→absorb strategy, and the lifecycle state of every capability (shipped-and-staying / shipped-being-removed / planned / not-building).
- [**TASKS.md**](TASKS.md) — the queue. **P0** = deletion, delegation, or absorption (shrinks toward the ~5–7K-LOC minimum-viable orchestrator). **P1** = bug fixes and clarity. **P2** = life improvements. **P3** = blocked by policy — upstream contributions waiting on maintainers and long-tail research; `/next-task` must ask before claiming.
- [**docs/competition/vercel-skills-cli-vs-agentbrew.md**](docs/competition/vercel-skills-cli-vs-agentbrew.md) — deep comparison with the upstream tool we delegate to most. It covers the gaps we plan to absorb and the PRs we plan to engage with.

Every new-feature PR must answer *"why is this in agentbrew instead of skills CLI / mcpm.sh / block-ai-rules / caliber?"* The accepted answers live in VISION's Strategy section.

## Configuration layout

AgentBrew has two config files:

| | **Agentfile** | **state.yaml** |
|---|---|---|
| Path | `~/.config/agentbrew/Agentfile.yaml` (global) or `./Agentfile.yaml` (project) | `~/.config/agentbrew/state.yaml` |
| Contents | What you want: MCP servers, skills, sources, rules | What agentbrew discovered: detected agents, resolved paths, source metadata |
| Edit by hand | Yes | No — agentbrew manages this |
| Commit to git | **Yes** — this is your portable config | **No** — machine-specific cache, regenerates from `init` |

## Development

```bash
bash scripts/worktree-deps.sh          # install deps; no-op when package-lock.json is unchanged
npm run dev -- status                  # run the CLI from source
npm test                               # Vitest tests related to the diff (inner loop)
npm run test:all                       # full Vitest suite
npm run typecheck && npm run lint      # tsc + biome + lint guards
npm run lint:changed                   # biome on changed files only (inner loop)
npm run verify:changed                 # inner-loop gate: only the checks the diff can break
npm run verify                         # full gate: build smoke + typecheck + lint + tests
npm run build                          # deps drift guard + tsup → dist/ + CLI smoke
npm run verify:build-pipeline          # npm ls + build + dist/cli.js --version
npm run lint:rules                     # Minsky rule checks on this repo (part of verify)
```

`npm run lint:rules` runs Minsky's deterministic rule checks (`scripts/check-rule-*.mjs`) against this repo through `src/adapters/rule-lint.minsky.ts`, instead of reimplementing them. It finds Minsky at `AGENTBREW_MINSKY_DIR` or `~/apps/tooling/minsky`. Without a checkout, or with one too old for `--repo`, each rule is skipped, not failed.

Rule 9 requires Hypothesis, Success/Acceptance, Pivot, Measurement, and Anchor on every `- **ID**:` task block, with no grandfathered tasks; `npm run verify` also runs `@tasks-md/lint --require-prereg` on `TASKS.md`. Minsky has no script for rules 8 and 16, so two local checks run in `npm run verify`. `scripts/check-rule-8-pattern-conformance.mjs` checks the VISION.md "Pattern conformance index" against each file's `Pattern:` comment, and `scripts/check-rule-16-defaults.mjs` fails when a CLI flag has no row in `docs/cli-flags-audit.md` saying why it is not the default.

`npm run verify` also runs `scripts/check-rule-3-test-first.mjs`, the test-first half of rule 3. It fails when the branch (committed or not) changes a non-test file under `src/` but changes no test file, unless a commit message on the branch has a `Test exemption: <reason>` line. It compares against `origin/main` (`--base <ref>` or `TEST_FIRST_BASE` to change it) and skips when that ref has no merge base.

`npm run verify` starts with `scripts/check-lockfile-sync.sh`. It runs `npm ci --dry-run` with npm 10 on a temp copy of `package.json` and `package-lock.json`, and fails when they disagree. Newer npm accepts some lockfiles that npm 10 rejects, so a lockfile can pass for you and still break `npm ci` for npm 10 users.

The step is cached until a package file changes. npm 10 comes from the npx cache; with no network and no cache, the check fails in seconds with a clear message. `lefthook.yml` runs the same check on pre-push when a pushed commit touches a package file.

That works only when lefthook installs the repo's hooks. A global `core.hooksPath` that does not call lefthook skips it, and then `npm run verify` is the catch.

### How `main` health is checked

GitHub Actions is off for this repo, so there is no CI badge. `main` is healthy when the local gates pass on it:

1. `npm run verify` is the full gate. Every PR runs it before merge.
2. `npm run checkup` lists your open PRs and unmerged branches first (finish them before new work), then runs the doctor (`agentbrew status --ci`), the cached gate, metrics, and a speed review. It ends with a local HTML page, `.metrics/checkup.html` (the verdict, the blockers, and what to do next). Run it on a fresh `main` checkout after a burst of merges, or monthly.

`npm run lint` and `npm run verify` also fail on repo-root `=...` files, which usually come from unquoted shell package constraints. Quote Python specs in docs or setup commands, for example `pip install 'package>=1.2.3'`.

Agent-facing artifacts are also testable build inputs. The inventory in `src/agent-artifacts/inventory.ts` discovers repo-owned prompts/configuration (`Agentfile.yaml`, `src/catalog.yaml`, `templates/AGENTS.md`, `src/core/agents.yaml`, `hooks/manifest.yaml`, `hooks/checks/*`, built-in skills, and catalog CLI command markdown) and classifies each record as `{ kind, name, sourcePath, targetAgents, risk, coverage }`. Run the static gate when touching those surfaces:

```bash
npm test src/agent-artifacts
bash hooks/checks/gh-pr-agent-artifacts-require-tests.test.sh
```

High-risk artifacts need deterministic tests, behavioral evals, or an exemption reason. The PR-time hook accepts same-PR `*.test.*`, `hooks/checks/*.test.sh`, `agent-artifact-evals/**`, `evals/evals.json`, or `Agent artifact test exemption: <reason>` in the PR body.

`npm run build` fails before `tsup` when `node_modules` has drifted from `package-lock.json`, with the remediation `deps out of sync — run npm ci`. After `tsup`, the postbuild guard runs `node dist/cli.js --version` so CI catches missing or unrunnable CLI output instead of leaving `bin/agentbrew` to fall back to source execution later.

Real e2e scenarios (opt-in; fixture-backed):

```bash
npm run test:real-e2e                  # all scenarios
npm run test:real-e2e:selected -- real-e2e/scenarios/us04-share-rules.test.ts
npm run test:real-e2e:selected -- instructions rules agents hooks mcp
```

Before an npm/public release, run
[`scripts/validate-public-release.sh`](scripts/validate-public-release.sh). It checks
that package metadata points at `github.com/fyodoriv/agentbrew` and that the
publish surface passes the strict no-internal-refs scrub:

```bash
scripts/validate-public-release.sh
```

### Learning a project

Learning a project moved to careerbrew, which keeps study state across days:
spaced reviews, retests, and mastery per section. Use its `learn-project` skill
or the `/careerbrew-learn` command. agentbrew still lists the upstream
`tutor-setup` and `tutor` skills in its catalog.

### Publishing to npm

The `Auto-release` workflow bumps the patch version on `main`, commits `release: vX.Y.Z [skip ci]`, and pushes a tag. It runs on pushes to `main` and on `workflow_dispatch`. GitHub Actions is disabled on `fyodoriv/agentbrew` today, so the workflow does not run. **npm publish is manual** (2FA OTP + maintainer credentials).

```bash
npm login                              # once per machine — npm whoami to verify
npm run publish:latest                 # fetch origin/main, build, publish
npm run publish:latest -- --quick      # skip build when dist/ already matches CI
npm run publish:latest -- --dry-run    # preflight + npm publish --dry-run
npm run publish:latest -- --otp=123456 # required when npm prompts for 2FA
```

The script is worktree-safe: it `git fetch origin main --tags` and syncs `package.json` / lockfile / `src/cli.ts` from `origin/main` without checking out `main`. While publishing, `"private": true` is stripped temporarily and restored on exit (even on failure).

Human-only steps: `npm login`, OTP at publish time, and explicit approval before running the command (see TASKS.md publishing policy).

See [AGENTS.md](AGENTS.md) for repo layout and editing rules.

## License

MIT
