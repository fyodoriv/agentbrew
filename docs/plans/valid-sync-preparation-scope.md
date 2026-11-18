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

The [hosted comparison](https://github.com/fyodoriv/agentbrew/actions/runs/44233998486)
failed all five new boundary assertions. The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44234251688)
passed them and the six compatibility files. The dispatcher supplies its
own normalized module order to all ordinary Agentfile routes. Other
state preparation, workspace publication and native output remain open.

## A selection with no native facet

Commands, agents, skills, models and instructions have no native Claude
marketplace output. They still use their ordinary sync engines. Keep the
existing redaction refresh as a privacy dependency for plugin-backed
content. Complete the native facet work separately for hooks, MCP and rules.

- **Hypothesis**: A selection with no native facet calls its ordinary
  engines and never regenerates the marketplace, while default sync and
  any requested native facet still reach the native publisher.
- **Measurement**: Use the existing CLI test with fake native publication,
  lock and engine boundaries. Cover every non-native selection, default
  sync, each native facet, a mixed selection, and dry-run behavior.
  Observe the redaction boundary and the exact module names in each case.
- **Success**: Zero native publications for all five non-native names.
  All requested native and default controls still publish exactly once.
  Redaction refresh still runs for real syncs. Preview writes nothing.
- **Pivot**: A skipped requested facet, changed default, leaked rejection,
  or removed redaction refresh rejects the change.
- **Anchor**: `emitClaudeNative`, `runSyncCommand`, and the signed
  physical selection receipts above.

The [hosted baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44235036116)
reported one unwanted publication in each of the five non-native modes.
The other six controls passed. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44235254674)
passed all eleven controls and all six compatibility files. This compares
calls to the real dispatcher through instrumented publication boundaries.
Scoped native output for hooks, MCP and rules still needs its own proof.
