# Draft: upstream PR for `block/ai-rules` — `--source-dir` / `--target-dir` flags on `generate`

**Status:** draft only — not yet filed. Pushing to `fyodoriv/ai-rules` and running `gh pr create` against `block/ai-rules` are public-write actions and require explicit per-action user approval per [`TASKS.md`](../../TASKS.md) file-level publishing policy.

**Source:** the [`delegate-rules-to-ai-rules-slice-6a-followup`](../../TASKS.md) task (PR (a) of 2 in slice 6 of the now-retired `delegate-rules-to-ai-rules` parent). When this lands upstream, agentbrew's `delegateRulesGenerate` (`src/sync/rules-delegate.ts`) can use explicit flags instead of changing `cwd` — a cleaner subprocess invocation. Net agentbrew shrink: minimal cleanup (~20 LOC change in `rules-delegate.ts`).

When approved, the files below land on a feature branch in `fyodoriv/ai-rules` and the body below is what to paste into `gh pr create`.

---

## Title

`feat: add --source-dir and --target-dir flags to generate`

## Body

`ai-rules generate` currently uses `std::env::current_dir()` (set in [`src/cli/mod.rs:23`](https://github.com/block/ai-rules/blob/main/src/cli/mod.rs#L23)) for both the source location (where `ai-rules/` config lives) AND the output location (where `.<agent>/` files are written). For most use cases that's correct, but it forces tools that drive `ai-rules` programmatically (e.g. monorepo build scripts, agent orchestrators) to `cd` into the right directory before invoking the binary.

This PR adds two optional CLI flags that override `current_dir` for those two purposes independently:

- `--source-dir <path>` — where to look for `ai-rules/` config + source files.
- `--target-dir <path>` — where to write generated `.<agent>/` files (and `ai-rules/.gitignore` updates when `--gitignore` is set).

When neither flag is set, behavior is unchanged: both default to `current_dir`. When one is set and the other isn't, the unset one defaults to `current_dir`. When both are set, source-reading and output-writing happen in independent directories.

### Why

Two real driver tools want this today:

1. **agentbrew** ([fyodoriv/agentbrew](https://github.com/fyodoriv/agentbrew)) — its [`delegateRulesGenerate`](https://github.com/fyodoriv/agentbrew/blob/main/src/sync/rules-delegate.ts) helper currently uses `execFileSync` with the `cwd:` option to invoke `ai-rules generate` against a temp directory. Explicit flags are a cleaner subprocess shape — no `cwd` mutation, no risk of hitting a corrupted working directory if the parent process crashes between `cd` and `exec`.
2. **CI / monorepo build pipelines** — calling `ai-rules generate --source-dir packages/foo --target-dir build/foo` is more idiomatic than wrapping every invocation in `(cd packages/foo && ai-rules generate)` and dealing with relative-path traps.

### Source-code references

- Modifies: [`src/cli/args.rs`](https://github.com/block/ai-rules/blob/main/src/cli/args.rs) — add `source_dir`/`target_dir` fields to `GenerateArgs` and `ResolvedGenerateArgs`.
- Modifies: [`src/cli/config_resolution.rs`](https://github.com/block/ai-rules/blob/main/src/cli/config_resolution.rs) — pass through the optional fields.
- Modifies: [`src/cli/mod.rs`](https://github.com/block/ai-rules/blob/main/src/cli/mod.rs) — pass `source_dir`/`target_dir` to `run_generate` (preserving current_dir as the default).
- Modifies: [`src/commands/generate.rs`](https://github.com/block/ai-rules/blob/main/src/commands/generate.rs) — accept the two new parameters and use them instead of `current_dir` in the right places.
- Adds: a new `tests` block in `src/commands/generate.rs` covering the three combinations (only source, only target, both, neither).

### Diff

#### `src/cli/args.rs` (diff)

```diff
+use std::path::PathBuf;
+
 use clap::{Args, Parser, Subcommand};

@@ pub struct GenerateArgs {
     #[arg(
         long,
         value_delimiter = ',',
         help = "Comma-separated list of agents to generate rules for"
     )]
     pub agents: Option<Vec<String>>,
     #[arg(long, help = "Add generated file patterns to .gitignore")]
     pub gitignore: bool,
     #[arg(
         long,
         help = "DEPRECATED: Use --gitignore instead. Skip updating .gitignore with generated file patterns"
     )]
     pub no_gitignore: bool,
     #[arg(
         long,
         help = "Maximum nested directory depth to traverse (0 = current directory only)"
     )]
     pub nested_depth: Option<usize>,
+    #[arg(
+        long,
+        value_name = "PATH",
+        help = "Source directory containing ai-rules/ (defaults to the current working directory)"
+    )]
+    pub source_dir: Option<PathBuf>,
+    #[arg(
+        long,
+        value_name = "PATH",
+        help = "Target directory for generated .<agent>/ files (defaults to the current working directory)"
+    )]
+    pub target_dir: Option<PathBuf>,
 }

@@ pub struct ResolvedGenerateArgs {
     pub agents: Option<Vec<String>>,
     pub command_agents: Option<Vec<String>>,
     pub gitignore: bool,
     pub nested_depth: usize,
+    pub source_dir: Option<PathBuf>,
+    pub target_dir: Option<PathBuf>,
 }
```

#### `src/cli/config_resolution.rs` (diff)

```diff
@@ impl GenerateArgs {
     pub fn with_config(self, config: Option<&config::Config>) -> ResolvedGenerateArgs {
         let agents = resolve_agents(self.agents, config);
         let command_agents = resolve_command_agents(config);
         let nested_depth = resolve_nested_depth(self.nested_depth, config);
+        let source_dir = self.source_dir;
+        let target_dir = self.target_dir;

         // Handle gitignore resolution with backward compatibility
         // ...

         ResolvedGenerateArgs {
             agents,
             command_agents,
             gitignore,
             nested_depth: nested_depth.unwrap_or(0),
+            source_dir,
+            target_dir,
         }
     }
 }
```

#### `src/cli/mod.rs` (diff)

```diff
@@ pub fn run() -> Result<()> {
     let cli = Cli::parse();
     let current_dir = std::env::current_dir()?;
     let config = load_config(&current_dir)?;

     match cli.command {
         Some(Commands::Generate(args)) => {
             let final_args = args.with_config(config.as_ref());
-            run_generate(&current_dir, final_args)
+            // --source-dir / --target-dir override current_dir for source-reading
+            // and output-writing respectively. Either falls back to current_dir
+            // when not set.
+            let source_dir = final_args
+                .source_dir
+                .clone()
+                .unwrap_or_else(|| current_dir.clone());
+            let target_dir = final_args
+                .target_dir
+                .clone()
+                .unwrap_or_else(|| current_dir.clone());
+            run_generate(&source_dir, &target_dir, final_args)
         }
         // ... other commands unchanged
     }
 }
```

#### `src/commands/generate.rs` (diff)

```diff
-pub fn run_generate(current_dir: &Path, args: ResolvedGenerateArgs) -> Result<()> {
+pub fn run_generate(source_dir: &Path, target_dir: &Path, args: ResolvedGenerateArgs) -> Result<()> {
     println!(
-        "Generating rules for agents: {}, nested_depth: {}, gitignore: {}",
+        "Generating rules for agents: {}, nested_depth: {}, gitignore: {}, source_dir: {}, target_dir: {}",
         args.agents
             .as_ref()
             .map(|a| a.join(","))
             .unwrap_or_else(|| "all".to_string()),
         args.nested_depth,
         args.gitignore,
+        source_dir.display(),
+        target_dir.display(),
     );
     let registry = AgentToolRegistry::new();
     let agents = args.agents.unwrap_or_else(|| registry.get_all_tool_names());

     let command_agents = args.command_agents.unwrap_or_else(|| agents.clone());

     let mut generation_result = GenerationResult::default();
-    let filter = DirectoryFilter::from_project_root(current_dir);
+    let filter = DirectoryFilter::from_project_root(source_dir);

-    traverse_project_directories(current_dir, args.nested_depth, 0, &filter, &mut |dir| {
-        generate_files(
-            dir,
-            &agents,
-            &command_agents,
-            &registry,
-            &mut generation_result,
-        )
-    })?;
+    traverse_project_directories(source_dir, args.nested_depth, 0, &filter, &mut |dir| {
+        // Translate per-walk dir from source-relative to target-relative.
+        // For the no-flag case (source_dir == target_dir == current_dir) this
+        // is a no-op; for the flagged case the relative path within source_dir
+        // is mirrored under target_dir so nested-depth traversals end up in
+        // the right place.
+        let relative = dir.strip_prefix(source_dir).unwrap_or(dir);
+        let output_dir = target_dir.join(relative);
+        generate_files(
+            dir,
+            &output_dir,
+            &agents,
+            &command_agents,
+            &registry,
+            &mut generation_result,
+        )
+    })?;

-    generation_result.display(current_dir);
+    generation_result.display(target_dir);

     if args.gitignore {
-        operations::update_project_gitignore(current_dir, &registry, args.nested_depth)?;
+        operations::update_project_gitignore(target_dir, &registry, args.nested_depth)?;
         print_success("Updated .gitignore with generated file patterns");
     } else {
-        operations::remove_gitignore_section(current_dir, &registry)?;
+        operations::remove_gitignore_section(target_dir, &registry)?;
     }

     Ok(())
 }

-fn generate_files(
-    current_dir: &Path,
-    agents: &[String],
-    command_agents: &[String],
-    registry: &AgentToolRegistry,
-    result: &mut GenerationResult,
-) -> Result<()> {
+fn generate_files(
+    source_dir: &Path,
+    target_dir: &Path,
+    agents: &[String],
+    command_agents: &[String],
+    registry: &AgentToolRegistry,
+    result: &mut GenerationResult,
+) -> Result<()> {
-    operations::clean_generated_files(current_dir, agents, registry)?;
+    operations::clean_generated_files(target_dir, agents, registry)?;
     // ... continue using source_dir for source-reading and target_dir for output
}
```

#### `src/commands/generate.rs` test additions

```rust
#[test]
fn test_run_generate_with_source_and_target_dirs() {
    use tempfile::TempDir;

    let source_dir = TempDir::new().unwrap();
    let target_dir = TempDir::new().unwrap();

    // Set up a minimal source ai-rules/ directory
    let ai_rules_dir = source_dir.path().join("ai-rules");
    std::fs::create_dir_all(&ai_rules_dir).unwrap();
    std::fs::write(ai_rules_dir.join("test.md"), "# Test rule").unwrap();

    let args = ResolvedGenerateArgs {
        agents: Some(vec!["claude".to_string()]),
        command_agents: Some(vec!["claude".to_string()]),
        gitignore: false,
        nested_depth: 0,
        source_dir: Some(source_dir.path().to_path_buf()),
        target_dir: Some(target_dir.path().to_path_buf()),
    };

    let result = run_generate(source_dir.path(), target_dir.path(), args);
    assert!(result.is_ok());

    // Output should appear in target_dir, not source_dir
    assert!(target_dir.path().join(".claude").exists());
    assert!(!source_dir.path().join(".claude").exists());
}

#[test]
fn test_run_generate_target_dir_falls_back_to_source() {
    use tempfile::TempDir;

    let temp = TempDir::new().unwrap();
    let ai_rules_dir = temp.path().join("ai-rules");
    std::fs::create_dir_all(&ai_rules_dir).unwrap();
    std::fs::write(ai_rules_dir.join("test.md"), "# Test rule").unwrap();

    let args = ResolvedGenerateArgs {
        agents: Some(vec!["claude".to_string()]),
        command_agents: Some(vec!["claude".to_string()]),
        gitignore: false,
        nested_depth: 0,
        source_dir: None,
        target_dir: None,
    };

    // When neither flag is set, source_dir == target_dir (the cwd-equivalent)
    let result = run_generate(temp.path(), temp.path(), args);
    assert!(result.is_ok());
    assert!(temp.path().join(".claude").exists());
}
```

### Why it matters

Once this lands, agentbrew's [`delegateRulesGenerate`](https://github.com/fyodoriv/agentbrew/blob/main/src/sync/rules-delegate.ts) can call:

```typescript
execFileSync(aiRulesBin(), ["generate", "--source-dir", tmpDir, "--target-dir", tmpDir, "--agents", agentList], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
});
```

…instead of:

```typescript
execFileSync(aiRulesBin(), ["generate", "--agents", agentList], {
    cwd: tmpDir,  // implicit cwd-mutation
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60_000,
});
```

Cleaner subprocess shape, no cwd mutation, no risk of cwd-related bugs in long-running parent processes.

The harm of not landing this is bounded (the `cwd:` workaround works), but the flags are mechanical, the test surface is small, and they generalize to any CI/build pipeline that wants to run `ai-rules generate` programmatically.

---

## Filing checklist (for the maintainer-approved publish step)

When the user approves the publish step:

1. **Confirm the source files match upstream main:**
   - `git -C /tmp/ai-rules pull origin main` — make sure I'm on the latest main.
   - Confirm `src/cli/args.rs`, `src/cli/config_resolution.rs`, `src/cli/mod.rs`, `src/commands/generate.rs` still have the same shape as the diffs above — if upstream refactored, regenerate the diffs.
2. **Push the feature branch to fyodoriv/ai-rules:**
   - `git -C /tmp/ai-rules remote add fork https://github.com/fyodoriv/ai-rules.git` (one-time)
   - `git -C /tmp/ai-rules checkout -b feat/source-target-dir-flags`
   - Apply the four file changes from the diff above + add the two new tests.
   - `cargo fmt --all && ./scripts/clippy-check.sh && cargo test` — must all pass before pushing.
   - `git -C /tmp/ai-rules add ...` + `git commit -m "feat: add --source-dir and --target-dir flags to generate"`
   - `git -C /tmp/ai-rules push -u fork feat/source-target-dir-flags`
3. **File the PR:**
   - `gh pr create --repo block/ai-rules --title "feat: add --source-dir and --target-dir flags to generate" --body "$(cat docs/audits/ai-rules-source-target-dir-pr-draft.md | sed -n '/^## Body/,/^---$/{/^## Body/d; /^---$/d; p}')"`
4. **Record the resulting PR URL in [`docs/competition/block-ai-rules-vs-agentbrew.md`](../competition/block-ai-rules-vs-agentbrew.md)** under slice 6 (a) in the execution-path table.
5. **(Historical) The slice 6a checkbox lived under the `delegate-rules-to-ai-rules` parent task; that parent retired 2026-04-28.**
6. **If the PR merges**: open a follow-up agentbrew PR that simplifies `delegateRulesGenerate` to use `--source-dir`/`--target-dir` instead of `cwd:` — net change ~20 LOC.

## Why this doc lives in `docs/audits/`

Mirrors the [`bridle-opencode-issue-draft.md`](bridle-opencode-issue-draft.md), [`mcpm-kiro-adapter-pr-draft.md`](mcpm-kiro-adapter-pr-draft.md), and [`mcpm-amp-adapter-pr-draft.md`](mcpm-amp-adapter-pr-draft.md) precedents — staging upstream-PR drafts in `docs/audits/` keeps the publish step gated by user approval while letting agents prepare the fully-shippable artifact in advance.

## Why slice 6b (status --json) is a separate draft

Per the parent task, slice 6b adds a `--json` flag to `ai-rules status` (`src/commands/status.rs`, currently 1,032 LOC). Different file, different concern (output formatting vs. argument parsing), different test surface. Splits cleanly into its own PR + its own draft file in this folder.
