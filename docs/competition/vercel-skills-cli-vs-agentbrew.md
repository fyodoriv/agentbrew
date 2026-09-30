# Vercel `skills` CLI vs agentbrew — Detailed Comparison

> **Scope**: This doc is the definitive strategic and technical analysis of `npx skills` (Vercel Labs) against agentbrew's skill installation subsystem. It's the backing evidence for the [**Contribute** verdict in COMPETITION.md](../COMPETITION.md#build-or-contribute--per-competitor-summary) and the now-retired `delegate-skill-install-to-skills-cli` parent task (PR #N retired 2026-04-28; residual sandbox / proxy / offline child closed 2026-05-02).
>
> **Last researched**: 2026-05-02 sandbox / proxy / offline measurement + supported-agent refresh; broader competition / fork-inventory facts from 2026-04-24 night refresh #5 (2 new fork draft PRs for #840 and #523; earlier night refresh #4 added 1 draft for #561; refresh #3 added 1 draft for #745; refresh #2 added 2 drafts for #793/#666; refresh #1 added 4 drafts for #941/#916/#953/#886; late-evening refresh added 3 drafts for #960/#982/#1010; evening refresh added upstream issue scan + delegate measurements; morning refresh captured stars/forks/PR movement; deep pass 2026-04-19). Source-of-truth links: [vercel-labs/skills README](https://raw.githubusercontent.com/vercel-labs/skills/main/README.md), [AGENTS.md](https://github.com/vercel-labs/skills/blob/main/AGENTS.md), [src/agents.ts](https://github.com/vercel-labs/skills/blob/main/src/agents.ts), [skills.sh](https://skills.sh).
>
> **What changed since 2026-04-24 night refresh #5** (2026-05-02 targeted measurement):
> - **Agent support expanded and one carve-out disappeared.** Skills CLI now advertises 54 targets: the prior 45 plus `aider-desk`, `codearts-agent`, `codemaker`, `codestudio`, `devin`, `dexto`, `forgecode`, `rovodev`, and `tabnine-cli`. Agentbrew mirrored the 8 net-new skills-only targets it did not already have, and `devin` now delegates through skills CLI instead of staying native.
> - **Kiro feature support changed.** Skills CLI's compatibility table now marks Kiro CLI as hooks-capable but still not allowed-tools-capable; agentbrew mirrored this as `supportedSkillFeatures: [hooks]`.
> - **Residual sandbox / proxy / offline gate closed.** In a Devin-run enterprise macOS session using an isolated temporary `HOME` and temporary project directory, `npx -y skills add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code -y --copy` completed on the current network (cold: exit 0 in 2.04s; warm: exit 0 in 1.89s) and with warm npm cache plus `npm_config_offline=true` and invalid HTTP(S) proxy (exit 0 in 1.44s). A cold offline cache failed fast with `ENOTCACHED` in 0.32s, which is expected and not worse than agentbrew's own first-time remote-source path.
> - **Strategic state unchanged but confidence upgraded.** Skill installation remains **Contribute / delegated split-strategy**: 51 exact-name agents plus 3 rename pairs use `npx skills add`; the 2 carve-outs (`claude-desktop`, `overlay-desktop`) stay native because upstream still lacks those targets / semantics.
>
> **What changed since 2026-04-24 night refresh #4** (2026-04-24 night refresh #5, same day):
> - **Fork draft inventory now 21, not 19.** Two additional drafts staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls):
>   - [**fork#20**](https://github.com/fyodoriv/skills/pull/20) — [vercel-labs/skills#840](https://github.com/vercel-labs/skills/issues/840) `skills update` swallows subprocess output. The update loop spawns one child per skill with `stdio: ['inherit', 'pipe', 'pipe']`, captures stderr/stdout, and then prints only `✗ Failed to update <skill>` on failure with no diagnostic info — even at `--verbose` / `DEBUG=1`. Reporters explicitly asked for the underlying error message so they could self-diagnose Windows-specific failures. Extracts `formatUpdateFailureMessage(safeName, result)` (`src/update-error-output.ts`) that emits indented log lines for spawn-level errors, signal termination, captured stderr (preferred) / stdout (fallback), or exit-code last resort. Output is bounded (≤20 lines, ≤240 chars per line) and sanitized via `sanitizeMetadata` (CWE-150 defense). Both update call sites route through the helper. 13 unit tests covering header, stderr verbatim, stdout fallback, exit-code last resort, spawn-level Error, signal, ANSI strip, Buffer input, blank-line skip, line overflow, line truncation, status-0 no-op, CRLF normalization. +242 / −2 LOC.
>   - [**fork#21**](https://github.com/fyodoriv/skills/pull/21) — [vercel-labs/skills#523](https://github.com/vercel-labs/skills/issues/523) (and the closed [#328](https://github.com/vercel-labs/skills/issues/328)) `getGitHubToken` unconditionally invokes `gh auth token` via `execSync` when no `GITHUB_TOKEN` / `GH_TOKEN` is set — even for public-repo installs that do not need auth. On corporate Windows machines this triggers Microsoft Defender for Endpoint and Intune MDM alerts that flag the spawn as credential-extraction malware (one reporter said Intune MDM revoked the entire device from its domain). Adds `SKILLS_NO_GH_AUTH=1` opt-out (also `true` / `yes`, case-insensitive, whitespace-trimmed). When set, the gh CLI fallback is skipped and `getGitHubToken` returns `null` — explicit `GITHUB_TOKEN` / `GH_TOKEN` continue to work. Default behavior is unchanged: users who don't set the env-var still get the gh CLI fallback for the API rate-limit boost. Extracts the resolution logic into `src/github-auth.ts` as a pure `resolveGitHubToken({ env, runGhAuthToken })` helper for testability. 22 unit tests covering env-var priority, all three opt-out values, strict allowlist (typos like `maybe`/`on` are NOT opt-out), opt-out passthrough for explicit env-var tokens, gh CLI failure paths (throws / empty / whitespace-only), trailing-newline trimming. +237 / −26 LOC.
> - **All 19 prior fork-draft target issues confirmed still OPEN** on vercel-labs/skills as of this refresh: #561, #666, #745, #781, #793, #806, #808, #886, #916, #941, #953, #954, #960, #982, #999, #1001, #1005, #1010. Zero auto-closures since night refresh #4; zero maintainer activity on PR #630 / #509 / issue #283.
> - **Combined fork inventory**: **+2,430 / −157 LOC across 21 drafts, 18 distinct upstream bug reports**.
>
> **What changed since 2026-04-24 night refresh #3** (2026-04-24 night refresh #4, same day):
> - **Fork draft inventory now 19, not 18.** One additional draft staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls):
>   - [**fork#19**](https://github.com/fyodoriv/skills/pull/19) — [vercel-labs/skills#561](https://github.com/vercel-labs/skills/issues/561) `npx skills add ./docs` records the absolute machine-specific path (`/Users/alice/repos/project/docs`) in the checked-in `skills-lock.json`. Other developers running `experimental_install` from the same project hit a path that doesn't exist on their machine — the lock leaks per-developer state. Adds `getLocalLockSource(absolutePath, cwd)` helper that returns `./relative/path` (POSIX separators, platform-portable JSON) when the path is inside cwd, and keeps the absolute path when outside cwd (cross-project installs are rare; relative paths like `../../../tmp/x` are too fragile for a checked-in lock). +80 / −3 LOC; 6 new unit tests (inside-cwd, nested, cwd-itself, outside-cwd, sibling-project, already-relative passthrough).
> - **Combined fork inventory**: **+1,951 / −129 LOC across 19 drafts, 16 distinct upstream bug reports**.
>
> **What changed since 2026-04-24 night refresh #2** (2026-04-24 night refresh #3, same day):
> - **Fork draft inventory now 18, not 17.** One additional draft staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls):
>   - [**fork#18**](https://github.com/fyodoriv/skills/pull/18) — [vercel-labs/skills#745](https://github.com/vercel-labs/skills/issues/745) `npx skills add <src> -g -y -a claude-code --skill <name>` silently flips installMode to copy, skipping the canonical `~/.agents/skills/` dir entirely; files end up only at `~/.claude/skills/<name>/` (a copy, not a symlink). The auto-default rule `if (uniqueDirs.size <= 1) installMode = 'copy'` is correct for project-scope installs but wrong for `-g`: the canonical `~/.agents/skills/` dir is always distinct from the agent dir, so symlink IS meaningful even with one agent. Extracts `shouldAutoDefaultToCopy()` as a pure helper; guard now requires `NOT installGlobally`. Both call sites (well-known + github/local) updated identically. 6 new unit tests covering project + 1 agent (copy preserved), global + 1 agent (the bug fixed), global + N agents, explicit `--copy`, multi-dir prompt path, 0-agent edge case. +131 / −7 LOC.
> - **Combined fork inventory**: **+1,871 / −126 LOC across 18 drafts, 15 distinct upstream bug reports**.
>
> **What changed since 2026-04-24 night refresh #1** (2026-04-24 night refresh #2, same day):
> - **Fork draft inventory now 17, not 15.** Two additional drafts staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls):
>   - [**fork#16**](https://github.com/fyodoriv/skills/pull/16) — [vercel-labs/skills#793](https://github.com/vercel-labs/skills/issues/793) `npx skills add <src> -yg --agent <agent>` silently drops `-yg` as an unknown token, leaving both `options.yes` and `options.global` unset and re-prompting "Installation scope" despite the `-y -g` user intent. POSIX-style combined short flags (`-yg` ≡ `-y -g`, like `tar -xvf`, `ls -la`) — every mainstream parser supports them; this CLI's hand-rolled `parseAddOptions` did not. Adds `expandCombinedShortFlags` helper with conservative split rule: `-yx` (unknown letter) stays a single token rather than activating `-y` from a typo. Allowlist limited to `{y, g, l}` — the value-less booleans. 5 new tests covering `-yg`, `-gy`, `-ygl`, the unknown-letter passthrough, and the long-flag passthrough. +71 / −0 LOC. Same class as the closed [#195](https://github.com/vercel-labs/skills/issues/195).
>   - [**fork#17**](https://github.com/fyodoriv/skills/pull/17) — [vercel-labs/skills#666](https://github.com/vercel-labs/skills/issues/666) `npx skills experimental_install` fails for any well-known source because the local `skills-lock.json` saves only the hostname (`react-spectrum.adobe.com`), and the installer misclassifies the bare hostname as a git source — `git clone <hostname>` fails. The **global** lock already had a `sourceUrl` field for the original install URL; the **local** lock didn't. Adds optional `sourceUrl` to `LocalSkillLockEntry`, persists the full `https://...` URL on well-known writes, and extracts a pure `resolveLockEntrySource()` function that prefers `sourceUrl` over `source` and recovers legacy hostname-only entries by prepending `https://`. Backward-compat is the explicit goal — old lock files restore without manual edits. 8 new tests in `tests/install-from-lock.test.ts` + 1 schema test in `tests/local-lock.test.ts`. +159 / −2 LOC. Full test suite green: 439/439.
> - **All 15 prior fork-draft target issues confirmed still OPEN** on vercel-labs/skills as of this refresh: #781, #806, #808, #886, #916, #941, #953, #954, #960, #982, #999, #1001, #1005, #1010. Zero auto-closures since 2026-04-24 night refresh #1; zero maintainer activity on PR #630 / #509 / issue #283 since the late-evening refresh.
> - **No new bug-tagged issues filed since 2026-04-24** (last bug-labeled issue was #999 on 2026-04-23). Two non-bug feature requests this morning (#1006 manifest-based default, #1009 ctx tool integration) are scope-expansion proposals, not bug fixes — leave to upstream.
> - **Combined fork inventory**: **+1,740 / −119 LOC across 17 drafts, 14 distinct upstream bug reports**.
>
> **What changed since 2026-04-24 late-evening refresh** (2026-04-24 night refresh, same day):
> - **Fork draft inventory now 15, not 11.** Four additional drafts staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls):
>   - [**fork#12**](https://github.com/fyodoriv/skills/pull/12) — [vercel-labs/skills#941](https://github.com/vercel-labs/skills/issues/941) `skills update` fails silently on Windows when `process.execPath` contains spaces (`C:\Program Files\nodejs\node.exe`). Extracts `buildUpdateSpawnPlan` helper (`src/update-spawn.ts`) that quotes execPath + whitespace-bearing args when `shell: true` routes through `cmd.exe`. 8 unit tests covering POSIX, Windows, arg-order parity, and embedded-quote escaping. +188 / −4 LOC.
>   - [**fork#13**](https://github.com/fyodoriv/skills/pull/13) — [vercel-labs/skills#916](https://github.com/vercel-labs/skills/issues/916) `npx skills update -p -y` creates a `skills/` folder at project root. Root cause: when `-y` is set with 0 detected agents, `add` falls through to "install to all agents" — including openclaw with `skillsDir: 'skills'`. Switches both fallback sites in `src/add.ts` to universal-agents-only (`.agents/skills/`). 2 regression tests with `HOME=<tmpdir>`. +98 / −4 LOC.
>   - [**fork#14**](https://github.com/fyodoriv/skills/pull/14) — [vercel-labs/skills#953](https://github.com/vercel-labs/skills/issues/953) `npx skills add` corrupts binary files from well-known endpoints and inflates file size. Root cause: `response.text()` decodes binary as UTF-8 → `U+FFFD` replacements → 3-byte `0xEF 0xBF 0xBD` re-encoded back. Changes `WellKnownSkill.files` from `Map<string, string>` to `Map<string, Uint8Array>`; uses `arrayBuffer()` everywhere in the fetch path; `writeFile(path, bytes)` with no encoding. 3 regression tests including a 4 KB byte-identity check. +243 / −12 LOC. **Verified bug exists on main** by stashing fix and watching tests fail (4096 → 8192 byte inflation).
>   - [**fork#15**](https://github.com/fyodoriv/skills/pull/15) — [vercel-labs/skills#886](https://github.com/vercel-labs/skills/issues/886) `npx skills add ./.agents/skills -s <name>` deletes the user's source SKILL.md when source overlaps the canonical install path. Root cause: `installSkillForAgent` always called `cleanAndCreateDirectory(canonicalDir)` (rm -rf + mkdir) before `copyDirectory(skill.path, canonicalDir)` — so when source and canonical resolved to the same physical directory, the source was destroyed before the copy could read it. Fix introduces `isSamePath(a, b)` helper (mirrors the existing `realpath` + `resolveParentSymlinks` pattern in `createSymlink`) and short-circuits clean+copy at three call sites: copy mode, symlink mode canonical write, symlink-fallback copy. 3 regression tests; **bug verified to exist on main** (test 1 + test 2 fail with ENOENT after rm -rf wipes source). +194 / −6 LOC. Data-loss bug, high impact.
> - **#985 schema-version-mismatch and #997 self-hosted-GitLab** still parked — same blockers as before (spec confirmation needed for #985; live GitLab instance needed for #997).
> - **#983 (`npx skills` ENOENT no package.json)** confirmed not skills-CLI-side: the error is raised by `npx` itself trying to read package.json. Upstream workaround `npm install -g skills` is correct; would need a docs change rather than code.
>
> **What changed since 2026-04-24 evening refresh** (2026-04-24 late-evening refresh, same day):
> - **Fork draft inventory grew from 8 to 11.** Three new drafts:
>   - [**fork#9**](https://github.com/fyodoriv/skills/pull/9) — [vercel-labs/skills#960](https://github.com/vercel-labs/skills/issues/960) `<subcommand> --help` executes the subcommand. Single-guard fix at top of `main()` in `src/cli.ts`; 15 new vitest cases covering every mutating subcommand + alias. Classic CLI bug, user-reported, zero controversy. +70 / −6 LOC.
>   - [**fork#10**](https://github.com/fyodoriv/skills/pull/10) — [vercel-labs/skills#982](https://github.com/vercel-labs/skills/issues/982) `skills update -p <name>` installs every skill in the source. Root cause fully diagnosed in the upstream issue (local lock has no `skillPath`). Fix adds `-s <name>` narrowing via new `buildLocalUpdateAddArgs()` helper. 2 unit tests. +48 / −9 LOC.
>   - [**fork#11**](https://github.com/fyodoriv/skills/pull/11) — [vercel-labs/skills#1010](https://github.com/vercel-labs/skills/issues/1010) (error-UX half only) detect `spawn git ENOENT` in `cloneRepo` and replace the raw stack trace with an actionable install hint. New `isGitMissingError()` predicate + `isGitMissing` flag on `GitCloneError`. 5 unit tests. +70 / −1 LOC. The allowlist half of #1010 stays in the issue conversation queue.
> - **Zero upstream movement** between the two 2026-04-24 refreshes: same star count, same PR queue, same issue counts. No maintainer comments on PR #630 (status/drift), #509 (validator), or issue #283 (install-from-lockfile). The 90-day engagement window countdown unchanged.
>
> **What changed since 2026-04-24 morning refresh** (2026-04-24 evening refresh):
> - **Measurements for `delegate-skill-install-to-skills-cli` recorded** (was the main gap — see [§ Delegate measurements](#delegate-measurements-2026-04-24-evening) below). Subprocess latency: ~0.5s warm, ~1s first-in-shell — tolerable. At that point, agent parity was **45 vs 45 but with a 6-agent rename delta + 3 agentbrew-unique carve-outs** (`claude-desktop`, `devin`, `overlay-desktop`) + 3 skills-CLI-unique gaps (`bob`, `deepagents`, `firebender`); the 2026-05-02 refresh supersedes the current parity numbers. Sandbox/proxy/offline: clear on author's laptop; org proxy + Devin sandbox were still untested in this 2026-04-24 snapshot and later closed PASS on 2026-05-02.
> - **8 new upstream bugs filed since the 2026-04-19 survey** (none opened between 2026-04-24 morning refresh and this one). Candidates for additional trust-building PRs: [#1010](https://github.com/vercel-labs/skills/issues/1010) (spawn `git` ENOENT on Windows without git), [#997](https://github.com/vercel-labs/skills/issues/997) (update fails for self-hosted GitLab normalized URL), [#985](https://github.com/vercel-labs/skills/issues/985) (`.well-known/agent-skills/index.json` not fetched), [#983](https://github.com/vercel-labs/skills/issues/983) (`npx skills` ENOENT when no `package.json` in cwd), [#977](https://github.com/vercel-labs/skills/issues/977) (duplicate of our draft #3 target #808), [#974](https://github.com/vercel-labs/skills/issues/974) (`-g` combined with `-a` overrides symlinking), [#969](https://github.com/vercel-labs/skills/issues/969) (multiselect duplicate options), [#960](https://github.com/vercel-labs/skills/issues/960) (subcommand `--help` executes the subcommand instead of printing help).
> - **Fork draft inventory now 8, not 5** — PRs #1–#3 (alternative approach to #806 via hashing installed layout + #781 Windows line-ending hash + #808 remove-doesn't-clean-lock) were also staged on 2026-04-24 as exploratory alternatives to PRs #4–#8. All still OPEN drafts; upstream targets have zero maintainer activity since staging. See [§ Fork draft inventory](#fork-draft-inventory-2026-04-24) for the full table.
> - **Agent compatibility matrix cross-checked against `src/agents.ts`** (not just the README table). In the 2026-04-24 snapshot, skills CLI listed 45 `AgentType` entries in `src/types.ts` (including `universal`) and 35 concrete `AgentConfig` records in `src/agents.ts` (the remaining 10 were meta / aliases / unsupported). Agentbrew's then-current 45 entries in `src/core/agents.yaml` aligned on 39 names, diverged on 6 (rename pairs), and extended by 3 (agentbrew-unique).
>
> **What changed since 2026-04-19** (2026-04-24 morning refresh, preserved for history):
> - Stars: 14.6K → **15,941** (+9.2% in 5 days — active adoption continues)
> - Forks: 1.2K → **1,302**
> - Open issues: 266 → **521** (nearly doubled — issue backlog is growing faster than maintainers can triage)
> - Open PRs: 219 → **230**
> - New releases: v1.4.8 → v1.4.9 → v1.5.0 → **v1.5.1** (2026-04-17)
> - Latest push to main: 2026-04-22 (2 days ago)
> - Latest main commit: `5516b8a feat: add heygen-com to blob download allowlist and sanitize untrusted metadata`
> - **Zero movement on agentbrew's contribution candidates**: PR #630 (status/drift) still OPEN + stuck since 2026-04-03 despite Elliot Liu's approval + `--fix` suggestion; PR #509 (validator) still open (now 50+ days); PRs #609/#611/#869/#944 (user-safety) still all open, no consolidation. Issue #283 (install-from-lockfile) got fresh activity 2026-04-21 but no status change. Issue #806 (hash verification mismatch — our trust-building-PR target) still OPEN, no recent comments.
> - Agent compatibility matrix: unchanged in the README (still the 18-agent table with claude-code supporting all features, cline supporting allowed-tools + hooks, kiro + zencoder opting out of allowed-tools). Agentbrew mirrored this matrix into `src/core/agents.yaml` in PR #689 (2026-04-24). Next refresh tied to `re-research-stale-competitors` in TASKS.md.
>
> **Strategic takeaway from the refresh**: the 90-day engagement window (VISION.md "Delegate, contribute, absorb") is past the halfway mark on every maintainer-side engagement signal. Elliot's approval of #630 dates to mid-March; Andrew Qu's "great idea! WIP" on #283 dates to 2026-02-18. If the next 45 days pass without #630 merging or #283 producing a WIP branch, the absorption case for drift-detection and lockfile-sync gets stronger. The user-safety PR backlog (4 competing implementations, zero merges) confirms the "neglect, not rejection" governance pattern documented below.
>
> **Five draft PRs staged in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls) on 2026-04-24** (not yet sent upstream — awaiting user review, then targeted at `vercel-labs/skills:main`). Each lands a narrow, high-confidence fix on the contribution-candidate surface identified below. The queue-saturation strategy is to ship small, focused, uncontroversial bug fixes first (to establish trust per the "Trust correlates with merge speed" pattern) before returning to the larger drift/validator/manifest threads.
>
> | Draft | Target issue | Shape | Scope |
> |---|---|---|---|
> | [#4](https://github.com/fyodoriv/skills/pull/4) | [#806](https://github.com/vercel-labs/skills/issues/806) | Align `computedHash` with installer's file filter; lock-file `computedHash` becomes verifiable against installed files | +221 / −13 LOC, 3 unit + 2 e2e tests |
> | [#5](https://github.com/fyodoriv/skills/pull/5) | [#1005](https://github.com/vercel-labs/skills/issues/1005) | Preserve `owner/repo/<subpath>` in lock write-back; extracts `getLockSource()` helper. Precedent: #588 | +89 / −7 LOC, 8 unit tests |
> | [#6](https://github.com/fyodoriv/skills/pull/6) | [#1001](https://github.com/vercel-labs/skills/issues/1001) | Drop ASCII banner from `skills find` output (agentic workflow friendliness); matches `list`/`check`/`update` | +8 / −1 LOC, 1 unit test |
> | [#7](https://github.com/fyodoriv/skills/pull/7) | [#999](https://github.com/vercel-labs/skills/issues/999) | Persist full URL (not truncated identifier) in local `skills-lock.json` for well-known skills | +7 / −2 LOC |
> | [#8](https://github.com/fyodoriv/skills/pull/8) | [#954](https://github.com/vercel-labs/skills/issues/954) | Make `skills check` read-only as AGENTS.md documents — threads `checkOnly` through `runUpdate` → `updateGlobalSkills` / `updateProjectSkills` | +60 / −20 LOC |
>
> Combined: +385 / −43 LOC of upstream-targetable fixes, covering 5 distinct open bug reports. Three of the 5 are in the "lock file write-back drops information" bug class — they plausibly bundle into one commit for faster review.

---

## TL;DR

**Skills CLI is ~80% functionally redundant with agentbrew's skill installer, and agentbrew already shells out to `npx skills add` as a fallback** (see [`src/add-source.ts:192`](../../src/add-source.ts#L192)). The strategic question isn't *whether* to delegate — we already partially do — it's whether to **make `npx skills` the primary installer and delete agentbrew's native git-clone → symlink pipeline**.

**The honest numbers:**
- **Skills CLI**: 16.7K stars, 1.3K forks, npm `skills` v1.5.3, 265 open issues, 211 open PRs, MIT, **50+ supported agents**, active Vercel Labs backing.
- **Agentbrew skill subsystem**: **~4,660 non-test LOC across 18 files**, 7,840 test LOC, **50+ supported agents**. The install pipeline alone is ~1,600 LOC.
- **Realistic shrink from full delegation**: **~1,000–1,500 lines**, not the "~2K" originally estimated in COMPETITION.md. Validation, display, drift detection, and lock-file logic would all stay.

**Current integration state**: the now-retired `delegate-skill-install-to-skills-cli` parent task shipped all execution slices and the 2026-05-02 measurement cleared the sandbox / proxy / offline gate. Current parity is 54 delegated skills-CLI targets (51 exact-name pass-through + 3 rename pairs) and 2 native carve-outs (`claude-desktop`, `overlay-desktop`).

**Beyond the main install delegation**, this doc also applies the "Contribute first, build second" principle feature-by-feature to **every agentbrew-only skill-subsystem feature** — 10 features, each with a structured contribution analysis (fit, effort, receptivity, user benefit, recommended action). See the [Contribution roadmap](#contribution-roadmap--priority-ordered) for the priority-ordered list. Headline finding: **4 additional upstream PR candidates** (validator, user-safety, drift detection, CI flag) for another ~500 LOC agentbrew shrink on top of the install delegation. Combined potential shrink: ~1,500–2,000 LOC plus a cleaner ecosystem.

**⚠ Read the [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said) first.** A 2026-04-19 survey of all 485 open issues + 219 open PRs in `vercel-labs/skills` found that 4 of the 5 agentbrew contribution candidates **already have competing community PRs in-flight or maintainer activity**. The single clearest entry point is [**PR #630 (`skills status` for lockfile drift)**](https://github.com/vercel-labs/skills/pull/630), which collaborator Elliot Liu approved with the quote *"lockfile drift is a real pain point... Would make CI integration much smoother"* — suggesting `--fix` flag. Agentbrew's drift detection + CI contributions should bundle into that PR as commentary, not a separate implementation. The research also shows a long review queue: external feature PRs stayed open for 4–10+ weeks — so "don't duplicate in-flight work" is critical.

**⚡ The bigger question — [Should agentbrew exist at all?](#should-agentbrew-exist-at-all--dissolution-analysis)** If the ecosystem absorbs 4 of our 5 skill-slice contributions over the next 6–12 months, agentbrew's reason for existing on that slice disappears. The dissolution analysis evaluates whether to retire agentbrew entirely and invest the engineering time in upstream OSS contribution across skills CLI + mcpm.sh + others. **Verdict**: not today (7 fatal gaps including commands/hooks/instructions/multi-surface drift have no upstream home, and ecosystem is fragmented across Node/Python/Go/Rust), but the dissolution trajectory is real. Target: aggressively shrink toward a **~5K-LOC minimum viable orchestrator** that shells out to specialized tools for each surface. Quarterly re-evaluation triggers are documented.

---

## What each tool is

### Vercel Labs `skills` CLI

`npx skills` is a package manager for agentskills.io-format skills. Its job is narrow and well-scoped: given a source (`owner/repo`, full git URL, GitLab URL, or local path), discover the SKILL.md directories inside, and install them into the correct skill directory for every detected coding agent on the user's machine. It's the reference implementation for the [agentskills.io spec](https://agentskills.io) and the backend powering the [skills.sh](https://skills.sh) leaderboard (91K+ skills tracked, 4M+ total installs in the top 50).

**Core value proposition**: *one-liner skill installation across 50+ agents, with a lock file for reproducibility and a telemetry-informed public leaderboard.*

### Agentbrew

Agentbrew manages **the full configuration surface** for AI coding agents — skills + MCP servers + rules + commands + agent definitions + hooks — with a declarative YAML state file at `~/.config/agentbrew/state.yaml`, drift detection across 12 check types, auto-repair on a 30-minute schedule, and a curated catalog plus team overlay. Its skill-install subsystem is **one slice** of that offering.

**Core value proposition**: *one declarative state file, synced across every agent on your machine, with continuous drift repair.*

### The scope overlap

```
                    ┌─────────────────────────────────┐
                    │       AGENTBREW                 │
                    │                                 │
                    │  ┌────────────────────┐         │
                    │  │    SKILLS          │         │
                    │  │                    │         │
                    │  │  ┌──────────────┐  │         │
                    │  │  │ skills CLI   │  │         │
                    │  │  │ install +    │  │         │
                    │  │  │ update +     │  │         │
                    │  │  │ lock + sync  │  │         │
                    │  │  └──────────────┘  │         │
                    │  │  validate          │         │
                    │  │  drift detection   │         │
                    │  │  tiered context    │         │
                    │  └────────────────────┘         │
                    │  MCP servers                    │
                    │  Rules + commands               │
                    │  Instructions + hooks           │
                    │  Agentfile manifest             │
                    │  Auto-repair + CI               │
                    │  team overlay                 │
                    └─────────────────────────────────┘
```

Skills CLI is the **smaller inner rectangle** — agentbrew wraps it with drift, multi-surface sync, and state. For the skills-install slice alone, overlap is ~80%.

---

## Architecture comparison

### How skills CLI installs a skill

From the [README](https://raw.githubusercontent.com/vercel-labs/skills/main/README.md) + [AGENTS.md](https://github.com/vercel-labs/skills/blob/main/AGENTS.md):

```
npx skills add vercel-labs/agent-skills --skill frontend-design -a claude-code -a cursor
  │
  ├── Parse source (owner/repo, URL, local path)
  ├── Fetch source into a local cache
  ├── Discover SKILL.md files (standard locations, then recursive fallback;
  │   plus plugin-manifest discovery from .claude-plugin/marketplace.json)
  ├── Detect installed agents (prompts if none found)
  ├── For each selected agent × selected skill:
  │     ├── Compute target path from a per-agent paths table
  │     │    (project: .<agent>/skills/; global: ~/.<agent>/skills/)
  │     ├── Install via symlink (default) or copy (--copy fallback)
  │     └── Record in skills-lock.json v3 (skillFolderHash = GitHub tree SHA)
  └── Print summary
```

- **Source of truth**: a canonical copy in a local cache; every agent's skill dir is a symlink to it.
- **Lock format**: `skills-lock.json` version 3. The `skillFolderHash` is the GitHub Trees API SHA of the skill's folder. `skills experimental_install` restores from lock. Older lock versions are wiped automatically.
- **Update model**: `skills check` compares local hash to upstream; `skills update` reinstalls the skill in place. GitHub-backed only.
- **Agent discovery**: auto-detects by checking for known agent config directories.

### How agentbrew installs a skill

Source: researcher report on `src/catalog/install-skill.ts`, `src/add-source.ts`, `src/sync/skills-sync.ts`.

Two paths depending on the argument:

**Path A — catalog install** (`agentbrew install <skill-name>` where `<name>` is in `catalog.yaml` or `catalog-overlay.yaml`):

```
install(name)  [src/catalog/install.ts:217]
  ├── loadCatalog()    # src/catalog.yaml + org overlay
  ├── cloneOrPull(source.url)
  │       → ~/.cache/agentbrew/sources/<safe-url>/          # shallow git clone
  ├── cpSync(skillDirInCache, ~/.config/agentbrew/installed-skills/<name>/)
  │       # Canonical copy, NOT a symlink to the cache
  ├── state.sources[url].skillsInstalled.push(name)
  ├── state.sources[url].commitSha = HEAD
  ├── saveState() → ~/.config/agentbrew/state.yaml
  ├── lockSource() → ~/.config/agentbrew/agentbrew.lock   # YAML, audit trail
  └── autoSync() → syncSkills()
        │
        └── For each detected agent:
              ├── cleanSymlinks() in ~/<agent>/skills/   # removes broken + agentbrew-managed
              │   (leaves user-created directories alone)
              └── symlinkSync(~/.config/agentbrew/installed-skills/<name>,
                              ~/<agent>/skills/<name>)
```

**Path B — source-repo install** (`agentbrew install user/repo`):

```
addSource(source)  [src/add-source.ts:306]
  ├── cloneAndIndexRemoteSource()    # renamed from `tryGitCloneFirst` 2026-04-26
  │       → ~/.cache/agentbrew/sources/<safe-name>/    # shallow git clone + index
  │
  ├── [If clone succeeds] register cache path as a skillSourceDir
  │       state.skillSourceDirs.push({ path: "~/.cache/.../<safe-name>", ... })
  │       # Symlinks will point DIRECTLY to the cache — no copy
  │
  ├── [If clone FAILS] delegateRemoteSkill()
  │       execFileSync("npx", ["skills", "add", source, "--global", "--agent", "*"])
  │       # ← This is the existing partial integration with skills CLI
  │
  └── autoSync() → syncSkills()
```

**Deploy phase (shared by both paths)**: `syncSkills()` in `src/sync/skills-sync.ts` iterates every detected agent (from `src/core/agents.yaml`) and writes `symlinkSync` targets into the agent's skills directory. `readsFrom` semantics skip agents that share a directory with another detected agent (e.g. `claude-desktop` is skipped if `claude-code` is detected — both use `~/.claude/skills`).

### Side-by-side

| Aspect | Skills CLI | Agentbrew |
|---|---|---|
| **Source protocol** | GitHub shorthand, full git URL, GitLab, local path, direct-to-skill URL | GitHub shorthand + git URL, local path |
| **Cache location** | CLI-managed | `~/.cache/agentbrew/sources/<safe-url>/` |
| **Canonical skill storage** | Cache directory | Catalog path: `~/.config/agentbrew/installed-skills/<name>/` (copy). Source-repo path: cache directory (no copy) |
| **Per-agent deployment** | Symlink (default) or `--copy` | Symlink (always; no copy mode) |
| **Agent paths source** | Hardcoded table in `src/paths.ts` equivalent | `src/core/agents.yaml` (247 lines, declarative) |
| **Agent auto-detect** | Yes; prompts if none found | Yes; uses `agents.yaml` detection criteria |
| **Lock file** | `skills-lock.json` v3, `skillFolderHash` = GitHub tree SHA | `~/.config/agentbrew/agentbrew.lock` YAML, `sha` = git HEAD SHA |
| **Lock semantics** | Reproducible restore via `skills experimental_install` | **Audit trail only — `sync --pull` always moves to HEAD.** Not a resolution-time pin. ([`src/lock.ts:47`](../../src/lock.ts#L47)) |
| **Update detection** | GitHub Trees API SHA comparison (`skills check`) | `git ls-remote <url> HEAD` in [`src/skills/skill-versions.ts`](../../src/skills/skill-versions.ts) |
| **Update action** | Reinstall skill (no in-place patching) | `sync --pull` re-fetches every source |
| **Telemetry** | Opt-out (`DISABLE_TELEMETRY` / `DO_NOT_TRACK`, auto-off in CI) | None |
| **`--copy` fallback** | Yes (for filesystems without symlink support) | No — symlink-only (see [Gap → "Copy fallback" below](#gap-1-copy-fallback)) |
| **Plugin manifest discovery** | Yes (`.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`) | No (see [Gap → "Plugin manifests" below](#gap-2-plugin-manifest-discovery)) |

---

## Agent coverage

### Skills CLI — 54 targets (source: [`src/types.ts` AgentType union](https://raw.githubusercontent.com/vercel-labs/skills/main/src/types.ts))

`adal`, `aider-desk`, `amp`, `antigravity`, `augment`, `bob`, `claude-code`, `cline`, `codearts-agent`, `codebuddy`, `codemaker`, `codestudio`, `codex`, `command-code`, `continue`, `cortex`, `crush`, `cursor`, `deepagents`, `devin`, `dexto`, `droid`, `firebender`, `forgecode`, `gemini-cli`, `github-copilot`, `goose`, `iflow-cli`, `junie`, `kilo`, `kimi-cli`, `kiro-cli`, `kode`, `mcpjam`, `mistral-vibe`, `mux`, `neovate`, `openclaw`, `opencode`, `openhands`, `pi`, `pochi`, `qoder`, `qwen-code`, `replit`, `roo`, `rovodev`, `tabnine-cli`, `trae`, `trae-cn`, `universal`, `warp`, `windsurf`, `zencoder` (54 total).

### Agentbrew — 56 entries (source: [`src/core/agents.yaml`](../../src/core/agents.yaml))

`adal`, `aider-desk`, `amp`, `antigravity`, `augment`, `bob`, `claude-code`, `claude-desktop`, `cline`, `codearts-agent`, `codebuddy`, `codemaker`, `codestudio`, `codex`, `command-code`, `continue`, `copilot`, `cortex`, `crush`, `cursor`, `deepagents`, `devin`, `dexto`, `droid`, `firebender`, `forgecode`, `gemini-cli`, `goose`, `iflow-cli`, `overlay-desktop`, `junie`, `kilo`, `kimi-cli`, `kiro`, `kode`, `mcpjam`, `mistral-vibe`, `mux`, `neovate`, `openclaw`, `opencode`, `openhands`, `pi`, `pochi`, `qoder`, `qwen-code`, `replit`, `roo-code`, `rovodev`, `tabnine-cli`, `trae`, `trae-cn`, `universal`, `warp`, `windsurf`, `zencoder` (56 total — 8 new skills-only entries mirrored on 2026-05-02; `devin` moved from native carve-out to delegated target because skills CLI now supports it).

### Parity diff — fresh 2026-05-02 measurement (block at src-of-truth level, not README level)

Agentbrew has 56 entries, skills CLI has 54 targets. 51 align on the exact name token, 3 are rename pairs, and 2 are true agentbrew-only carve-outs.

**Rename pairs** (same agent, different canonical name — one side must map when delegating):

| Agentbrew name | Skills CLI name | Notes |
|---|---|---|
| `copilot` | `github-copilot` | Skills CLI prefers the full product name; agentbrew chose the shorter form historically |
| `kiro` | `kiro-cli` | Skills CLI tags the CLI variant; agentbrew covers the shared base |
| `roo-code` | `roo` | Skills CLI dropped the `-code` suffix |

**Agentbrew-unique (no direct skills CLI entry)** — these are **hard carve-outs** for a full-delegation strategy; agentbrew's native installer stays active for these two:

| Agentbrew name | Why skills CLI doesn't have it |
|---|---|
| `claude-desktop` | Claude Desktop shares `~/.claude/skills` with Claude Code via the `readsFrom` mechanism; skills CLI conflates them under `claude-code` |
| `overlay-desktop` | team desktop app target is org-internal; not an upstream-accepted addition |

**Delegation implication**: for 51/56 entries (the exact-name intersection, post-refresh) agentbrew can forward the spec straight to `npx skills add <source> --agent <name>`. For the 3 rename pairs, agentbrew keeps a one-way name map (~10 lines of code) in the dispatcher. For the 2 agentbrew-unique agents, agentbrew keeps its native installer active: `overlay-desktop` almost certainly stays agentbrew-native; `claude-desktop` probably gets resolved upstream via a `readsFrom`-equivalent, not a new agent entry.

**Sharing semantics**: both tools handle agents that share directories (e.g. Claude Desktop reads from `~/.claude/skills` which Claude Code also writes to). Skills CLI handles this via its path table + a global-detection heuristic; agentbrew handles it via the `readsFrom` field in `agents.yaml` ([`src/core/agents.ts:109`](../../src/core/agents.ts#L109)). This is a **design parity** item — neither approach is cleaner, but they're not interoperable without a shim.

**Task deltas from this measurement**:
- `absorb-per-skill-per-agent-granularity-from-skills-cli` — closed as DEFER (slice 10, 2026-04-27); see [Gap 3](#gap-3-per-skill-and-per-agent-granularity) for the carve-out applicability rationale. Rename pairs are already in `agent-name-map.ts` and wired through `delegateRemoteSkill` (slice 2 of the parent delegation task).
- **`absorb-skills-cli-missing-agents` — LANDED 2026-04-24** (`bob`/`deepagents`/`firebender` now in agents.yaml).
- **2026-05-02 follow-up**: `aider-desk`, `codearts-agent`, `codemaker`, `codestudio`, `dexto`, `forgecode`, `rovodev`, and `tabnine-cli` added to `agents.yaml`; `devin` removed from `AGENTBREW_ONLY_AGENTS_RATIONALE` because skills CLI now supports it.
- New scouted task: `overlay-desktop` is a permanent carve-out regardless of delegation outcome; `claude-desktop` can be re-measured quarterly via `quarterly-dissolution-reeval`.

### Vendor-neutral path

Agentbrew also writes to `~/.agents/skills` as a vendor-neutral default (unless `AGENTBREW_VENDOR_NEUTRAL=0`). Skills CLI has a corresponding `--agent universal` / `--agent amp` / etc. that targets `.agents/skills/`. Both ecosystems have embraced the `.agents/skills/` convention, so this is parity.

---

## Command surface comparison

| Capability | Skills CLI | Agentbrew |
|---|---|---|
| Install from source repo | `npx skills add owner/repo` | `agentbrew install owner/repo` |
| Install from local path | `npx skills add ./path` | `agentbrew install ./path` |
| Install specific skill | `npx skills add owner/repo -s frontend-design` | Not supported — agentbrew installs all skills from a source |
| Install to specific agent | `npx skills add owner/repo -a claude-code` | Not supported — agentbrew installs to all detected agents |
| Project vs global scope | `-g` flag | Global-only for `install`; project via [project-manifest](../../src/types.ts) |
| List installed | `npx skills list` | `agentbrew skill` (list), `agentbrew skill <name>` (show) |
| Search | `npx skills find [query]` | `agentbrew catalog --search` |
| Remove | `npx skills remove [skills]` | `agentbrew remove <name>` |
| Update | `npx skills update` | `agentbrew sync --pull` |
| Check for updates | `npx skills check` (implicit in update) | `agentbrew status`, `agentbrew sync --pull --dry-run` |
| Init new skill | `npx skills init [name]` | ~~`agentbrew skills init <name>`~~ — **Deleted 2026-05-03** (delete-skills-init). Delegated to `npx skills init` upstream per VISION.md "Delegate when 80%+ of need is covered." |
| Restore from lock | `npx skills experimental_install` | `agentbrew sync` (but lock is advisory, not enforcing) |
| Validate SKILL.md | Implicit (frontmatter parse on install) | `agentbrew validate` — full spec validator (365 LOC, 40 tests; see [`src/skills/validate.ts`](../../src/skills/validate.ts)) |

**Missing from agentbrew** that would be valuable if we delegate:
- Per-skill granularity (`-s <name>`) — installing one skill from a 50-skill repo
- Per-agent granularity (`-a claude-code`) — installing only to one agent
- `--copy` mode for filesystems without symlink support

**Missing from skills CLI** that agentbrew provides:
- Drift detection + auto-repair
- Full spec validator (agentbrew's `validate.ts` is 365 LOC with 40 tests)
- Tiered context loading (L0/L1/L2) for agent consumption
- Unified state for other surfaces (MCP, rules, commands, instructions)

---

## Lock file: audit trail vs SHA pinning

This is a **semantic difference, not a feature gap**.

### Skills CLI lock file ([AGENTS.md § Update Checking System](https://github.com/vercel-labs/skills/blob/main/AGENTS.md))

- **File**: `skills-lock.json`
- **Version**: 3 (older versions wiped automatically — users re-install to regenerate)
- **Key field**: `skillFolderHash` — the GitHub Trees API SHA of the skill's folder at install time
- **Update check**: compare local hash to upstream GitHub Trees API; if different, skill has updates available
- **Restore**: `npx skills experimental_install` reinstalls from lock — reproducible install
- **Scope**: GitHub-backed skills only

### Agentbrew lock file ([`src/lock.ts`](../../src/lock.ts))

- **File**: `~/.config/agentbrew/agentbrew.lock`
- **Format**: YAML, human-readable
- **Key field**: `sha` — git HEAD commit SHA at install time
- **Header comment** (`src/lock.ts:47`): *"SHAs are tracked, not enforced. agentbrew sync --pull re-resolves sources to latest."*
- **Update check**: `agentbrew lock --verify` — reports mismatches but doesn't block anything
- **Restore**: not implemented. `agentbrew sync` uses whatever is in the cache; `sync --pull` always moves to HEAD.
- **Scope**: every source registered in `state.yaml`

### The practical difference

Skills CLI's lock is a **reproducibility primitive** — run `experimental_install` on a fresh machine and get bit-identical skills. Agentbrew's lock is an **audit trail** — the SHA is recorded so you can see *what you had*, but `sync` doesn't pin to it.

**COMPETITION.md has been inflating this.** The tier-tables Comparison Matrix says agentbrew has "✅ agentbrew.lock (YAML)" under "Lock file (SHA pinning)." It is more accurately "Lock file (SHA tracking, not enforcing)." The honest version belongs in a follow-up fix.

---

## What agentbrew has that skills CLI doesn't — with contribution analysis

These are the **real differentiators** — the features that justify agentbrew existing alongside skills CLI even if skill installation itself is delegated. But the bigger question for each one is: *should this feature live in skills CLI instead of agentbrew?* If an agentbrew-only feature would benefit every skills CLI user, VISION.md's "Contribute first, build second" principle argues for upstreaming it and deleting our version.

### Contribution-analysis framework

For each feature below, the "Contribution analysis" subsection evaluates:

- **Fit with skills CLI scope** — does this feature match what skills CLI is conceptually about, or does it imply re-scoping the product?
- **Complexity of an upstream contribution** — rough LOC / surface-area estimate if agentbrew's implementation were ported upstream.
- **Likely Vercel receptivity** — based on existing issues, AGENTS.md tone, and general OSS maintainer patterns for a 14.6K-star Vercel Labs project. This is a best-effort signal, not a commitment.
- **User benefit if upstreamed** — does every skills CLI user benefit, or only agentbrew-style power users?
- **What agentbrew does if upstreamed** — delete the native implementation (shrink), delegate via subprocess, or keep for multi-surface reasons.
- **Recommended action** — **PR candidate** (open an issue + implementation), **RFC first** (propose the idea before writing code), **Keep in agentbrew** (don't upstream — scope or receptivity blocks), or **Skip** (genuinely not worth the effort).

The priority-ordered [Contribution roadmap](#contribution-roadmap--priority-ordered) at the end of this doc summarizes the outcomes.

---

## Upstream receptivity — what skills CLI maintainers have said

> **Method**: on 2026-04-19, surveyed all 485 open issues + 219 open PRs in [`vercel-labs/skills`](https://github.com/vercel-labs/skills) for discussion relevant to our 5 contribution candidates. Read maintainer comments directly (not just issue titles). Cross-referenced against recent merges to identify accepted directions. Research is read-only and citable — every claim links to an issue/PR number.

### Repo governance snapshot

- **Active maintainers** (from recent commits + review patterns):
  - [**Andrew Qu ("quuu")**](https://github.com/quuu) — primary merger and decision-maker. Primary merger and decision-maker.
  - [**Elliot Liu ("elliotllliu")**](https://github.com/elliotllliu) — collaborator who reviews and approves. Has merge rights on some surfaces but final gate on large features is the primary maintainer.
  - Occasional contributors with narrow merge rights: Ben Holmes, Casey Gollan, Joe Hanley.
- **Discussions feature**: Disabled. All conversation happens in issues / PRs.
- **Governance documents**: No `CONTRIBUTING.md`, no milestones, no roadmap, no `wontfix`/`good-first-issue`/`help-wanted` labels actively used.
- **Repo age**: Created 2026-01-14. ~3 months old at time of research — young, fast-moving.
- **PR backlog**: **219 open PRs, 485 open issues** at the time of research. Large external feature PRs stayed open for weeks.

### Maintainer signal per candidate

What the researcher found for each of our 5 candidates, with verbatim maintainer quotes where available:

| Candidate | Existing upstream work | Maintainer signal | Action signal strength |
|---|---|---|---|
| **1. SKILL.md spec validator** (P1 in original roadmap) | [**PR #509**](https://github.com/vercel-labs/skills/pull/509) — complete implementation (782 LOC, 30 tests, `--strict`, SPDX validation); [issue #503](https://github.com/vercel-labs/skills/issues/503); [PR #171](https://github.com/vercel-labs/skills/pull/171) | **None** — zero maintainer response after 47 days. | **Weak — don't duplicate**. PR #509 already covers what agentbrew would contribute. Duplicate PR would add noise. |
| **2. User-created skill preservation** (P1 in original roadmap) | [Issue #268](https://github.com/vercel-labs/skills/issues/268), [#455](https://github.com/vercel-labs/skills/issues/455), [#606](https://github.com/vercel-labs/skills/issues/606); **4 overlapping bug-fix PRs** [#609](https://github.com/vercel-labs/skills/pull/609), [#611](https://github.com/vercel-labs/skills/pull/611), [#869](https://github.com/vercel-labs/skills/pull/869), [#944](https://github.com/vercel-labs/skills/pull/944) | **Implicit acceptance** — [PR #588](https://github.com/vercel-labs/skills/pull/588) (preservation-related SSH URL fix by Elliot Liu) was merged 2026-03-13. No rejections. | **Moderate — RFC only**. Don't add a 5th competing PR. Comment on issues #268 / #455 with agentbrew's `cleanEntry()` design to inform the architecture. |
| **3. Drift detection — `skills doctor`** (P2 in original roadmap) | [**PR #630**](https://github.com/vercel-labs/skills/pull/630) — `skills status` command (wommy); [issue #629](https://github.com/vercel-labs/skills/issues/629); [PR #376](https://github.com/vercel-labs/skills/pull/376) (`skills doctor`, separate, stalled); [bug #806](https://github.com/vercel-labs/skills/issues/806) | **Explicit acceptance by Elliot Liu**: approved PR #630 and wrote: *"Clean implementation with proper separation of concerns. [...] LGTM."* Then commented: *"The `skills status` command is a great addition — lockfile drift is a real pain point when managing skills across projects. Suggestion: consider adding a `--fix` flag that auto-resolves drift (reinstall missing, update lockfile for extras). Would make CI integration much smoother. LGTM 👍"* ([2026-03-15 + 2026-03-16](https://github.com/vercel-labs/skills/pull/630)) | **STRONG — engage now**. This is the only candidate with an explicit maintainer endorsement. Agentbrew's broken-symlink + validity scenarios are additive to PR #630. |
| **4. CI flag (`--ci`)** (P2 in original roadmap) | [**PR #558 (merged)**](https://github.com/vercel-labs/skills/pull/558) added `--json` to `skills list`; [PR #507](https://github.com/vercel-labs/skills/pull/507) (lockfile enhancements incl. `skills ci`, unreviewed 6+ weeks); [PR #958](https://github.com/vercel-labs/skills/pull/958) (`skills outdated --json`); README already documents `-y` flag as "CI/CD friendly" | **Directional acceptance**: machine-readable output and non-interactive mode are existing patterns. Exit-code-on-drift is the specific missing piece, and it ties directly to Elliot Liu's `--fix` request on PR #630. | **STRONG — bundle with #3**. Don't file standalone. Contribute `--fix` to PR #630. |
| **5. Declarative `skills.yaml` manifest** (P3 in original roadmap) | [**Issue #283**](https://github.com/vercel-labs/skills/issues/283) — `skills install` from lockfile; [issue #729](https://github.com/vercel-labs/skills/issues/729) — declarative `Skillfile`; [PR #937](https://github.com/vercel-labs/skills/pull/937) by **Anthony Fu** (antfu) — merges `skills-npm` into `experimental_sync`, mentions "config system for the CLI as a whole" | **Maintainer WIP**: Andrew Qu (primary merger) commented on issue #283 on 2026-02-18: ***"great idea! WIP"*** — the only direct "we're building this" signal found in the survey. `src/install.ts` already exists with `runInstallFromLock()`. | **Medium — comment only, don't race**. Post Agentfile.yaml design on #283 + #729. Do not file implementation PR before Andrew's WIP lands. |

### Cross-cutting patterns

1. **No explicit scope limits.** Zero "we don't accept feature contributions" or "this is out of scope" statements from maintainers. Zero uses of the `wontfix` label. The project has grown from basic install/list to `check`, `update`, `find`, `remove`, `init`, `experimental_install`, `experimental_sync` — wide scope is the current direction.

2. **No documented contribution policy.** No `CONTRIBUTING.md`, no governance. This makes contribution disposition uncertain, but also means there's no gatekeeping beyond "did the maintainer notice and respond?"

3. **Long queue, no rejections.** Large external feature PRs (4 of our 5 candidates have one) stayed open for 4–10+ weeks. There are no explicit closures. This looks like a queue-capacity issue, not a scope issue.

4. **Small focused PRs are the practical entry point.**
   - Small focused bug fixes are the easiest to land.
   - Large feature PRs need an agreed direction first.
   - **Implication**: establish trust with a small bug fix before proposing a large feature.

5. **Anthony Fu (antfu) is a wildcard.** He's a prominent OSS developer (Vite, Vitest, UnoCSS) with high credibility. His [PR #937](https://github.com/vercel-labs/skills/pull/937) on merging `skills-npm` features into `experimental_sync` is worth watching — its review speed will signal whether high-profile contributors get faster review or whether everyone waits.

### What this changes in our contribution plan

Before this research, agentbrew's plan (from the original Contribution roadmap) was to open issues + file PRs for 4 of 5 candidates. After the research:

- **Only PR #630 has an approved direction** — engage there, don't start new PRs on the drift+CI axis.
- **Validator, safety, manifest** all have in-flight community work — comment on existing threads, don't duplicate.
- **Trust-building step** — file a narrow regression test PR for bug [#806](https://github.com/vercel-labs/skills/issues/806) (hash verification mismatch) before proposing larger work. Establishes agentbrew as a reliable contributor.
- **The 4–10 week review lag** means contributions are low-probability-per-PR. Bundle small, focused changes rather than large feature implementations.

The updated per-feature analyses and [Contribution roadmap](#contribution-roadmap--priority-ordered) reflect this. The roadmap table has been rewritten to prioritize **engagement on PR #630** over all other options.

---

### 1. Drift detection — 4 distinct checks for skills

**Status**: Agentbrew-only
**Files**: [`src/drift-checks/skills.ts`](../../src/drift-checks/skills.ts) (148 LOC), [`src/health.ts`](../../src/health.ts) (orchestrator)
**Related skills CLI surface**: [`npx skills check`](https://raw.githubusercontent.com/vercel-labs/skills/main/README.md) — but scope is different (detects **upstream updates**, not **local install integrity**)

**What it does**. Agentbrew runs four independent drift checks against the skills it has installed. Each one surfaces a distinct failure mode:

| Check | What it detects | Auto-fixable? |
|---|---|---|
| `checkSkillsDrift` | Missing symlinks — a skill listed in `state.sources[].skillsInstalled` but absent in some agent's skills dir (e.g. the user deleted `~/.claude/skills/debug`) | Yes (`syncSkills` redeploys) |
| `checkBrokenSymlinks` | Dangling symlinks where the target was deleted (e.g. the user deleted `~/.cache/agentbrew/sources/<repo>/` manually) | Yes (`removeBrokenSkillSymlinks` unlinks them) |
| `checkSkillsValidity` | SKILL.md frontmatter errors on already-installed skills that passed install but have since been corrupted or broken by an upstream update | No — requires author action |
| `checkUserCreatedSkills` | Non-symlink directories in agent skill dirs (user-created, not managed by agentbrew) | No — informational only, never destroyed |

**How users interact with it**. `agentbrew status` reports all four categories. `agentbrew status --fix` triggers `fix()` in `src/repair.ts:26` which auto-repairs categories 1 and 2 (missing + broken symlinks) and leaves 3–4 for the user. The background auto-repair (30-minute interval) does the same.

**Why it matters**. Skills CLI is "install and forget." If a user manually deletes a symlink in `~/.claude/skills/`, skills CLI won't notice — the `skills-lock.json` still says the skill is installed. Agentbrew notices and offers to repair. For long-lived installations (the primary agentbrew user scenario), this is the single most important day-2 safety feature.

**Overlap with skills CLI**. Skills CLI's `skills check` uses GitHub Trees API SHA to detect **upstream updates**. Agentbrew's checks detect **local corruption**. These are orthogonal axes — a skill can be up-to-date with upstream and still have a broken symlink locally. Skills CLI's check flow could naturally extend to include local integrity.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Moderate-Good**. `skills check` already has the "verify installed state" mental model. Extending it to local integrity (`--local` flag or new `skills doctor` command) is a natural next step — not a scope expansion. |
| **Complexity of upstream contribution** | **Small-Medium**. ~200–300 LOC in skills CLI's codebase. The agent path table and lock file iteration already exist; the new code is the symlink-existence check plus the reporting format. Agentbrew's 4-check taxonomy would likely become 2 checks upstream (missing + broken) with validity folded into existing install-time checks. |
| **Likely Vercel receptivity** | **STRONG — explicit maintainer endorsement exists.** [PR #630 (`skills status` for lockfile drift)](https://github.com/vercel-labs/skills/pull/630) was **approved by collaborator Elliot Liu** on 2026-03-15 with the quote: *"Clean implementation with proper separation of concerns. [...] LGTM."* Then on 2026-03-16 he added: *"The `skills status` command is a great addition — lockfile drift is a real pain point when managing skills across projects. Suggestion: consider adding a `--fix` flag that auto-resolves drift (reinstall missing, update lockfile for extras). Would make CI integration much smoother. LGTM 👍"* This is the only explicit maintainer endorsement found across all 5 candidates. See [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said). |
| **Existing upstream work** | **In-flight, approved, awaiting final merge.** [PR #630](https://github.com/vercel-labs/skills/pull/630) (approved). Also [PR #376](https://github.com/vercel-labs/skills/pull/376) — separate `skills doctor` for agent diagnostics (stalled, no review in 2+ months). Related bug [#806](https://github.com/vercel-labs/skills/issues/806) — hash verification mismatch that blocks the lockfile-vs-disk check. |
| **User benefit if upstreamed** | **High**. Every skills CLI user benefits. Solves a real failure mode (manual deletes, OS reinstalls, partial rsyncs). |
| **What agentbrew does if upstreamed** | **Partial shrink**. Agentbrew could delete `checkSkillsDrift` + `checkBrokenSymlinks` from `drift-checks/skills.ts` (~80 LOC) and either (a) delegate to `skills status --json` and parse the output, or (b) rely on skills CLI's output directly when the user runs the CLI and keep the agentbrew layer for MCP + rules + commands drift. |
| **Recommended action** | **ENGAGE ON PR #630 — don't file separate PR.** Comment with agentbrew's broken-symlink + validity-drift scenarios as additive cases for the implementation. Offer to contribute the `--fix` flag that Elliot Liu specifically requested. Timing is good: the PR is approved but blocked on Andrew Qu's final merge. |

**Concrete first step**: Post a comment on [PR #630](https://github.com/vercel-labs/skills/pull/630) covering: (a) agentbrew's broken-symlink detection scenario (not just lockfile-vs-disk hash comparison), (b) offer to implement the `--fix` flag with agentbrew's `cleanSymlinks` + `syncSkills` logic as reference, (c) link bug [#806](https://github.com/vercel-labs/skills/issues/806) as a dependency. Do NOT file a competing `skills doctor` PR.

---

### 2. Auto-repair on schedule

**Status**: Agentbrew-only
**Files**: [`src/repair.ts`](../../src/repair.ts) (158 LOC), [`src/health.ts`](../../src/health.ts) (hooks the scheduler)
**Related skills CLI surface**: None

**What it does**. A background task runs every 30 minutes on machines where agentbrew is installed. It calls `fix()`, which (a) walks every detected agent's skill directory and removes broken symlinks, then (b) redeploys missing symlinks from the declarative state. The loop is idempotent — a converged machine produces no writes.

**How users interact with it**. Install-once, forget. No CLI invocation required. Users notice only when they manually delete something and it reappears within 30 minutes.

**Why it matters**. The "zero-to-configured-in-two-minutes" experience depends on auto-repair. A user who installs agentbrew, walks away, and comes back a week later should find their config still healthy even if they (or another tool) edited agent directories in between.

**Overlap with skills CLI**. None. Skills CLI is a one-shot CLI with no daemon or scheduler.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Poor**. A scheduler changes the product category — from "package manager you run" to "daemon that runs itself." Skills CLI's maintainers have been deliberate about scope; adding a daemon would likely be rejected. |
| **Complexity of upstream contribution** | **Large**. Cross-platform scheduling (launchd on macOS, systemd on Linux, Windows Task Scheduler), install/uninstall flows, privilege considerations, logging, status reporting. ~500+ LOC plus ongoing maintenance. |
| **Likely Vercel receptivity** | **Unlikely**. They'd reasonably say "use a cron job" or "run `skills check` in CI." The maintenance burden of a scheduler is high relative to the value for the median skills CLI user. |
| **User benefit if upstreamed** | **Medium**. Useful for users with long-running setups, less useful for CI/ephemeral environments. |
| **What agentbrew does if upstreamed** | N/A (won't happen) |
| **Recommended action** | **Keep in agentbrew**. This is genuinely agentbrew's differentiator and aligns with its "quiet by default" + "auto-fix by default" VISION principles. Don't pitch upstream. |

**Concrete first step**: Not applicable. Revisit only if Vercel ships a `--watch` or `--daemon` flag on their own (in which case reassess whether to delegate).

---

### 3. Unified multi-surface config (skills + MCP + rules + commands + agents + hooks + instructions)

**Status**: Agentbrew-only
**Files**: Entire `src/sync/` + `src/commands/` tree (beyond the skill subsystem)
**Related skills CLI surface**: None — skills CLI is skills-only by design

**What it does**. One `agentbrew sync` command reconciles skills **and** MCP servers **and** rules files **and** slash commands **and** agent definitions **and** hooks **and** shared instruction files across every detected agent. One YAML state file (`state.yaml`) is the source of truth for all of them.

**How users interact with it**. `agentbrew sync` / `agentbrew status` — same commands, multi-surface behavior.

**Why it matters**. Users with 4+ AI coding agents don't want to run 5 different CLIs. This is agentbrew's core value proposition and the reason the tool exists.

**Overlap with skills CLI**. None. Skills CLI doesn't manage MCP, rules, or commands — by design.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **No**. Expanding skills CLI to manage MCP + rules + commands would re-scope the product to become a different product. |
| **Complexity of upstream contribution** | **Huge** — full re-scope. |
| **Likely Vercel receptivity** | **Very unlikely**. They've been clear: skills CLI is skills-only. |
| **User benefit if upstreamed** | N/A |
| **What agentbrew does if upstreamed** | N/A (won't happen) |
| **Recommended action** | **Keep in agentbrew**. This is the non-overlap — the reason agentbrew exists alongside skills CLI. |

**Concrete first step**: Not applicable. This is the foundation of agentbrew's positioning.

---

### 4. Declarative YAML state (config-as-code)

**Status**: Agentbrew-only (for declarative-install specification); partial overlap on post-install record
**Files**: [`src/state.ts`](../../src/state.ts) (state IO), [`src/types.ts`](../../src/types.ts) (schema)
**Related skills CLI surface**: `skills-lock.json` — but that's a *post-install record*, not a *declarative install spec*

**What it does**. `~/.config/agentbrew/state.yaml` is the declarative source of truth. Users can hand-edit it, commit it to a dotfiles repo, run `agentbrew sync` on a fresh machine, and get identical config. Compare to `skills-lock.json`, which is *written by* the CLI on install but isn't the input — the input is whatever the user passed to `skills add`.

**How users interact with it**. `agentbrew export` / `agentbrew import`, git-committing the state file, `agentbrew sync` against a committed Agentfile manifest.

**Why it matters**. Team configs. CI reproducibility. Dotfiles. "I want everyone on my team to have the same agent setup" is a declarative problem — skills CLI's lock file makes this *possible* (via `skills experimental_install`) but not *ergonomic*.

**Overlap with skills CLI**. Skills CLI's lock file v3 + `experimental_install` provides reproducibility for skills. A declarative manifest (let the user write a `skills.yaml` with the skills they want) would go further.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Moderate**. Skills CLI has the lock file as a reproducibility primitive; adding a declarative `skills.yaml` (the input, not the output) is a natural extension but may feel redundant with the lock file. |
| **Complexity of upstream contribution** | **Medium**. New file format (or adopt an existing one — skillfile.rs has a `Skillfile` format), new resolve/install flow that consumes it, documented semantics vs the lock file. |
| **Likely Vercel receptivity** | **WIP already acknowledged by primary maintainer.** On [issue #283](https://github.com/vercel-labs/skills/issues/283) (`skills install` from lockfile), **Andrew Qu ("quuu", primary merger)** commented on 2026-02-18: ***"great idea! WIP"*** — the strongest "we're building this" signal found in the full survey. Additionally, `src/install.ts` already exists in main with `runInstallFromLock()`. Separate request [issue #729](https://github.com/vercel-labs/skills/issues/729) proposes a `Skillfile` declarative manifest. [PR #937](https://github.com/vercel-labs/skills/pull/937) by **Anthony Fu (antfu)** is building `experimental_sync` with mention of a "config system for the CLI as a whole." See [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said). |
| **Existing upstream work** | [Issue #283](https://github.com/vercel-labs/skills/issues/283) — Andrew's WIP. [Issue #729](https://github.com/vercel-labs/skills/issues/729) — `Skillfile` declarative manifest proposal. [PR #937](https://github.com/vercel-labs/skills/pull/937) — Anthony Fu merging `skills-npm` into `experimental_sync`. [Issue #549](https://github.com/vercel-labs/skills/issues/549) — community-confirmed partial implementation. |
| **User benefit if upstreamed** | **Medium**. CI workflows, team onboarding, dotfiles. Lock-file-based flows already cover most of it. |
| **What agentbrew does if upstreamed** | **Keep** — agentbrew's state covers more than skills (MCP, rules, commands), so a skills-only manifest doesn't obviate agentbrew's state file. But agentbrew could point at `skills.yaml` as the skill sub-section of its own config. |
| **Recommended action** | **COMMENT ONLY — don't race the upstream WIP.** Post Agentfile.yaml design on issue #283 and #729 with agentbrew's multi-machine + team-onboarding use cases. Ask Andrew whether the Feb WIP is still progressing. Filing an implementation PR risks competing with an internal effort that may land first. |

**Concrete first step**: Comment on [issue #283](https://github.com/vercel-labs/skills/issues/283) with: (a) agentbrew's `Agentfile.yaml` format as a reference, (b) explicit question: *"Is the WIP from February still progressing? If not, would a community RFC on the manifest schema be welcome?"* — non-duplicative, non-racing posture. Watch Anthony Fu's [PR #937](https://github.com/vercel-labs/skills/pull/937) for the config-system direction.

---

### 5. Full SKILL.md spec validator ⚠ COMPETING PR ALREADY IN-FLIGHT

**Status**: Agentbrew-only
**Files**: [`src/skills/validate.ts`](../../src/skills/validate.ts) (365 LOC, 40 tests in `validate.test.ts`)
**Related skills CLI surface**: Implicit frontmatter parse on install (not a full validator); **[PR #509 is a complete validator implementation](https://github.com/vercel-labs/skills/pull/509)**

**What it does**. A spec-conformance validator for SKILL.md files. Checks:

- Directory naming conventions (kebab-case, no spaces, matches `name` field)
- Frontmatter YAML parseability + required fields (`name`, `description`)
- Known optional fields with type checks (e.g. `allowed-tools` must be an array)
- Unknown fields (warning, with suggestions for common typos)
- Description quality — minimum length, "Don't use for X" convention
- Cross-references to other skills (dead-link detection)
- Body structure — headings, sections, length

Exit code 1 on any errors for CI use. Verbose mode for authors.

**How users interact with it**. `agentbrew validate` — runs over every installed skill. `agentbrew skill <name>` shows validation status inline. Enterprise catalogs (team overlay, other org catalogs) run it in CI against proposed skill PRs.

**Why it matters**. There is no reference validator for the agentskills.io spec. Skill authors ship broken SKILL.md files; install tools silently accept them; agent runtimes fail to load them. A validator at the ecosystem level fixes this for everyone.

**Overlap with skills CLI**. Skills CLI does a minimal frontmatter parse on install (enough to read `name` and `description`). It doesn't validate spec conformance. If the user ships a SKILL.md with `allowed-tools: "not an array"`, skills CLI installs it anyway.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Excellent**. Vercel Labs authored the agentskills.io spec. A reference validator for that spec is the *most natural first-party contribution imaginable*. Strongly coherent with skills CLI's role as the "CLI for the open agent skills ecosystem." |
| **Complexity of upstream contribution** | **Small**. `src/skills/validate.ts` is 365 LOC. The logic is self-contained — no deep coupling to agentbrew. Port + adapt to skills CLI's test conventions = ~1–2 days. |
| **Likely Vercel receptivity** | **UNCLEAR — competing PR exists with zero maintainer response.** [**PR #509**](https://github.com/vercel-labs/skills/pull/509) by voodootikigod is a complete `skills validate` implementation (782 additions, 30 tests, `--strict` flag, SPDX license validation). It's been open since 2026-03-05 with **zero maintainer comments in 47+ days**. Related [issue #503](https://github.com/vercel-labs/skills/issues/503) + older [PR #171](https://github.com/vercel-labs/skills/pull/171). The silence is consistent with the pattern: not a rejection, but not an acceptance either. In the issue comments, user @cylixlee notes the agentskills.io reference implementation (`skills-ref`) is *"just a demo tool"* and unsuitable for production — reinforcing the demand signal but not the acceptance signal. See [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said). |
| **Existing upstream work** | [**PR #509**](https://github.com/vercel-labs/skills/pull/509) (complete, open 47+ days). [Issue #503](https://github.com/vercel-labs/skills/issues/503). [PR #171](https://github.com/vercel-labs/skills/pull/171) — earlier validator attempt, also stalled. |
| **User benefit if upstreamed** | **Very high** — unchanged. Skill authors, marketplace operators, enterprise catalogs all benefit. |
| **What agentbrew does if upstreamed** | **Delete** `src/skills/validate.ts` (365 LOC) and shell out to `skills validate` via subprocess. Unchanged — but only if the PR lands. |
| **Recommended action** | **HOLD AND MONITOR — don't duplicate PR #509.** Filing a competing implementation would split maintainer attention further. Comment on [issue #503](https://github.com/vercel-labs/skills/issues/503) acknowledging PR #509 and offering to review or co-author if voodootikigod stalls. Revisit in 4 weeks (end of May 2026): if PR #509 still has no maintainer response, **open a new issue asking for maintainer direction** (not a new PR). If the direction is rejected or the PR closed, then consider agentbrew's version — but this is the lower-probability path. |

**Concrete first step**: Comment on [PR #509](https://github.com/vercel-labs/skills/pull/509) expressing support with a link to agentbrew's validator as additional reference material (cross-pollination of ideas). Then add this to a recurring review — if the PR sits for another 4+ weeks with no engagement, escalate by opening a new issue that explicitly asks for maintainer direction on the validator topic.

**Why the downgrade**: agentbrew's original analysis called this the "highest-impact contribution candidate" assuming no competing work existed. The research found otherwise: the same contribution is already implemented and waiting for review. Duplicating it adds noise. The right move is to *amplify the existing PR* rather than compete with it.

---

### 6. Tiered context loading (L0 / L1 / L2) — WITHDRAWN 2026-04-24

**Status**: DELETED 2026-04-24. The tiered renderer (`src/skills/skill-info.ts` + `src/skills/skill-display.ts`, 634 LOC + 1,240-line test) was retired together with the top-level `agentbrew skill` command in commit `c6c8452`; the render code was never rewired and only its own tests imported it. Users browse via `agentbrew catalog show <name>`.

**Why the withdrawal matters for the contribution analysis**. The "what agentbrew does if upstreamed → keep skill-info.ts for internal use" argument no longer applies — there is no internal caller. If a tiered-catalog conversation ever reopens (e.g. an official skills MCP server proposal), agentbrew would start from a clean slate rather than a legacy renderer.

**Recommended action**: Skip. Revisit only if an "official skills MCP server" conversation materializes AND agentbrew has a concrete internal consumer to justify rebuilding the tiered API.

---

### 7. User-created skill preservation ⚠ 4 COMPETING BUG-FIX PRs IN-FLIGHT

**Status**: Agentbrew-only (and confirmed a real bug class in skills CLI)
**Files**: [`src/sync/skills-sync.ts:122-148`](../../src/sync/skills-sync.ts#L122) — the `cleanEntry()` classifier
**Related skills CLI surface**: `skills remove` — unclear behavior on user-created content; **multiple open bug reports confirm this is broken in skills CLI today**

**What it does**. Before any sync, `cleanEntry()` classifies every entry in each agent's skill directory:

1. **Managed symlink** (agentbrew-created, pointing to a known source) → safe to unlink and recreate
2. **Broken symlink** (target deleted) → unlink (auto-repair)
3. **User symlink to a valid non-agentbrew path** → **leave alone** (user did this intentionally)
4. **Directory** (not a symlink) without `.agentbrew-filtered` marker → **leave alone** (user created it)
5. **Directory with `.agentbrew-filtered` marker** → managed, can be removed on re-sync

The "leave alone" paths are absolute. Agentbrew never destroys user content — even on `--fix`, even on `--prune`, even in the 30-minute auto-repair loop.

**How users interact with it**. Transparent — users shouldn't need to know this exists. But if a user manually `cp`'d a skill into `~/.claude/skills/my-custom/`, they can run `agentbrew sync` a hundred times and that directory stays exactly where it is.

**Why it matters**. Data safety. A tool that silently deletes user content loses trust permanently. This is agentbrew's strongest VISION principle ("Never destroy data you didn't create") enforced at the sync layer.

**Overlap with skills CLI**. Skills CLI's behavior on user-created content is **unclear from the docs**. `skills remove <name>` removes based on the lock file — what does it do if the user's `~/.claude/skills/foo/` was created manually and a skill with the same name is later installed via `skills add`? This is a real edge case that the agentbrew classifier already handles.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Excellent**. Safety primitives are always in scope. This is a bug-fix contribution framing, not a feature addition. |
| **Complexity of upstream contribution** | **Small**. The classifier logic is ~30 LOC. The surrounding changes are in `skills remove` (check before delete) and `skills add` (don't clobber). Total: ~80 LOC. |
| **Likely Vercel receptivity** | **Implicitly accepted direction — but queue is saturated with 4 competing PRs.** [PR #588](https://github.com/vercel-labs/skills/pull/588) (preservation-related SSH URL fix by Elliot Liu) was **merged 2026-03-13**, showing preservation patches land. But **four overlapping open PRs attempt variations of this fix** — [#609](https://github.com/vercel-labs/skills/pull/609), [#611](https://github.com/vercel-labs/skills/pull/611), [#869](https://github.com/vercel-labs/skills/pull/869), [#944](https://github.com/vercel-labs/skills/pull/944) — all unreviewed. Related bug reports: [#268](https://github.com/vercel-labs/skills/issues/268), [#455](https://github.com/vercel-labs/skills/issues/455), [#606](https://github.com/vercel-labs/skills/issues/606). Filing a 5th PR would add noise to an already-saturated queue. See [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said). |
| **Existing upstream work** | **Heavy community activity, no maintainer engagement.** Bug reports [#268](https://github.com/vercel-labs/skills/issues/268) (separate managed from user-created), [#455](https://github.com/vercel-labs/skills/issues/455) (preserve-local mode), [#606](https://github.com/vercel-labs/skills/issues/606) (lossy lock rewrites + name collisions). Open PRs: [#609](https://github.com/vercel-labs/skills/pull/609) (remove only lockfile-managed), [#611](https://github.com/vercel-labs/skills/pull/611) (prevent collisions + preserve unknown fields), [#869](https://github.com/vercel-labs/skills/pull/869) (preserve dotfiles on copy), [#944](https://github.com/vercel-labs/skills/pull/944) (preserve dotfiles on remote install — duplicate of #869). |
| **User benefit if upstreamed** | **High**. Every skills CLI user who manually edits a skills dir benefits. Prevents a class of bug reports. |
| **What agentbrew does if upstreamed** | **Simplify** — agentbrew's `cleanEntry()` logic in `src/sync/skills-sync.ts:122-148` mostly moves upstream. Agentbrew's `checkUserCreatedSkills` drift check (40 LOC) could either stay (for informational surfacing in `agentbrew status`) or be replaced by parsing `skills list --include-unmanaged` output. |
| **Recommended action** | **RFC COMMENT ONLY — don't add a 5th competing PR.** Post agentbrew's `cleanEntry()` classifier design as a comment on [issue #268](https://github.com/vercel-labs/skills/issues/268) (the foundational issue) to inform how maintainers architect the eventual fix. The value is agentbrew's specific taxonomy (managed symlink / broken / user symlink / user dir / `.agentbrew-filtered` sentinel) — not another competing implementation. |

**Concrete first step**: Comment on [issue #268](https://github.com/vercel-labs/skills/issues/268) with agentbrew's 5-case classifier taxonomy as a design reference. Include the specific invariant: *"The user's own files are preserved forever; `--prune`, auto-repair, and sync all treat user-created directories as sacrosanct."* Link to [`src/sync/skills-sync.ts:122`](../../src/sync/skills-sync.ts#L122) for implementation detail. Do NOT file a PR.

**Why the downgrade**: agentbrew's original analysis called this a "PR candidate" but the research shows the PR surface is already saturated (4 community PRs in-flight). Maintainer queue saturation means adding a 5th implementation hurts rather than helps. RFC-only engagement is the right move.

---

### 8. team overlay + curated catalog

**Status**: Agentbrew-only
**Files**: [`src/catalog.yaml`](../../src/catalog.yaml) (generic curated), team overlay `catalog-overlay.yaml` (org-recommended sources), `src/team/*` (overlay activation)
**Related skills CLI surface**: [skills.sh](https://skills.sh) — Vercel's public directory with leaderboard

**What it does**. Two-layer catalog: (a) `catalog.yaml` has ~130 generic skills agentbrew recommends by default; (b) `catalog-overlay.yaml` adds org-specific internal sources and is auto-enabled when org signals are detected (GHE hostname, corporate Slack, etc.). Opt-out via `agentbrew team unset`.

**How users interact with it**. Zero-configuration for the target audience. Install agentbrew on an enterprise laptop → get the team overlay → run `agentbrew sync` → have curated internal skills available.

**Why it matters**. Organizational curation. Skills.sh is public and general-purpose. Internal enterprise skills don't belong there. Agentbrew's overlay is how a company (org specifically) says "these are the skills our engineers should have."

**Overlap with skills CLI**. None for the org-specific content. Skills.sh is the public catalog; there's no equivalent "private corporate catalog" concept in skills CLI.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **No** for the org-specific content. **Possible** for a generic "multiple catalog sources" concept — but that's a different feature request. |
| **Complexity of upstream contribution** | Not applicable for org-specific content. For generic multi-source catalog, **Medium** (~500 LOC, new config format, search API changes). |
| **Likely Vercel receptivity** | **Unlikely** for the specific content. **Uncertain** for multi-source catalogs — might conflict with skills.sh as the canonical registry. |
| **User benefit if upstreamed** | N/A for org-specific content. Medium for multi-source catalogs (every enterprise user). |
| **What agentbrew does if upstreamed** | Keep the team overlay regardless — it's content, not code infrastructure. |
| **Recommended action** | **Keep in agentbrew**. Don't try to upstream org-specific content. If skills CLI adds multi-source catalog support organically, agentbrew's overlay can interop with it. |

**Concrete first step**: Not applicable. Advocate for skills CLI to support multiple catalog sources generically if the opportunity arises, but don't drive it.

---

### 9. CI integration (`status --ci`)

**Status**: Agentbrew-only (skills CLI has partial CI awareness — telemetry auto-disables)
**Files**: [`src/status.ts`](../../src/status.ts), flag handling across commands
**Related skills CLI surface**: `DISABLE_TELEMETRY` env var, CI auto-detection for telemetry

**What it does**. `agentbrew status --ci` exits 1 on drift. Suppresses interactive prompts, strips colors, produces machine-readable output. Usable in GitHub Actions / GitLab CI / CircleCI / etc. to fail the build when agent config has drifted from its declarative source of truth.

**How users interact with it**. `agentbrew status --ci` in a CI step. Pass/fail determines whether the PR can merge.

**Why it matters**. Config-as-code means CI can verify it. Without `--ci`, a user can merge a PR that silently breaks their team's agent setup.

**Overlap with skills CLI**. Skills CLI has CI-awareness for telemetry but no exit-code guarantee on drift. Once skills CLI has drift detection (see feature 1), a `--ci` flag is a natural add-on.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Excellent**. CI support is table stakes. `--ci` / `--non-interactive` / `--exit-code` is standard CLI hygiene. Machine-readable output already accepted in skills CLI (see below). |
| **Complexity of upstream contribution** | **Small** (dependent on feature 1 landing first). ~20 LOC to add the flag once drift detection exists. |
| **Likely Vercel receptivity** | **STRONG direction signal.** [**PR #558 was merged on 2026-03-11**](https://github.com/vercel-labs/skills/pull/558) adding `--json` flag to `skills list` — machine-readable output is established as a welcome direction. The README also explicitly documents `-y` as *"CI/CD friendly"*. Separately, [PR #507](https://github.com/vercel-labs/skills/pull/507) (`skills ci` + `--frozen-lockfile`) has been unreviewed for 6+ weeks. The missing piece is **exit-code-on-drift**, which ties directly to Elliot Liu's `--fix` request on [PR #630](https://github.com/vercel-labs/skills/pull/630) — that's the natural bundling point. See [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said). |
| **Existing upstream work** | [**PR #558 (MERGED)**](https://github.com/vercel-labs/skills/pull/558) — `--json` flag on `skills list`. [PR #507](https://github.com/vercel-labs/skills/pull/507) — `skills ci` + `skills verify` + `--frozen-lockfile` (unreviewed 6+ weeks). [PR #958](https://github.com/vercel-labs/skills/pull/958) — `skills outdated --json`. [Issue #500](https://github.com/vercel-labs/skills/issues/500) — lockfile enhancements for CI. |
| **User benefit if upstreamed** | **High**. Every team running CI on agent config benefits. |
| **What agentbrew does if upstreamed** | **Partial shrink** — agentbrew's `status --ci` still needs multi-surface logic (rules, MCP, commands), but the skills check specifically can delegate to `skills status --fix` output. |
| **Recommended action** | **BUNDLE WITH PR #630** — don't file standalone. The CI value-add (exit-code on drift) is exactly the `--fix` flag Elliot Liu requested on PR #630. Offer to implement `--fix` as part of engaging with #630, which gives CI support as a natural byproduct. |

**Concrete first step**: When commenting on [PR #630](https://github.com/vercel-labs/skills/pull/630) (see feature 1), specifically volunteer to implement the `--fix` flag with `--json` output and non-zero exit code on unfixable drift. This lands CI support + `--fix` + drift detection in one PR instead of three.

---

### 10. Portable export/import bundles

**Status**: Agentbrew-only
**Files**: [`src/portable.ts`](../../src/portable.ts)
**Related skills CLI surface**: `skills-lock.json` + `skills experimental_install` (functionally equivalent for skills)

**What it does**. `agentbrew export -o bundle.yaml` serializes the entire agentbrew state (skills + MCP + rules + commands + sources) into a portable YAML bundle. `agentbrew import --bundle bundle.yaml` restores it on a new machine.

**How users interact with it**. New laptop setup. Sharing a team's config. Backing up a known-good state before an experimental change.

**Why it matters**. "Move my entire agent setup to a new machine in one command" is a real user scenario. Skills CLI's lock file covers the skills slice; agentbrew covers more.

**Overlap with skills CLI**. Skills CLI's `skills-lock.json` + `experimental_install` provides the same capability for skills only. Agentbrew's export covers multiple surfaces.

#### Contribution analysis

| Dimension | Assessment |
|---|---|
| **Fit with skills CLI scope** | **Uncertain**. The lock file already serves this purpose for skills. An export/import command would rename + bundle — arguably redundant. |
| **Complexity of upstream contribution** | **Small** (~100 LOC — lock file → bundle → reimport). |
| **Likely Vercel receptivity** | **Uncertain**. Might see as redundant. |
| **User benefit if upstreamed** | **Low-Medium**. Lock-file-based workflows mostly cover it. |
| **What agentbrew does if upstreamed** | **Keep** — agentbrew's export covers MCP + rules + commands, not just skills. Even if skills CLI had export, agentbrew still needs its own multi-surface bundle. |
| **Recommended action** | **Skip**. Not a meaningful contribution. Skills CLI's lock file is enough. |

**Concrete first step**: None. Keep in agentbrew.

---

## Contribution roadmap — priority-ordered

> **Note**: this roadmap was rewritten on 2026-04-19 after the [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said). The original roadmap assumed we'd be filing fresh PRs for 4 candidates; the research found that 4 of 5 candidates already have competing community PRs or explicit maintainer activity. Priorities and actions below reflect that reality.

### Priority-ordered actions

| # | Action | Priority | Target | Why | First step |
|---|---|---|---|---|---|
| 1 | **Engage on PR #630** (drift detection + CI + `--fix`) | **P0** | [vercel-labs/skills#630](https://github.com/vercel-labs/skills/pull/630) | Only explicit maintainer endorsement found. Elliot Liu approved + requested `--fix` for CI. Bundles features 1 + 9 into one contribution with the strongest signal of acceptance. | Post a comment on PR #630 with agentbrew's broken-symlink scenarios + offer to implement `--fix` with agentbrew's sync logic as reference |
| 2 | **Trust-building bug fix**: regression test for [bug #806](https://github.com/vercel-labs/skills/issues/806) | **P1** | [vercel-labs/skills#806](https://github.com/vercel-labs/skills/issues/806) | Maintainer queue responds faster to small focused bug fixes by trusted contributors. Filing a narrow PR establishes agentbrew as a contributor before proposing larger changes. Also: #806 blocks PR #630's hash-verification check, so fixing it accelerates feature 1. | Write a failing regression test + minimal fix, open a small PR. Target: <100 LOC |
| 3 | **RFC comment on issues #268 + #455** (user-safety classifier) | **P2** | [#268](https://github.com/vercel-labs/skills/issues/268), [#455](https://github.com/vercel-labs/skills/issues/455) | 4 competing bug-fix PRs already in-flight — adding a 5th hurts. Agentbrew's `cleanEntry()` 5-case taxonomy is more valuable as design input than as a competing implementation. | Comment with the classifier taxonomy + invariant, link to `src/sync/skills-sync.ts:122` |
| 4 | **RFC comment on issues #283 + #729** (declarative manifest) | **P2** | [#283](https://github.com/vercel-labs/skills/issues/283), [#729](https://github.com/vercel-labs/skills/issues/729) | Andrew Qu's "WIP" comment means an internal implementation may land first. Non-racing posture: share agentbrew's Agentfile.yaml design and ask whether Feb WIP is still active. | Comment with Agentfile.yaml reference + direct question to Andrew |
| 5 | **Amplify, don't duplicate, PR #509** (validator) | **P2** | [vercel-labs/skills#509](https://github.com/vercel-labs/skills/pull/509) | Complete validator implementation already still open. Duplicating splits attention. Supportive comment + offer to co-author if original author stalls. | Comment on PR #509 expressing support + linking agentbrew's validator as cross-reference |
| 6 | **Watch PR #937** (Anthony Fu's config system) | **P3** | [vercel-labs/skills#937](https://github.com/vercel-labs/skills/pull/937) | Anthony Fu is a prominent OSS developer; his PR's review speed signals whether high-profile contributors get faster attention. Informs future contribution posture. | Add PR #937 to a monthly review; note merge date or stall |
| — | **Auto-repair on schedule** (feature 2) | N/A | — | Scope mismatch — daemon is a different product. | Keep in agentbrew permanently |
| — | **Unified multi-surface config** (feature 3) | N/A | — | Scope mismatch — this IS agentbrew's reason to exist. | Keep in agentbrew permanently |
| — | **Tiered context loading** (feature 6) | N/A | — | Uncertain fit; belongs in an MCP server / skills.sh API, not the CLI. | Skip |
| — | **team overlay** (feature 8) | N/A | — | Content, not infrastructure. | Keep in agentbrew permanently |
| — | **Portable export/import** (feature 10) | N/A | — | Lock file + `experimental_install` covers skills. Multi-surface bundles stay agentbrew-only. | Keep in agentbrew permanently |

### The "engage, don't duplicate" rule

**Four of the five agentbrew contribution candidates have competing community work in-flight.** In every case, the best move is to engage with the existing work rather than file a parallel implementation. Specifically:

- **Validator**: PR #509 is complete with 782 LOC + 30 tests. Comment, don't duplicate.
- **User safety**: 4 open PRs already. RFC-only engagement on issue #268.
- **Drift + CI**: PR #630 is approved. Engage there with `--fix` offer.
- **Declarative manifest**: A maintainer has a WIP. Comment on #283, don't race.

**The single new PR worth filing is a trust-building bug fix for #806.** Every other contribution should be a comment, a supportive review, or an offer to co-author — not a new implementation.

### Why this is better than the original roadmap

The original roadmap (pre-research) proposed filing 4 PRs against a project with a 4–10 week review lag and 219 open PRs. That plan would have:

- Produced duplicate PRs competing with existing implementations (validator, safety)
- Raced against a maintainer's stated WIP (manifest)
- Wasted agentbrew engineering time on PRs unlikely to merge within 6 months

The revised roadmap instead:

- Concentrates effort on the **one PR with explicit maintainer approval** (#630)
- Establishes trust via a small bug fix (#806) before proposing larger work
- Uses **comments and RFC input** to influence in-flight work without adding noise
- **Does not block agentbrew's shrink plan** on upstream acceptance — the main install delegation (now-retired `delegate-skill-install-to-skills-cli` parent, slices shipped 2026-04-26 to 2026-04-28) proceeded independently whether or not any upstream contribution lands

### Net impact if PR #630 engagement lands

If the engagement on PR #630 results in `--fix` + broken-symlink detection landing upstream:

- **Drift detection + CI + `--fix` merged** → agentbrew deletes `checkSkillsDrift` + `checkBrokenSymlinks` from [`src/drift-checks/skills.ts`](../../src/drift-checks/skills.ts) → **~80–100 LOC shrink**
- Main skill-install delegation (separate, ongoing task) → **~1,000–1,500 LOC shrink**
- **Total upstream-dependent shrink: ~1,100–1,600 LOC**
- If validator PR #509 eventually merges (long-tail, 3–6 month horizon): additional **~365 LOC shrink** for a total of ~1,500–2,000 LOC

The "realistic immediate shrink" is smaller than the original roadmap's "~500 LOC from 4 PRs" estimate because 3 of the 4 PRs should not be filed. But the **one-PR-that-matters approach has a higher merge probability per PR** than the 4-PR approach, so the expected-value outcome is likely better.

### Strategic takeaway

The Contribute-first principle isn't just "write code and hope it lands." It's **find the maintainer's path of least resistance and contribute along it**. For skills CLI today, that path is PR #630 — because one collaborator has already said yes, and the missing piece (`--fix`) is exactly what agentbrew already has.

Everything else is noise until that PR lands or stalls indefinitely.

---

## Should agentbrew exist at all? — Dissolution analysis

> **The meta-question**: every feature analysis above asked *"should this feature move upstream?"*. This section asks the bigger question: *if we're moving every feature upstream, should agentbrew exist as a separate tool at all, or should we dissolve the project and invest the engineering time into upstream contribution + OSS maintenance across skills CLI, mcpm.sh, and others?*
>
> This has to be evaluated honestly. The "Contribute first, build second" principle taken to its conclusion is: *if the ecosystem can absorb everything agentbrew does, agentbrew stops existing*. That's a success criterion, not a failure mode.

### Why ask this now

Four of agentbrew's five unique skill-subsystem features already have **in-flight community contributions** that would land equivalent functionality in skills CLI. The [Upstream receptivity research](#upstream-receptivity--what-skills-cli-maintainers-have-said) found:

- **Validator** → [PR #509](https://github.com/vercel-labs/skills/pull/509) (complete, 782 LOC)
- **User safety** → [4 competing PRs](#7-user-created-skill-preservation--4-competing-bug-fix-prs-in-flight)
- **Drift detection + CI** → [PR #630](https://github.com/vercel-labs/skills/pull/630) (approved)
- **Declarative manifest** → [the upstream WIP](https://github.com/vercel-labs/skills/issues/283) + [Anthony Fu's PR #937](https://github.com/vercel-labs/skills/pull/937)

If all four land upstream over the next 6–12 months, **80% of agentbrew's skill-slice differentiation disappears**. Combined with the main install-delegation path (shelling out to `npx skills add`), agentbrew's skill subsystem would become a thin wrapper over skills CLI. That wrapping provides essentially zero user value — so why does agentbrew still exist?

The honest answer today is *multi-surface + team overlay + ecosystem unification*. But each of those is also on a dissolution path, and the question is how long the justification holds up.

### Feature-by-feature dissolution map

The complete list of agentbrew subsystems, with the best upstream home for each if we dissolved the project. "Home" means "where does this functionality live in a post-agentbrew world?"

| Agentbrew subsystem | LOC (est) | Best upstream home | Ecosystem fit | Maturity | Status today |
|---|---|---|---|---|---|
| **Skills install / sync** | ~1,600 | [`npx skills`](https://github.com/vercel-labs/skills) | ✅ Node.js | Mature | Already partially delegated via fallback |
| **Skills validator** | ~365 | skills CLI ([PR #509](https://github.com/vercel-labs/skills/pull/509)) | ✅ Node.js | PR pending review | Community PR exists, open 47+ days |
| **Skills drift detection** | ~150 | skills CLI ([PR #630](https://github.com/vercel-labs/skills/pull/630)) | ✅ Node.js | PR approved | Approved by Elliot Liu, awaiting merge |
| **Skills update / lock file** | ~380 | `npx skills update` + `skills-lock.json` | ✅ Node.js | Mature | Agentbrew's tracking-only lock could be abandoned |
| **Skills user-safety classifier** | ~100 | skills CLI (issue [#268](https://github.com/vercel-labs/skills/issues/268) + 4 competing PRs) | ✅ Node.js | PRs in-flight | 4 overlapping community PRs |
| **MCP sync across agents** | ~2,000 | [`mcpm`](https://mcpm.sh) | ⚠️ Python ecosystem | Mature | Agentbrew covers 15+ agents; mcpm covers 10+ different agents |
| **MCP Registry integration** | ~200 | MCP Community Registry + mcpm.sh registry | ✅ Multi-language | Mature | Already using these upstream |
| **MCP profiles** | ~150 | `mcpm profiles` | ⚠️ Python | Mature | Direct feature parity |
| **MCP server execution** | ~200 | `mcpm run` | ⚠️ Python | Mature | Direct parity |
| **MCP server sharing (tunnels)** | ~180 | `mcpm share` | ⚠️ Python | Mature | Direct parity |
| **Rules sync** | ~800 | [block/ai-rules](https://github.com/block/ai-rules) OR [ai-rules-sync](https://github.com/lbb00/ai-rules-sync) | ⚠️ Go (block) or stagnant (sync) | Mixed | block/ai-rules is Go binary; ai-rules-sync is stagnant |
| **Commands sync** | ~500 | **❌ NO UPSTREAM HOME** | — | — | No ecosystem tool covers this |
| **Hooks sync** (Claude Code) | ~200 | **❌ NO UPSTREAM HOME** | — | — | Claude Code plugin ecosystem only |
| **Instructions sync** (CLAUDE.md, AGENTS.md etc.) | ~400 | **❌ NO UPSTREAM HOME** | — | — | Users edit files manually today |
| **Agent definitions sync** | ~300 | **❌ PARTIAL (Bridle covers 6 agents)** | ⚠️ Rust | Narrow | Bridle covers agents sync across 6 harnesses; agentbrew covers 44 |
| **Multi-surface drift detection** | ~400 | **❌ NO UPSTREAM HOME** | — | — | No tool spans skills + MCP + rules + commands |
| **Auto-repair (30-min scheduler)** | ~160 | **❌ NO UPSTREAM HOME** | — | — | No tool has a scheduler-based model |
| **Declarative YAML state** | ~300 | [Agentfile.yaml concept](https://github.com/vercel-labs/skills/issues/283) for skills; nothing multi-surface | ⚠️ Partial | In-flight | the upstream WIP covers skills-only |
| **Export / import bundles** | ~150 | **❌ NO MULTI-SURFACE HOME** | — | — | Skills-only via `skills-lock.json`; MCP-only via mcpm; no unified bundle |
| **CI integration (`status --ci`)** | ~100 | skills CLI (via PR #630 `--fix`) | ✅ Node.js | Emerging | Bundles with drift detection upstream |
| **Skill display / info (L0/L1/L2)** | ~580 | **❌ NO UPSTREAM HOME** | — | — | Agentbrew-specific tiered context design |
| **team overlay + catalog** | ~500 | **❌ NO UPSTREAM HOME** | — | — | Content, not code — could publish as skills.sh-listed repo |
| **Agentfile manifest + init** | ~300 | [skills CLI Skillfile](https://github.com/vercel-labs/skills/issues/729) | ⚠️ Skills-only | In-flight | Skills CLI has community request for declarative manifest |
| **Per-project MCP sync** | ~200 | **❌ NO UPSTREAM HOME** | — | — | Mcpm is global-only |
| **Discover / scan for agents** | ~250 | **❌ NO UPSTREAM HOME** | — | — | Each tool does its own detection narrowly |
| **Drift repair orchestrator** | ~160 | Self-assembled per-tool | — | — | Would become "run mcpm doctor; run skills status; etc." |

**Total agentbrew non-test LOC**: ~23,000. **Of that, ~5,000 (~22%) has a clean upstream home.** The remaining **~18,000 LOC (~78%) covers subsystems no upstream tool handles**.

### Fatal gaps: what has no upstream home today

These are the blockers. If agentbrew dissolved today, these capabilities disappear with it:

1. **Commands / hooks / instructions sync** — no tool covers `.claude/commands/*.md`, `.cursor/rules/*.mdc`, CLAUDE.md, AGENTS.md, etc. syncing across agents. Users would manually copy files.
2. **Multi-surface drift detection** — no tool asks *"is my config coherent across skills + MCP + rules + commands?"*. Each upstream tool covers its own slice.
3. **Auto-repair on schedule** — no tool runs a background daemon fixing drift. Users would run `skills check; mcpm doctor; ai-rules status` manually.
4. **Multi-surface declarative state** — the upstream WIP on skills manifest covers skills only. Nothing unifies skills + MCP + rules in one config file.
5. **Agent definitions across 44 agents** — Bridle covers 6. Skills CLI covers 45 for *skills* but not *agent definitions*. Agentbrew's `src/core/agents.yaml` is the only cross-agent registry.
6. **team overlay auto-enable + GHE detection** — organizational-content delivery. Could be handled by publishing a skills.sh-listed repo + a separate agentbrew-slim bootstrap, but the "auto-detect + auto-enable" UX is agentbrew-specific.
7. **Export / import bundles** — portable multi-surface dotfiles. Lock files cover skills. Nothing covers the multi-surface unified case.

These are the reasons agentbrew exists today. Each has an ecosystem-level justification that survives skills CLI absorbing the skill slice.

### The ecosystem-mismatch problem

Even if we wanted to delegate everything, the upstream tools live in different language ecosystems:

| Surface | Upstream tool | Language |
|---|---|---|
| Skills | `npx skills` | Node.js |
| MCP | `mcpm` | Python |
| Rules (best option) | `block/ai-rules` | Go binary |
| Rules (stagnant) | `ai-rules-sync` | Node.js |
| Agents (partial) | Bridle | Rust binary |
| Everything else | — | — |

A user who wants unified config across these would need **Node + Python + Go + Rust runtimes** installed, plus manual file edits for commands/hooks/instructions. That's the multi-ecosystem tax that agentbrew currently hides from users.

Agentbrew's genuine user-facing value isn't any single subsystem — it's **invisible multi-tool orchestration**. The `agentbrew` binary absorbs the multi-ecosystem fragmentation. Dissolve agentbrew and the fragmentation becomes the user's problem.

This is why "agentbrew is the glue" is a defensible product position even if every individual subsystem is redundant with an upstream tool.

### What dissolution would look like

Two plausible dissolution endpoints:

#### Partial dissolution (feasible today)

Dissolve the **skill subsystem only**. Agentbrew retains MCP, rules, commands, hooks, instructions, agent-defs, drift, auto-repair, overlay, Agentfile. The skill-install code path shells out to `npx skills add`.

- **Agentbrew shrink**: ~1,500–2,000 LOC (install + validator + drift + CI flag, as discussed in [Contribution roadmap](#contribution-roadmap--priority-ordered))
- **What users lose**: nothing. Skills still install; all non-skill subsystems unchanged.
- **Upstream contribution**: engage on PR #630, comment on #509, comment on #283/#729.
- **Status**: shipped via the now-retired `delegate-skill-install-to-skills-cli` parent task (retired 2026-04-28).

This is the path the current roadmap recommends and should proceed.

#### Full dissolution (NOT feasible today)

Dissolve agentbrew entirely. Users install `npx skills` + `pip install mcpm` + `brew install ai-rules` + manually edit commands/hooks/instructions. The team overlay becomes a GitHub repo published to skills.sh.

- **Agentbrew shrink**: ~23,000 LOC (all of it)
- **What users lose**:
  - Unified CLI (`agentbrew sync` → must run 3+ tools sequentially)
  - Multi-surface drift detection (no tool has it)
  - Auto-repair (no tool has it)
  - Commands/hooks/instructions sync (users edit files manually)
  - org auto-detection + auto-enable (becomes user-invoked only)
  - Portable multi-surface bundles (lock files are per-tool)
  - 44-agent coverage (skills CLI: 45 for skills; mcpm: 10 for MCP; different sets)
  - Agentfile declarative manifest (until the upstream WIP generalizes)
- **What users gain**:
  - Each tool is better-funded / better-maintained than agentbrew alone
  - No agentbrew maintenance burden on the org
  - Ecosystem contributions benefit every user of the upstream tools
- **Required conditions for this to be viable**:
  - Skills CLI expands to MCP + rules + commands (currently NOT on their roadmap — Andrew Qu's scope is deliberately skills-focused)
  - OR: a well-funded multi-surface tool emerges (Bridle at 417 stars is closest but narrow)
  - OR: users accept running 4 separate CLIs and losing multi-surface drift detection

**Verdict on full dissolution: not today.** The ecosystem is fragmented across 4 languages with no unifying layer. The "fatal gaps" list has 7 items with no upstream home.

### Minimum viable agentbrew — the orchestrator fallback

If full dissolution isn't feasible but partial dissolution is, agentbrew should **aggressively shrink toward a "minimum viable orchestrator"** shape. Target characteristics:

- **Shell out, don't reimplement.** Every subsystem that has an upstream tool becomes a subprocess call:
  - Skills: `agentbrew sync` internally runs `npx skills add / update / remove` based on state
  - MCP: delegate to `mcpm` (via Python subprocess) or embed the MCP Registry API client directly
  - Rules: delegate to `block/ai-rules generate` (Go subprocess) for the generic case; keep team overlay content-delivery in-house
  - Validator: delegate to `npx skills validate` once PR #509 lands (or shell out to a published `@vercel/skills-validator` package)
- **Keep**: declarative YAML state (multi-surface glue), team overlay (content), auto-repair scheduler (nothing else has it), multi-surface drift detection, Agentfile manifest, `agentbrew export/import` (multi-surface bundle).
- **Drop**: native skill installer (→ skills CLI), custom SKILL.md validator (→ skills CLI), patch system (ghost feature), per-project skill manifest (ghost feature), TUI dashboard (already deleted).
- **Target LOC**: ~5,000–7,000 non-test source lines. **From ~23,000 today, that's a ~70% shrink** — far beyond the ~1,500–2,000 shrink from the current roadmap. But it's only achievable if we accept more delegation across MCP and rules, not just skills.

The "minimum viable orchestrator" is an architectural posture, not a one-PR change. It's a direction for every feature decision: *"could an upstream tool do this? If yes, delegate. If no, own it minimally."*

### What dissolution costs — honest accounting

Even partial dissolution has real costs that must be honest about:

1. **Error-surface leakage**. Subprocess output isn't agentbrew's format. `npx skills add` errors will look different from `mcpm install` errors. Users lose the unified "agentbrew-speak" error vocabulary.
2. **Subprocess latency**. Cold-start `npx`, `pip`, `cargo` subprocess invocations add latency per operation. `agentbrew sync` with 5 subsystems = 5 cold-starts.
3. **Version pinning complexity**. Each upstream tool has its own versioning. Coordinating compatible versions across 4 tools is agentbrew's new problem.
4. **Sandbox / proxy friction**. Devin sandbox, corporate proxy, offline mode — each subprocess must work in each environment. A native implementation avoids this per-tool.
5. **Upstream instability risk**. If mcpm rebrands its CLI flags, or if skills CLI changes `--agent '*'` semantics, agentbrew breaks until we patch.
6. **Loss of unified UX guarantees**. Agentbrew's "quiet by default" + "never destroy data" principles can't be enforced across subprocess boundaries. We become the UX wrapper for tools that may not share our values.
7. **The "org engineer on a fresh laptop" story**. If dissolution requires installing 4 CLIs, the two-minute onboarding target in VISION.md is at risk.

Each of these is a reason *not* to over-rotate on dissolution. The orchestrator posture is a tradeoff, not a free win.

### What dissolution gains — honest accounting

Equally important to name the wins:

1. **Engineering time freed.** Every subsystem agentbrew doesn't maintain is time org engineers can spend on higher-leverage work (the team overlay curation, internal skills authoring, integrations).
2. **Ecosystem contribution multiplies.** A fix agentbrew contributes to skills CLI benefits every skills CLI user. A fix agentbrew keeps internal benefits only agentbrew users.
3. **Security surface shrinks.** ~23K LOC is a lot to audit. ~5K LOC is much less. Every deleted module is one less security surface.
4. **Faster upstream bug-fix adoption.** When skills CLI fixes a bug, users get it immediately via `npx skills add`. Native agentbrew code needs manual port + release.
5. **Alignment with the stated principle.** VISION.md's "Wrap, don't rewrite" + "Maintenance is the product" taken to conclusion is the orchestrator shape. Dissolution is the logical endpoint of the principle — actively resisting it is arguably un-principled.

### Decision: don't dissolve today, but build the dissolution path

**Recommendation**: agentbrew should not dissolve today, but every decision should be made with dissolution as the long-run trajectory.

**Why not today**:
- 7 fatal gaps have no upstream home (commands/hooks/instructions/multi-surface drift/auto-repair/multi-surface manifest/export bundles)
- Ecosystem is fragmented across 4 languages
- org has real users getting value from the overlay

**Why a dissolution trajectory**:
- 80% of skill-slice differentiation is being absorbed upstream within 6–12 months
- Each fatal gap is independently on a dissolution path (e.g. Anthony Fu's PR #937 "config system for the CLI as a whole" could grow to cover multi-surface state)
- Pretending the trajectory doesn't exist just delays the inevitable shrink

**Concrete actions in the dissolution direction**:
1. **Execute the install delegation** (now-retired `delegate-skill-install-to-skills-cli` parent, slices shipped 2026-04-26 to 2026-04-28) — skills slice moves to `npx skills`.
2. **Evaluate the MCP delegation to mcpm.sh** — ecosystem mismatch is the main risk; measure subprocess latency + feature parity + sandbox compatibility. Open new task.
3. **Evaluate the rules delegation to block/ai-rules** — Go ecosystem is a bigger friction but 91-star backing might ease long-term. Open new task.
4. **Quarterly dissolution re-evaluation** — tied to the P0 `re-research-stale-competitors` task. If any fatal gap closes (someone ships multi-surface drift, a new unified tool hits 5K stars), revisit.
5. **Document the dissolution path** — this doc. Keep it current. Make it easy for future maintainers to execute if/when the ecosystem catches up.

### Triggers that would flip the decision to "dissolve now"

Specific conditions that would change the answer. If any of these happen, open an RFC to dissolve:

- **Skills CLI expands to MCP OR rules sync.** Would reduce fatal gaps from 7 to 4–5 and signal Andrew Qu is expanding scope.
- **A multi-surface tool (Bridle, Caliber, or new entrant) hits 5K stars with drift detection + 20+ agent targets.** Would fill the multi-surface gap.
- **Anthony Fu's [PR #937](https://github.com/vercel-labs/skills/pull/937) lands with the "config system for the CLI as a whole"** and evolves to a multi-surface declarative manifest. Would fill the multi-surface state gap.
- **org's engineering team can no longer staff agentbrew maintenance** — even half a headcount. The tool's value proposition depends on maintenance happening.
- **Agentbrew codebase grows past 30K LOC without commensurate user-story gains.** The ratio of maintenance burden to user value has flipped.
- **A Node.js port of mcpm or ai-rules emerges.** Would solve the ecosystem-mismatch problem and make full delegation viable.

Until one of these triggers fires, the orchestrator-shape minimum-viable agentbrew is the target. The dissolution path is documented, the ecosystem is monitored, and the shrinks happen incrementally.

### Dissolution as a success metric, not a failure

One last framing. In VISION.md, agentbrew commits to "Maintenance is the product" and "the codebase must shrink over time, not grow." Dissolution is the logical endpoint of that principle. If the ecosystem catches up and agentbrew retires by upstreaming everything it does, **that's success**, not failure.

The VISION.md already says this:

> *If upstream absorbs enough of the slices, agentbrew should shrink or fold into them — that's a successful outcome for the ecosystem, not a loss.*

This section operationalizes that statement. The dissolution trajectory is real, documented, and actively monitored. Agentbrew exists today because the ecosystem isn't ready. When the ecosystem is ready, agentbrew hands off its work and steps aside.

That's the plan.

---

## What skills CLI has that agentbrew doesn't

These are the real gaps. If agentbrew delegates, these come for free.

### Gap 1: Copy fallback

Skills CLI's `--copy` flag creates independent file copies per agent when symlinks aren't supported (some Windows filesystems, certain container/sandbox mounts, some corporate-managed machines). Agentbrew is symlink-only — if symlinks fail, the install fails.

Evidence from agentbrew: [`installSkillForAgent` result type](../../src/catalog/install-skill.ts) tracks `symlinkFailed` but the fallback logic isn't consistently wired through the main path.

**Carve-out applicability (slice 8 of `delegate-skill-install-to-skills-cli`, 2026-04-27; refreshed 2026-05-02)**: SUBSUMED. The delegated path inherits skills CLI's `--copy` behaviour for free — `npx skills add ... --copy` (or the automatic EPERM/EXDEV/ENOTSUP fallback inside skills CLI) handles all 54 delegated targets. The 2 carve-out agents stay native, but each targets a macOS filesystem where `symlinkSync` is reliable: `claude-desktop` is detected only when `~/Library/Application Support/Claude/` exists, and `overlay-desktop` writes to `~/Library/.../TeamDesktopApp/`. There is no realistic scenario where a carve-out agent encounters a symlink-unfriendly filesystem; the symlink-only carve-out path is acceptable. The `absorb-copy-fallback-from-skills-cli` task is closed as no longer needed; if a carve-out user reports an `EPERM`/`EXDEV`/`ENOTSUP` failure later, file a fresh task at that point.

### Gap 2: Plugin manifest discovery

Skills CLI reads `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json` — an emerging standard for declaring skills inside a plugin distribution. If a Claude Code plugin author ships skills this way, skills CLI finds them. Agentbrew's source scanner (`src/catalog/index-source.ts`) doesn't know about these files.

**Carve-out applicability (slice 9 of `delegate-skill-install-to-skills-cli`, 2026-04-27; refreshed 2026-05-02)**: NARROW SCOPE / DEFER. The delegated path inherits manifest discovery from skills CLI for free; agentbrew's `isSkillShaped()` heuristic in [`src/add-source.ts`](../../src/add-source.ts#L173) already detects `.claude-plugin/marketplace.json` and routes those repos through `delegateRemoteSkill`. The narrow gap remaining: when ONLY carve-out agents are detected (no `claude-code` / `cursor` / any other skills-CLI-supported agent), `maybeRunSkillsCliDelegation` short-circuits to skip the subprocess, and the native scanner (`indexSource`) doesn't read the manifest — so a user with a pure carve-out setup who registers a Claude-plugin-shaped repo (manifest, no SKILL.md at the canonical paths) sees zero skills indexed. Real-world frequency: very low. The intersection of "Claude-plugin-shaped repo" AND "carve-out-only detection" requires (a) a manifest-format source, which is rare today (vercel-labs/skills sources still use SKILL.md), AND (b) a user with no delegated target detected. `claude-desktop` users almost always co-install `claude-code`, in which case `claude-code`'s skills CLI install populates the shared `~/.claude/skills` directory and `claude-desktop` reads from there transitively. Implementing manifest reading inside the native scanner is ~30-50 LOC and contradicts VISION.md's "shrink, delegate, don't build" direction. The `absorb-plugin-manifest-discovery-from-skills-cli` task is closed as deferred; if a real user reports the gap, file a fresh task at that point — the workaround is trivial (install via `npx skills add` directly).

### Gap 3: Per-skill and per-agent granularity

`npx skills add owner/repo -s frontend-design -a claude-code` installs one specific skill to one specific agent. Agentbrew installs **all** skills from a source to **all** detected agents. For a user who wants just one skill from a 50-skill repo, this is a real UX loss.

**Carve-out applicability (slice 10 of `delegate-skill-install-to-skills-cli`, 2026-04-27; refreshed 2026-05-02)**: NARROW SCOPE / DEFER. The delegated path could pass `--skill` / `--agent` flags through to skills CLI (~5 LOC dispatcher change), but agentbrew currently does not expose those flags on its CLI surface. Adding them is ~50-100 LOC of CLI plumbing + state schema (`{ skills: string[], agents: string[] }` on `SourceState`) + carve-out narrowing logic in `skills-sync` — net additions to agentbrew's surface against VISION.md's "shrink, delegate, don't build" direction. The workaround for users who need narrowing is `npx skills add owner/repo -s <skill> -a <agent>` directly, which works for 54 delegated targets. Pure-carve-out users with narrowing needs are very rare. The `absorb-per-skill-per-agent-granularity-from-skills-cli` task is closed as deferred; if a real user requests narrowing, file a fresh task at that point — the implementation question splits naturally into (a) dispatch flags through (small) and (b) narrow native carve-out path (medium).

### Gap 4: Rich source formats

Skills CLI accepts:
- `owner/repo` (GitHub shorthand)
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/main/skills/X` (direct path to skill inside repo)
- `https://gitlab.com/...` (GitLab)
- `git@github.com:owner/repo.git` (SSH)
- `./local/path` (local)

Agentbrew's source handling is less rich — GitHub shorthand and URLs work, but direct-to-skill URLs and GitLab support are not well-documented.

**Carve-out applicability (slice 11 of `delegate-skill-install-to-skills-cli`, 2026-04-27; refreshed 2026-05-02)**: SUBSUMED for delegation; NARROW SCOPE / DEFER for carve-out. Agentbrew's [`detectSourceType`](../../src/add-source.ts#L23) classifies any non-shorthand string as `"url"` and passes it straight to `git clone` (which natively handles HTTPS GitLab, SSH `git@...`, and any other git-resolvable URL), and the dispatcher in `delegateRemoteSkill` forwards the raw user-supplied source string to `npx skills add` so skills CLI parses it on its own for all delegated targets. The narrow gap remaining: direct-to-skill subtree URLs like `https://github.com/owner/repo/tree/main/skills/X`. For delegated targets, skills CLI parses the subtree path and installs only that skill. For the carve-out path, agentbrew's native scanner clones the whole repo and indexes every skill found (no subtree narrowing) — a user with carve-out-only detection who passes a subtree URL gets all skills from the repo, not just the pointed-at one. This is the same UX gap as Gap 3 (per-skill granularity) and resolves the same way: workaround via `npx skills add` directly for delegated targets. Implementing subtree narrowing inside the native carve-out path is ~30 LOC against the shrink direction. The `absorb-rich-source-formats-from-skills-cli` task is closed as deferred.

### Gap 5: Public ecosystem + leaderboard

[skills.sh](https://skills.sh) is the de facto skill registry. 91,061 skills tracked, 4M+ installs of the top 50. Agentbrew's catalog has ~130 skills + team overlay. When a user wants to *discover* skills, skills.sh is where the action is. Agentbrew's `catalog --search` is narrower.

(Note: this isn't really a gap to close — VISION.md explicitly commits to "not another skills.sh." The point is: skills CLI brings ecosystem access that agentbrew's catalog doesn't match.)

### Gap 6: Agent compatibility table — CLOSED 2026-04-24 (PR #689)

Skills CLI's README documents which agents support which skill features (`allowed-tools`, `context: fork`, Hooks). Agentbrew now mirrors that table in [`src/core/agents.yaml`](../../src/core/agents.yaml) via the `supportedSkillFeatures` field on every agent — a skill that declares a feature its target agent doesn't support is skipped during sync. Originally tracked by `absorb-agent-compatibility-table-from-skills-cli`; closed by PR #689 (2026-04-24). Refresh cadence is tied to `re-research-stale-competitors` so upstream-table drift gets caught quarterly.

### Gap 7: `INSTALL_INTERNAL_SKILLS` environment variable

Skills marked with `metadata.internal: true` are hidden unless the env var is set. Useful for WIP skills. Agentbrew doesn't have an equivalent mechanism.

**Carve-out applicability (slice 12 of `delegate-skill-install-to-skills-cli`, 2026-04-27; refreshed 2026-05-02)**: SUBSUMED for delegation; NARROW SCOPE / DEFER for carve-out. The delegated path inherits the env-var honoring from skills CLI for free — `npx skills add` reads `INSTALL_INTERNAL_SKILLS` from its environment and the dispatcher's `execFileSync` invocation inherits the parent process environment by default. The narrow gap remaining: agentbrew's native scanner (`scanDirectoryForSkills`) does not read the `metadata.internal` field from SKILL.md frontmatter, so a user with carve-out-only detection who registers a source containing internal skills will get those skills installed regardless of the env var. Real-world frequency: very low. Internal skills are uncommon (mainly WIP/draft authors); carve-out-only setups are rare; the intersection is rarer still. Implementing `metadata.internal` reading inside the native scanner is ~20 LOC against the shrink direction. The `absorb-install-internal-skills-envvar-from-skills-cli` task is closed as deferred. **This was the last of 5 absorb siblings** — combined with slices 8-11 and the 2026-05-02 sandbox / proxy / offline PASS, the parent `delegate-skill-install-to-skills-cli` task is fully retired.

### Gap 8: Telemetry-backed popularity signals

Skills CLI's telemetry (opt-out) feeds the skills.sh leaderboard, which gives users a real signal about skill adoption. Agentbrew has no telemetry, so catalog entries can't be ranked by usage.

---

## Current integration state: the existing `npx skills` fallback

**This is an important fact that changes the strategic question.** Agentbrew already shells out to `npx skills add` as a fallback — the integration is live, in production, and has been for a while.

Source: [`src/add-source.ts:192-207`](../../src/add-source.ts#L192)

```typescript
/** Delegate remote skill install to npx skills CLI. Returns false if failed and no non-skill work remains. */
function delegateRemoteSkill(source: string, options: AddSourceOptions, wantsNonSkill: boolean): boolean {
  const skillArgs = ["skills", "add", source, "--global", "--agent", "*"];
  if (options.skill) skillArgs.push("--skill", options.skill);
  if (options.yes) skillArgs.push("-y");

  console.log(chalk.dim(`  Running: npx ${skillArgs.join(" ")}\n`));

  try {
    execFileSync("npx", skillArgs, { stdio: "inherit", timeout: 120_000 });
  } catch (e) {
    logSkipped("add-source/execFileSync", e);
    console.error(chalk.red("\nnpx skills add failed. Check the source and try again."));
    if (!wantsNonSkill) return false;
  }
  return true;
}
```

**When it fires**: `addSource()` tries native git clone first. If clone fails (e.g. a private repo the user has git auth for but the clone surface hit an edge case), the fallback invokes `npx skills add` with `--global --agent *` and optional `--skill` / `-y` flags. Timeout: 120 seconds. Output is inherited to the user's terminal.

**Inverted acknowledgment**: [`add-source.ts:463`](../../src/add-source.ts#L463) also has a comment: *"Skills from this source are still installed. Use `npx skills remove` to uninstall."* — agentbrew tells the user to use skills CLI for removal of anything added via this fallback path. The tools already co-exist in the user's state.

**Implication for the delegation question**: we're not debating whether to *introduce* `npx skills` as a dependency. It's already there. We're debating whether to **promote it from fallback to primary**.

---

## The delegation question — four options

> Options A–C below are scoped to the **skill install slice only** (what `agentbrew install <skill>` does today). Option D is the dissolution question covering the whole tool — see the full [Dissolution analysis](#should-agentbrew-exist-at-all--dissolution-analysis) for the detailed treatment.

### Option A: Delegate everything to `npx skills`

Agentbrew's skill-install code (path A + path B above) gets replaced with a subprocess call to `npx skills add`. Agentbrew retains:
- The catalog (`catalog.yaml` + team overlay) as a source of "which skills to recommend"
- State (`state.yaml`) tracking what's been installed
- Drift detection (runs against skills CLI's installed state)
- Auto-repair (uses skills CLI to reinstall missing)
- Lock file (agentbrew records the SHA it asked skills CLI to install)
- Validation, display, skill-info

**Deletions**: `src/sync/skills-sync.ts` (524 LOC), `src/catalog/install-skill.ts` (273 LOC), half of `src/catalog/index-source.ts` (~259 LOC). Net: ~1,050–1,200 LOC.

**Wins**:
- Skills CLI's `--copy` fallback (solves the symlink-unsupported-filesystem case)
- Plugin manifest discovery
- Per-skill and per-agent granularity exposed to agentbrew users
- Every skills CLI improvement lands in agentbrew for free
- The ecosystem converges — agentbrew + Warden + Chops + Claude Code all operate on the same install state

**Risks**:
- Subprocess latency (TBD; needs measurement)
- Error-surface leakage (skills CLI errors appearing in agentbrew logs without agentbrew's formatting)
- Agent coverage drift (if skills CLI drops support for an agent agentbrew's users care about — e.g. Devin, Overlay Desktop — we lose that agent)
- Offline / restricted-network behavior (subprocess calls can fail in Devin sandbox or org proxy-only environments)

### Option B: Keep native, contribute drift detection upstream

Push agentbrew's drift checks into skills CLI. Then the 80% becomes 100% and agentbrew retires its skill-sync code by virtue of skills CLI doing it all.

**Wins**:
- Ecosystem-wide drift repair (every skills CLI user benefits)
- Long-term convergence

**Risks**:
- Requires upstream acceptance (266 open issues, 219 open PRs — Vercel Labs has throughput but no guarantee)
- Longer timeline — we can't delete our code until skills CLI ships the equivalent
- Unclear whether Vercel wants drift detection in scope (they may view it as not-their-problem)

### Option C: Keep native, do nothing

Status quo: agentbrew maintains a parallel implementation indefinitely.

**Wins**: no risk, no upstream dependency, no migration cost.

**Risks**: every skills CLI release adds capabilities agentbrew doesn't have (copy fallback, plugin manifest, per-skill granularity, source formats). Maintenance burden grows monotonically. VISION.md's "Maintenance is the product" belief argues against this.

### Option D: Dissolve agentbrew entirely

Retire agentbrew as a tool. Skills → `npx skills`. MCP → `mcpm`. Rules → `block/ai-rules` or `ai-rules-sync`. Commands/hooks/instructions → users edit manually. The team overlay becomes a GitHub repo published to skills.sh. Engineering time that would have maintained agentbrew goes into upstream OSS contribution across skills CLI + mcpm.sh + others.

**Wins**: maximum ecosystem contribution, ~23K LOC retired, zero ongoing maintenance, org engineering team freed for other work, security surface nearly eliminated.

**Risks**: 7 fatal gaps have no upstream home today (commands/hooks/instructions sync; multi-surface drift detection; auto-repair; multi-surface declarative state; agent definitions across 44 agents; team overlay auto-enable UX; portable multi-surface bundles). Users would lose unified config UX and need to run 4+ tools across Node/Python/Go/Rust ecosystems. The org "zero-to-configured in two minutes" story breaks.

**Scope**: full evaluation in the [Dissolution analysis](#should-agentbrew-exist-at-all--dissolution-analysis) section. Short version: **not today** (fatal gaps block it), but **yes eventually** (as the ecosystem catches up). The orchestrator-shape minimum-viable agentbrew is the intermediate target.

### Recommended path

**Option A immediately, Option D as the long-term trajectory.** Measure the Option A risks first (latency, parity, sandbox, error surface). If they clear, delegate the skill slice via subprocess. Simultaneously: execute the [Contribution roadmap](#contribution-roadmap--priority-ordered) engagements (comments on PR #630, issues #268 + #283, etc.) to nudge the ecosystem toward filling agentbrew's fatal gaps. Re-evaluate Option D quarterly via the `re-research-stale-competitors` task — if any fatal gap closes, accelerate dissolution of the corresponding agentbrew subsystem.

---

## Honest LOC shrink estimate (corrects COMPETITION.md "~2K")

**COMPETITION.md line 238** currently says *"delete ~2K lines of skill-install code"*. The researcher's LOC breakdown shows this is inflated. Honest estimate:

| File | LOC | Candidate for deletion if we delegate to `npx skills`? |
|---|---|---|
| `src/sync/skills-sync.ts` | 524 | **Yes** — deployment engine replaced by skills CLI |
| `src/catalog/install-skill.ts` | 273 | **Yes** — install pipeline replaced |
| `src/catalog/index-source.ts` | 518 | **Partially** — ~50% (259 LOC) covers skill discovery, rest stays for MCP/rules/commands |
| `src/commands/cli-install.ts` | 360 | **Partially** — ~30% (108 LOC) for skill dispatch |
| `src/skills/skill-versions.ts` | 138 | **Yes** — replaced by skills CLI's check/update |
| `src/lock.ts` | 238 | **No** — agentbrew's lock covers more than skills (MCP, rules, sources) |
| `src/drift-checks/skills.ts` | 148 | **No** — still runs against skills CLI's installed state |
| `src/skills/validate.ts` | 365 | **No** — unique to agentbrew |
| ~~`src/skills/skill-display.ts`~~ | ~~345~~ | **Deleted 2026-04-24** — never wired into any CLI after the `skill`/`skill <name>` retirement |
| ~~`src/skills/skill-info.ts`~~ | ~~289~~ | **Deleted 2026-04-24** — never wired into any CLI after the `skill`/`skill <name>` retirement |
| ~~`src/skills/init-skill.ts`~~ | ~~92~~ | **Deleted 2026-05-03** (delete-skills-init) — `npx skills init [name]` covers the same SKILL.md scaffold; the local copy plus its 139-LOC `init-skill.test.ts` and the `skills init` registration in `cli-sync-subcommands.ts` were removed in one commit. |
| `src/skills/skill-validate-display.ts` | 77 | **No** — unique to agentbrew |
| `src/repair.ts` | 158 | **No** — orchestrator, stays |
| `src/catalog/install.ts` | 305 | **Partially** — ~20% (60 LOC) is skill-specific |
| `src/catalog/install-other.ts` | 162 | **No** — MCP/rule/command, not skills |
| ~~`src/commands/cli-skills.ts`~~ | ~~11~~ | **Deleted 2026-04-24** — retired compatibility shim |
| ~~`src/install-detect.ts`~~ | ~~123~~ | **Deleted 2026-04-24** — smart-install classifier that was never wired into `cli-install.ts` |
| ~~`src/catalog/registry-search.ts`~~ | ~~429~~ | **Deleted 2026-04-24** — multi-registry search never wired into any CLI; `mcp-registry.ts::searchRegistry` was the live MCP-registry search path at the time (subsequently deleted 2026-04-27 by `delegate-mcp-to-mcpm` slice 5a, PR #850) |

**Realistic deletion**: the original ~1,150–1,500 LOC estimate for the skills-CLI delegation path shrinks by ~1,200 LOC of unrelated dead code that landed 2026-04-24, so the delegation itself still needs to net ~1,000–1,500 LOC to hit the target. `skill-display.ts`/`skill-info.ts`/`cli-skills.ts`/`install-detect.ts`/`registry-search.ts` no longer appear in the delegation diff.

---

## Decision framework — what tips the balance

| Signal | Direction | Why |
|---|---|---|
| `npx skills add owner/repo` cold-start latency > 5 sec | Against delegation | User friction on every install |
| `npx skills add owner/repo` warm-cache latency > 500 ms | Against delegation | Every `sync` slowdown |
| Skills CLI drops support for Devin or Overlay Desktop | Against delegation | Breaks agentbrew's agent set |
| Skills CLI adds drift detection or auto-repair | Strongly for delegation | Overlap becomes 100% — time to retire agentbrew's installer |
| Skills CLI adds a JSON/YAML machine-readable output | For delegation | Agentbrew can parse it, no error-surface leakage |
| A bug in agentbrew's installer is reported that's already fixed in skills CLI | For delegation | Confirms the parallel-maintenance cost is real |
| Skills CLI fails in Devin sandbox or org proxy environment | Against delegation | Primary users can't run it |
| A new competitor (Bridle, Caliber, anything) ships that also delegates to skills CLI | Strongly for delegation | Ecosystem convergence pressure |

---

## Measurements from the evaluation task

See the now-retired `delegate-skill-install-to-skills-cli` parent task (retired 2026-04-28). The four measurements were:

1. **Subprocess latency**: cold + warm cache for `npx skills add` on 3–5 typical repos. Compare to agentbrew's native install.
2. **Agent-target parity**: one-for-one comparison between `agents.yaml` and skills CLI's path table. Any gaps in either direction.
3. **Sandbox / proxy / offline friction**: does `npx skills` work inside the Devin sandbox? Behind an org proxy? When npm is unreachable?
4. **Error-surface preservation**: can agentbrew filter / transform / suppress skills CLI's raw output so users don't see the underlying subprocess?

Terminal states after measurement:
- **If all four clear**: delegate. Delete ~1,200 LOC. Update COMPETITION.md verdict note to "delegation shipped in PR #N." Update VISION.md's "today's honest answer" paragraph.
- **If one blocks**: flip the verdict to **Complementary** with the specific blocker named. VISION.md and COMPETITION.md both get updated to reflect the finding. This is still a productive outcome — "we evaluated it honestly, here's why we keep native" is stronger than ambiguity.

### Delegate measurements (2026-04-24 evening) {#delegate-measurements-2026-04-24-evening}

**Dimension 1 — subprocess latency** (author's M-series macOS laptop, npm + npx cache primed):

```text
$ time npx skills --version    # warm-ish (after first-in-shell cache prime)
1.5.1
real    0m0.565s    user    0m0.343s    sys    0m0.190s

$ time npx --no-install skills --version    # cached, no network
1.5.1
real    0m0.534s    user    0m0.337s    sys    0m0.185s
```

Warm subprocess overhead is **~0.5s** per `npx skills` invocation. Cold first-in-shell (before any cache) is ~0.9s. Neither is a blocker for an interactive `agentbrew sync` workflow. For the one-shot `agentbrew install` path where a single subprocess call suffices, the overhead is invisible. **Verdict**: PASS.

**Dimension 2 — agent-target parity**:

Comprehensive side-by-side diff captured in [§ Parity diff](#parity-diff--fresh-2026-05-02-measurement-block-at-src-of-truth-level-not-readme-level) above. Summary: 51/56 exact-name overlap; 3 rename pairs (need a name map in the dispatcher); 2 agentbrew-unique carve-outs (`claude-desktop`, `overlay-desktop`); no skills-CLI-unique gaps after the 2026-05-02 mirror pass. **Verdict**: PASS with caveats — delegation covers 54/56 entries; the 3 renames need ~10 LOC of mapping; the 2 carve-outs (especially `overlay-desktop`) mean the native installer stays alive for at least those targets. Net LOC shrink estimate revises from "delete everything" to "delete ~80% of skills-sync, keep ~20% for carve-outs."

**Dimension 3 — sandbox / proxy / offline friction**: **PASS** (closed 2026-05-02).

Command under test:

```bash
npx -y skills add vercel-labs/agent-skills --skill web-design-guidelines --agent claude-code -y --copy
```

The command ran with an isolated temporary `HOME` and temporary project directory so no real agent configuration was changed.

| Context | Status | Evidence | Remediation |
|---|---|---|---|
| enterprise macOS / current network, cold cache | PASS | exit 0, 2.04s; stdout included `Found 7 skills`, `Selected 1 skill: web-design-guidelines`, `Installed 1 skill`; stderr only contained npm's optional update notice plus `real 2.04`. | None. |
| enterprise macOS / current network, warm cache | PASS | exit 0, 1.89s; stdout included the same install summary with `overwrites: Claude Code`; stderr `real 1.89`. | None. |
| Devin-run session | PASS | The same measurement ran inside the active Devin CLI execution environment (`DEVIN_MODEL` present) and subprocess + outbound network both worked. | None. |
| Offline warm cache (`npm_config_offline=true`, invalid HTTP(S) proxy) | PASS | exit 0, 1.44s after the online warm-up; stdout still reached `Installation complete`. | None. |
| Offline cold cache (`npm_config_offline=true`, invalid HTTP(S) proxy, empty npm cache) | EXPECTED FAIL | exit 1, 0.32s; stderr `npm error code ENOTCACHED` and `cache mode is 'only-if-cached' but no cached response is available.` | Documented as acceptable: first-time remote install requires network, same as agentbrew's native git-clone path. |

**Dimension 4 — error surface preservation**: **PASS** (resolved 2026-04-28). `delegateRemoteSkill` in `src/add-source.ts` uses `execFileSync("npx", skillArgs, { stdio: "inherit", timeout: 120_000 })` — `stdio: "inherit"` streams skills CLI's own stdout/stderr directly to the user's terminal without buffering or reformatting, so the raw subprocess output shape is preserved verbatim. On non-zero exit, agentbrew appends its own one-line "npx skills add failed. Check the source and try again." marker (red) and routes the caught error through `logSkipped("add-source/execFileSync", …)` for the structured log. Decision: accept the raw subprocess error shape (~0 LOC of wrapper logic, the `~20 LOC either way` budget collapses to 0). Acceptance criterion (d) "no 'deprecated' flags or dead code paths remain" is satisfied — there is no wrapper layer to drift from skills CLI's error format.

**Overall verdict**: all measured dimensions now PASS for delegation, with the known split-strategy caveat. The 54 delegated targets use `npx skills add`; the 2 carve-outs (`claude-desktop`, `overlay-desktop`) keep the native cache-clone + index path because upstream does not target them / their sharing semantics. The `overlay-desktop` carve-out means the native installer can't be deleted *entirely* — but the rest (~800–1000 LOC of fetch / symlink / version / source-kind logic) can go.

**Revised terminal state**: **(a′) Delegate 54/56 + keep native for 2/56 carve-outs**. Not pure "delete everything" but not "keep native everywhere" either. This is the split the implementer should preserve.

### Fork draft inventory (2026-04-24) {#fork-draft-inventory-2026-04-24}

Twenty-two draft PRs in [`fyodoriv/skills`](https://github.com/fyodoriv/skills/pulls) as of the 2026-04-24 night refresh #6. Each drafts a fix to an open upstream bug. No upstream submission has happened yet — drafts exist for user review before promoting to `vercel-labs/skills:main`. The split across batches exists because:
- **Batch 1** (PRs #1–#3, 2026-04-24 early): first exploratory drafts including two alternative approaches to bug #806.
- **Batch 2** (PRs #4–#8, 2026-04-24 evening): settled on one canonical approach to #806 and added more targets.
- **Batch 3** (PRs #9–#11, 2026-04-24 late-evening): three bugs off the "next batch candidates" list — subcommand `--help` (#960), project-scope `update -p <name>` (#982), and Windows-without-git error UX (#1010 half).
- **Batch 4** (PRs #12–#15, 2026-04-24 night): four more bugs from the freshly scanned issue list — Windows execPath quoting (#941), no-agents-detected fallback (#916), binary-file corruption from well-known sources (#953), and source-deletion-on-overlap (#886).
- **Batch 5** (PRs #16–#17, 2026-04-24 night #2): two more from the fresh-scan + previously-deferred review — combined short flags (#793, hand-rolled parser missing POSIX standard) and well-known source URL preservation in local lock (#666, parity with global lock's existing `sourceUrl` field).
- **Batch 6** (PR #18, 2026-04-24 night #3): single-agent global install silently flipping to copy mode (#745) — auto-default rule was missing the `installGlobally` guard, so files ended up at the agent dir only, skipping the canonical `~/.agents/skills/` location.
- **Batch 7** (PR #19, 2026-04-24 night #4): local-source absolute paths in checked-in `skills-lock.json` (#561) — `npx skills add ./docs` recorded `/Users/alice/.../docs` instead of `./docs`, breaking collaboration when teammates ran `experimental_install`. Sits in the lock-file-write-back family (alongside fork#7, fork#17).
- **Batch 8** (PRs #20–#21, 2026-04-24 night #5): two diagnostic / privacy fixes — silent error swallowing in `skills update` (#840, multiple users asking for the captured stderr message so they can self-diagnose Windows failures) and the `gh auth token` opt-out (#523, multiple corporate-Windows reporters whose Microsoft Defender / Intune MDM flags the spawn as credential-extraction malware; one report says Intune literally revoked the device from its domain).
- **Batch 9** (PR #22, 2026-04-24 night #6): well-known v0.2.0 discovery schema support (#985 + #949) — `WellKnownProvider.fetchIndex` rejected every v0.2.0 index because `isValidSkillEntry` hard-required the legacy `files: string[]` shape. Two real public endpoints — `mockaton.com` and `createos.nodeops.network` — already publish v0.2.0 indexes per the [Cloudflare RFC 0.2 spec](https://github.com/cloudflare/agent-skills-discovery-rfc) and existing skills CLI users get "No skills found at this URL". Previously deferred for spec confirmation; spec is now public and stable, so the draft lands the `type: "skill-md"` half with full SHA-256 digest verification (per spec §Integrity and Verification) and skips `type: "archive"` with a console warning naming the skill (archive support requires tar/zip extraction with path-traversal + decompression-bomb defenses; tracked as a follow-up).

| Draft | Target upstream issue | Branch | Approach |
|---|---|---|---|
| [fork#1](https://github.com/fyodoriv/skills/pull/1) | [vercel-labs/skills#806](https://github.com/vercel-labs/skills/issues/806) | `fix/806-hash-exclusions-match-installer` | **Alternative approach to #806**: hash the installed layout directly (not the source). Exploratory; superseded by fork#4 in most cases, but kept as a comparison point. |
| [fork#2](https://github.com/fyodoriv/skills/pull/2) | [vercel-labs/skills#781](https://github.com/vercel-labs/skills/issues/781) | `fix/781-normalize-line-endings-in-hash` | Normalize LF/CRLF line endings when computing skill content hash so Windows + Linux agree on the same skill-folder hash. |
| [fork#3](https://github.com/fyodoriv/skills/pull/3) | [vercel-labs/skills#808](https://github.com/vercel-labs/skills/issues/808) | `fix/808-remove-updates-local-lockfile` | `skills remove <name>` on project scope now strips the entry from `skills-lock.json`; previously left a stale entry. |
| [fork#4](https://github.com/fyodoriv/skills/pull/4) | [vercel-labs/skills#806](https://github.com/vercel-labs/skills/issues/806) | `fix/806-hash-matches-installed-files` | **Canonical approach to #806**: align `computeSkillFolderHash` file filter with the installer's file filter so `computedHash` in the lock verifies against installed files. +221 / −13 LOC; 3 unit + 2 e2e tests. |
| [fork#5](https://github.com/fyodoriv/skills/pull/5) | [vercel-labs/skills#1005](https://github.com/vercel-labs/skills/issues/1005) | `fix/1005-preserve-subpath-lock-writeback` | Preserve `owner/repo/<subpath>` in lock write-back; extracts `getLockSource()` helper. Precedent: upstream PR #588. +89 / −7 LOC; 8 unit tests. |
| [fork#6](https://github.com/fyodoriv/skills/pull/6) | [vercel-labs/skills#1001](https://github.com/vercel-labs/skills/issues/1001) | `fix/1001-suppress-banner-in-find` | Drop ASCII banner from `skills find` output for agent-friendliness; matches `list`/`check`/`update` default. +8 / −1 LOC; 1 unit test. |
| [fork#7](https://github.com/fyodoriv/skills/pull/7) | [vercel-labs/skills#999](https://github.com/vercel-labs/skills/issues/999) | `fix/999-well-known-lock-source-url` | Persist the full well-known URL (not a truncated identifier) in local `skills-lock.json` so updates can resolve. +7 / −2 LOC. |
| [fork#8](https://github.com/fyodoriv/skills/pull/8) | [vercel-labs/skills#954](https://github.com/vercel-labs/skills/issues/954) | `fix/954-check-is-read-only` | Make `skills check` read-only as AGENTS.md documents — threads `checkOnly` through `runUpdate` → `updateGlobalSkills` / `updateProjectSkills`. +60 / −20 LOC. |
| [fork#9](https://github.com/fyodoriv/skills/pull/9) | [vercel-labs/skills#960](https://github.com/vercel-labs/skills/issues/960) | `fix/960-subcommand-help-dry-run` | `<subcommand> --help` prints help without running the subcommand. Single guard at top of `main()` in `src/cli.ts`. +70 / −6 LOC; 15 new vitest cases. |
| [fork#10](https://github.com/fyodoriv/skills/pull/10) | [vercel-labs/skills#982](https://github.com/vercel-labs/skills/issues/982) | `fix/982-update-project-single-skill` | `skills update -p <name>` narrows to the named skill via `-s <name>` (new `buildLocalUpdateAddArgs` helper). +48 / −9 LOC; 2 new unit tests. |
| [fork#11](https://github.com/fyodoriv/skills/pull/11) | [vercel-labs/skills#1010](https://github.com/vercel-labs/skills/issues/1010) (error-UX half) | `fix/1010-git-missing-error-message` | Detect `spawn git ENOENT` and throw a platform-appropriate install hint instead of a raw stack trace. New `isGitMissingError` predicate + `isGitMissing` flag on `GitCloneError`. +70 / −1 LOC; 5 new unit tests. The allowlist half of #1010 stays in the issue conversation queue. |
| [fork#12](https://github.com/fyodoriv/skills/pull/12) | [vercel-labs/skills#941](https://github.com/vercel-labs/skills/issues/941) | `fix/941-quote-execpath-on-windows` | `skills update` fails silently on Windows when `process.execPath` contains spaces. Extracts `buildUpdateSpawnPlan` (`src/update-spawn.ts`) that quotes execPath + whitespace-bearing args when `shell: true`. Both `updateGlobalSkills` and `updateProjectSkills` route through the helper. +188 / −4 LOC; 8 unit tests covering POSIX, Windows, arg-order parity, and embedded-quote escaping. |
| [fork#13](https://github.com/fyodoriv/skills/pull/13) | [vercel-labs/skills#916](https://github.com/vercel-labs/skills/issues/916) | `fix/916-default-to-universal-when-no-agents` | `npx skills update -p -y` creates a `skills/` folder at project root because `add` falls through to "install to all agents" when 0 detected + `-y`, and that includes openclaw with `skillsDir: 'skills'`. Switches both fallback sites in `src/add.ts` to universal-only (`.agents/skills/`). +98 / −4 LOC; 2 regression tests with `HOME=<empty tmpdir>`. |
| [fork#14](https://github.com/fyodoriv/skills/pull/14) | [vercel-labs/skills#953](https://github.com/vercel-labs/skills/issues/953) | `fix/953-wellknown-binary-files-not-corrupted` | `npx skills add` corrupts binary files from well-known endpoints because `response.text()` decodes binary as UTF-8 (replacement chars) and `writeFile(..., 'utf-8')` re-encodes them, mangling content + inflating size. Changes `WellKnownSkill.files` from `Map<string, string>` to `Map<string, Uint8Array>`; uses `arrayBuffer()` everywhere; writes raw bytes. +243 / −12 LOC; 3 regression tests including a 4 KB byte-identity check. **Verified bug exists on main** (4096 → 8192 byte inflation). |
| [fork#15](https://github.com/fyodoriv/skills/pull/15) | [vercel-labs/skills#886](https://github.com/vercel-labs/skills/issues/886) | `fix/886-no-self-overwrite-on-overlapping-source` | Data-loss bug: `skills add ./.agents/skills -s <name>` deletes the user's source SKILL.md because `installSkillForAgent` always wipes the canonical dir before copying — destroying source files when source==canonical. Adds `isSamePath(a, b)` helper (mirrors `createSymlink`'s `realpath` + `resolveParentSymlinks` pattern); short-circuits clean+copy at three call sites: copy mode, symlink-mode canonical write, symlink-fallback copy. +194 / −6 LOC; 3 regression tests; **bug verified to exist on main** (test 1 + test 2 fail with ENOENT). |
| [fork#16](https://github.com/fyodoriv/skills/pull/16) | [vercel-labs/skills#793](https://github.com/vercel-labs/skills/issues/793) | `fix/793-combined-short-flags` | `parseAddOptions` doesn't handle POSIX-style combined short flags — `-yg` is silently dropped instead of expanding to `-y -g`, leaving the user re-prompted for "Installation scope" despite explicit non-interactive intent. Adds `expandCombinedShortFlags` helper with conservative split rule: only known boolean letters `{y, g, l}` are eligible; any unknown letter aborts the split (typo `-yx` stays a single token, doesn't accidentally activate `-y`). Long flags (`--xxx`) and value-bearing short flags (`-a`/`-s`) pass through unchanged. +71 / −0 LOC; 5 new tests covering `-yg`, `-gy`, `-ygl`, unknown-letter passthrough, long-flag passthrough. |
| [fork#17](https://github.com/fyodoriv/skills/pull/17) | [vercel-labs/skills#666](https://github.com/vercel-labs/skills/issues/666) | `fix/666-wellknown-https-preserved-in-lock` | `experimental_install` fails for any well-known source because the local lock saves only `source: <hostname>` (matching telemetry conventions but missing the scheme); the installer then misclassifies the bare hostname as a git source and `git clone <hostname>` fails. The global lock already carries this via a separate `sourceUrl` field; the local lock didn't. Adds optional `sourceUrl` to `LocalSkillLockEntry`; well-known writes now persist the full `https://...` URL alongside the hostname-only `source` (telemetry stays unchanged). Extracts `resolveLockEntrySource()` as a pure function preferring `sourceUrl` over `source`; for legacy lock files written before this fix (well-known with hostname-only `source` and no `sourceUrl`), recovers by prepending `https://` so existing users don't need to re-add. +159 / −2 LOC; 8 new tests in `tests/install-from-lock.test.ts` + 1 schema test. Full suite green: 439/439. |
| [fork#18](https://github.com/fyodoriv/skills/pull/18) | [vercel-labs/skills#745](https://github.com/vercel-labs/skills/issues/745) | `fix/745-single-agent-global-keeps-symlink` | `npx skills add <src> -g -y -a claude-code --skill <name>` silently flipped installMode to copy because the auto-default rule `if (uniqueDirs.size <= 1) installMode = 'copy'` didn't account for the canonical `~/.agents/skills/` dir always being distinct from the agent dir under `-g`. Files ended up only at `~/.claude/skills/<name>/` (a copy, not a symlink). Extracts `shouldAutoDefaultToCopy()` as a pure helper requiring `NOT installGlobally` before falling through to copy. Both call sites (well-known + github/local) updated identically. +131 / −7 LOC; 6 new unit tests covering project + 1 agent (preserved), global + 1 agent (the bug), global + N agents, explicit `--copy`, multi-dir prompt path, 0-agent edge case. |
| [fork#19](https://github.com/fyodoriv/skills/pull/19) | [vercel-labs/skills#561](https://github.com/vercel-labs/skills/issues/561) | `fix/561-relative-paths-for-local-sources` | `npx skills add ./docs` recorded the absolute machine-specific path (`/Users/alice/.../docs`) into the checked-in `skills-lock.json`, leaking per-developer state — teammates running `experimental_install` hit a path that doesn't exist on their machine. New `getLocalLockSource(absolutePath, cwd)` helper returns `./relative/path` with POSIX separators (platform-portable JSON) when the path is inside cwd, and keeps the absolute path when outside cwd (cross-project installs are rare; relative paths like `../../../tmp/x` are too fragile for a checked-in lock). Backward-compat: `parseSource()` already handles both relative and absolute local paths identically. +80 / −3 LOC; 6 new unit tests (inside-cwd, nested, cwd-itself, outside-cwd, sibling-project, already-relative passthrough). |
| [fork#20](https://github.com/fyodoriv/skills/pull/20) | [vercel-labs/skills#840](https://github.com/vercel-labs/skills/issues/840) | `fix/840-surface-update-error-output` | `skills update` was silently swallowing every subprocess failure: `stdio: ['inherit', 'pipe', 'pipe']` captures stderr/stdout, but the failure branch printed only `✗ Failed to update <skill>` with no diagnostic info — `--verbose` and `DEBUG=1` produced nothing. Reporters explicitly asked for the underlying error message so they could self-diagnose Windows-specific failures and contribute fixes. New pure helper `formatUpdateFailureMessage(safeName, result)` (`src/update-error-output.ts`) emits indented diagnostic lines: spawn-level `Error` (ENOENT, EACCES) takes precedence; killing signal (SIGKILL, SIGTERM, …) when status is null; non-empty captured stderr (preferred), falling back to stdout; exit code as last resort when no output was captured. Output is bounded (≤20 lines, ≤240 chars per line) and sanitized via `sanitizeMetadata` (CWE-150 defense). Both update call sites in `cli.ts` (`updateGlobalSkills` + `updateProjectSkills`) route through the helper. +242 / −2 LOC; 13 unit tests covering header always present, stderr verbatim, stdout fallback, exit-code last resort, spawn-level Error, signal, ANSI strip, Buffer input, blank-line skip, line overflow, line truncation, status-0 no-op, CRLF normalization. |
| [fork#21](https://github.com/fyodoriv/skills/pull/21) | [vercel-labs/skills#523](https://github.com/vercel-labs/skills/issues/523) | `fix/523-skills-no-gh-auth-optout` | `getGitHubToken` unconditionally invoked `gh auth token` via `execSync` when no `GITHUB_TOKEN` / `GH_TOKEN` was set — even for public-repo installs that do not need auth. On corporate Windows machines this triggers Microsoft Defender for Endpoint and Intune MDM alerts that flag the spawn as credential-extraction malware. One reporter ([jdngray77](https://github.com/vercel-labs/skills/issues/523)) said Intune MDM literally revoked the entire Windows machine from its domain when this fired. Adds `SKILLS_NO_GH_AUTH=1` opt-out (also `true` / `yes`, case-insensitive, whitespace-trimmed). When set, the gh CLI fallback is skipped and `getGitHubToken` returns `null` — explicit `GITHUB_TOKEN` / `GH_TOKEN` continue to work. Default behavior is unchanged: users who don't set the env-var still get the gh CLI fallback for the API rate-limit boost. Extracts the resolution logic into `src/github-auth.ts` as a pure `resolveGitHubToken({ env, runGhAuthToken })` helper (testable without spawning a real subprocess); `src/skill-lock.ts:getGitHubToken` becomes a thin wrapper. +237 / −26 LOC; 22 unit tests covering env-var priority order, all three opt-out values (with whitespace tolerance), strict allowlist (typos like `maybe`/`on` are NOT opt-out), opt-out passthrough for explicit env-var tokens, gh CLI failure paths (throws / empty / whitespace-only), trailing-newline trimming. |
| [fork#22](https://github.com/fyodoriv/skills/pull/22) | [vercel-labs/skills#985](https://github.com/vercel-labs/skills/issues/985) + [#949](https://github.com/vercel-labs/skills/issues/949) | `fix/985-wellknown-v02-schema-skill-md` | Well-known v0.2.0 discovery schema support. The current `WellKnownProvider.isValidSkillEntry` hard-requires `entry.files: string[]`, so EVERY v0.2.0 index — `$schema: https://schemas.agentskills.io/discovery/0.2.0/schema.json` with entries shaped `{ type, url, digest }` — is rejected. Two real public endpoints already publish v0.2.0 indexes (`mockaton.com`, `createos.nodeops.network`) and existing users see "No skills found at this URL". Adds schema-aware dispatch: `fetchIndex` returns a discriminated union by `schemaVersion` (`'v0.1.0' | 'v0.2.0'`); v0.1.0 path is unchanged; v0.2.0 `type: "skill-md"` fetches raw bytes, verifies SHA-256 against `entry.digest` (per spec §Integrity and Verification — text decoding happens AFTER digest check, matching fork#14's byte-correctness fix), parses frontmatter; v0.2.0 `type: "archive"` skips with `console.warn` naming the skill and pointing at #985 (archive support needs tar/zip extraction with path-traversal + decompression-bomb defenses per §Archive Safety — landing separately). URL resolution per RFC 3986 §5 against the index URL covers absolute, path-absolute, and relative entry URLs. Unrecognized `$schema` URIs are rejected per spec §Versioning. Pure schema/digest helpers extracted into `src/providers/wellknown-v02-schema.ts` so the validation, name-validation, URL-resolution, and digest logic is unit-testable without a network. The returned `WellKnownSkill` is normalized to a v0.1.0-shaped `indexEntry` (`files: ['SKILL.md']`) so downstream consumers (catalog, install, lock-file) keep working unchanged. +1,033 / −37 LOC across 4 files (1 new helper module, 2 new test files, 1 modified provider); 50 new tests (41 unit + 9 integration mocking `globalThis.fetch`) covering schema detection, name validation, entry validation, mixed-validity rejection, URL resolution, digest compute / verify, real-world `mockaton` end-to-end, real-world `createos` archive-skipped warning, digest-mismatch reject path, mixed v0.1.0/v0.2.0 fixture, and v0.1.0 backward-compat. Total test count grows from 123 → 173 baseline; all pre-existing tests pass. |

Combined: **+3,463 / −194 LOC** across 22 drafts, 19 distinct upstream bug reports. Four (fork#2, fork#5, fork#7, fork#19) are in the "lock-file write-back drops information" bug class — fork#17 sits adjacent (same lock-file file but different concern: well-known URL preservation vs subpath/line-ending preservation). Three (fork#14, fork#17, fork#22) all touch the well-known provider — fork#14 is byte-correctness, fork#17 is local-lock URL preservation, fork#22 is v0.2.0 schema support. If upstream review agrees, fork#7 + fork#17 + fork#19 could bundle as the "lock-file source-shape preservation" group; fork#14 + fork#22 could bundle as the "well-known correctness" group. Fork#1 and fork#4 are mutually exclusive approaches to #806; only one goes upstream. Fork#20 (silent failure surfacing) is the single highest-value draft for users currently stuck — it doesn't fix the underlying Windows update failure but unblocks self-diagnosis for everyone hitting #840.

**Promotion priority** for upstream submission: fork#15 (data-loss) → fork#21 (corporate-blocker) → fork#22 (every v0.2.0 endpoint blocked, real users hitting #985 + #949 today, 50 new tests, no breaking change for v0.1.0 consumers) → fork#20 (diagnostic enabler) → fork#17 (data-recovery for well-known) → fork#18 (data-correctness symlink mode) → fork#19 (collaboration-correctness) → fork#6 (smallest, zero controversy) → fork#16 (POSIX parser) → ... see prior priority order in `contribute-trust-building-pr-skills-cli` (`TASKS.md`). fork#22 jumps ahead of fork#20 on the post-fork#15/fork#21 priority list because v0.2.0-only servers have no workaround at all today (every fetch returns "No skills found"), whereas fork#20's silent-failure swallowing has a workaround (read the source).

**Candidates for future drafts** — reviewed 2026-04-24 night but not pursued in this session. File in fork only after user review of the current 22:

| Upstream issue | Shape | Why deferred |
|---|---|---|
| [#974](https://github.com/vercel-labs/skills/issues/974) | `-g` combined with `-a` overrides symlinking | Spans 20+ `installGlobally` call sites in `src/add.ts`; not a drive-by. Park until the smaller drafts ship. |
| [#1010](https://github.com/vercel-labs/skills/issues/1010) (allowlist half) | Blob fast path is org-allowlisted | Policy change, not mechanical. Ask upstream in the issue conversation whether they'd accept expanding the allowlist vs keeping the current behavior with better docs. Error-UX half already covered by fork#11. |
| [#969](https://github.com/vercel-labs/skills/issues/969) | Multiselect prompt shows duplicate options | Fix is "upgrade `@clack/prompts` 0.11 → 1.2" — a major version bump with breaking-changes surface across every prompt file. Not a narrow bug fix. |
| [#997](https://github.com/vercel-labs/skills/issues/997) | `npx skills update` fails for self-hosted GitLab | Environment-dependent; needs a real self-hosted GitLab instance to reproduce. Defer. |
| [#923](https://github.com/vercel-labs/skills/issues/923) | `skills update` reports success without updating contents | Triage-needed: the bug shape is unclear from the report; need a reliable repro and a careful read of the update path before drafting. Defer until repro is in hand. |
| [#915](https://github.com/vercel-labs/skills/issues/915) | `skills update <skill-name>` adds all other skills | Likely the same root cause as fork#10 (`-p <name>` doesn't narrow). If fork#10 lands and #915 doesn't auto-close, revisit then. |

**Items no longer candidates**:
- [#983](https://github.com/vercel-labs/skills/issues/983) (`npx skills` ENOENT when no `package.json`) — the failure mode is in `npx` itself, not the skills CLI. A doc note on the README (or a targeted `npm install -g` hint when we detect `npx` mode) would help, but it's not a code fix in the CLI.
- [#977](https://github.com/vercel-labs/skills/issues/977) (remove doesn't clean lock for project scope) — **duplicate of #808 / fork#3**; would close when fork#3 merges upstream.
- [#960](https://github.com/vercel-labs/skills/issues/960) — **now fork#9**.
- [#982](https://github.com/vercel-labs/skills/issues/982) — **now fork#10**.
- [#1010](https://github.com/vercel-labs/skills/issues/1010) error-UX half — **now fork#11**; allowlist half stays in the deferred table above.
- [#941](https://github.com/vercel-labs/skills/issues/941) — **now fork#12**.
- [#916](https://github.com/vercel-labs/skills/issues/916) — **now fork#13**.
- [#953](https://github.com/vercel-labs/skills/issues/953) — **now fork#14**.
- [#886](https://github.com/vercel-labs/skills/issues/886) — **now fork#15**.
- [#793](https://github.com/vercel-labs/skills/issues/793) — **now fork#16**.
- [#666](https://github.com/vercel-labs/skills/issues/666) — **now fork#17**.
- [#745](https://github.com/vercel-labs/skills/issues/745) — **now fork#18**.
- [#561](https://github.com/vercel-labs/skills/issues/561) — **now fork#19**.
- [#840](https://github.com/vercel-labs/skills/issues/840) — **now fork#20** (silent error swallowing in `skills update`).
- [#523](https://github.com/vercel-labs/skills/issues/523) (and the closed [#328](https://github.com/vercel-labs/skills/issues/328)) — **now fork#21** (`SKILLS_NO_GH_AUTH=1` opt-out).
- [#985](https://github.com/vercel-labs/skills/issues/985) + [#949](https://github.com/vercel-labs/skills/issues/949) — **now fork#22** (well-known v0.2.0 schema support, `skill-md` half; `archive` half is a tracked follow-up). Spec confirmed via [`cloudflare/agent-skills-discovery-rfc`](https://github.com/cloudflare/agent-skills-discovery-rfc).

---

## Cross-references

- **Strategic posture**: [`docs/VISION.md` → Strategy: delegate, contribute, absorb](../VISION.md#strategy-delegate-contribute-absorb)
- **Main verdict**: [`docs/COMPETITION.md` → Tier 1 → skills CLI](../COMPETITION.md) + [Build or Contribute? summary](../COMPETITION.md#build-or-contribute--per-competitor-summary)
- **Evaluation task**: the now-retired `delegate-skill-install-to-skills-cli` parent task (retired 2026-04-28)
- **Existing integration**: [`src/add-source.ts:192`](../../src/add-source.ts#L192) (`delegateRemoteSkill`)
- **Source-of-truth docs**: [vercel-labs/skills README](https://raw.githubusercontent.com/vercel-labs/skills/main/README.md), [AGENTS.md](https://github.com/vercel-labs/skills/blob/main/AGENTS.md), [skills.sh](https://skills.sh)

---

## Follow-ups discovered while writing this doc

These are worth filing as TASKS.md entries (the "always scout and record" rule):

1. **COMPETITION.md claims a `patch.ts` that doesn't exist.** The Gap Analysis row "Patch system for skill customization | `patch.ts` — pin, unpin, resolve, pinned" is a ghost feature — no `patch.ts` file exists in `src/`. The Comparison Matrix also shows agentbrew with ✅ on "Patch system." Both need correction. The honest state: agentbrew does NOT have a patch system; skillfile does.
2. **COMPETITION.md lock-file claim is imprecise.** The Matrix says agentbrew has "Lock file (SHA pinning) ✅ agentbrew.lock (YAML)." The correct description is "Lock file (SHA tracking, not enforcing)" per [`src/lock.ts:47`](../../src/lock.ts#L47).
3. **COMPETITION.md "~2K line shrink" is inflated.** The researcher's LOC breakdown shows ~1,000–1,500 lines is the realistic shrink. The now-retired `delegate-skill-install-to-skills-cli` parent task referenced this number and was corrected before retirement.
4. **Freshness tracker for skills CLI is stale.** The tracker claims 13.8K stars; the live GitHub page shows 14.6K stars as of 2026-04-19. This will be caught by the P0 `re-research-stale-competitors` task.
