# Scoped native plugin publication

The signed [selected baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44231771838)
shows that hooks, MCP and rules selections each write all three native
facets. The [qualified default control](https://github.com/fyodoriv/agentbrew/actions/runs/44233485420)
writes all three and the expected workspace and instructions outputs.

Reuse the existing signed plugin loader, launcher generator, native
marketplace structure and default full emitter. Add selected behavior
at the existing emitter entry point so CLI selection can use the real
publisher. Plugin add, update, rollback, remove and no-selection sync
continue through their normal full route. A selected publication builds
its plan from the verified lock and source before it changes output.

## Facet ownership

| Facet | Selected output | Protected output |
| --- | --- | --- |
| Hooks | Declared hook groups and files from the signed checkout | Generated rules hook, MCP config and launchers |
| MCP | Named servers and their verified launchers | Declared hooks, scripts and generated rules hook |
| Rules | The generated SessionStart handler for scoped plugin rules | Declared hook groups, scripts, MCP config and launchers |

The plugin envelope and marketplace index carry only identity shared
by active facets. Build a cold envelope only from a verified plugin.
A warm envelope must prove the same name and source version. A missing
or conflicting owner, unknown shared-file layout or different source
version cannot justify overwriting an existing facet. Preserve a user
disabled setting and every unowned marketplace or settings entry.

Hooks and rules share the hooks JSON file. Check decoded unselected
entries and separate script bytes and modes. In a warm case that
changes this shared file, verify equivalent unselected entries and
keep their relative order. Independently check launcher paths and
untouched output files by bytes, type, mode and modification time.
Cold activation takes place after requested outputs and redaction are
ready. Warm activation and explicit disabled outcomes have their own
controls.

## Focused test-first phase

- **Hypothesis**: The selected publisher writes every requested cold or
  warm facet and produces zero unrequested writes in the fixed cases.
- **Measurement**: Extend the existing signed scratch publisher tests.
  Freeze a three-facet synthetic signed plugin on each arm. Cold hooks,
  MCP and rules each expect only their own newly published facet.
  Warm hooks repair a missing signed hook script, warm MCP repairs one
  missing launcher or JSON output, and warm rules restore the generated
  SessionStart entry. Freeze every other facet before each call.
- **Success**: All six requested output cases pass. No unselected
  standalone file, setting or launcher is changed. Preserve decoded
  unselected hook entries when the shared file needs an update. Default
  behavior and full publisher tests pass. All real plugin data stays
  outside the fixture.
- **Pivot**: An unrequested write, failed requested facet, unverified
  owner, lost existing declaration or abnormal full publish outcome
  rejects the candidate. Cover validated activation and refusal cases
  before wiring the new facet selector to the live CLI.
- **Anchor**: `src/plugins/claude-native.ts`, the established signed
  fixture helper, and the exact hosted selected and default receipts.

Workspace preparation, full Agentfile state scope, and source pulls
have separate ownership and write boundaries.

## Initial payload result

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44235758606)
failed all six cold and warm cases. The [prototype](https://github.com/fyodoriv/agentbrew/actions/runs/44236338161)
passed them, the ordinary plugin and launcher files, and type checking.
The prototype remains separate from the live CLI. The existing envelope's
version ends with only eight commit digits. It cannot prove full source
identity. Keep full identity, lifecycle coordination, retry and activation
work open before the live entry point.

## Source and shared hook ownership controls

- **Hypothesis**: Reading from the exact pinned Git tree copies no local
  files outside signed content. The shared hook preflight leaves unknown
  warm metadata untouched and refuses the selected write.
- **Measurement**: Plant one benign ignored text file in the synthetic
  checkout's hook folder and compare output against the actual signed
  tree. Add an independent warm case with an extra metadata field in its
  hooks JSON. Observe output paths and file bytes before and after. Run
  the existing six cold/warm and ordinary publisher controls.
- **Success**: The signed files still publish. The ignored file appears
  zero times in native output. Unknown metadata yields an explicit
  refusal with zero destination changes. Six existing payload cases and
  ordinary compatibility stay green.
- **Pivot**: An unreadable Git identity, unknown blob mode, escaped path,
  altered unknown field, missed signed path or existing regression
  rejects the read path. The selected emitter remains unwired.
- **Anchor**: The verified plugin pin in `store.ts`, the existing signed
  source fixture and the first payload comparison.
