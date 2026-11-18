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

The [test-first run](https://github.com/fyodoriv/agentbrew/actions/runs/44236662826)
failed both new controls. The [pinned-tree candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44237671388)
passed all eight scoped controls, the ordinary native and launcher files,
and type checking. It compares the same capability declarations the
installer records in the lock.

## Destination claims and empty selections

- **Hypothesis**: A selected publisher creates no envelope when the
  plugin contributes none of the requested payloads. It refuses ambiguous
  launcher ownership before any output changes.
- **Measurement**: Select MCP and rules against a signed hooks-only
  plugin. Compare the complete scratch marketplace and launcher paths.
  Then select MCP for a signed fixture with two identical declarations
  of one server and a matching pre-existing launcher. Check the
  refusal and all existing outputs by bytes, mode and modification time.
- **Success**: Zero paths created for each empty selection, one explicit
  refusal for the ambiguous claim, zero changed outputs on refusal, and
  all current payload and full-publisher controls pass.
- **Pivot**: An empty envelope, shared destination, missing existing
  output or unexpected write rejects the candidate. This phase leaves
  on-disk full source identity and live activation open.
- **Anchor**: Native marketplace entry and launcher naming in
  `src/plugins/claude-native.ts` and `src/plugins/mcp-launcher.ts`.

The [test-first run](https://github.com/fyodoriv/agentbrew/actions/runs/44237899247)
failed the two empty selections and the existing duplicate launcher.
The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44238056862)
passed all eleven scoped controls, ordinary publisher and launcher tests,
and type checking. A matching file still counts as a launcher claim.

This proof covers claims from the selected launcher declarations. Before
activation, cover collisions against retained marketplace references and
hook paths that alias by case, normalization or file type. A full-source
receipt must describe verified output even when a legacy publisher used
working-copy files. An existing eight-digit display version is insufficient.

## Full identity and interrupted publication

The selected and full native publishers need the same exclusive
publication boundary. Hold the boundary across a plugin lifecycle
change that affects native output, source loading, planning, writes,
settings and the exact output receipt. The named owner is the invoking
process. An ownership record must include more than its process ID.
Leave uncertain ownership in place. The boundary coordinates Agentbrew
processes. Claude and manual edits can continue, so the write path also
needs fresh checks against its expected destination state.

A receipt binds the full pinned commit and tree, source and signer
identity, capability hash, and each generated path, type, mode and
digest. For legacy output with no qualifying receipt, a selected
warm operation refuses without modifying the tree or settings. A
successful full publication through the protected path establishes the
first receipt. It must verify what it emitted against the pinned
source. A matching older display version cannot establish ownership.

Record a private pending intent before changing output. Each recorded
step must have a known previous state and verified expected bytes
afterward. On restart, recover only a proven partial operation or
refuse while preserving what is present. Do not infer safe takeover
from time elapsed. Treat a changed setting, link, owner, or pre-existing
destination as an independent ownership conflict.

The payload draft remains out of the live CLI until the following cases
qualify independently.

- **Hypothesis**: The cooperating publisher refuses concurrent and
  ambiguous writers before changes, and interrupted writes can resume
  without altering paths outside the selected or verified shared output.
- **Measurement**: Use two separate processes in a scratch home to
  contend across selected, full, and lifecycle entry points. Inject an
  interruption before payload, index, and settings commits. Vary legacy,
  exact receipt, mismatched receipt, disablement and concurrent local
  edits. Compare complete file, type, mode and digest receipts and
  observe redaction order through the real isolated CLI.
- **Success**: One owner in every contention case. All three interruption
  checkpoints either recover to the exact expected output or explicitly
  refuse with zero additional changes. All three legacy, identity
  mismatch and edit conflicts preserve bytes and settings. No explicit
  disabled value changes. All existing cold, warm and default controls
  pass, with zero unexpected writes.
- **Pivot**: An untracked writer, ambiguous destination, unsafe cleanup,
  order violation, fail-open recovery or unexpected write blocks use at
  the live CLI boundary.
- **Anchor**: The signed selected and default receipts, native publisher
  and plugin lifecycle entry points, and the independent source and
  destination review.

## Ambiguous registry identities and retained claims

- **Hypothesis**: A selected repair refuses an ambiguous registry identity
  or a launcher already referenced by a retained plugin. It preserves a
  well-formed retained entry and every unrelated file.
- **Measurement**: Place a duplicate existing registry entry in one
  scratch home. In a separate scratch home, give a retained synthetic
  plugin a native server configuration that references the selected
  plugin's already-present launcher. Compare file bytes, modes and
  modification times on refusal. Also retain a synthetic server with an
  unrelated command as a positive control.
- **Success**: Both ambiguous cases refuse before any changes. The
  unrelated command case can repair its selected payload and leaves
  retained output unchanged. Pass all eleven prior scoped controls.
- **Pivot**: Any unsafe permit, unowned overwrite or unexpected write
  stops the candidate. No live CLI activation in this phase.
- **Anchor**: The marketplace index and launcher reference written in
  `src/plugins/claude-native.ts`, plus the independent claim review.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44238556692)
