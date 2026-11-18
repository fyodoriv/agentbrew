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

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44241517013)
failed all three selected cases. The no-selection control passed.
The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44241713591)
passed four focused controls, 150 compatibility tests, and type
checking. The fixture reloads saved state before checking each family.

## Owned source directories

- **Hypothesis**: Command, agent and local skill declarations update
  only their selected directory lists and keep existing ownership.
- **Measurement**: Plant one replaceable owned directory for each
  family. Select commands, agents and skills separately, then apply
  the same file without a selection. Reload saved state and compare
  the name, absolute path, origin and owner.
- **Success**: Each selected mode replaces exactly one old directory.
  The full control replaces all three. Workspace live apply still
  preserves its stable owner for both rules and selected skills.
- **Pivot**: An unselected addition or prune, dropped owner, or
  compatibility regression rejects the change.
- **Anchor**: Existing per-Agentfile ownership for command, agent and
  local skill directory registrations.

The [directory baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44242037555)
failed all three selected directory controls. The matching
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44242245370)
passed the complete nine-case matrix and 154 compatibility tests.
The workspace case selected both rules and skills, reused one owner
and kept the ordinary and pull tests green.

This phase scopes six content families. Source-list changes, managed
memory registration and shared initialization need separate ownership
decisions and evidence.

## Keep existing pull preparation

The existing selected pull passes a module list for its earlier
rule and installed-skill guards. Ordinary preparation needs a distinct
opt-in for the six newly scoped fields so this phase preserves the
existing pull path.

- **Hypothesis**: A selected ordinary apply still limits all six
  families. A selected pull still prepares its existing mixed state
  before update begins.
- **Measurement**: Run the real Commander pull path in a cold scratch
  home with MCP, hooks, model and owned command declarations. Capture
  the saved state at the update boundary. Select MCP and compare the
  result with the existing pull contract.
- **Success**: All four mixed pull declarations are present before
  update. The original nine ordinary controls stay green, and existing
  rule and installed-skill pull exclusions pass.
- **Pivot**: If either path loses a required field or changes its
  earlier rule or skill exclusion, keep this draft out of delivery.
- **Anchor**: `applyAgentfileBeforePull` and the independent scope review.

The [mixed pull baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44242631661)
reached the update boundary with the hook declaration missing.
The [corrected candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44242776313)
treated ordinary apply and pull separately. All ten focused cases
and 207 compatibility tests passed, along with type checking.

## Source tracking and managed memory registration

Ordinary selected sync already assigns skills and MCP their own
preparation. The tracked source list supports skill discovery and
ownership. Managed memory registers an MCP server. Keep source pull
and full apply behavior. Keep shared exclusions and memory pack
discovery on the existing path.

- **Hypothesis**: Selecting skills may change tracked sources.
  Selecting MCP may enable or repair managed memory. Selecting hooks
  preserves both state fields. A selected ordinary apply leaves old
  work steps for full apply to remove.
- **Measurement**: In four fresh homes, exercise skills, MCP, hooks
  and full apply against a replacement source and disabled managed
  memory. Reload the saved state. Run an existing mixed pull test at
  the update boundary.
- **Success**: All four ordinary controls and the pull control retain
  every unselected value and apply each owning change.
- **Pivot**: A source disappearing outside skills, a server appearing
  outside MCP, or a full or pull behavior change blocks this phase.
- **Anchor**: Existing source ownership and installed skill pruning in
  Agentfile application, and the managed memory MCP registration.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44251020538)
failed the three selected cases. The full apply and existing mixed
pull controls passed. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44251187364)
passed 14 focused controls, 159 compatibility tests, and type
checking. Shared pack discovery and agent exclusions keep their
earlier behavior.
