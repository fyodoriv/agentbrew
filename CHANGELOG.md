# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — Unreleased

### Removed

- The `learn-project` skill, its `stage-learn-sources` script, and its guide
  moved to careerbrew, which keeps study state across days (spaced reviews,
  retests, mastery). A guard test keeps them out of agentbrew.

### Changed

- `/work` reads 34% less to start: 6298 bytes, down from 9511
  (`work_instruction_bytes`). `commands/work.md` keeps only what the plan does
  not say, `agentbrew work --json` prints compact JSON, and the plan drops
  `dashboard.top`. The day's page is republished when a stage ends, when a watch pass
  changes a row, when a row needs the user, and at end of day; `dashboard.statusPath` still updates on
  every row change.

### Added

- `agentbrew work stats [--days N] [--json]` measures `/work`: the instruction
  bytes a run reads, and each recorded run's wall time, tool time, calls,
  blocked calls, Artifact calls, subagents, and time per step (from the
  agent perf log, `agent-perf.mjs work`). New metrics `work_instruction_bytes`
  and `work_run_wall_ms`.
- `/work` keeps a live dashboard for the day (#510). `agentbrew work --json`
  returns a `dashboard` block: title, one row per step, statuses, and a
  local page path; the end-of-day report links it.
- `/work` runs steps in parallel stages (#509). A `workSteps:` entry can set
  `scope:`, `after:`, and `longRunning:`; `agentbrew work --json` returns
  `stages`, and `/work` runs one subagent per step in a stage.
- `/work` runs its steps back to back (#508). `agentbrew work --json`
  adds `flow`, `stopOnlyFor` (merge conflict, destructive or public action,
  a choice only the user can make), and `questions` (asked once, at the end).
- `agentbrew setup --all` runs the multi-repo setup chain (#442 part 4):
  `agentbrew sync`, the dotfiles and careerbrew installers, then
  `agentbrew audit-skills`. One question round (`--yes` for defaults), done
  steps skipped on rerun (`--force` reruns), failed steps listed at the end.
  Plain `agentbrew setup` is unchanged.

### BREAKING CHANGE

- **Team overlays are removed** (#208 step 12). `agentbrew team set`,
  `team unset`, and `team status` are gone; `agentbrew team ...` now prints the
  migration steps and exits 1. The overlay `catalog-overlay.yaml` merge,
  overlay agent definitions (`agents:`), executable MCP-format adapters
  (`adapters:`), and the team lock pin are removed too. An old `team:` block in
  `state.yaml` is ignored. Company content now ships as signed plugins.
- **The plugin preview flag is gone.** `agentbrew plugin` works without
  `AGENTBREW_PLUGINS_V2=1`.

### Migration

1. `agentbrew plugin migrate <overlay-checkout>` prints a draft
   `agentbrew-plugin.yaml` and lists what it could not map. It changes nothing.
2. Commit the manifest to the overlay repo, fix everything
   `agentbrew plugin test <checkout>` reports, and push an SSH-signed tag.
3. On each machine: `agentbrew plugin add <url>@<tag> --signer "<ssh-public-key>"`,
   then `agentbrew sync`.
4. Not carried over automatically: remote `sources:` (add them to the catalog),
   overlay MCP entries (write `mcp/servers.yaml` with secret references and
   pinned versions), executable adapters, overlay agents, and detect scripts.

## [Unreleased]

### Added

- `agentbrew catalog`, `catalog --search` and `--format json|markdown` list
  catalog Claude Code plugins with their pinned commit; `install <name>
  --dry-run` previews one.
- Catalog item type `claude_plugins`: `agentbrew install <name>` clones a
  third-party Claude Code plugin at a pinned commit, registers it as a
  directory marketplace, and enables it; `remove` undoes it and `status`
  reports drift. First entry: `agent-usage-guard` at `e9bd8d6`.

### Changed

- The `watch-issues` skill says what to do when a Monitor's `gh` reads fail
  TLS in the sandbox: run the watch loop outside it, writing to a log, and
  tail that log.

- Every tool setup now starts with a preflight: check for duplicates and
  conflicts (hooks, status line, MCP servers, skills, LaunchAgents, plugins),
  prove it in a scratch HOME, and pin the version. It is a rule in
  `docs/shared-rules.md` and a step in each `agentbrew-add-*` skill.
- `agentbrew sync --pull` now pulls already-cloned sources in parallel, and
  skips re-copying installed skills that already match their source. On 16
  sources this cut the median run from 8.4 s to 4.9 s (load 13-26).
- `agentbrew sync --pull` looks up each source's commit once, in parallel,
  instead of twice one after another. On 16 sources this cut the median
  run from 17.0 s to 8.5 s.

### Fixed

- `agentbrew measure context` shows the same error and warning counts as
  `agentbrew lint` in its printed lint-failed alert (#461). Before, it counted only
  `validateConfig()`, so a failure such as an oversized command read
  "0 errors, 0 warnings".
- The nightly memory maintenance LaunchAgent no longer pins a versioned Node
  that `brew upgrade node` (or a new fnm version) deletes (#456). It uses the
  same upgrade-proof Node as the check job, and the scheduler now also knows
  fnm's `default` alias. `agentbrew status` reports a versioned Node in every
  `com.agentbrew.*` job, with `agentbrew memory fix` as the memory job's fix.
- `agentbrew work --json` gives each step its file `path` and `userOnly`, and
  `/work` reads and follows a user-only skill's file when the Skill tool hides
  it (#451). Before, a step such as `/tooling-checkup` could not run.
- `agentbrew plugin add`, `update`, `rollback`, and `remove` now refresh the
  Claude Code plugin copy right away (#447). Before, a hook that a new plugin
  version added stayed off until the next `agentbrew sync`.
- `agentbrew status` names an outdated catalog pin in an agent that
  agentbrew does not manage (for example `tasks-mcp@0.5.0` in VS Code
  settings when Copilot is not detected), with the exact one-line edit. Sync
  still leaves those files alone. `status --json` lists them under
  `unmanagedOutdatedPins`.
- `agentbrew status` no longer reports "PATH missing node" for a LaunchAgent
  whose plist runs a Homebrew Cellar node while PATH has a link to the same
  node, such as `/opt/homebrew/opt/node/bin` (#441). `status --fix` and sync
  use the same check, so they no longer rewrite such a plist either.
- Drift repair now also raises an exact pin of a catalog-pinned MCP package
  that is older than the catalog's (for example `tasks-mcp@0.5.0` left in VS
  Code settings). That version's `list_tasks` walks the whole home folder, so
  `mcp probe --deep` timed out under load. A newer exact pin, a range, or a
  tag stays as you set it.
- `agentbrew sync` and `agentbrew status` now name a command you made in
  `~/.config/agentbrew/commands` when an Agentfile or plugin dir with the
  same name replaces it for your agents. Before, it was replaced silently.
- An Agentfile `skills:` entry now always installs a skill. Before,
  `skills: [load-project-context]` installed the catalog rule of that name.
  `agentbrew install load-project-context` still installs the rule and now
  says that a built-in skill shares the name. A catalog test fails when a
  new rule, MCP server, or CLI tool takes a built-in skill's name.
- On Linux, `agentbrew auto-sync install` and `uninstall` with a scratch
  `HOME` no longer write the real user's crontab or run `systemctl --user`
  enable, disable, or daemon-reload. Both are per user, so agentbrew changes
  them only when `HOME` is your home folder, as it already does for launchd.
- A command or agent name that two sources ship now has one fixed winner,
  the same rule as skills: the source listed later wins. Before, commands
  took the later dir and agents the earlier one, and nothing was printed.
  Sync warns, and `agentbrew status` (and `--json`) names each clash.
- **Security:** `agentbrew plugin leak-audit` and `plugin rules` started from
  a git hook now read the folder they are given. Before, a hook's `GIT_DIR`
  made the leak audit list the hook's repository, so it could miss a leak in
  the audited folder, and made the rules scope name the wrong repo. `--cwd`
  must name a checkout: a setup reachable only through `GIT_DIR` and
  `GIT_WORK_TREE` (a bare dotfiles repo) now fails the audit closed (exit 2).
- **Security:** a built-in skill name with no catalog entry now resolves to
  agentbrew's own copy. Before, `agentbrew install`, an Agentfile `skills:`
  list, and `sync --pull` searched every source for it, so a source (a local
  one ranks first) that shipped the same name replaced the built-in skill.
  `sync --pull` no longer installs a team source's `recommended` skill with a
  built-in name either. An explicit `install <name> --from <source>` still
  replaces it.
- `agentbrew init`, `sync`, `auto-sync install`, and `memory enable` with a
  scratch `HOME` no longer load, unload, enable, or restart the real user's
  launchd jobs (`com.agentbrew.check` and the memory daemons). launchd is per
  user, so agentbrew now changes it only when `HOME` is your home folder.
- A command started from a git hook no longer runs plugin-store git commands
  (clone, checkout, tag and signature checks, drift checks) or local-source
  SHA lookups in the hook's repository: they drop `GIT_DIR`, `GIT_WORK_TREE`,
  and the other repo-pointing variables. A local source's SHA now always comes
  from its own folder, even when `GIT_DIR` is exported in the shell.
- Two sources that ship an installed skill with the same name no longer
  overwrite each other's copy on every `sync --pull`. The source listed later
  in state wins, and `agentbrew status` (and `--json`) shows the clash.
- A `sync --pull` started from a git hook no longer pulls, realigns, or resets
  the hook's repository: cache git commands drop `GIT_DIR`, `GIT_WORK_TREE`,
  and the other repo-pointing variables.
- A set-but-empty `XDG_STATE_HOME` no longer saves `agentbrew report` drafts
  in the current directory. They go to `~/.local/state/agentbrew/reports/`.
- Two `agentbrew memory sync-projects` runs at the same time (for example
  the daily job and a `SessionEnd` hook) no longer drop each other's stores
  from the sync ledger. The ledger write now takes a short lock and merges.
- A set-but-empty `XDG_STATE_HOME` no longer puts the memory sync ledger in
  the current directory. It falls back to `~/.local/state`, as the XDG spec
  says.
- **Security:** a token inside a git URL (`https://user:token@host/...`)
  no longer shows in agentbrew output: the CLI filters all of its stdout
  and stderr, and errors, the debug log, and the saved sync-error log show
  it as `***`. A git-installed MCP server's saved `gitUrl` leaves it out (an
  entry saved before keeps it until you install the server again). An
  unattended git run (`--yes` or no terminal) also adds `-o BatchMode=yes`
  to the ssh command, so a private SSH repo fails fast instead of waiting
  on a passphrase or host-key prompt (plink and putty commands are left
  alone, since they do not take `-o`).
- The `perf-task-review` Stop hook no longer counts a background agent
  launch (`Agent` with `run_in_background`) as a call that never ran, and a
  worker's run time no longer counts as tool time in the turn its result
  lands in. Turns that dispatch workers are no longer asked for a time
  review for them. A denied launch is still flagged; a background launch
  that a hook blocks now counts as ran.
- `install.sh run --keep-claude-permissions` saves the setting with
  `agentbrew config set claudePermissions keep` instead of editing
  `state.yaml` by hand, and the README's offline rows name
  `agentbrew config set skillInstallMode native`.
- Interactive `plugin add` fetches the plugin once and installs the exact
  checkout it showed for approval. Before, it fetched again after the prompt,
  so a tag moved in between could install other code than the one approved.
- **Security:** `agentbrew setup` never prints a secret value. Before, it
  printed the full `export` lines when you declined to save, showed the
  first and last 4 characters in its review, showed the current value as
  the prompt default, echoed what you typed, and echoed a malformed
  `--env` pair. It now hides input and prints key names only. An
  unattended `install --git` (`--yes` or no terminal) or `mcp update` (no
  terminal) also stops git's https login prompts, so a private repo with
  no saved login fails at once instead of hanging the run.
- `install --git` and `mcp add --git` now pass `--env` to the server
  (`KEY` alone stores a `${KEY}` reference; `KEY=VALUE` stores the value),
  and `mcp add` takes `--yes`. With `--yes` or no terminal, a missing env
  var fails with exit 1 and its name instead of waiting on a prompt, so
  agents can run both commands. In a terminal, the prompt hides what you
  type and offers to save the value to the shell secrets file; Ctrl-C there
  exits 130 instead of 0. Keys are checked before the clone, a bare `KEY`
  must be upper case, `KEY=VALUE` needs a value, and a re-install keeps
  the server's other env vars. Before, `--env`
  was ignored for git installs, and a typed value was lost after the run.
- A failed `install --git` or `agentbrew mcp update` now exits 1. Before,
  a refused ref, a clone or pull error, or a missing entrypoint printed an
  error and exited 0. `mcp update` on a tag or commit pin now says that
  agentbrew pulls only a branch pin and prints the install command that
  moves the pin, instead of a network hint. A re-pin or update whose build
  fails no longer registers the previous commit's build output (`dist/`):
  a build that fails at a commit the cache has no build output from (no
  successful build, and not a fresh clone of it) is a failed install, and
  with no build script an entrypoint that the commit does not contain is
  refused. agentbrew removes none of your files. A
  cache cloned by an older agentbrew counts as unbuilt until one build
  succeeds. `mcp update` before `agentbrew init` now exits 1 too.
- **Security:** `install --git` and `mcp update` reuse a cached repo in
  `~/.config/agentbrew/mcp-repos/<name>` only when its `origin` is the
  requested repo. Before, a second `--git` URL under the same server name
  installed the first repo's code and recorded the second URL. A cache dir
  with no `origin` remote (git then read `origin` as a path in the checkout)
  or a cache dir that is a symlink or a linked worktree (git then ran in or
  moved another repo's branch) is now refused too. A local path is now
  recorded as an absolute path; a server installed from a relative path
  before this change needs one `agentbrew install <name> --git <absolute
  path>` before `mcp update` works from another dir.
- `install --git <url> --ref <ref>` and `mcp add --git` install the tag
  when a branch has the same name. Before, `git clone --branch` picked the
  branch. agentbrew now looks the name up as `refs/tags/<ref>`, then
  `refs/heads/<ref>`, fetches exactly that ref, and checks out its commit.
  A full commit ID now works on a fresh install, `refs/heads/<name>` pins a
  branch that a tag hides, and a ref that starts with `-` is refused. On a
  cached repo, `--ref` now takes only a tag, a branch, or a full commit ID
  (a short ID or `HEAD~1` is refused). Every `--git` install now needs git
  2.24 or later. A server name made only of dots is refused, and agentbrew's
  git and npm calls in the MCP cache never act on a repo that encloses a
  cache dir without `.git`, or on the repo that an inherited `GIT_DIR` names
  (git sets it inside hooks).
- **Security:** `plugin add`, `update`, and `rollback` install only the commit
  of the signed tag they verified. Before, an unsigned tag named like the
  signed tag's object ID, or a branch with the tag's name, could install an
  unsigned commit. agentbrew now fetches exactly `refs/tags/<ref>`, refuses
  object-ID names and a signed tag published under another name, and checks
  that the checkout is the tag's commit. A tag signed with OpenPGP or X.509
  could also pass when its key was in the user's gpg keyring; now only one
  SSH signature counts, and it is checked before anything is checked out.
- Team overlay `commands:` folders now deploy, and `sync --pull`
  fast-forwards and re-pins the overlay; a force-pushed overlay is refused
  (#331).

### Fixed

- **ChatGPT and Claude Desktop context files are no longer empty.**
  `context/chatgpt.md` and `context/claude-desktop.md` took their body from the
  "Auto-Synced Cursor Rules" section, which the Cursor removal (#286) deleted.
  They now carry the whole deployed instructions template.

### Removed

- **Cursor and Grok support** (#286). Cursor and Grok support was removed on
  purpose on 2026-10-19. This first step removes the Cursor token tooling: the
  `cursor-token-playbook` skill, the Cursor `.mdc` inventory in
  `measure context`, the tokscale Cursor usage probe, the Cursor context-ring
  field, and the "Auto-Synced Cursor Rules" strip step.
  The second step removes the `cursor` agent: its `agents.yaml` entry, the
  Cursor hooks format, the `cursor` command transform, the Cursor MCP GUI
  wrapping, and Cursor in the delegation maps, primary agent lists, project
  detection, the shell hook, hook-manifest targets, and installer backups.
  agentbrew no longer writes under `~/.cursor`. Files it wrote there before
  stay; delete them by hand if you no longer want them.
  The last step updates the docs and skills, regenerates the README agent
  matrix, adds the author's note to `AGENTS.md` and the README "Supported
  agents" section, and adds `src/core/removed-agents.test.ts`, which fails if
  a Cursor, Grok, or xAI agent, a `~/.cursor` write path, or a Cursor-only
  script or LaunchAgent comes back. The `agentbrew-add-command` skill no
  longer documents the Cursor-only `<!-- turbo -->` annotation.

### Security

- `agentbrew sync` enforces `agentbrew.lock`: it exits 1 and deploys nothing
  when a locked source drifted or the team overlay checkout moved off its
  pinned commit. `team set` pins the overlay commit. A missing or broken
  overlay catalog is now an error (#208).

### Added

- `agentbrew audit-skills [--json] [--into <repo>]`: lists the skills and
  commands in the agent folders that no tracked source owns, once each, marked
  `merge`, `merge?` (a near-duplicate; a prefix needs two or more name
  segments), or `adopt` (#442). It changes nothing.
- A SessionStart hook, `updates-landed`: when dotfiles' `dotfiles-updates-landed`
  is installed, the agent gets its once-a-day "updates landed" line and can
  suggest the checkup. It keeps no state and gives up after 3 seconds (#442).
- A recommended catalog rule, `default-to-these-repos`: before writing a new
  skill, command, rule, or hook, extend the installed source that owns the
  closest one. The README now opens with one install-or-update prompt that
  also syncs, audits local skills and commands, and asks for feedback (#442).
  INSTALL.md says how to do that audit by hand.
- `/work`, a built-in command for the work day, and `agentbrew work [--json]`,
  which prints its plan: ordered checkup steps, the machine rule (company
  plugin installed or not), watch mode, and end of day. Agentfiles add steps
  with `workSteps:` (#440).
- **Company plugins preview** (`AGENTBREW_PLUGINS_V2=1`, #208 step 3):
  `agentbrew-plugin.yaml` schema, `plugin add/list/remove`, and a `plugins:`
  lock section with commit, tree hash, and capabilities hash. `sync` refuses
  a plugin checkout that drifted from its lock.
- **Plugin authoring** (#208 step 11): `plugin new`, `plugin test`, and
  `plugin migrate` (draft a manifest from a legacy overlay).
- **`plugin update`** (#208 step 11): semantic diff of rules, skills, MCP
  servers, hooks, and capabilities; applies only on confirmation, and a
  capability change always asks. `plugin rollback` returns to the old version.
- **Core leak audit** (#208 step 10): `agentbrew plugin leak-audit` reads
  plugin leak patterns as data, fails closed, and runs in `npm run verify`.
  The perf log redacts matching project names; context-budget snapshots are
  kept for 180 days.
- **Plugin MCP secrets by reference** (#208 step 9): plugin MCP env values
  must be `env:`, `keychain:` or `op://` references, runtimes must be pinned,
  and generated launchers resolve secrets at start so no agent config holds them.
- **Native Claude Code plugins** (#208 step 8): sync emits a local
  marketplace and one Claude Code plugin per company plugin (hooks plus a
  session-start rules hook), enabled in user settings. New
  `plugin policy` prints an admin managed-settings fragment.
- **Scoped plugin rules** (#208 step 7): plugin rules leave global rules
  files. `agentbrew plugin rules` serves them per agent and per repo
  (`capabilities.repos`); public hosts are excluded by default.
- **One refresh path for plugins** (#208 step 6): `sync` derives plugin
  rules, skills, and commands from the locked plugin tree every run, so none
  of the overlay stale-state cases apply to v2 plugins.
- **Plugin capabilities** (#208 step 5): undeclared rule agents, hook events,
  MCP servers, and shell-running commands are refused with exit code 3 on
  `plugin add` and `sync`.
- **Signed company plugins** (#208 step 4): `plugin add` installs only from
  SSH-signed tags checked against `~/.config/agent-plugins/allowed_signers`
  (shared with dotfiles). New `plugin trust` / `--revoke` and
  `plugin rollback`. The lock records the signer; a revoked signer fails sync.

- **One-step install with your agent** — tell Claude Code (or Cursor, Codex)
  "Install agentbrew by following …/INSTALL.md". `scripts/install.sh` explains
  the plan, takes the answers as flags, backs up your agent settings, builds,
  runs `init`, heals with `status --fix`, verifies with `lint`, and restores
  the backup by itself on a critical error (`install.sh restore` undoes it by
  hand). It ends by suggesting `agentbrew contribute` for fixes.
- `agentbrew metrics` and `agentbrew contribute`.

- **Working human-in-the-loop MCP** — the catalog `ask-human` entry, whose
  last release fails before MCP initialize, is replaced by the opt-in
  `mcp-feedback-enhanced` (pinned, MIT), which passed a live stdio smoke test.

- **More gstack skills in the catalog** — the gstack skills people install most
  by name now have catalog entries: design (`design-consultation`,
  `design-shotgun`, `design-html`, `ios-design-review`), safety (`freeze`,
  `unfreeze`, `guard`), `cso`, `document-release`, `benchmark`, `ios-qa`,
  `context-save`, `context-restore`, `pair-agent`, `make-pdf`, and
  `gstack-upgrade`. Each is opt-in and says when to use a sibling instead.

- **Opt-in official MCP Registry lookup** — with `AGENTBREW_MCP_REGISTRY=1`,
  `agentbrew install <name>` resolves a server the local catalog lacks from
  `registry.modelcontextprotocol.io` (npm/pypi stdio packages and http
  remotes) and installs it through the normal MCP path. Local catalog entries
  win; an outage prints one warning and falls back. Off by default until the
  registry reaches 1.0.
- **Docs that agents can use and humans can scan** — `AGENTS.md` is now a
  short router (start here, commands, where to change what, rules, gotchas,
  delivery, docs upkeep), and `CLAUDE.md` links to it so Claude Code loads it.
  The full rule text moved to `docs/editing-rules.md`. `docs/README.md` maps
  every doc by question and audience, and the README opens with who it is for
  and where the docs are. `src/docs/agent-guide-contract.test.ts` pins all of
  it. `docs/agent-guide-baseline.md` is the same contract for any repo.
- **Hook `gh-pr-body-requires-docs`** (opt-in, like every Bash hook) blocks
  `gh pr create`/`edit` when the body has no `## Docs` section or
  `Docs: none — <reason>` line. It also reads multi-line heredoc bodies.
  `templates/AGENTS.md` now tells every agent to update docs with each change.
- **`npm run lint:rules` reuses Minsky's rule checks** — a rule-lint adapter
  runs Minsky's `scripts/check-rule-*.mjs` against this repo with `--repo`,
  and `npm run verify` runs it. Rule 9 now requires the five
  pre-registration fields on new task blocks; `.prereg-allowlist` holds the
  older ones. A machine without Minsky skips the rules.

### Changed

- **Fewer opinions for new users** — nine hooks that encode one maintainer's
  workflow (`code-no-timestamps`, `selectors-pure`, `tests-adapt-to-production`,
  `skill-names-user-facing-verbs`, `async-human-comms-blocks`,
  `jira-no-grandchildren`, both `gdoc-*` guards, and the `perf-task-review`
  Stop hook) now ship opt-in. List an ID under `enabled:` in
  `~/.config/agentbrew/hooks-overlay/manifest.yaml` to keep it.
- **Attention-friendly language is a default, not a lock** — an explicit user
  request for another style now wins. Make it strict in your own shared rules.
- The attribution footer names the committer's first name (`git config
  user.name`), and skills no longer assume the maintainer's `~/apps/tooling`
  layout.

- **One runner for the context-budget usage tools** — ccusage, tokscale, and
  openusage now share one "try each command, keep the first JSON" helper in
  `src/measure/context-budget-runtime.ts`, with tests for fallback order and
  skip reasons. The README lists which measurements stay native and why.

### Fixed

- **Memory daemon on Python 3.15** — the memory LaunchAgent and `memory`
  CLI calls now pass `uvx --python 3.13`. On a Mac where uv had Python 3.15,
  the daemon failed to install `onnxruntime` and every agent saw
  `ECONNREFUSED` for the `memory` MCP server.

- **Competitor spot-check can target a repo by path** —
  `competitor-spot-check.sh --root <repo-dir> "<feature>"` scans that repo
  instead of the shell cwd, so an agent that cannot `cd` (or has a stale
  cwd) no longer cites prior art from the wrong repo. A missing `--root`
  path scans nothing.
- **Competitor watch reuses the repo's competitor directory** — the
  `companion-competitor-watch` lane now detects `docs/competition/`,
  `docs/competitors/`, or `competitors/` and writes there. It no longer
  creates a parallel `docs/competitors/` in repos like agentbrew. The
  `companion-researcher` allow-list accepts all three directories.
- **PR-body hooks stop tripping on quoted mentions** — the docs and
  validation hooks now act only on `gh pr create`/`edit` in command
  position, so an `echo` or a script string that mentions it passes. The
  validation hook now reads multi-line heredoc bodies too; before, it let
  them through unchecked.
- **Tests no longer file fake MCP tasks** — one heal-cycle test let the
  real follow-up writer add a `bad` on `cursor` P0 task to `TASKS.md`. The
  test now stubs the writer, and a vitest setup file fails any test file that
  changes `TASKS.md`.
- **A plain `sync` no longer overrides the Agentfile** — it installed the
  catalog recommended set on every run, even skills the Agentfile had removed.
  With an Agentfile in effect, only the Agentfile's `recommended: true` asks
  for that set. A machine with no Agentfile keeps the first-run install.
- **Skills dropped from the Agentfile stay removed** — they stayed in the
  source's `skillsInstalled` list, and `sync --pull` copied them back. The
  authoritative Agentfile apply and `sync --pull` now prune them. Skills
  installed by hand are not touched.
- **`remove` clears a skill whose folders are already gone** — it reported
  "not found" and left the state entry behind.
- **A diverged source cache no longer deploys stale skills** — a cache that
  could not fast-forward printed "using cached data" and kept old files. It is
  now reset to upstream, and local-only commits stay on a `salvage/` branch.
- **An Agentfile with no rules no longer writes an empty block** — the empty
  `<!-- agentfile-rules: … -->` block was glued to the next rule line in
  `shared-rules.md`. An Agentfile that drops its `rules:` now removes its own
  block.

## [0.4.1] - 2026-10-09

### Fixed

- **MCP servers reach Claude Code and Codex without mcpm** — on a machine
  without `mcpm` on `PATH`, sync used to skip the mcpm-managed clients, so a
  fresh install left Claude Code and Codex with no agentbrew MCP servers.
  Sync and `remove` now write those configs directly when `mcpm` is missing.
  Goose stays mcpm-only because its YAML adapter is read-only.

## [0.4.0] - 2026-10-09

### Security

- **Dependency fixes** — `simple-git` 4.0.2 and `proxy-addr` 2.0.8 close the
  critical advisories that Dependabot reported on `main`.

### Removed

- **Windsurf and Devin support** — breaking change. agentbrew no longer
  knows Windsurf or Devin as agents. Their `agents.yaml` entries, sync
  targets, command transform, MCP schema, carve-out rows, Devin import
  simulator and real-tier workflow, and the literal-env MCP inheritance path
  are gone. Existing config files under `~/.codeium/`, `~/.windsurf/`, and
  `~/.config/devin/` are left alone. Augment stays deprecated and frozen.

### Changed

- **Workflow skills live in agentbrew** — the owner's workflow skills moved
  from the separate `fyodoriv/dev-skills` repository into
  `skill-plugins/workflow/`. Catalog entries now use
  `source: fyodoriv/agentbrew`, and the previously uncatalogued workflow
  skills gained opt-in catalog entries. Unlike `skill-plugins/dev/`, these
  skills deploy only when selected by name.

### Fixed

- **Helper scripts ship with agentbrew** — the instructions tell agents to run
  `~/.config/agentbrew/scripts/load-project-context.sh`,
  `verify-vision-trace.sh`, `competitor-spot-check.sh`, and
  `check-pr-vision-trace.mjs`, but no release shipped them. The shell
  scripts now live in `templates/scripts/`, the `.mjs` gate stays in
  `scripts/`, and `agentbrew sync` installs them. Sync never replaces a file
  it did not write, so a hand-made copy at that path stays.
- **Memory backups** — `agentbrew memory maintain` now writes the daily
  backup and keeps the newest 14. Pruning an old backup also removes its
  SQLite `-shm` and `-wal` files. `memory status --json` reports the
  daemon's LaunchAgent identity.
- **Lock entries** — `agentbrew sync` prunes lock entries for removed
  sources.

## [0.3.5] - 2026-10-01

### Security

- **Runtime dependency fixes** — `js-yaml` 4.3.2 fixes quadratic CPU use
  from crafted YAML merge keys. `fast-uri` 3.1.8 (through `ajv`) fixes host
  confusion and request-forgery bugs. `npm audit --omit=dev` is now clean.

### Fixed

- **Publish preflight** — `npm run publish:latest` stops early on npm older
  than 11, which cannot install this lockfile or stage a publish.
- **Clean tree after publish** — the publish script restores `package.json`
  byte for byte instead of moving the `private` key.

## [0.3.4] - 2026-10-01

First npm release built from the clean public history. Versions 0.3.3 and
earlier are deprecated; upgrade with `npm install -g agentbrew@latest`.

### Removed

- **Mirror tooling** — removed the mirror-push, parity, staleness, and
  branch-prune scripts and related skills. Private emails are now blocked at
  push time, never rewritten.

### Fixed

- **Drift repair leaves the memory daemon PATH alone** — the LaunchAgent PATH
  check no longer flags `com.agentbrew.mcp-memory` for missing Node, and
  `agentbrew fix` no longer rewrites it. The rewrite and the memory installer
  undid each other and restarted the daemon on every sync.
- **Truthful auto-repair status** — `agentbrew status` no longer says
  auto-repair is `active` because a scheduler file exists. It now checks the
  loaded job, its last exit code, its program path, and its last run time. It
  reports `not running`, `disabled`, `broken`, `stale`, `failing`,
  `not run yet`, or `unverified` when auto-repair is not working, with the fix
  command. `status --json` adds an `autoRepair` field.
- **Truthful auto-sync install** — `agentbrew auto-sync install` no longer
  says the LaunchAgent is loaded because `launchctl load` exited 0. It checks
  `launchctl print` and says when launchd has the job disabled.

### Added

- **Shared-memory hardening** — project-memory sync now skips unchanged stores,
  supports explicit `--force` recovery, records collision-resistant hashed
  source tags, writes atomic metadata evidence, and captures bounded
  non-content SessionEnd scheduling receipts. Full doctor reports project-sync
  drift as an advisory, and `memory transport-report` adds read-only
  loopback/session/Origin/auth/timeout/primary-agent evidence before a future
  transport security migration.
- **Strict attention-friendly language** — AgentBrew now deploys an always-active
  ASD-STE100-style writing rule for all agent-authored natural-language output,
  including user-facing text and code comments, through shared rules,
  instruction templates, and supported per-file rules. The rule requires
  answer-first, short, scan-friendly output for an ADHD audience without asking
  agents to add comments to clear code.
- **Product-doc / Jira reconciliation protocol** — `task-command-center` now requires every Google Doc + docs PR/Jira refresh to read all source comments and children, preserve cited immutable product contracts separately from dynamic engineering guidance, use Jira fields/comments for transient state, and verify every destination after writes. Includes pressure evals and contract coverage.
- **Focused Jira task scope** — task-command-center now avoids Jira UI metadata
  and PR state in descriptions, respects a requested single PR boundary, and
  treats end-to-end coverage as opt-in.
- **learn-project verification gate** — Phase 5c runs a pre-quiz grounding pass: re-answer each question from vault notes only, discard/regenerate ungrounded questions, verify note claims against cited staged spans (Chain-of-Verification / RAGAS-faithfulness). Eval scenario 9 + contract tests.
- **learn-project mastery threshold + interleave** — concepts flip 🟢 only after two corrects (incl. one applied/analysis), within-session retention re-test after spacing, and interleaved cross-section mode once basics are green. Eval scenario 10 + contract tests.
- **learn-project applied/transfer tasks** — locate-owner, where-to-add, trace-the-bug, blast-radius graded against staged repos after mastery threshold. Eval scenario 11 + contract tests.
- **learn-project source freshness** — `stage-learn-sources` v3 records per-source `contentHash`, skips unchanged inputs on re-run, and exposes `manifest.freshness.changed` / `unchanged` for stale-vault detection. Unit tests + SKILL.md Phase 1/4.
- **Mermaid maps** — concept map per section + architecture diagram for codebase/mixed runs, embedded in vault MOC. Eval scenario 12 + contract tests.
- **learn-project user guide** — [`docs/learn-project.md`](docs/learn-project.md): prerequisites, quick starts, pipeline, StudyVault layout, pedagogy, troubleshooting; `skill-plugins/dev/learn-project/README.md` points maintainers to SKILL + evals.
- **learn-project quiz-fix loop** — Phase 5c Verification Log artifact, practice-file audit loop, eval #20 + contract tests.
- **learn-project upstream PR drafts** — `docs/learn-project-tutor-upstream-pr-drafts/` ready-to-paste bodies for tutor-skills contribution (publish gated).

### Added

- **Practice-file quality** — audit tutor-setup practice files (~30% recall cap), short concept labels, live MOC Weak Areas, rendering-vs-delivery Exam Trap (eval #19); quiz-fix loop guidance (eval #20).

### Fixed

- **`sync --pull` records its result** — the engine re-sync now runs every
  engine even when one fails, writes the sync log, and sets a failing exit
  code on errors. `agentbrew status` shows the real "Last Sync" time after a
  pull instead of the previous plain `sync`.
- **Closed desktop apps are not MCP failures** — a refused connection to a
  loopback MCP URL (WebStorm, Figma desktop) now probes as
  `skipped_local_app_offline` with "nothing is listening on host:port", so
  `agentbrew status` stops reporting it as failing for weeks. Other fetch
  errors keep their socket code, for example `fetch failed (ECONNREFUSED)`.
- **Memory daemon no longer restarts from worktree or test shells** — the
  daemon LaunchAgent PATH now holds only the uvx directory and system
  directories. Before, it copied the caller's Node directory and
  `DOTFILES_DIR`, so running agentbrew from another shell rewrote the plist
  and restarted the daemon. Cursor then marked `memory` as failed and did not
  reconnect.
- **Chezmoi worktree LaunchAgent repair** — resolve Dotfiles from
  `DOTFILES_DIR` or its managed environment file before guessing a checkout,
  and accept Dotfiles' secure shim-first prefix so `agentbrew fix` does not
  rewrite a valid active worktree PATH.
- **Stale `insecure-defaults` catalog pointer** — removed the Trail of Bits
  entry because the upstream repository now exposes that plugin without an
  installable `SKILL.md`, which caused `sync --pull` to report it as missing.
- **npm executable entrypoint** — invoking the installed `agentbrew` symlink now resolves to the compiled CLI and executes normally instead of silently exiting before command parsing.
- **Shared memory cold-start and protocol reliability** — the managed LaunchAgent now enables behavioral bootstrap, re-enables the required daemon while respecting intentionally disabled maintenance, sync idempotently reconciles and waits for readiness, doctor verifies `get_bootstrap_profile`, and the pinned 11.7 MCP client uses the service's actual tag/store/update/delete schemas.
- **vision-task-refs** — `extractTasksMdIds` now parses TASKS.md sub-bullet `  - **ID**:` metadata lines; VISION.md no longer backtick-tags as faux task IDs.
- **vision-task-refs Pattern B** — skip `(tag …)` metadata parens after TASKS.md; only backtick-open ID lists count as task references.

### Changed

- **Semantic memory defaults** — the `memory` catalog entry now uses local `mcp-memory-service[sqlite]` hybrid retrieval, and sync reconciles exact mcpm definitions so same-name backend or transport changes cannot remain stale.
- **Windsurf MCP path** — native sync now targets Windsurf's active `~/.codeium/windsurf/mcp_config.json` file.
- **Shrink — delete upstream-duplicate dev skills** — Removed in-repo copies of generic engineering skills (`debug`, `tdd`, `plan`, `jira`, etc.) that already exist in Superpowers, Anthropic, and fyodoriv source repos. `skill-plugins/dev/` shrank accordingly; catalog entries repoint to upstream (`page-zero-errors` → `fyodoriv/page-zero-errors`). Contract tests for deleted skills removed; remaining agentbrew skills reference upstream replacements.
- **Skill source deduplication** — Moved remaining local workflow skills to `fyodoriv/dev-skills`, switched methodology entries to maintained upstream implementations, and folded `autoresearch` into `iterate`. AgentBrew now retains only agentbrew-owned built-ins and catalog pointers.

### Added
- Catalog entry for **Composio Connect MCP** (`agentbrew install composio`) — single HTTP endpoint at `connect.composio.dev/mcp` with consumer-key setup wizard; replaces per-vendor Notion and Atlassian MCP catalog entries (Gmail, Slack, Linear, HubSpot, Jira, etc. connect via Composio OAuth).
- Catalog sources and skill pointers for **Compound Engineering** (`EveryInc/compound-engineering-plugin`) and **gstack** (`garrytan/gstack` sprint-pipeline skills). Confirmed **obra/superpowers** remains the indexed process-discipline source. All three register via `agentbrew install <source>` and deploy selected skills on `sync` — pointers only, no content copied in-repo.
- Catalog entry for **Sourcegraph MCP** (`agentbrew install sourcegraph`) — HTTP transport to `/.api/mcp` with access-token setup wizard for instance URL + `SOURCEGRAPH_ACCESS_TOKEN`. Confirmed **Context7** remains the recommended stdio docs MCP (`agentbrew install context7`) for all agents.

### Changed
- **Instructions sync** collapses onto the agents.md standard: deploy once to `~/.config/agentbrew/AGENTS.md`, symlink every detected agent whose `rulesFile` is `AGENTS.md`, keep copy+merge only for proprietary instruction filenames (`CLAUDE.md`, `global_rules.md`, `guidelines.md`, `GEMINI.md`) and ChatGPT/Claude Desktop context paste files. Removed unused `extractSharedInstructions`. Net shrink in `instructions-content.ts` (~7 LOC); `instructions-sync.ts` +~120 LOC for canonical/symlink orchestration (replaces N per-agent full writes). (`prefer-reuse-over-reinvent`, `verify-vision-trace`, `competitor-spot-check`, `detect-task-backend`, `write-vision`) as permanent Bucket-1 built-ins in `skill-plugins/dev/README.md` and VISION.md's "Curator, not host" enumeration.
- Recommended catalog rule bodies for project-context loading, PR vision trace, and agent attribution are compact enough to keep post-`sync --pull` deployed instruction files under the 40k-character budget.
- `agentbrew sync` now treats tracked skill sources as indexes, not deployment
  sets: only names recorded in `state.sources[].skillsInstalled` are
  symlinked. Legacy/manual `skillSourceDirs` outside tracked source paths still
  deploy as explicit opt-in directories, and stale symlinks from previously
  over-deployed source skills are pruned on the next sync.

### Removed
- **BREAKING:** Per-vendor SaaS connector MCP catalog entries **`notion`** and **`atlassian`** — use `agentbrew install composio` + `agentbrew setup composio` for Notion, Jira, Linear, HubSpot, Gmail, and 1,000+ other apps through Composio Connect.

### Fixed
- **LaunchAgent auto-repair** invokes `node` + `dist/cli.js` explicitly in `ProgramArguments` instead of a npm-global `agentbrew` symlink with a `#!/usr/bin/env node` shebang — fixes `env: node: No such file or directory` exit 127 on fnm hosts where launchd could not resolve the shebang even with a correct PATH.
- Agentfile rules merge now strips subsection/paragraph blocks already present in
  `shared-rules.md` before writing the managed overlay block, preventing ~800–1k
  token duplicate Pull/fetch subsections on re-apply.
- Agentfile/state `memory` MCP entries using `uvx --from mcp-memory-service` migrate
  to the lightweight `npx @modelcontextprotocol/server-memory` server, fixing
  `init_timeout` probe failures when pymilvus/milvus-lite are not installed.
- `agentbrew commands list` now includes Agentfile-declared `commands:`
  source directories alongside `~/.config/agentbrew/commands`, matching the
  command sync pipeline instead of undercounting configured commands.
- Agentfile `rules:` application is now marker-managed and idempotent instead
  of appending stale copies after wording changes. `agentbrew lint`,
  `agentbrew status`, and `agentbrew status --fix` now detect and repair
  repeated `shared-rules.md` blocks; `agentbrew rules dedupe` exposes the same
  cleanup as an explicit command.
- The generated instruction template is compact again, keeping always-loaded
  agent files under the 40k-character budget while preserving the safety
  guardrails covered by regression tests.

### Removed
- **BREAKING:** Hidden `agentbrew skills status` subcommand removed (2026-05-03,
  `simplify-hidden-skills-status-command`). It printed the same per-agent +
  per-source skill counts already shown by the visible
  `agentbrew status --verbose` (which calls `printVerboseSkillsSection()` in
  `src/status.ts`). Tail of the `simplify-hidden-status-commands` family —
  follows the deletions of `instructions status` and `hooks list`
  (`delete-instructions-and-hooks`). The `skills` subcommand
  registration in `src/commands/cli-sync-subcommands.ts` shrank, the dedicated
  `skillsSyncStatus()` entry-point and its two private helpers
  (`printTargetSkillStatus`, `collectTargetEntries`) were deleted from
  `src/sync/skills-sync.ts`, and the four-test `describe("skillsSyncStatus")`
  block was removed from `src/sync/skills-sync.test.ts`. Code/doc references
  to the deleted command are caught by the `skills status` entry now in
  `src/docs/cli-removed-commands.test.ts`. Migration: anywhere you ran
  `agentbrew skills status`, run `agentbrew status --verbose` instead.
- **BREAKING:** Hidden `agentbrew instructions` and `agentbrew hooks`
  namespaces removed (2026-05-03, `delete-instructions-and-hooks`).
  Both shipped a single subcommand each (`instructions status`, `hooks list`)
  and both were thin wrappers over functions already exposed by
  `agentbrew status --verbose` — `printVerboseInstructionsSection()` for the
  per-agent freshness signal, and the verbose status output plus the
  Agentfile `hooks:` block for the hook inventory + deployment. Per the focus
  instruction "delete hidden CLI surface that has no distinct user problem"
  the dedicated helpers (`instructionsSyncStatus()` in
  `src/sync/instructions-sync.ts` and `listHooks()` in
  `src/sync/hooks-sync.ts`), their direct test coverage, and the
  registrations + mocks in `cli-sync-subcommands.{ts,test.ts}` were all
  deleted in one commit. Users who want the deployment-status snapshot run
  `agentbrew status --verbose`. Future stale references in code,
  skill-plugins, docs, real-e2e, and templates are caught by the
  `instructions status` and `hooks list` entries now in
  `src/docs/cli-removed-commands.test.ts` `REMOVED_COMMANDS`.
- **BREAKING:** Hidden `agentbrew skills init <name>` subcommand removed
  (2026-05-03, `delete-skills-init`). The upstream `npx skills init
  [name]` (vercel-labs/skills) scaffolds the same SKILL.md + frontmatter
  shape, so per VISION.md "Delegate to upstream when 80%+ of need is covered"
  the local copy is gone. Net codebase shrink: ~240 LOC across the
  92-line `src/skills/init-skill.ts`, the 139-line `init-skill.test.ts`, plus
  the registration + tests in `cli-sync-subcommands.{ts,test.ts}`. Future
  stale references are caught by the `skills init` entry now in
  `src/docs/cli-removed-commands.test.ts` `REMOVED_COMMANDS`. Users who
  scaffold new skills run `npx skills init my-skill` instead.
- **BREAKING:** Hidden `agentbrew mcp sync` subcommand removed (2026-05-03
  hidden-CLI audit, parent task `simplify-cli-surface-audit-hidden-commands`).
  It was a bare-bones wrapper over `syncMcpServers()` with zero documentation
  references and zero `--dry-run` / `--verbose` / `--no-prune` flag support.
  Users who want to sync only MCP servers run `agentbrew sync --only mcp`,
  which calls the same orchestrator through the full sync pipeline. The
  cross-client batch **orchestrator** (`syncMcpServers` in
  `src/sync/mcp-sync.ts`) stays — that's still agentbrew's value-add. Only
  the duplicate CLI surface was deleted. The audit reviewed the other 11
  remaining hidden commands (`completions`, `classify`, `rules`, `commands`,
  `agents`, `instructions`, `skills`, `hooks`, `fix`, `mcp` namespace,
  `hook`, `auto-sync`) and concluded each solves a distinct user problem
  documented in user-stories or skill-plugins, or is a programmatic API
  for downstream tools (`classify`) / schedulers (`fix`); they stay in the
  Advanced help group.
- **BREAKING:** Legacy `.agentbrew.yaml` per-project format and `agentbrew mcp
  project` subcommand family (`init`, `sync`, `status`) removed. Per-project
  MCP servers now flow through the standard `Agentfile.yaml` `mcp:` block at
  the repo root — same target paths (`.cursor/mcp.json`, `.mcp.json`,
  `.windsurf/mcp.json`) via `applyAgentfile()`, one declarative format.
  Existing `.agentbrew.yaml` files in cwd print a one-time deprecation hint
  and are otherwise ignored. Migration: rename to `Agentfile.yaml` (or merge
  the `mcpServers:` block into your existing Agentfile's `mcp:` block) — same
  fields, no schema work.
- **BREAKING:** `agentbrew team` command family
  (`team init|set|unset|show|sync|check`) removed, along with
  `agentbrew rules list|import|export` (which only made sense
  alongside it), `state.teamConfig`, the team layer in
  `rules-sync` / `mcp-sync`, the legacy `.agentbrew-team.yaml`
  format, and the `docs/rfc-team-config-v2.md` RFC. Teams now share
  configuration via the dotfiles + git pattern documented in the
  README — clone the team's Agentfile-bearing repo, symlink its
  `Agentfile.yaml` to `~/.config/agentbrew/Agentfile.yaml`, run
  `agentbrew sync`. Updates flow through `git pull && agentbrew sync`,
  drift verification through `agentbrew status --ci`. Existing users
  with `state.teamConfig` set see a one-time migration hint on the
  next `init`/`sync` and the field is dropped on the next state save
  (no data loss — MCP servers, sources, and rules previously applied
  by `team sync` are already persisted in the rest of the state).
- **BREAKING:** `agentbrew mcp profile create/list/activate/deactivate/delete`
  removed. Per-context server sets belong in a per-project `Agentfile.yaml`
  `mcp:` block, which already scopes servers to the current directory.
  Global filtering that outlives a repo-scoped Agentfile should run through
  `mcpm.sh` (the canonical Python MCP manager) — see VISION.md
  "Delegate, contribute, absorb". Existing state.yaml files with
  `mcpProfiles` or `activeProfile` set load cleanly and drop those fields
  on next save.
- **BREAKING:** `agentbrew log` and six hidden `<namespace> sync` aliases
  removed:
  - `agentbrew log` — run `tail -n 20 ~/.local/share/agentbrew/logs/auto-sync.log`
    instead.
  - `agentbrew rules sync`, `agentbrew commands sync`, `agentbrew agents sync`,
    `agentbrew instructions sync`, `agentbrew skills sync`,
    `agentbrew hooks sync` — all one-line wrappers over the same function
    `agentbrew sync --only <name>` already calls. The top-level spelling
    also supports `--dry-run`.

  The non-sync subcommands under each namespace (`rules init`, `commands list`,
  `agents init`, `agents add-source`, `instructions status`, `skills status`,
  `skills init`, `hooks list`, etc.) stay — they serve unique purposes and
  have no top-level equivalent.

  The `agentbrew sync --only` help string was also corrected to enumerate
  the module names actually produced by `buildSyncModules()`: `mcp`,
  `project-mcp`, `rules`, `commands`, `agents`, `skills`, `hooks`,
  `instructions`.
- **BREAKING:** `agentbrew status --usage` and `agentbrew clean --unused` removed,
  along with the `src/usage.ts` module that powered them. The analytics were
  unreliable by construction:
  - **Skills (`atime`-based):** `collectSkillUsage` read each SKILL.md's `atimeMs`
    and marked the skill "never used" when `atime <= birthtime`. On macOS SSDs
    (and any other filesystem mounted with `noatime` or `relatime`, which is the
    default on most modern systems), `atime` never gets updated — so every skill
    always appeared "never used."
  - **MCP (`mtime`-based):** `collectMcpUsage` used the agent config file's
    `mtime`, but `agentbrew sync` rewrites that file on every run. "Last used"
    literally meant "last time agentbrew wrote the file," not "last agent use."
  - **`clean --unused`** then offered to delete items >30 days old by default —
    a data-integrity footgun on top of wrong data.

  A user who wants to trim unused skills + MCP servers runs `agentbrew status`
  and decides what they don't want, then `agentbrew remove <name>` for each.
  Rebuilding accurate "last used" telemetry would require agents to call back
  into agentbrew on every skill/server invocation — no agent does that today.
- **BREAKING:** Six hidden deprecated aliases removed. All had descriptions that
  literally said "use X instead". Commander's "did you mean" suggestion now
  surfaces the canonical command on unknown-command errors.

  | Removed | Replacement |
  |---|---|
  | `agentbrew add <source>` | `agentbrew install <source>` |
  | `agentbrew update` | `agentbrew sync --pull` |
  | `agentbrew doctor` | `agentbrew status --fix` |
  | `agentbrew check` | `agentbrew status --fix` (or `--ci` for CI) |
  | `agentbrew clean <name>` | `agentbrew remove <name>` |
  | `agentbrew rollback` | `agentbrew sync --rollback` |

  If you had a CI workflow running `agentbrew check --ci`, update it to
  `agentbrew status --ci`. All other replacements are drop-in.
- `agentbrew browse` removed (hidden command, not a breaking change).
  The TUI was a partial duplicate of `agentbrew catalog` — both loaded
  the same catalog — but its "toggle" metaphor was broken: unchecking
  an installed item just printed "run `agentbrew remove <name>` manually"
  instead of actually removing anything. Users who want an interactive
  browser now run `agentbrew catalog` (which supports `--search`, `--json`,
  `--markdown`), then `agentbrew install <name>` / `agentbrew remove <name>`
  for the actual install/remove. If demand for a two-way toggle UI returns
  later, it will live under `catalog` — no second command.
- **BREAKING:** `agentbrew mcp share` removed. The SSE bridge + `localtunnel`
  tunnel shipped but was unusable to browser-based MCP clients due to a
  hardcoded CORS origin check (every non-localhost `Origin` header got a
  403 response), had no README documentation, and no real-e2e coverage.
  To expose a local MCP server, run `mcpm run <name>` (the `agentbrew mcp
  run` wrapper itself was later deleted in slice 5b on 2026-04-27) and then
  tunnel the port with `ngrok http <port>`, `cloudflared tunnel --url
  http://localhost:<port>`, `serveo`, or `ssh -R` — all of these ship
  better auth and dashboards than `localtunnel`. See docs/VISION.md
  "What We're NOT Building"; cleanup landed in PR #692.
- **BREAKING:** Six imperative MCP subcommands and the top-level
  `agentbrew run` deleted in slices 5a-5c of `delegate-mcp-to-mcpm`
  (2026-04-27, total **−2,632 LOC** net):
  - `agentbrew mcp install <name>` (use `agentbrew install <name>` for the
    catalog-curated path or `mcpm install <name>` for raw registry resolution).
  - `agentbrew mcp search <query>` (use `mcpm search <query>` directly).
  - `agentbrew mcp info <name>` (use `mcpm info <name>` directly).
  - `agentbrew mcp run <name>` (use `mcpm run <name>` directly).
  - `agentbrew mcp health <name>` (use `mcpm doctor` for global probing or
    `mcpm inspect <name>` for per-server debugging).
  - `agentbrew mcp list` (use `mcpm ls` for richer per-client status).
  - `agentbrew mcp remove <name>` (use `agentbrew remove <name>` top-level —
    auto-detects type, removes from agentbrew state, AND bridges to mcpm
    for the MCPM intersection clients per PR #858).
  - `agentbrew run <name>` (top-level wrapper deleted alongside `mcp run`
    in PR #851 — slice 5b).
  See `docs/competition/mcpm-sh-vs-agentbrew.md` § "Command surface
  dissolution map" for the per-row Status column with PR refs.
- Internal docs, skill plugins, and references (open-source readiness)

### Added
- Catalog → mcpm bridge for the MCPM intersection clients (cursor, claude-code,
  codex, claude-desktop, cline, windsurf, gemini-cli, goose, roo-code).
  `agentbrew install <name>` from the catalog now runs `mcpm install` +
  `mcpm client edit --add-server` per intersection client, so users see
  the server in their actual config files (not just agentbrew state).
  Carve-out-only setups (devin/overlay-desktop/copilot/opencode/kiro/amp)
  short-circuit and stay on the native sync path. PR #857.
- Remove → mcpm bridge for the same MCPM intersection clients.
  `agentbrew remove <name>` now runs `mcpm client edit --remove-server`
  per intersection client + `mcpm uninstall <name> --force` for global
  cleanup, so removing an MCP server cleans every client's config — not
  just agentbrew state. The native `pruneServerFromAgents` path still
  handles carve-outs. PR #858.
- Sync → mcpm bridge for state-driven additions in the same MCPM intersection
  client set. `agentbrew sync` now bridges every server in
  `state.mcpServers` to mcpm via `mcpm install` + `mcpm client edit`
  whenever the intersection clients (cursor, claude-code, codex, etc.)
  are detected. Closes the regression where a hand-edit to
  `state.yaml` or an `Agentfile.yaml mcp:` import landed in agentbrew
  state but never reached the actual client config files. The bridge
  honors latency by reading `~/.config/mcpm/servers.json` once per
  sync — every server already known to mcpm short-circuits, so a
  steady-state `agentbrew sync` pays zero subprocess tax. Failures are
  non-fatal and the carve-out native sync path runs independently.
  Closes slice 2 of `bridge-mcp-sync-to-mcpm-for-intersection`.
- `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1)
- `SECURITY.md` (vulnerability reporting policy)
- "The problem" section in README explaining the use case
- `isGitHubEnterprise()` helper for generic GHE detection

### Fixed
- Sync-runner tests making real network calls (14 failures → 0)
- Unused `vi` import lint warning in env-vars test

### Changed
- GHE detection generalized from hardcoded `github.example.com` to any enterprise host
- Package.json repository URL updated to `github.com/fyodoriv/agentbrew`

## [0.2.1] - 2026-04-05

### Added
- GITHUB_TOKEN resolution via `gh auth token` fallback for literal-format agents
- Experimental marker for skills-only agent definitions
- Shell hook for project detection (`agentbrew hook install --shell`)
- Agentfile support — declarative manifest (`Agentfile.yaml`) for agent config
- `agentbrew install --git` for MCP servers from git repos
- `agentbrew sync --pull` to fetch latest from sources before deploying
- `agentbrew sync --rollback` to restore from pre-sync snapshot
- `agentbrew lint` for config validation (exit 1 on errors)
- `agentbrew export/import` for portable config bundles
- `agentbrew team set/sync/check` for shared team baselines
- Expanded curated catalog (skills, MCP servers, and rule sets — see `src/catalog.yaml`)
- Support for every agent in the README agent matrix including Copilot, Kiro, Amp, Overlay Desktop
- Background drift detection and auto-repair every 30 minutes
- Lock file with SHA pinning for skill sources

[Unreleased]: https://github.com/fyodoriv/agentbrew/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/fyodoriv/agentbrew/releases/tag/v0.2.1
