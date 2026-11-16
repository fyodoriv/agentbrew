# Org overlay update plan: adopt the 2026-11 core

**Task**: `org-overlay-adopt-core-2026-11` in [TASKS.md](../../TASKS.md).
**Who runs it**: an agent or person on a company machine, in the company
plugin repo (`agentbrew-<org>`, called `<org-overlay>` below). The personal
Mac never touches that repo. Nothing company-specific ever comes back into
this public repo.
**Contract**: [README "Plugins"](../../README.md#migrating-from-team-overlays-10)
(the plugin system), [hook-protocol.md](../hook-protocol.md) (hooks and the
hooks overlay), [ci.md](../ci.md) (hosted CI) and
[observability.md](../observability.md#org-log-sink) (the org log sink).
**Sibling plan**: the dotfiles side is the dotfiles repo's
`docs/plans/plugin-update-plan.md` (task `org-plugin-adopt-core-2026-11`).
Run both in the same rollout.

## Why

In November 2026 the agentbrew core changed in five ways that a company
overlay must follow. An overlay that does nothing mostly keeps working, but:

| Area | What changed in the core | What an overlay misses if it does nothing |
|---|---|---|
| Public repo | The core is public on github.com. Its leak gates (pre-commit, pre-push, `gh`) fail closed. agentbrew 1.0 removed `catalog-overlay.yaml` and team overlays; org content ships as a signed company plugin. | A legacy `catalog-overlay.yaml` is ignored, so its skills and MCP servers silently disappear. Leaks into the public core get blocked late, or not at all without the pattern file. |
| CI | Tests run on hosted CI, not on laptops. the opt-in PreToolUse hook `block-local-tests` blocks local test runs in an agentbrew checkout (opt-out `AGENTBREW_ALLOW_LOCAL_TESTS=1`). Core CI pins actions to SHAs and caches only what was measured to help. | Agents on company laptops get blocked mid-task. Unpinned actions (`@v4`) and no early warning when a core change breaks the overlay. |
| Telemetry | One policy file, `~/.config/agentbrew/telemetry-sink.json`, sends events and error lines to a company log system. | Company machines send opt-in events to the public PostHog project, or send nothing. |
| Rust | The core prebuilds and rebuilds its native helpers (`checkup-run`, `publish-dist`). Hooks stay in shell. | Nothing, unless the overlay calls a core script or binary by path. |
| Docs and metrics | The docs map, metrics and scorecard are current. | Employee docs point at removed commands (`agentbrew team ...`). |

## Before you start

Get these from the owner. Do not guess any of them.

1. A written yes from the company security or IT contact to send events and
   error lines to the company log system. With no written yes, stop the
   telemetry work (skip step 4) and do the rest.
2. The log system details, exactly as task
   `org-overlay-splunk-sink-agentbrew` lists them (HEC URL, index, token and
   where it is kept, consent mode `managed` or `ask`, error logs on or off).
   That task block is the single source; this plan does not copy its values.
3. The signer key that signs `<org-overlay>` tags, and the company Git host
   (for example `github.example.com`).
4. An agentbrew core commit that has this plan:
   `rg -c "org-overlay-update-plan" docs/README.md` prints 1 or more. Write
   down its full SHA. This is `CORE_REF` below.
5. Whether the company host runs GitHub Actions, and which runner labels and
   allowed-actions list it uses.

**Token rule**: never paste, print, log or commit the token. The owner stores
it, and the policy names only the place. Preferred place: the macOS Keychain,
added by the owner (`security add-generic-password -s org-telemetry -a
hec_token -w`, which asks for the value). Other places: a file that group and
others cannot read, or an env var name. The same rule holds for the signer's
private key and any CI secret.

## Step 1: public boundary and plugin form (every overlay)

1. Keep `<org-overlay>` private, on the company host.
2. If it still has `catalog-overlay.yaml` or relies on `agentbrew team set`,
   migrate it: `agentbrew plugin migrate <overlay-dir>` prints a draft
   `agentbrew-plugin.yaml` and a list of what it could not map. Fix each
   listed item by hand (README "Migrating from team overlays").
3. Keep the private-reference pattern in the overlay: list it under
   `contributes.leak_patterns` (POSIX ERE regexes), and keep the machine's
   `~/.config/oss-readiness/oss-readiness.env` in place. The core gates load
   it and block when it is missing or older than the minimum version. Report
   a block; never work around it. Only a human may set an override.
4. Never open an issue or PR on the public core that names the company, a
   company host, an index or a person. Use `<org-overlay>`, `*.example.com`,
   `github.example.com` and `PROJ-123`. Report core bugs with
   `agentbrew report` (it scrubs first; no `--yes`).
5. Check: `agentbrew plugin test <overlay-dir>` exits 0, and in a core
   checkout `agentbrew plugin leak-audit` exits 0.

## Step 2: hooks (every overlay with hooks)

1. Ship overlay hooks through `contributes.hooks` in `agentbrew-plugin.yaml`,
   not by editing `~/.claude/settings.json` or the core manifest.
   Declare every hook event in `capabilities.hooks` (`Event` or
   `Event:matcher`). Capabilities are deny by default; an undeclared event
   makes `plugin add` and `sync` exit 3 with `capability not declared`.
2. Per-machine choices (turn a core hook off or an opt-in hook on) stay in
   `~/.config/agentbrew/hooks-overlay/manifest.yaml` (`disabled:` /
   `enabled:`). The overlay may document them; it must not overwrite that
   file.
3. The core hook `block-local-tests` blocks local test runs inside an
   agentbrew checkout. It is opt-in: add it under `enabled:` in the hooks
   overlay. Do not disable it fleet-wide. A person who must reproduce a CI
   failure exports `AGENTBREW_ALLOW_LOCAL_TESTS=1` before the agent starts;
   setting it inside an agent command has no effect ([CI](../ci.md#tests-run-on-hosted-ci-only)).
4. Check: `agentbrew sync --dry-run` lists the overlay hooks and shows no
   conflict with a core hook ID.

## Step 3: CI (every overlay)

1. Run the overlay's checks on hosted CI on every pull request:
   `agentbrew plugin test .` against the core at `CORE_REF`.
2. Pin every `uses:` line to a full commit SHA with the tag as a comment, as
   the core `.github/workflows/ci.yml` does. On GitHub Enterprise, use the
   same SHA on that host or the company's approved mirror, pinned by SHA.
   Never fall back to a tag.
3. Add a cache only when a measured run shows a gain: record the job time
   with and without it on two runs each, and keep it only if it saves 20% or
   more. Key the cache on every input that changes the result.
4. Add a weekly `schedule:` job that runs the same checks against the newest
   core `main`, so a core change that breaks the overlay shows up before a
   person's machine breaks.
5. Use the company's standard runners. Do not pick a larger or billed runner
   without the owner's yes.
6. Run no tests on the laptop: push a branch and read the CI result. Locally
   run only `agentbrew plugin test .` and linters.
7. Check: CI is green on the pull request, and the first weekly run is green.

## Step 4: telemetry sink (only with the written yes)

1. Follow task `org-overlay-splunk-sink-agentbrew` in [TASKS.md](../../TASKS.md)
   step by step. It holds the policy format, the invalid-policy rules, what
   the log system receives, the `kind: file` forwarder option and the known
   limit. Do this step as part of that task; do not open a second one.
2. Delivery: the agentbrew plugin manifest has no telemetry-sink
   contribution, so the Splunk task's fallback route applies. Deliver `~/.config/agentbrew/telemetry-sink.json` (mode 600)
   through the dotfiles company plugin, next to its own dotfiles policy
   (dotfiles plan step 3). Use sourcetype `agentbrew:telemetry` and source
   `agentbrew`.
3. If a machine already has a hand-placed policy with different bytes,
   remove that one file during rollout (step 7), then apply.
4. Add the Splunk task's overlay test (step 3 there): it runs
   `agentbrew telemetry status` in a scratch HOME with the policy and fails
   on `sink policy invalid`. It runs in overlay CI.
5. Check: `agentbrew telemetry status` shows the company sink and no
   `sink policy invalid`.

## Step 5: Rust and core paths (every overlay)

1. Find every core path the overlay calls:
   `rg -n 'apps/tooling/agentbrew|AGENTBREW_DIR|agentbrew/(dist|scripts|native|hooks)/' <overlay-dir>`.
2. Replace each hit with a documented `agentbrew <command>`. Never call a core
   script, hook or native binary by path.
3. Native helpers are core internals. The core build prebuilds them and
   `agentbrew` rebuilds or falls back on its own. The overlay adds no Rust code
   and leaves `contributes.native` unused unless the core docs describe it.
4. Overlay hooks stay shell scripts that run under macOS `/bin/bash` 3.2.
5. Check: the hit list from item 1 is empty, and CI (step 3) is green against
   `CORE_REF`.

## Step 6: docs and metrics (every overlay)

1. Overlay README: install (`agentbrew plugin add <url>@<tag> --signer ...`),
   update, check commands, the `CORE_REF` it is built for, and a "Where tests
   run" line (CI only).
2. One employee doc page: what telemetry is sent, where it goes, how to stop
   it (`agentbrew telemetry off`), and who approved it.
3. Remove every mention of `agentbrew team` and `catalog-overlay.yaml`:
   `rg -n 'agentbrew team|catalog-overlay' <overlay-dir>` prints nothing.
4. Record the rollout numbers (step 8) in the overlay CHANGELOG or release
   notes.

## Step 7: release and roll out

1. Bump the version in `agentbrew-plugin.yaml`. Create a signed tag:
   `git tag -s vX.Y.Z -m vX.Y.Z`, then push the tag.
2. On one company machine: `agentbrew plugin update <name> vX.Y.Z` (without a
   tag it only lists refs). A capability change always asks at a terminal,
   even with `--yes`. Approve it, then run `agentbrew sync`.
3. Run step 8 there. Then roll out to the other machines.

## Step 8: verify (paste the output in the overlay PR or release notes)

```sh
agentbrew plugin list
agentbrew plugin test <overlay-dir>
agentbrew telemetry status
agentbrew telemetry send --dry-run
agentbrew telemetry send; echo "exit=$?"
```

Expected:
- The plugin shows the new version, locked and verified.
- `status` shows the company sink, the consent mode and the token source
  kind, with no token value. The dry run names no public address. The send
  exits 0.
- One event is found with `index=<index> sourcetype=agentbrew:* | stats count
  by host` (paste it with host names removed).
- Overlay CI is green on the PR and on the weekly run.
- In a core checkout, the leak check prints 0.

## Rollback

1. `agentbrew plugin rollback <name>` returns to the previous locked tag;
   then `agentbrew sync`.
2. To stop telemetry on one machine: `agentbrew telemetry off`. To stop it
   fleet-wide: remove the policy file from the dotfiles plugin and release.
   With no file, nothing changes from the public default (which is still
   opt-in).
3. If the new CI blocks merges for a reason unrelated to the overlay, mark
   the weekly job non-required; do not remove pins.

## Verification checklist

- [ ] `agentbrew plugin test <overlay-dir>` exits 0.
- [ ] No `catalog-overlay.yaml` or `agentbrew team` left.
- [ ] Every `uses:` pinned by SHA; each cache has a measured gain.
- [ ] Weekly run against newest core is green.
- [ ] No core path called by path (step 5 list empty).
- [ ] Telemetry: status, dry run and send as expected (only with the yes).
- [ ] Employee doc page published.
- [ ] Public core leak check prints 0.

## Measurement

- **Hypothesis**: overlay breaks caught by CI before a company machine breaks
  go from 0 (no weekly core check) to every break the weekly job sees; company
  machines on the plugin form, with 0 legacy `catalog-overlay.yaml` use, go
  from unknown to every machine with the overlay.
- **Measurement**: `agentbrew plugin list && agentbrew plugin test
  <overlay-dir>; echo "exit=$?"` on each machine, plus the weekly CI result.
- **Success**: exit 0 on every machine, and the first weekly run is green.
- **Pivot**: if more than 1 in 4 weekly runs fail for core reasons the overlay
  cannot fix, stop tracking newest `main` and track tagged core releases.
- **Anchor**: Basili, Caldiera, Rombach 1994 (Goal Question Metric);
  Forsgren, Humble, Kim 2018 (*Accelerate*, change failure rate).

## Done

Delete the `org-overlay-adopt-core-2026-11` block from the public TASKS.md
in a PR that names no company detail.
