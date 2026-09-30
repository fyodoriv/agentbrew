# Filed: upstream PR for `block/ai-rules` — `--json` flag on `status`

**Status:** FILED 2026-04-27 at [block/ai-rules#91](https://github.com/block/ai-rules/pull/91). This document remains as the implementation reference + post-merge follow-up checklist.

**Source:** part of the (now-retired 2026-04-28) `delegate-rules-to-ai-rules` parent task (slice 6b, PR (b) of 2 in slice 6). When merged upstream, agentbrew's drift checker for rules ([`src/drift-checks/rules.ts`](https://github.com/fyodoriv/agentbrew/blob/main/src/drift-checks/rules.ts)) can use `ai-rules status --json` instead of relying on subprocess exit codes for richer drift information. Modest agentbrew refactor follow-up: ~30 LOC drift-check enhancement.

When approved, the files below land on a feature branch in `fyodoriv/ai-rules` and the body below is what to paste into `gh pr create`.

---

## Title

`feat: add --json output flag to status`

## Body

`ai-rules status` currently prints a human-friendly Rich-text summary and uses exit codes (0 = in sync, 1 = drift, 2 = no rules) for tools that consume its output programmatically. The exit-code-only contract is fine for "go / no-go" decisions but doesn't surface which agents are out of sync, which body files are stale, or whether the project has any rules at all.

This PR adds a `--json` flag to `ai-rules status` that emits a structured JSON object mirroring the internal `ProjectStatus` struct. The default Rich-text output is verbatim-unchanged when `--json` is not passed.

### Output shape

```json
{
  "has_ai_rules": true,
  "body_files_out_of_sync": false,
  "agent_statuses": {
    "claude": true,
    "cursor": false,
    "codex": true
  },
  "summary": "out_of_sync",
  "out_of_sync_agents": ["cursor"]
}
```

- `has_ai_rules`: whether the project has any `ai-rules/` source files (drives the exit-2 case in the human output).
- `body_files_out_of_sync`: top-level body-files-vs-disk drift flag.
- `agent_statuses`: per-agent in-sync/out-of-sync map.
- `summary`: one of `"in_sync"`, `"out_of_sync"`, `"no_rules"`. Lets consumers branch on a single string instead of cross-referencing the booleans + map.
- `out_of_sync_agents`: deduplicated list of agent names that are out of sync. Empty array when `summary == "in_sync"`.

The same exit codes apply (0 / 1 / 2) so existing CI integrations don't break.

### Why

agentbrew's [`src/drift-checks/rules.ts`](https://github.com/fyodoriv/agentbrew/blob/main/src/drift-checks/rules.ts) currently calls `ai-rules status --agents <name>` per-agent and reads the exit code (0 = in-sync, 1 = drift). With `--json`, it can call `ai-rules status --json` ONCE and read the per-agent map in a single subprocess invocation — N agents → 1 subprocess instead of N. Latency: per-call invocation of the Rust binary is ~22ms warm; saving N-1 invocations matters in the per-sync-cycle drift loop where N is 11 (intersection size).

Other downstream consumers (CI dashboards, monorepo build pipelines, custom drift visualizers) get a stable structured contract instead of having to parse the Rich-text output.

### Source-code references

- Modifies: [`src/cli/args.rs`](https://github.com/block/ai-rules/blob/main/src/cli/args.rs) — add `json: bool` field to `StatusArgs` and `ResolvedStatusArgs`.
- Modifies: [`src/cli/config_resolution.rs`](https://github.com/block/ai-rules/blob/main/src/cli/config_resolution.rs) — pass through the bool (no config-file fallback; CLI-only).
- Modifies: [`src/commands/status.rs`](https://github.com/block/ai-rules/blob/main/src/commands/status.rs) — derive `Serialize` on `ProjectStatus`, branch on `args.json` to call `print_status_results_json` or `print_status_results`.
- Adds: tests covering both output paths and the exit-code preservation.

### Diff

#### `src/cli/args.rs` (diff)

```diff
@@ pub struct StatusArgs {
     #[arg(
         long,
         value_delimiter = ',',
         help = "Comma-separated list of agents to check status for"
     )]
     pub agents: Option<Vec<String>>,
     #[command(flatten)]
     pub nested_depth_args: NestedDepthArgs,
+    #[arg(
+        long,
+        help = "Emit machine-readable JSON instead of the default Rich-text summary"
+    )]
+    pub json: bool,
 }

@@ pub struct ResolvedStatusArgs {
     pub agents: Option<Vec<String>>,
     pub command_agents: Option<Vec<String>>,
     pub nested_depth: usize,
+    pub json: bool,
 }
```

#### `src/cli/config_resolution.rs` (diff)

```diff
@@ impl StatusArgs {
     pub fn with_config(self, config: Option<&config::Config>) -> ResolvedStatusArgs {
         let agents = resolve_agents(self.agents, config);
         let command_agents = resolve_command_agents(config);
         let nested_depth = self.nested_depth_args.with_config(config);
         ResolvedStatusArgs {
             agents,
             command_agents,
             nested_depth,
+            json: self.json,
         }
     }
 }
```

#### `src/commands/status.rs` (diff)

```diff
 use crate::agents::AgentToolRegistry;
 use crate::cli::ResolvedStatusArgs;
 use crate::models::SourceFile;
 use crate::operations;
 use crate::operations::body_generator::generated_body_file_dir;
 use crate::operations::source_reader::detect_symlink_mode;
 use crate::utils::file_utils;
 use anyhow::Result;
+use serde::Serialize;
 use std::collections::HashMap;
 use std::path::Path;

-#[derive(Debug, PartialEq)]
+#[derive(Debug, PartialEq, Serialize)]
 pub struct ProjectStatus {
     pub body_files_out_of_sync: bool,
     pub agent_statuses: HashMap<String, bool>,
     pub has_ai_rules: bool,
 }

+#[derive(Debug, Serialize)]
+struct StatusJsonOutput<'a> {
+    pub has_ai_rules: bool,
+    pub body_files_out_of_sync: bool,
+    pub agent_statuses: &'a HashMap<String, bool>,
+    pub summary: &'static str,
+    pub out_of_sync_agents: Vec<&'a String>,
+}
+
+impl<'a> StatusJsonOutput<'a> {
+    fn from_status(status: &'a ProjectStatus) -> Self {
+        let summary = if !status.has_ai_rules {
+            "no_rules"
+        } else if status.body_files_out_of_sync
+            || status.agent_statuses.values().any(|&in_sync| !in_sync)
+        {
+            "out_of_sync"
+        } else {
+            "in_sync"
+        };
+        let mut out_of_sync_agents: Vec<&String> = status
+            .agent_statuses
+            .iter()
+            .filter(|(_, &in_sync)| !in_sync)
+            .map(|(agent, _)| agent)
+            .collect();
+        out_of_sync_agents.sort(); // deterministic output
+        Self {
+            has_ai_rules: status.has_ai_rules,
+            body_files_out_of_sync: status.body_files_out_of_sync,
+            agent_statuses: &status.agent_statuses,
+            summary,
+            out_of_sync_agents,
+        }
+    }
+}
+
 pub fn run_status(current_dir: &Path, args: ResolvedStatusArgs) -> Result<()> {
-    println!(
-        "🔍 AI Rules Status for agents: {}, nested_depth: {}",
-        args.agents
-            .as_ref()
-            .map(|a| a.join(","))
-            .unwrap_or_else(|| "all".to_string()),
-        args.nested_depth
-    );
+    let emit_json = args.json;
+    if !emit_json {
+        println!(
+            "🔍 AI Rules Status for agents: {}, nested_depth: {}",
+            args.agents
+                .as_ref()
+                .map(|a| a.join(","))
+                .unwrap_or_else(|| "all".to_string()),
+            args.nested_depth
+        );
+    }

     let status = check_project_status(current_dir, args)?;
-    print_status_results(&status);
+    if emit_json {
+        print_status_results_json(&status);
+    } else {
+        print_status_results(&status);
+    }

     Ok(())
 }
+
+fn print_status_results_json(status: &ProjectStatus) {
+    let output = StatusJsonOutput::from_status(status);
+    let serialized = serde_json::to_string_pretty(&output)
+        .unwrap_or_else(|_| "{\"error\":\"failed to serialize status\"}".to_string());
+    println!("{serialized}");
+
+    // Same exit-code contract as the human output: 2 = no rules, 1 = drift, 0 = in sync.
+    if !status.has_ai_rules {
+        std::process::exit(2);
+    }
+    if status.body_files_out_of_sync || status.agent_statuses.values().any(|&in_sync| !in_sync) {
+        std::process::exit(1);
+    }
+}
```

#### Tests (additions to `src/commands/status.rs` `mod tests` block)

```rust
#[test]
fn test_status_json_output_shape_in_sync() {
    let status = ProjectStatus {
        has_ai_rules: true,
        body_files_out_of_sync: false,
        agent_statuses: HashMap::from([
            ("claude".to_string(), true),
            ("cursor".to_string(), true),
        ]),
    };
    let output = StatusJsonOutput::from_status(&status);
    let json = serde_json::to_value(&output).unwrap();
    assert_eq!(json["summary"], "in_sync");
    assert_eq!(json["has_ai_rules"], true);
    assert_eq!(json["body_files_out_of_sync"], false);
    assert_eq!(json["out_of_sync_agents"].as_array().unwrap().len(), 0);
}

#[test]
fn test_status_json_output_shape_out_of_sync() {
    let status = ProjectStatus {
        has_ai_rules: true,
        body_files_out_of_sync: false,
        agent_statuses: HashMap::from([
            ("claude".to_string(), true),
            ("cursor".to_string(), false),
            ("codex".to_string(), false),
        ]),
    };
    let output = StatusJsonOutput::from_status(&status);
    let json = serde_json::to_value(&output).unwrap();
    assert_eq!(json["summary"], "out_of_sync");
    let out_of_sync = json["out_of_sync_agents"].as_array().unwrap();
    assert_eq!(out_of_sync.len(), 2);
    // Sorted for determinism
    assert_eq!(out_of_sync[0], "codex");
    assert_eq!(out_of_sync[1], "cursor");
}

#[test]
fn test_status_json_output_shape_no_rules() {
    let status = ProjectStatus {
        has_ai_rules: false,
        body_files_out_of_sync: false,
        agent_statuses: HashMap::new(),
    };
    let output = StatusJsonOutput::from_status(&status);
    let json = serde_json::to_value(&output).unwrap();
    assert_eq!(json["summary"], "no_rules");
}

#[test]
fn test_status_json_body_files_out_of_sync_flips_summary() {
    let status = ProjectStatus {
        has_ai_rules: true,
        body_files_out_of_sync: true,
        agent_statuses: HashMap::from([("claude".to_string(), true)]),
    };
    let output = StatusJsonOutput::from_status(&status);
    let json = serde_json::to_value(&output).unwrap();
    assert_eq!(json["summary"], "out_of_sync");
    assert_eq!(json["body_files_out_of_sync"], true);
}
```

### Why it matters

Agentbrew's drift checker collapses from N subprocess invocations (one per agent) to 1 (one query, parsed map). The `summary` field also lets simpler consumers branch on a single string without cross-referencing booleans. Other CI/build pipelines consuming `ai-rules status` get a stable JSON contract.

The default Rich-text output is verbatim-unchanged, so existing terminal users see no behavior change.

The harm of not landing this is bounded (exit-code-only contract is workable), but the flag is mechanical, the test surface is small, and the JSON shape generalizes to any tool that wants to programmatically reason about ai-rules state.

---

## Filing checklist (for the maintainer-approved publish step)

When the user approves the publish step:

1. **Confirm the source files match upstream main:**
   - `git -C /tmp/ai-rules pull origin main` — make sure I'm on the latest main.
   - Confirm `src/cli/args.rs`, `src/cli/config_resolution.rs`, `src/commands/status.rs` still have the same shape as the diffs above — if upstream refactored, regenerate the diffs.
2. **Push the feature branch to fyodoriv/ai-rules:**
   - `git -C /tmp/ai-rules remote add fork https://github.com/fyodoriv/ai-rules.git` (one-time; reuse the slice 6a remote if both PRs go up in the same session)
   - `git -C /tmp/ai-rules checkout -b feat/status-json-output`
   - Apply the three file changes from the diff above + add the four new tests.
   - `cargo fmt --all && ./scripts/clippy-check.sh && cargo test` — must all pass before pushing.
   - `git -C /tmp/ai-rules add ...` + `git commit -m "feat: add --json output flag to status"`
   - `git -C /tmp/ai-rules push -u fork feat/status-json-output`
3. **File the PR:**
   - `gh pr create --repo block/ai-rules --title "feat: add --json output flag to status" --body "$(cat docs/audits/ai-rules-status-json-pr-draft.md | sed -n '/^## Body/,/^---$/{/^## Body/d; /^---$/d; p}')"`
4. **Record the resulting PR URL in [`docs/competition/block-ai-rules-vs-agentbrew.md`](../competition/block-ai-rules-vs-agentbrew.md)** under slice 6 (b) in the execution-path table.
5. **(Historical) The slice 6b checkbox lived under the `delegate-rules-to-ai-rules` parent task; that parent retired 2026-04-28.** With both 6a and 6b filed, the original slice 6 is fully advanced.
6. **If the PR merges**: open a follow-up agentbrew PR that simplifies `src/drift-checks/rules.ts` to use `ai-rules status --json` (1 invocation) instead of N per-agent invocations — net change ~30 LOC.

## Why this doc lives in `docs/audits/`

Mirrors the [`bridle-opencode-issue-draft.md`](bridle-opencode-issue-draft.md), [`mcpm-kiro-adapter-pr-draft.md`](mcpm-kiro-adapter-pr-draft.md), [`mcpm-amp-adapter-pr-draft.md`](mcpm-amp-adapter-pr-draft.md), and [`ai-rules-source-target-dir-pr-draft.md`](ai-rules-source-target-dir-pr-draft.md) precedents — staging upstream-PR drafts in `docs/audits/` keeps the publish step gated by user approval while letting agents prepare the fully-shippable artifact in advance.
