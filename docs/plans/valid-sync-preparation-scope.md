# Scope preparation for a valid sync selection

The [signed selected cases](https://github.com/fyodoriv/agentbrew/actions/runs/44231771838)
all exited 0. Selecting hooks, MCP or rules wrote all three native
facets and applied the workspace MCP declaration. The [offline default control](https://github.com/fyodoriv/agentbrew/actions/runs/44233485420)
produced all native outputs and both packaged instructions files.
It matched one absent optional renderer, with no other denied calls
or unknown paths. Keep the first incomplete default run separately.

## First implementation phase

Scope ordinary selected Agentfile application before touching the native
publisher. Protect the explicit pull behavior and the default path.
Start with a focused test at the real application entry point. Verify
the same scope reaches the explicit, global and project Agentfile from
the ordinary sync command. The workspace writer, native facets and
update source refresh require their own tests and remain open.

- **Hypothesis**: Applying a mixed Agentfile for a valid ordinary
  selection changes only state or files owned by the selection.
- **Measurement**: Use mixed signed-independent Agentfiles and the
  current scratch state tests. Compare the exact state and shared-rules
  manifest before and after, with requested hooks, MCP, rules or empty
  destructive-prune fixtures. Run the existing CLI, application, pull
  and dry-run suites plus a focused selection matrix.
- **Success**: Every positive requested write occurs. No unrequested
  state, file, prune or install-request change occurs. Keep the default
  compatibility path, existing pull protections, and preview semantics.
- **Pivot**: Reject a lost selected write, stale ownership deletion,
  changed default behavior, omitted pull control, or undefined field
  treatment that can alter unrelated live state.
- **Anchor**: `applyAgentfile`, `runSyncCommand`, and the three qualified
  physical selected receipts above.

Single-module ownership follows the engine names. MCP server mutations,
hook entries, rules/body ownership, commands/agents directory ownership,
skills and installed skill directories, and model configuration each
belong to their named module. Reads may inform selection without adding
or applying unrelated fields. Shared sources and agent exclusion affect
multiple engines. A partial ordinary apply cannot persist changes to
those shared fields or migrate legacy state during selection. Retain the
existing state for the selected engines. A no-selection apply still
handles the full Agentfile and all cross-module settings.

Treat memory enablement as MCP runtime configuration only where the
existing registration contract is preserved. Pack lists and shared
source changes need separate qualification before a selected apply
writes them. Preserve explicit pull's current scoped rules and
skill-prune behavior until it has a separate exact comparison.

### First delivery boundary

Start by connecting the existing rule and skill-prune guard to every
ordinary Agentfile apply. This is the first step toward the full
ownership matrix. It does not alter the guard's existing rule or skill
semantics, the pull caller, or the publisher.

- **Hypothesis**: The explicit apply wrapper, global apply, project apply
  and dry-run explicit apply will all receive the normalized requested
  list. The current ordinary caller omits that list.
- **Measurement**: Select the new `selected Agentfile gate` cases in
  `src/cli-sync-agentfile.test.ts`, `src/commands/cli-install.test.ts`
  and `src/sync-runner.test.ts`. In the same hosted workflow run the
  unaffected suites after the focused regression is green.
- **Success**: All focused call boundaries are red before the change
  and green afterward. Unselected live rules and owned skill pruning
  use the established guard. Default and pull compatibility stay green.
- **Pivot**: A wrong list, changed apply order, broken dry run, altered
  default rule, or an existing pull regression rejects the wiring.
- **Anchor**: `selectedSyncModule` in the existing apply path, the
  hosted signed selected result, and the P1 task's explicit-pull cases.
