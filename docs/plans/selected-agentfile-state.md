# Scope Agentfile state preparation by selected module

Selected sync already limits the engine list. Agentfile preparation
still merges MCP servers, hooks and default models before that engine
list runs. Use the existing normalized selection at each of these
three owning preparation steps. Preserve shared values required by
other modules, and keep source pull behavior in its existing path.

- **Hypothesis**: A single selected module changes its own fields
  only. Unselected MCP servers, hooks and model fields keep their
  existing values through the state writer.
- **Measurement**: Seed a real synthetic state with three distinct
  values and declare a replacement for each in the Agentfile. Apply
  the same file with only MCP, only hooks, only models, and with no
  selection. Reload the saved state and compare exact values. Run
  workspace ownership, ordinary CLI preparation and pull compatibility.
- **Success**: All three selected cases change exactly one family.
  The full control changes all three. Replacing selected MCP
  declarations keeps its normal authoritative behavior.
- **Pivot**: A changed unselected field, lost selected mutation or
  changed default or pull behavior rejects the candidate. Keep any
  ambiguous shared state field outside this phase.
- **Anchor**: The current Agentfile application and module registry
  in `src/agentfile-apply.ts` and `src/sync-runner.ts`.
