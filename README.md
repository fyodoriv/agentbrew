# agentbrew

[![npm version](https://img.shields.io/npm/v/agentbrew.svg)](https://www.npmjs.com/package/agentbrew)
[![license](https://img.shields.io/npm/l/agentbrew.svg)](LICENSE)

**One CLI that syncs skills, MCP servers, rules, and commands across every AI coding agent on your machine.** Claude Code, Cursor, Windsurf, Devin, Codex, Copilot, Goose, Kiro, Amp, and more — see the agent matrix below. Declarative `Agentfile`, drift detection, auto-repair. On enterprise laptops the `catalog-overlay.yaml` overlay auto-enables for recommended internal skills.

```bash
npx agentbrew              # try it — detects agents, installs recommended set, schedules drift repair
npm install -g agentbrew   # or install globally for faster startup + tab completion
```

Requires Node.js 20.11+ and git.

**First run:** In an interactive terminal, `agentbrew` auto-runs `init` — detects agents, installs recommended items, schedules background drift repair. In CI or pipes, it prints help. Opt out with `AGENTBREW_NO_AUTO_INIT=1`.

## Why agentbrew

Most developers use multiple AI coding tools. Each stores config in its own format (JSON, TOML, YAML, markdown). Add an MCP server: edit several config files. Add a skill: copy into each agent's skill directory. Something breaks silently: nobody notices until a tool stops working.

- **One source of truth, every agent gets it.** Install once, deploy to every agent in its native format. Custom servers get the same treatment as catalog items.
- **Self-healing.** Background drift checks every 30 minutes. If an agent update or manual edit breaks the deployed config, it auto-repairs.
- **Never destroys your data.** Manual edits, user-added servers, custom rules — all survive every sync, update, and auto-repair.
- **Declarative.** Commit an `Agentfile.yaml` to your dotfiles; a fresh machine bootstraps in one command.
- **Curated 200+-item catalog.** Skills from [Vercel](https://github.com/vercel-labs/skills), [Anthropic](https://github.com/anthropics/skills), [obra/superpowers](https://github.com/obra/superpowers), [Every Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin), [gstack](https://github.com/garrytan/gstack), [Supabase](https://github.com/supabase/agent-skills), [Trail of Bits](https://github.com/trailofbits/skills), [slavingia/skills](https://github.com/slavingia/skills), [awesome-design-md](https://github.com/VoltAgent/awesome-design-md) — plus the team overlay when enabled.
- **Rollback is always available.** Every sync snapshots pre-state; `sync --rollback` restores it.

## Install a skill or MCP server

```bash
agentbrew install debug                   # skill from the catalog (every agent)
agentbrew install context7                # live library docs MCP (recommended, all agents)
agentbrew install sourcegraph             # enterprise code search MCP (token + instance URL)
agentbrew install storybook-screenshot    # catalog CLI command + package binary
agentbrew install --recommended           # recommended skills + MCP + rules, in one shot
agentbrew install @anthropic/mcp-proxy    # any npm package (auto-detected as MCP)
agentbrew install sqlite -- uvx mcp-server-sqlite   # any command as an MCP server
agentbrew install api --url https://api.example.com/mcp   # SSE/HTTP transport
agentbrew install --git https://github.com/org/mcp-server  # clone, build, auto-detect entrypoint
agentbrew install vercel-labs/skills      # add a GitHub skill repo as a source
agentbrew remove context7                 # auto-detects type, removes from all agents
agentbrew catalog --search security       # browse + search the catalog
agentbrew skills coverage --builtins      # require in-repo skill eval coverage
```

Adding a source indexes its available skills; it does not deploy every skill from that repo. `sync` deploys skills only after you explicitly install/select them, plus legacy manual `skillSourceDirs` outside tracked source paths that are already treated as opt-in source directories.

In-repo custom skills under `skill-plugins/dev/` must ship a spec-valid `evals/evals.json`. `npm run skills:coverage` is part of `npm run verify` and fails CI when any built-in skill is missing evals, even if aggregate coverage would otherwise meet the threshold.

The bundled `writing-plans` skill produces source-backed plans with explicit
alternatives, dependency-aware work, and versioned host-boundary contracts.
Use `task-command-center` with it when the plan spans a docs hub, Jira, or
multiple repositories. It keeps Jira tasks concise: Jira fields and links own
UI metadata, explicit non-goals stay excluded, and a requested single PR
remains one delivery boundary.

High-risk prompt-like artifacts also have deterministic Promptfoo checks. Use Vitest for structural or pure-helper invariants, Promptfoo evals for policy/behavior drift in prompt-like files, and explicit exemptions only when neither layer fits. Run `npm run eval:agent-artifacts` directly, or see [Testing agent artifacts](docs/testing-agent-artifacts.md).

Source repos can declare one-time setup in `agentbrew-source.yaml`:

```yaml
bootstrap: scripts/bootstrap.sh
```

After adding the source, run `agentbrew bootstrap <source>` to execute the script from that source's local cache. Bootstrap never runs automatically during `install` or `sync`.

**Secrets.** MCP servers that need credentials print per-token instructions after install. The setup wizard fills them in interactively:

```bash
agentbrew install composio                 # deploys Composio Connect MCP (1000+ SaaS apps)
agentbrew setup composio                   # guided wizard → saves to ~/.zshenv.secrets
```

Literal-env agents such as Devin skip servers whose required env vars are missing, so one unconfigured server never prevents the rest of the MCP config from loading. For Devin, `agentbrew sync` omits direct `${VAR}` env mappings instead of writing resolved token values into `~/.config/devin/config.json`; launch Devin from a shell that exports those vars (for example after sourcing `~/.zshenv.secrets`) so stdio MCP servers inherit them at runtime. `agentbrew status` still reports missing env vars until you run `agentbrew setup`.

**Scopes.** `install` is global by default (applies to every agent). Use `--local` / `--project` to install into the current repo's `.agentbrew/skills/` — ideal for project-specific conventions or team-shared skills.

**Delegated skill install networking.** Remote skill sources are installed through Vercel's `skills` CLI for agents it supports. That subprocess may need egress to `registry.npmjs.org` (to resolve the `skills` package), GitHub or the source Git host (to fetch the skill repo), and `skills.sh` (for risk-assessment metadata). If a proxy blocks any of those hosts, configure npm/git proxy settings first; agentbrew will still fall back to its native scanner when the subprocess fails.

Offline installs work only after the npm cache is warm. Before going offline, run `npx --yes skills --version` once (or complete one online `agentbrew install <source>` run) so npm has the package cached. A cold offline run can fail with `ENOTCACHED`; for first-run offline machines, temporarily set the machine-local override in `~/.config/agentbrew/state.yaml` and switch it back to `auto` when online again:

```yaml
skillInstallMode: native
```

#### Fallback failure modes

Every delegation failure prints `Delegated skill install networking` at the top of the error block — that's the anchor to this section. The fallback automatically engages: native registration still runs, the source still lands in `state.sources`, and only the selected skill is marked for deployment through agentbrew's own scan instead of `npx skills add`. The 4 failure modes below cover what the operator typically sees in the wild:

| Symptom | Likely cause | What to do |
|---|---|---|
| `tunneling socket could not be established, statusCode=407` | Corporate HTTP proxy blocked the `registry.npmjs.org` / GitHub egress. | Configure `npm config set proxy` + `git config --global http.proxy`, OR set `skillInstallMode: native` to skip delegation. |
| `connect ETIMEDOUT <ip>:443` | Network egress hangs (firewall drops on the proxy, VPN required for one of the three hosts). | Verify VPN connection, retry. If repeating, switch to `skillInstallMode: native` — see also the [skill-install-fallback section in TASKS.md](TASKS.md). |
| `npm error 404 Not Found - GET https://registry.npmjs.org/<package>` | The `skills` CLI's published package shape changed, OR the source repo's manifest is wrong. | Update agentbrew (`npm install -g agentbrew@latest`). If still 404 after update, file an issue with the failing source URL. |
| `getaddrinfo ENOTFOUND registry.npmjs.org` (or `ENOTCACHED` / `ECONNREFUSED`) | Registry unreachable: cold offline, DNS broken, or first-run-without-cache. | Run `npx --yes skills --version` once online to warm the cache, then offline retries work. For permanently-offline machines, set `skillInstallMode: native`. |

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

defaultModel: claude-opus-5-5    # default model for every agent with a file-managed model setting
defaultEffort: medium            # reasoning effort, for agents that store it separately
modelOverrides:
  codex: null                    # null = skip; keep that agent's own model
  devin: null                    # (a string swaps in that provider's id for the same model)
```

`${VAR}` substitutes from your shell environment at sync time; `${VAR:-default}` provides a fallback. Devin is the exception for direct MCP `env` mappings: agentbrew leaves those secrets out of Devin's generated config and relies on the launching shell environment instead.

```bash
agentbrew init --from-state              # generate an Agentfile from the current setup
agentbrew agentfile merge base.yaml overlay.yaml --output ~/.config/agentbrew/Agentfile.yaml
```

**Global vs. project.** The global Agentfile (`~/.config/agentbrew/Agentfile.yaml`) is authoritative — items you remove from it are removed from state on next sync. The project Agentfile (`./Agentfile.yaml`) is additive — it can add items for that repo but never removes the global config. `install` and `remove` always update the global file (like `npm install` updating `package.json`); pass `--project` for project scope.

Agentfile `commands:` directories are extra source dirs for the same command sync pipeline as `~/.config/agentbrew/commands`; `agentbrew commands list` shows commands from all configured source dirs.

**Default model.** `defaultModel` deploys one model id to every detected agent that has a file-managed model setting: Claude Code (`~/.claude/settings.json` `model`), Devin (`~/.config/devin/config.json` `agent.model`), and Codex (`~/.codex/config.toml` `model`). Cursor and Windsurf keep the model in app-managed/UI state, so there is no file surface to manage. `modelOverrides` handles per-agent differences: a string swaps in that provider's id for the same model; `null` skips the agent (useful when a model isn't available on that agent's provider/gateway yet — drop the override line once it is). `defaultEffort` is written next to the model for agents that keep reasoning effort in its own key: Claude Code (`effortLevel`) and Codex (`model_reasoning_effort`). A skipped agent keeps its own effort too. `agentbrew init` writes the recommended default — `claude-opus-5-5` at `medium` effort, with Codex and Devin skipped — into a new Agentfile unless the machine already has a `defaultModel`. Drift-repair re-applies the default every 30 minutes, so a manually flipped model reverts on the next tick; agents are set-when-present, meaning removing `defaultModel` from the Agentfile stops managing models without rewriting anything.

**Merging overlays.** `agentbrew agentfile merge` builds one normalized Agentfile from multiple inputs. List-like fields (`mcp`, `skills`, `sources`, `commands`, `agents`, `hooks`, `excludeAgents`) merge in file order; duplicate MCP or hook entries keep their original position but use the later definition. `rules` are additive and path-based rules are expanded before writing the merged file. Scalar metadata fields (including `defaultModel` and `defaultEffort`) use the later file; `modelOverrides` merges per agent with the later file winning.

Use `agentbrew sync --dry-run` to validate and preview Agentfile changes, including downstream per-agent sync changes for Agentfile-only MCP servers, sources, commands, agents, rules, and hooks, without updating `state.yaml` or installing anything. Add `--agentfile <path>` to preview an explicit dotfiles Agentfile before making it authoritative.

## Sync

One command translates the source of truth into every agent's native format.

- **MCP servers** → JSON (Cursor, Claude, Windsurf at `~/.codeium/windsurf/mcp_config.json`), TOML (Codex), YAML (Goose); exact definitions are reconciled into mcpm so backend changes cannot leave stale same-name servers
- **MCP permissions** → `permissions.allow` entries for agents that require explicit MCP tool grants (Cursor CLI, Devin)
- **Skills** → symlinks for explicitly installed skills and opt-in source dirs outside tracked sources
- **Rules** → marker-injected sections in each agent's rules file; catalog-owned per-file rules in `templates/rules/` refresh into `~/.config/agentbrew/rules/` on every `agentbrew sync --only rules`, then deploy to Cursor/Windsurf (`browser-tasks.mdc`, `sso-background-work.mdc`, etc.)
- **Commands** → Markdown auto-transformed per agent
- **Hooks** → native hook files (Claude Code settings, Cursor hooks.json, project-local Devin hooks.v1.json)
- **Models** → the Agentfile's `defaultModel` written to each agent's model setting (Claude Code settings.json, Devin config.json, Codex config.toml)
- **Instructions** → one canonical `~/.config/agentbrew/AGENTS.md` (agents.md standard); agents whose `rulesFile` is `AGENTS.md` get a symlink, proprietary filenames (`CLAUDE.md`, `guidelines.md`, `global_rules.md`, `GEMINI.md`) still receive copy+merge with deduplication against managed rules
- **Helper scripts** → the scripts the instructions tell agents to run (`load-project-context.sh`, `verify-vision-trace.sh`, and `competitor-spot-check.sh` from `templates/scripts/`, plus the `scripts/check-pr-vision-trace.mjs` CI gate) install into `~/.config/agentbrew/scripts/`. Sync writes a script only when it is missing or agentbrew wrote it and nobody changed it since. It keeps any other file at that path; `agentbrew sync --verbose` lists the kept copies

### Strict attention-friendly language

Agentbrew requires managed agents to write all agent-authored natural-language
text for an ADHD audience. This rule is always active, including in user-facing
text, docs, prompts, status updates, and code comments.

Agents must put the answer first, use short paragraphs and direct sentences,
keep one idea per sentence or bullet, and use headings, bullets, or numbered
steps when they improve scanning. They must surface blockers and the next
action. Required formats and verbatim code, commands, logs, JSON, and user text
stay unchanged.

```bash
agentbrew sync                  # deploy + prune stale items (the one healing command)
agentbrew sync --pull           # fetch latest from sources first, then deploy
agentbrew sync --dry-run        # preview Agentfile + sync changes without applying
agentbrew sync --only mcp       # sync one surface; installs skills only with --only skills
agentbrew sync --rollback       # restore from last pre-sync snapshot
```

Every sync creates a timestamped snapshot. Pruning only touches entries agentbrew deployed — user-added items are always preserved.

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

The managed endpoint is `http://127.0.0.1:18765/mcp`. Readiness performs the
Streamable HTTP discovery contract in order — `initialize`,
`notifications/initialized`, then `tools/list` — and requires a non-empty tool
set. The probe preserves `MCP-Session-Id` and accepts JSON or SSE responses.
Behavioral bootstrap is enabled with a 1,536-token cap so a fresh agent session
can load relevant durable context. LaunchAgent reconciliation is idempotent: a
normal sync does not restart a healthy unchanged daemon, but configuration
drift is rewritten before MCP fanout.

If `memory fix` recovers or restarts the daemon, its JSON result includes
`cursorReloadRecommended: true` and the human output prints a manual reload
advisory. Fully restart Cursor or use **Developer: Reload Window** yourself;
agentbrew never quits Cursor, kills processes, or edits `~/.cursor/mcp.json`.
Cold login ordering should start memory before the IDE.

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

The command is safe for the daily Dotfiles job and delivery automation:
daemon failures are reported as skipped stores and still exit zero. It stores
only hashed file-tree fingerprints, counts, timestamps, and bounded scheduler
outcomes in local AgentBrew state; memory text and source paths stay out of
that evidence. Use `--check` when a caller needs a non-zero result for changed
or unsynced stores. The managed Claude Code `SessionEnd` hook records a
non-blocking receipt and debounces only after a successful run, so a failed
child is retried by the next session. The daily job remains the recovery path.

`agentbrew memory doctor` reports project-sync drift as an advisory and keeps
startup readiness separate. `agentbrew memory transport-report --json` records
the loopback, legacy session, Origin, unauthenticated-access, timeout, and
five-primary-agent evidence needed before changing transport authentication or
protocol behavior. It does not change the running daemon or agent
configuration.

## Drift detection

A background scheduler (LaunchAgent / systemd / cron) runs `agentbrew fix` every 30 minutes. If an agent update or manual edit breaks your config, it auto-repairs. The same tick probes stdio and URL MCP servers through initialization plus `tools/list` (each distinct server spec starts once, however many agents list it), using catalog-defined read-only `smokeCall` metadata except for entries marked `probe: fast` to avoid side-effectful scheduler probes, attempts registered heal actions for common failures, suppresses catalog-documented known-broken failures from futile heal attempts while keeping them visible in `~/.cache/agentbrew/mcp-health.json`, and surfaces unresolved MCP failures in `agentbrew status`. On macOS, LaunchAgent repair uses the active Dotfiles source from its managed `~/.config/dotfiles/env.sh` file, and falls back to `DOTFILES_DIR` only when that file names no existing checkout. A caller's shell (for example an agent shell pointing `DOTFILES_DIR` at a development checkout) never changes a plist. It accepts Dotfiles' secure shim-first PATH repair, so a Chezmoi worktree is not replaced with a guessed checkout. It also adds `LANG=C.UTF-8` to any `com.agentbrew.*` LaunchAgent without a locale, because launchd sets none and the Dotfiles `awk` shim (Homebrew gawk) then fails unanchored regex matches. Repair rewrites the plist and reloads it; a job you disabled stays disabled. To repair manually:

```bash
agentbrew status               # configured + drift summary
agentbrew status --fix         # detailed drift check + auto-repair
agentbrew status --ci          # exit 1 on drift (CI-friendly)
```

When the global CLI runs from a git checkout (for example after `npm link`), `agentbrew status` also checks that its `dist/` is current. Each build writes `dist/build-info.json` with the commit it came from. If the checkout later moved to a commit that changes `src/`, `templates/`, `package.json`, `package-lock.json`, or `tsup.config.ts`, status reports `CLI build: stale` with the rebuild command. `agentbrew status --fix` rebuilds in place.

The `Auto-repair` line in `agentbrew status` shows what the scheduler really does, not only whether its file exists. It says `active` only after a successful run in the last 90 minutes. Other states:

- `not running` — the LaunchAgent plist or systemd timer exists, but launchd or systemd has not loaded it.
- `disabled` — launchd has the job disabled (for example, by an endpoint safe mode). `agentbrew auto-sync install` cannot load it until `launchctl enable gui/$UID/com.agentbrew.check` clears the flag. Do that only if the job was not disabled on purpose.
- `broken` — the job points at a program that no longer exists, such as a deleted `dist/cli.js`.
- `stale` — the last run is older than 90 minutes.
- `failing` — the last run exited with an error. The line names the exit code and the log file.
- `not run yet` or `unverified` — no run history exists yet, or agentbrew cannot read it (Windows Task Scheduler).

Run `agentbrew auto-sync install` to reinstall and reload the job. On macOS, agentbrew reads the job state from `launchctl print` and the last-run time from the job's log files. `agentbrew status --json` includes the same data in `autoRepair`.

### MCP endpoint repair

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

**Cursor context ring:** no API — append manual readings to `~/.config/agentbrew/metrics/manual-snapshots/` (see `context-budget` skill). **What gets captured:** projected deployed rules tokens, soft-token headroom, `alerts[]` (low headroom / over-threshold), Cursor `.mdc` byte inventory, top H2 sections from shared-rules, shared-rules byte count, agent/MCP/skill/command inventory from `agentbrew status`, optional ccusage daily JSON with `runtime.ccusage.today` rollup, optional tokscale Cursor today JSON, optional openusage daily JSON with `runtime.openusage.today` rollup.

**Automatic refresh (throttled):**

| Trigger | Min interval | Mode |
|---------|--------------|------|
| SessionStart hook (`context-budget-measure`, opt-in via hooks overlay `enabled:`) | 6h | background, `--quick` (static-only) |
| `agentbrew sync --pull` post-sync | 24h | inline, static-only |
| Cron/launchd (`scripts/measure-context-budget.sh`) | weekly | full (optional ccusage) |

Skip a scheduled capture: `HOOK_BYPASS_CONTEXT_BUDGET_MEASURE=1`. Force refresh anytime: `agentbrew measure context`.

**Cursor context ring:** no public API — note IDE ring readings under `~/.config/agentbrew/metrics/manual-snapshots/` when investigating IDE pressure.

**Agents:** load the `context-budget` skill (or `templates/rules/context-budget-hygiene.mdc` when deployed) and read `~/.config/agentbrew/metrics/latest.json` before trim work. Weekly cadence: `RECURRING.md` → `context-budget-weekly-audit`.

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

## Team overlays

agentbrew supports team-level configuration overlays that extend the base catalog with team-specific skills, MCP servers, and rules. An overlay is a git repo (for example `agentbrew-<org>`) with an `Agentfile.yaml` at its root. It can include:

- **Catalog overlay** — org-specific skills and MCP servers from private source repos
- **Environment detection** — optional detect script that fires on signals such as a GitHub Enterprise host in `~/.config/gh/hosts.yml` or org env vars
- **MCP adapters** — support for a custom desktop app's MCP config format

To use a team overlay:

```bash
agentbrew team set git@github.example.com:your-org/agentbrew-your-org.git
agentbrew team sync
agentbrew sync
```

The overlay contains pointers only — skill content lives in the source repos. An overlay can declare whole-repo skill registries in its `repo_sources:` block. `agentbrew team set` auto-registers each one as a tracked source with `origin: team`; `agentbrew team unset` removes them symmetrically while preserving anything you added with `agentbrew install` (origin `user`). `agentbrew catalog --sources` flags team-sourced repos with a `[team]` tag so it's obvious which will disappear on `team unset`.

`agentbrew sync` soft-updates **agentbrew-managed skill sources** (catalog, team overlay `team:<label>`, global Agentfile `origin: global`) when their cache is older than 30 minutes, then re-copies any installed skills from the refreshed cache before deploying symlinks. User-, project-, and agentfile-added sources refresh only on explicit `agentbrew sync --pull`. Within the TTL window, plain `sync` stays quiet (no network). Offline or auth failures print a one-line warning and fall back to the cached copy; `sync` never crashes on a transient refresh error. `agentbrew status --verbose` labels managed sources as **always-fresh on sync**. Force a fresh pull of every source with `agentbrew sync --pull`.

## Supported agents

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
| cursor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| devin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| firebender | ✓ | — | ✓ | ✓ | — | — |
| gemini-cli | ✓ | ✓ | ✓ | ✓ | — | — |
| goose | ✓ | ✓ | ✓ | — | — | — |
| kilo | ✓ | — | ✓ | — | — | — |
| kiro | ✓ | ✓ | — | — | — | — |
| opencode | ✓ | ✓ | — | ✓ | — | — |
| roo-code | ✓ | ✓ | ✓ | — | — | — |
| windsurf | ✓ | ✓ | ✓ | ✓ | — | — |

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
| cursor | ✓ | — | — |
| devin | ✓ | — | — |
| firebender | ✓ | — | — |
| gemini-cli | ✓ | — | — |
| goose | ✓ | — | — |
| kilo | ✓ | — | — |
| kiro | — | — | ✓ |
| opencode | ✓ | — | — |
| roo-code | ✓ | — | — |
| windsurf | ✓ | — | — |

Skills-only (experimental; sync only writes to `skillsDir`; not tested on real user machines beyond the author's): adal, aider-desk, antigravity, bob, codearts-agent, codebuddy, codemaker, codestudio, command-code, continue, cortex, crush, deepagents, dexto, droid, forgecode, iflow-cli, junie, kimi-cli, kode, mcpjam, mistral-vibe, mux, neovate, openclaw, openhands, pi, pochi, qoder, qodo, qwen-code, replit, rovodev, tabnine-cli, trae, trae-cn, universal, warp, zencoder.
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
agentbrew                              Status dashboard (auto-init on first run)
agentbrew init [--force] [--skip-install] [--skip-sync]
                                       Detect agents + install recommended + sync (idempotent)
agentbrew status [--verbose] [--fix] [--ci] [--json]
                                       Show agents, servers, sources, skills, drift
agentbrew sync [--dry-run] [--no-prune] [--only <modules>] [--rollback]
                                       Deploy + repair drift (prunes by default)
agentbrew sync --pull                  Fetch latest from sources, then deploy
agentbrew sync --agentfile <path>      Apply an Agentfile before syncing (dotfiles workflow)
agentbrew sync --dry-run --agentfile <path>
                                       Preview that Agentfile without changing state

agentbrew install [name]               Install from catalog, npm, source, or folder
agentbrew install @scope/pkg           npm package (auto-detected as MCP)
agentbrew install srv -- <cmd> <args>  Any command as an MCP server
agentbrew install srv --url <url>      SSE/HTTP server
agentbrew install --git <url>          MCP server from a git repo
agentbrew install user/repo            GitHub skill repo (adds as a source)
agentbrew bootstrap <source>           Run a source-declared bootstrap script
agentbrew remove [name]                Remove any item (auto-detects type)

agentbrew catalog [--search <term>]    Browse available items
agentbrew lint                         Validate all config files (exit 1 on errors)
agentbrew rules dedupe                 Remove repeated blocks from shared-rules.md
agentbrew import [--from <agent>]      Discover MCP servers from agent configs
                                       (mcpm bridge `mcpm_*` entries are
                                       mcpm-managed — excluded from unmanaged noise)
agentbrew export [-o file]             Export portable config bundle
agentbrew setup [server]               Configure API keys for MCP servers

agentbrew team {set|unset|status}      Manage team overlays
agentbrew hook install --shell         Install shell hook for project detection
agentbrew upgrade [--check]            Check for / install CLI updates
agentbrew env {check|sanitize}         Review env vars that could leak across sessions
agentbrew completions                  Shell completions (bash, zsh, fish)
agentbrew classify <repo-path>         Classify a repo as solo or shared (downstream
                                       safety-rail input — minsky, etc.)
                                       Override file: ~/.config/agentbrew/repo-class.yaml
```

`agentbrew --help` shows all commands grouped by category. Some commands are scheduled for deletion — see [docs/VISION.md § "Shipped — being removed"](docs/VISION.md#shipped--being-removed) and [TASKS.md](TASKS.md).

`agentbrew lint` also guards instruction/rules bloat: duplicate `##` headings, repeated subsection markers inside one shared-rules section, sections above the shared-rules token budget, deployed rules files projected above the 40k-character budget, built-in skill token/line budgets (with regression vs `docs/skill-baselines.json`), command size caps, and Cursor `.mdc` scope/size checks. See `docs/agent-bloat-lint.md`.

## Status and roadmap

Three documents live next to each other and should be read together:

- [**docs/VISION.md**](docs/VISION.md) — what agentbrew is, the delegate→contribute→absorb strategy, and the lifecycle state of every capability (shipped-and-staying / shipped-being-removed / planned / not-building).
- [**TASKS.md**](TASKS.md) — the queue. **P0** = deletion, delegation, or absorption (shrinks toward the ~5–7K-LOC minimum-viable orchestrator). **P1** = bug fixes and clarity. **P2** = life improvements. **P3** = blocked by policy — upstream contributions waiting on maintainers and long-tail research; `/next-task` must ask before claiming.
- [**docs/competition/vercel-skills-cli-vs-agentbrew.md**](docs/competition/vercel-skills-cli-vs-agentbrew.md) — deep comparison with the upstream tool we delegate to most, including the gaps we plan to absorb and the PRs we plan to engage with.

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
npm ci && npm run dev -- status        # clean bootstrap from the committed lockfile
npm test                               # affected Vitest tests (git-aware)
npm run test:all                       # full Vitest suite
npm run typecheck && npm run lint      # tsc + biome + lint guards
npm run verify                         # full gate: build smoke + typecheck + lint + tests
npm run build                          # deps drift guard + tsup → dist/ + CLI smoke
npm run verify:build-pipeline          # npm ls + build + dist/cli.js --version
```

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

### Learn-a-project workflow (tutor me, then quiz me)

**Full user guide:** [`docs/learn-project.md`](docs/learn-project.md) — prerequisites, quick starts, six source types, StudyVault layout, pedagogy, troubleshooting.

The `learn-project` skill is a single entrypoint that teaches you a project and then quizzes you. Say "tutor me on X" / "teach me this project" in Claude Code or Cursor and it will: ensure the upstream teach + quiz skills are installed, detect where prep left off (resumable), ask for any missing inputs, gather sources, stage them, build a grounded StudyVault, verify + teach, then run an adaptive quiz.

It pulls **six source types** into one grounded StudyVault: local folders/repos, remote enterprise repos + PRs/issues (GitHub MCP), Google Docs incl. all tabs (Drive MCP), Jira issues/epics/initiatives (Jira MCP), loose files (PDF/MD/…), and web pages.

**Pedagogy built into the orchestrator** (agentbrew-owned; see `skill-plugins/dev/learn-project/SKILL.md`):

- **Source freshness** — `stage-learn-sources` v3 hashes each input; re-runs skip unchanged sources (`manifest.freshness.changed` / `unchanged`).
- **Mermaid maps** — concept map per section + architecture diagram after tutor-setup.
- **Verification gate** — re-answer each question from vault notes only before quizzing (CoVe / RAGAS-faithfulness).
- **Teach before test** — concise learning brief before the quiz.
- **Mastery tracking** — per-section coverage %, weakest-first + big-picture-first selection; threshold before 🟢; retention re-test; interleave mode.
- **Applied tasks** — locate-owner / where-to-add / trace-the-bug / blast-radius on staged repos.

Install the upstream teach + quiz pair (the skill also does this automatically):

```bash
agentbrew install tutor-setup --from bevibing/tutor-skills
agentbrew install tutor --from bevibing/tutor-skills
```

The deterministic staging step is [`scripts/stage-learn-sources.ts`](scripts/stage-learn-sources.ts) (manifest **version 3**):

```bash
npm run stage-learn-sources -- ./.learn-project \
  --local ~/apps/tooling/agentbrew \
  --repo https://ghe.example.com/owner/enterprise-repo.git \
  --doc "Design Doc:./.learn-project/inputs/docs/design-doc.md" \
  --file "Spec PDF:./.learn-project/inputs/files/spec.pdf" \
  --web "https://example.com/guide:./.learn-project/inputs/web/guide.md" \
  --context "PR-814:./.learn-project/inputs/context/pr-814.md" \
  --context "PROJ-123:./.learn-project/inputs/context/proj-123.md"
```

Read `./.learn-project/manifest.json` for `tutorSetupMode`, `tutorSetupCwd`, and `freshness`, then run `/tutor-setup` and `/tutor` from that directory.

Upstream tutor enhancements planned for contribution (not yet in tutor-skills): see [`docs/learn-project-tutor-upstream-contribution.md`](docs/learn-project-tutor-upstream-contribution.md).

Canonical upstream: [`bevibing/tutor-skills`](https://github.com/bevibing/tutor-skills) (`RoundTable02/tutor-skills` redirects there).

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