failed the duplicate-registry and retained-launcher collision controls.
It passed the unrelated-command control and all eleven earlier cases.
The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44238718335)
passed all fourteen scoped cases, compatibility tests and type checking.

## Hook destination aliases

- **Hypothesis**: Canonical claim checking refuses case aliases and
  file-to-directory conflicts before any selected native payload writes.
- **Measurement**: Use the signed fixture with a custom hook
  declaration filename. Add either a harmless similarly named file or
  a harmless file inside a similarly named directory. Both would
  alias the generated hooks JSON on a case-insensitive output volume.
  Include a separate valid nested text file as a positive control.
- **Success**: Two exact refusals with zero native output created, one
  valid nested file published, and all fourteen earlier scoped cases
  pass. Run normal native compatibility and type checking.
- **Pivot**: An ambiguous write or misplaced declaration rejects the
  candidate. If the filename's alias behavior cannot be established,
  refuse without altering destination data.
- **Anchor**: Signed hook subtree layout and the independently
  observed gap in the destination plan.

## Shared publisher admission

- **Hypothesis**: Full and selected artifact publication use one
  process-owned exclusive file in the physical home directory. A held
  record causes both writers to refuse before touching any output.
- **Measurement**: Place a synthetic held record in a scratch home and
  call both publisher modes separately. Compare the record and all
  output paths. Ordinary cases must release their owned record, including
  a selected planning failure. Follow with two-process orchestration
  before any live route can rely on the lock.
- **Success**: Two modes refuse without any output changes, the held
  record stays identical and normal runs leave zero ownership files.
- **Pivot**: A lost held file, shared admission, unsafe cleanup or an
  output write on refusal blocks the proposed boundary. The warm
  receipt, recovery and lifecycle integration still need their own
  controls.
- **Anchor**: Exclusive file creation, both calls to the common
  publisher, and the registered interrupted-publication matrix.

## Independent process ownership

- **Hypothesis**: An actual second process cannot enter a publication
  held by the first. After normal release it can enter. An owner that
  exits before release leaves a refusal on the next attempt.
- **Measurement**: Start the same compiled host runtime in a separate
  process against one synthetic home. Observe its distinct exit status
  and whether the protected callback ran. Repeat after release and
  after a separate synthetic interrupt. Compare the on-disk owner
  record before and after each refusal.
- **Success**: One cross-process refusal with zero extra callbacks,
  one success after release, and one refusal that preserves the
  interrupted owner's record. All subprocess work has a fixed limit.
- **Pivot**: An unintended callback, leaked ownership record after a
  normal exit, unexpected takeover, or lost interrupted record rejects
  the candidate. Pending publication recovery remains separate.
- **Anchor**: Operating system exclusive file creation and the shared
  publisher admission outcomes.
