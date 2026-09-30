# Draft: upstream issue for `neiii/bridle`

**Status:** draft only — not yet filed. The `gh issue create` step is a public-write action and requires explicit per-action user approval per [`TASKS.md`](../../TASKS.md) file-level publishing policy.

**Source:** the `bridle-opencode-path-issue` task in [`TASKS.md`](../../TASKS.md), surfaced from the [`audit-harness-locate-paths` audit](harness-locate-cross-check.md) (2026-04-26).

When approved, the message below is what to post. Title + body are formatted for paste into the GitHub issue editor; Markdown renders directly.

---

## Title

`harness-locate::opencode` returns singular `skill/` and `command/` — OpenCode docs say plural

## Body

[`harness-locate`](https://github.com/neiii/bridle/tree/master/crates/harness-locate) returns the OpenCode global skills directory as `~/.config/opencode/skill/` and the global commands directory as `~/.config/opencode/command/`. Both are singular. Per [OpenCode's official docs](https://opencode.ai/docs/skills) (read 2026-04-26, re-verified 2026-05-02 against `neiii/bridle@master`), the actual paths are plural:

- Skills: `~/.config/opencode/skills/<name>/SKILL.md` ([opencode.ai/docs/skills](https://opencode.ai/docs/skills))
- Commands: Global `~/.config/opencode/commands/` ([opencode.ai/docs/commands/](https://opencode.ai/docs/commands/))

Project-scope paths are also plural in the OpenCode docs:

- Project skills: `.opencode/skills/`
- Project commands: `.opencode/commands/`

### Source-code references

The two specific Bridle source-code lines that return the singular forms:

- [`crates/harness-locate/src/harness/opencode.rs:41-46`](https://github.com/neiii/bridle/blob/master/crates/harness-locate/src/harness/opencode.rs#L41-L46) — `commands_dir()` joins `"command"` (singular).
- [`crates/harness-locate/src/harness/opencode.rs:73-78`](https://github.com/neiii/bridle/blob/master/crates/harness-locate/src/harness/opencode.rs#L73-L78) — `skills_dir()` joins `"skill"` (singular).

Tests at `opencode.rs:296-334` assert the same singular forms, so a fix would update three call sites and one test fixture (the test names already say `commands_dir_*` and `skills_dir_*` — they just need the assertions to match the new paths).

### Suggested patch

```diff
-pub fn commands_dir(scope: &Scope) -> Result<PathBuf> {
-    match scope {
-        Scope::Global => Ok(global_config_dir()?.join("command")),
-        Scope::Project(root) => Ok(project_config_dir(root).join("command")),
-        Scope::Custom(path) => Ok(path.join("command")),
+pub fn commands_dir(scope: &Scope) -> Result<PathBuf> {
+    match scope {
+        Scope::Global => Ok(global_config_dir()?.join("commands")),
+        Scope::Project(root) => Ok(project_config_dir(root).join("commands")),
+        Scope::Custom(path) => Ok(path.join("commands")),
     }
 }
```

…and the analogous `"skill"` → `"skills"` change in `skills_dir()`.

### Why it matters

Tools that consume `harness-locate`'s OpenCode paths (e.g. installers that wire skills into `<global>/skill/` or `<global>/command/`) write into directories OpenCode doesn't read. End-users see no skills appear after install, and the failure mode is silent. A simple plural rename matches the documented surface and unblocks every downstream tool.

The harm is bounded today (Bridle has 44 monthly npm downloads and 64 recent crate-pulls per [crates.io](https://crates.io/crates/harness-locate) — small adoption), but the fix is mechanical and risk-free since the only consumers of the wrong paths are the same Bridle codebase that's about to change.

### Audit reference

This finding came out of an external cross-check audit comparing Bridle's `harness-locate` against [agentbrew](https://github.com/fyodoriv/agentbrew)'s [`src/core/agents.yaml`](https://github.com/fyodoriv/agentbrew/blob/main/src/core/agents.yaml) per-agent path table. The full audit is at [`docs/audits/harness-locate-cross-check.md`](https://github.com/fyodoriv/agentbrew/blob/main/docs/audits/harness-locate-cross-check.md) — agentbrew is correct on the OpenCode plurals, so the cross-check turned up exactly two cells where Bridle and agentbrew disagree, and OpenCode's docs side with agentbrew.

Happy to send a PR if maintainers prefer.

---

## Filing checklist (for the maintainer-approved publish step)

When the user approves the publish step:

1. Confirm the title above is short and factual.
2. Confirm the source-code line ranges (#L41-L46 and #L73-L78) still match Bridle's `master` branch — if Bridle has refactored, update the line ranges.
3. Confirm the OpenCode docs URLs still resolve (they were live 2026-04-26).
4. `gh --repo neiii/bridle issue create --title "harness-locate::opencode returns singular skill/ and command/ — OpenCode docs say plural" --body "$(cat docs/audits/bridle-opencode-issue-draft.md | sed -n '/^## Body/,/^---$/{/^## Body/d; /^---$/d; p}')"`.
5. Record the resulting issue URL in [`docs/audits/harness-locate-cross-check.md`](harness-locate-cross-check.md) under "Scout output".
6. If maintainers respond positively, offer the PR (with the diff above + corresponding test updates).
7. If Bridle merges a fix, also update the `agents-yaml-honor-env-overrides` task in [`TASKS.md`](../../TASKS.md) to note Bridle now matches agentbrew's plural paths.

## Why this doc lives in `docs/audits/`

Acceptance (a) of the [`bridle-opencode-path-issue`](../../TASKS.md) task says: *"the issue draft is recorded in the commit body or a sibling `docs/audits/bridle-opencode-issue-draft.md`."* The sibling-file path was chosen because: (i) the audit context is itself a sibling at [`docs/audits/harness-locate-cross-check.md`](harness-locate-cross-check.md), so co-locating the follow-up draft keeps both pieces in one folder; (ii) the publish step expects to `cat` the body from a file path, which works only if the draft lives in a stable location, not a commit body that the next session can't easily find.
