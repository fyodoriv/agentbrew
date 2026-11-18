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

The [alias baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44238921344)
failed the two collision controls, and the
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44239077017)
passed all seventeen scoped controls, including the valid nested file.
The selected writer reserves the generated hooks JSON and verifies
its auxiliary paths before touching any destination. It refuses an
auxiliary name outside the checked ASCII subset.

The [shared admission baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44239169548)
allowed both publishers past a pre-existing owner. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44239349321)
refused both modes and released its own record after success and
ordinary refusal. The
[independent process run](https://github.com/fyodoriv/agentbrew/actions/runs/44239466728)
passed all twenty-two focused cases and all thirty-eight tests in the
two ordinary files. Retrying after an interrupted owner preserved its
record and refused. This proves process admission and known-owner
release. It does not recover partial payload files, serialize plugin
lifecycle changes or establish durable source ownership.

## Crash-released commit fence

Use an independently qualified short lock for final publication and
signer revocation. It must release when the holder exits. The longer
publisher owner record remains useful for detecting interrupted work.
Ordinary signer revocation must remain available when that owner record
is left behind. The final publisher revalidates signer trust under the
same short lock it holds through publication and receipt commit.

Evaluate the host's existing lock command on a descriptor inherited
from Node. macOS provides `/usr/bin/lockf` and the Ubuntu runner
provides `/usr/bin/flock`. Run from a synthetic directory with a
single mode-0600 file. The lock command must exit while the same open
descriptor remains locked in the parent. Use a separate process to
observe contention and release. Test an abrupt holder exit and
compare the lock file inode across every attempt.

- **Hypothesis**: The inherited descriptor continues holding the
  short lock after its acquisition subprocess exits. Other processes
  get one immediate refusal until that descriptor closes or its
  holder exits.
- **Measurement**: Run the same synthetic descriptor test on macOS
  and Ubuntu. Require deterministic holder-ready markers, fixed
  wait limits, and zero access to an installed plugin or signer data.
- **Success**: On each host, pass all four decisions: hold after helper
  exit, refusal from a distinct process, acquire after normal close,
  and acquire after forced holder exit. Keep the same lock inode.
- **Pivot**: A missing helper, lost descriptor ownership, unexpected
  callback, wrong status or stale OS lock rejects this portable
  method. This measurement covers kernel admission, not signer
  revalidation or settings publication.
- **Anchor**: macOS `lockf(1)` descriptor mode, Linux util-linux
  `flock(1)` descriptor mode, and the native lifecycle review.

The descriptor test passed on this Mac and on the
[Ubuntu runner](https://github.com/fyodoriv/agentbrew/actions/runs/44243184248).
Both used the system lock utility with a descriptor held by Node.
A separate process refused while the holder was active and acquired
after normal close and after abrupt holder exit. The original mode-0600
inode stayed in place.

Agentbrew and Dotfiles both update the allowed signers registry.
Agentbrew's short fence by itself cannot cover the shell trust and
revoke commands. Qualify one lock address derived from the configured
registry path, and make both writers hold it during read, change and
atomic replace. Existing tools, symlink or inode changes, external
editors and a missing platform lock utility remain outside this
accepted experiment. Certify a source only after the integrated
publisher and both signer writers pass the ordering controls.

## Agentbrew signer writer admission

Use the same `<registry>.agentbrew-signer-v1.lock` file as Dotfiles.
Only signer writes enter this short boundary in this phase. Holding
an interrupted publisher owner record alone must leave trust and
revocation available.

- **Hypothesis**: The Node signer writer refuses both mutations during
  the short commit lock, preserves unrelated keys, and can still
  revoke under an abandoned long publisher record.
- **Measurement**: Hold the signer lock through the already qualified
  descriptor command. Invoke the real trust and revoke functions.
  Compare registry bytes, then release and retry both operations.
  Place a separate synthetic interrupted publisher record and
  prove revocation succeeds without changing that record.
- **Success**: Two short-lock refusals and zero registry changes
  during contention. Both mutations succeed after release. A signer
  can be revoked with the long record present. Retain the earlier
  native and lifecycle compatibility checks.
- **Pivot**: A competing write, a lost key, a stale blocker on signer
  revocation, or a mismatch with the Dotfiles lock path blocks
  integration.
- **Anchor**: The portable descriptor test, the Dotfiles shared signer
  plan, and `src/plugins/signers.ts`.

The [Node baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44244184598)
allowed a signer write under another owner. The
[Node candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44244639346)
passed both focused controls and 80 existing native and lifecycle cases.
It refused short-lock contention and kept revocation available under
an interrupted long publisher record.

## Cross-tool writer admission

- **Hypothesis**: A real Agentbrew process holding the shared signer
  fence prevents the Dotfiles trust CLI from mutating the registry.
  On release, both direct writers preserve each other's keys and
  use the same adjacent lock inode.
- **Measurement**: Use staged public source revisions for both
  repositories and a custom synthetic signer registry. Hold the lock
  in an Agentbrew process. Run the Dotfiles trust and revoke paths
  during the hold, then retry after release. Finish with an Agentbrew
  change and compare the complete synthetic registry and lock identity.
- **Success**: Two Dotfiles exit-75 refusals with zero byte changes,
  two successful retries, one final Agentbrew update, and one
  unchanged inode and owner throughout.
- **Pivot**: A different lock address, unauthorized write, missing
  retry, lost signer or changed lock identity rejects this integration
  stage. Native publication remains separately unwired.
- **Anchor**: The exact Node and Dotfiles focused receipts and the
  `AGENT_PLUGINS_ALLOWED_SIGNERS` contract.

## Revalidate signer trust before selected publication

The selected prototype may plan output before taking the short signer
lock. Take that lock before any planned output becomes visible. Reload
the plugin lock and signer registry, then require each proposed plugin
to retain the same full source identity and trusted signer.

- **Hypothesis**: A held signer fence or a signer revoked after
  planning begins prevents all selected native output writes.
- **Measurement**: Install a signed fixture in a scratch home. Hold
  the short writer fence during one selected publish. In a separate
  run, revoke the fixture signer immediately after the first real
  pinned source read. Check native output and activation paths.
- **Success**: Both negative controls refuse before any native writes.
  Existing cold, warm and default controls stay green. Revocation
  remains present after the attempt.
- **Pivot**: Any planned write reaching output after contention or
  revocation blocks the candidate. Remaining lifecycle and recovery
  conditions still apply before live activation.
- **Anchor**: The shared signer descriptor, the pinned read and
  the current native output plan.

The [cross-tool scratch run](https://github.com/fyodoriv/agentbrew/actions/runs/44245169949)
used the actual Dotfiles trust entry point. It refused both writes
while Agentbrew held the short lock, then succeeded after release.
Agentbrew's follow-up kept the Dotfiles key and the original lock inode.

The [selected publication baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44245363765)
failed both new trust controls. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44245571293)
passed 24 focused and 82 compatibility tests plus type checking.
This phase guards planned selected writes. It leaves lifecycle changes,
durable output ownership, interrupted payload recovery and activation open.

## Existing destination spelling and physical launcher paths

- **Hypothesis**: A warm selected write refuses an alternate spelling
  of its destination or a retained launcher reference that resolves
  to the same physical file.
- **Measurement**: In one scratch marketplace, give the existing
  hooks JSON only an alternate-case name. In another, give a retained
  server a launcher reference through a known directory alias. Run the
  real selected emitter and compare files, directory entry names,
  modes and modification times. Keep the existing unrelated-reference
  and valid warm repair controls.
- **Success**: Both ambiguous cases refuse with zero native writes.
  The unrelated reference and supported repairs pass.
- **Pivot**: Changing a differently named file, accepting an alias,
  or losing a supported warm repair rejects the candidate.
- **Anchor**: Native destination ownership checks and independent
  feedback on physical launcher reference resolution.

## Admit plugin lifecycle changes before editing installed state

Add, update, rollback and remove currently edit the installed checkout
and lock before entering the native publisher. Let the same long
publication owner admit the approved apply and final output together.
Keep interactive prompts and staged network fetches ahead of admission
when those operations already stage separately. Discard a staged plan
if admission refuses. A signer-only revoke remains a short operation.

- **Hypothesis**: With an existing long owner, each of the four
  plugin commands refuses before installing or changing a plugin.
- **Measurement**: Use the existing signed lifecycle scratch fixture.
  Hold a synthetic owner record before each command. Compare current
  pin, installed checkout, native manifest bytes and staging folder.
  Keep the ordinary full lifecycle chain and the separate revocation
  and selected publisher controls.
- **Success**: Four refusals with unchanged installed state, zero
  orphaned per-command staging paths, and an unchanged held record.
  The ordinary add/update/rollback/remove chain still passes.
- **Pivot**: A partial apply before admission, blocked signer
  revocation, a leaked staging checkout or an existing route failure
  blocks release.
- **Anchor**: Existing plugin command mutation and publisher call
  sites and the independent lifecycle review.

## Keep an approved update tied to its installed pin

A plugin update stages the signed target before the user approves the
diff. A concurrent operation can change the installed pin or revoke
the target signer during that interval. Recheck the installed pin and
target signer under the short commit lock before replacing the checkout.

- **Hypothesis**: Revoking a staged signer's trust or advancing the
  installed pin prevents a prior approval from committing an update.
- **Measurement**: In two signed scratch runs, stage an update and
  either revoke the signer or apply a separately staged newer pin.
  Try the older approval. Compare the installed pin, checkout commit
  and temporary checkout directory before and after.
- **Success**: Both stale approvals refuse, change zero installed
  state, and discard only their own staged checkout. The first
  confirmed supported update and the existing lifecycle chain pass.
- **Pivot**: A stale or revoked update writes any installed content,
  uses another plan's checkout, or blocks ordinary approved rotation.
- **Anchor**: The approval and apply phases in `src/plugins/update.ts`
  and the shared signer commit fence.

The [physical path baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44246329276)
failed the two alias controls. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44246543277)
passed 26 focused and 84 compatibility cases. The
[lifecycle candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44247657379)
passed all four admission refusals and 88 compatibility cases. The
[approved update candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44248069195)
passed six focused and 90 compatibility cases. The installed pin and
signer are rechecked before applying its staged update.

## Verify a full native output receipt

Add an internal proof option to the draft. The routine full writer
still uses its existing publication path. Only the explicit proof
option verifies and records output. The proof describes artifacts
for a pinned source. It does not certify activation or host readiness.

- **Hypothesis**: The normal full writer produces an exact inventory
  for a supported signed fixture. An ignored source file that
  reaches the legacy output prevents a receipt.
- **Measurement**: Run standard full publication and explicit
  full certification in separate signed scratch homes. Build the
  independent expected inventory from Git object bytes and Claude's
  generated formats. Check marketplace and launcher coverage,
  complete per-plugin file lists, and the private source digest.
  Add a benign ignored source note to the negative fixture.
- **Success**: The exact fixture writes a mode-0600 receipt naming
  each five verified plugin files. Standard full publication leaves
  no proof file. An extra payload refuses certification and writes
  zero receipts. All earlier controls stay green.
- **Pivot**: A receipt for unverified bytes, an extra or unidentified
  output, a missing pin, or an ordinary route regression rejects
  certification. Activation and restart recovery stay open.
- **Anchor**: The full legacy emitter, verified Git object reader
  and independent artifact ownership review.

## Require the full receipt before a warm selected repair

Allow a warm repair only when the current source matches the full
receipt and the repair restores recorded bytes. The selected plan
already checks shared hook groups before a rewrite. Recheck all
received file evidence and allow missing files only when the
selected plan restores the recorded path, digest and mode.

- **Hypothesis**: A selected warm repair can restore missing
  payloads from a certified source. Missing or mismatched identity
  and changed unselected bytes cause refusal before a repair.
- **Measurement**: Prime the existing warm fixtures with the signed
  full proof. Independently remove the proof, change its digest and
  edit a different facet's output. Observe receipt, native tree,
  settings and the missing selected asset.
- **Success**: All three negative controls refuse with zero output
  changes. The supported warm repairs restore only their selected
  payload and keep the existing receipt valid. No live activation.
- **Pivot**: A stale proof, unsafe adoption, lost neighbor or repair
  outside the recorded inventory blocks warm use.
- **Anchor**: The independently derived full receipt and the signed
  warm fixture path ownership checks.

Hosted run 44249742643 reproduced all three refusals as missing.
Run 44250523487 passed 32 focused controls, all 96 native
compatibility tests, and type checking. A warm repair kept the
receipt and restored the recorded bytes and mode. A missing
receipt, a changed source digest, and an edited unselected file
each stopped the repair before any writes.

## Keep the prototype off ordinary publication paths

- **Hypothesis**: Ordinary full sync continues to emit without the
  experimental process owner. Only explicit prototype calls enter
  that owner. Warm receipts cannot omit signed unselected files.
- **Measurement**: Run the full no-plugin emitter with an unavailable
  prototype owner on Linux and Windows. On Linux exercise the
  signed full and warm controls. Remove an unselected launcher and
  its receipt row before attempting a selected hook repair.
- **Success**: Ordinary publication avoids the prototype owner in
  both operating system controls. The incomplete receipt causes
  refusal with zero mutations. All supported prototype controls
  and existing lifecycle compatibility tests pass.
- **Pivot**: Any changed ordinary invocation or partial receipt
  admission keeps the prototype out of delivery.
- **Anchor**: The no-options native emitter, its real lifecycle
  callers and independent review of complete receipt ownership.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44251588464)
failed the ordinary path on Linux and Windows and admitted the
incomplete launcher receipt on Linux. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44251849496)
passed the ordinary path on both systems, 33 signed publication
checks, 89 compatibility tests, and type checking. Only explicit
prototype calls enter the experimental path. The lifecycle and
signer-writer experiments are retained separately. No product
caller adopts the new receipt or lock in this phase.

## Recheck planned file destinations under the signer lock

- **Hypothesis**: A selected publication leaves the output untouched
  if a file appears after planning or a planned registry target
  changes before the lock is held.
- **Measurement**: Insert a synthetic earlier owner file at the
  exact admission boundary. Repeat for the selected hook script
  and the marketplace index. Compare every known output path.
- **Success**: Both injected changes cause refusal before any write
  by the publisher. The unchanged signed cold and warm controls pass.
- **Pivot**: Any overwritten fixture file, new plugin envelope, or
  settings change rejects the prototype.
- **Anchor**: Read-only selected plan, lock admission, and signed
  native scratch controls.

The comparison covers the last pre-write observation. The process
owner coordinates other native prototype invocations.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44260814881)
accepted both changes. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44261096467)
refused both before the first write and kept the existing file
bytes. It passed 35 focused controls, 91 compatibility tests, the
ordinary publication control, and type checking. The new check
compares every planned destination before native output begins.

## Certify the selected artifacts from an empty marketplace

- **Hypothesis**: Each selected publish can record exactly the
  new signed artifacts it produced in a private receipt.
- **Measurement**: Start with an empty native directory for hooks,
  MCP, rules, and hooks plus rules. Compare the receipt fields to
  the pinned identity, expected output paths, digests, and modes.
- **Success**: All four cases record exactly their selected coverage
  and written files. The receipt is readable only by its owner.
  Settings and unselected payloads retain the cold fixture behavior.
- **Pivot**: Any unexpected artifact, incorrect proof, mixed source,
  or setting change blocks this step.
- **Anchor**: The signed selected writer, the full receipt verifier,
  and the existing cold scoped fixture.

The cold receipt records its coverage separately from the earlier
full receipt. Later publication still needs a qualified transition
from partial coverage to a second selected facet.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44262812630)
lacked a receipt in all four cases. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44263063423)
recorded all four inventories, source digests, coverage lists and
modes exactly. It passed 39 focused controls, 95 compatibility tests,
the ordinary publication control, and type checking. A subsequent
selection still needs a qualified transition from partial coverage.

## Extend a verified partial receipt with a later facet

- **Hypothesis**: A second selected publish can extend a matching
  partial receipt and retain exactly the artifacts from the first
  selection that it does not own.
- **Measurement**: Run hooks then MCP, MCP then hooks, and hooks
  then rules with the same source pin. Compare each old payload,
  the index and the receipt coverage. Plant a changed retained
  script before a second selection and check that every path stays.
- **Success**: All three supported transitions keep their prior
  files and record the exact coverage union. A changed retained
  file refuses with zero additional writes. Settings remain absent.
- **Pivot**: An adopted unknown file, misidentified covered facet,
  changed unrelated path or unsuccessful supported transition
  rejects this phase.
- **Anchor**: The signed cold receipt, native hook grouping, and
  independent inventory validation.

This phase covers repeated selected output on the same installed
pin. Interrupted publication and activation need separate evidence.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44264526308)
refused all three supported transitions. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44265123576)
preserved the retained files and recorded the three coverage unions.
An edited retained script still caused refusal. The run passed 43
focused controls, 99 compatibility tests, and type checking.

## Refuse a pre-existing unowned launcher during a cold publish

Review found that an unchanged launcher could be missing from a
cold receipt because the writer built the inventory from files it
planned to write. Derive the complete cold inventory from the
signed source and compare it to the plan before the first write.

- **Hypothesis**: An exact byte match at an unowned launcher path
  causes refusal instead of an incomplete cold receipt.
- **Measurement**: Keep one exact signed launcher in the scratch
  home and remove the synthetic marketplace. Attempt the same
  selected MCP publication against that state.
- **Success**: The publisher leaves the retained launcher untouched
  and creates zero marketplace files or settings. All normal cold
  controls still record their complete inventories.
- **Pivot**: Adoption, a partial receipt, or a changed retained file
  rejects the candidate.
- **Anchor**: Independent review of the selected output receipt
  and the pinned launcher inventory.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44265947064)
accepted the unowned launcher. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44266213545)
left it untouched and refused before creating the native directory.
All 44 focused controls, 100 compatibility tests, and type checking
passed.

## Repair a missing file within an already covered facet

- **Hypothesis**: A selection can restore a recorded missing file
  to its exact bytes and mode without changing the partial receipt.
- **Measurement**: Publish each of hooks, MCP, and rules separately
  in a cold home. Remove its script, launcher, or generated hook
  and repeat the same selection. Compare the previous bytes, mode,
  receipts, and neighboring paths.
- **Success**: All three repairs restore their recorded file and
  keep the index, receipt, envelope, and state of other facets.
- **Pivot**: A missing, extra, or differently owned file, or a
  changed receipt fails the candidate.
- **Anchor**: The existing warm full-receipt repair controls and
  the independently verified partial inventory.

This repair reuses prior coverage. An expanded selection still
requires all earlier payloads to be present and verified.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44266738534)
refused all three repairs. The first candidate restored scripts and
launchers. Its rules case still rejected the empty signed parent
folder. The [corrected candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44267284512)
allowed existing parents of verified repair paths and passed all
three repairs, 47 focused controls, 103 compatibility tests, and
type checking.

## Recheck retained receipt paths before a repair

- **Hypothesis**: An updated unselected artifact or marketplace
  index causes refusal before a selected repair changes any file.
- **Measurement**: Start with a full signed receipt and remove
  the selected hook script. Replace the retained MCP file or
  index at the exact signer admission boundary. Compare all
  other paths, the changed file and the still-missing script.
- **Success**: Both controls refuse with zero publisher writes.
  All supported cold, partial, and warm checks still pass.
- **Pivot**: Any restored selected output after a changed
  dependency, or any write to the retained file, rejects this step.
- **Anchor**: The signed warm receipt and final destination checks.

This adds the last pre-write observation for retained receipt
files and the marketplace index.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44268465074)
accepted both changed input files. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44268882533)
refused both before repairing the missing script. It passed 49
focused controls, 105 compatibility tests, and type checking.

## Qualify executable hooks from the signed Git tree

- **Hypothesis**: A hook declared executable in the signed commit
  stays executable through selected publication and receipt repair.
- **Measurement**: Confirm mode 100755 with Git, publish the signed
  fixture, and compare the script mode and private receipt after
  deleting and restoring it.
- **Success**: Git reports 100755 and both emitted copies use
  mode 0755. The receipt stays unchanged through repair.
- **Pivot**: A lost executable bit or unproven Git mode keeps
  this case outside the activation evidence.
- **Anchor**: The signed Git tree reader and selected receipt
  mode checks.

The [hosted control](https://github.com/fyodoriv/agentbrew/actions/runs/44269622494)
confirmed Git mode 100755 and native mode 0755 before and after
repair. The receipt stayed unchanged. The run passed 50 focused
controls, 106 compatibility tests, and type checking.

## Retain ownership when a selected write fails

- **Hypothesis**: After the first selected write begins, a reported
  error keeps its process owner record for verified recovery.
- **Measurement**: Complete one synthetic native file write and
  fail the writer at that boundary. Retry publication in the same
  scratch home. Observe the owner record, payload and settings.
- **Success**: The first failure keeps its exact owner record. The
  retry refuses before any further file changes. Existing planning
  refusals and successful publications release their owned record.
- **Pivot**: An automatic retry after partial output, an unrelated
  state change or a retained pre-write planning failure rejects it.
- **Anchor**: The process owner record and independent selected
  output interruption controls.

This step preserves recovery evidence. Reopening an interrupted
publication needs a separate verified recovery procedure.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44271418146)
removed the owner record after a partial write. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44271706452)
kept the same record and refused a retry before another write.
The run passed 51 focused controls, 107 compatibility tests, the
ordinary publication control, and type checking.

## Retain ownership after a certified full write fails

- **Hypothesis**: The opt-in full certification path retains the same
  owner after a real native write fails. A second opted-in run refuses
  without changing the interrupted output.
- **Measurement**: Fail after the signed fixture's first native envelope
  write in the existing scratch publisher test. Record the owner and
  envelope, then try the full certification again with the same fixture.
  Check the ordinary no-options publisher separately.
- **Success**: One interrupted write, the exact owner and envelope retained,
  zero changes on retry, and zero settings or certification receipt created.
  Full certification success and the ordinary publisher still pass.
- **Pivot**: Fail if the writer clears the owner record after mutation, a second write
  before recovery, or an ordinary publisher behavior change.
- **Anchor**: The selected write failure control above and the full
  publisher's separate certification path.

This proof covers the opt-in writer in a scratch home. Recovery and any
change to ordinary full publication need separate qualification.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44281159545)
wrote the native envelope, threw the synthetic error and removed the
owner. The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44281522433)
kept the owner and exact envelope, and a retry refused before any write.
The candidate passed 52 focused controls, 108 compatibility tests,
ordinary publication, and type checking.

## Preserve a disabled plugin during opt-in certification

- **Hypothesis**: An opted-in full publication preserves an explicit
  disabled setting for a plugin it continues to publish.
- **Measurement**: Seed scratch settings with the signed fixture
  disabled, one unrelated enabled plugin, one unrelated marketplace,
  and a separate owner setting. Run full certification and compare all
  four values. Confirm that missing settings use the existing defaults.
- **Success**: The known false value and all three unrelated values
  survive. Certification records the signed artifact inventory. The
  ordinary publisher and the earlier interruption controls remain green.
- **Pivot**: Reject any lost disabled setting, changed unrelated value,
  guessed path ownership, or ordinary publisher behavior change.
- **Anchor**: The ordinary settings projection and the deferred native
  activation ownership work above.

This control covers a valid owned settings file in the scratch fixture.
Settings path ownership and activation remain separate.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44282217325)
changed the explicit false to true. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44282475637)
preserved the disabled setting and all three unrelated values. It passed
53 focused controls, 109 compatibility tests, ordinary publication,
and type checking.

## Keep settings unchanged if certification fails

- **Hypothesis**: An opted-in publication that cannot certify its signed
  output retains the caller's settings bytes exactly.
- **Measurement**: Seed an unrelated owner settings file and an extra
  working-copy payload in the existing signed fixture. Verify the
  failure, the exact settings bytes, the retained owner record and
  the missing receipt. Check the default enabled state on a clean
  certified fixture.
- **Success**: The rejected publication changes zero settings bytes
  and creates zero certificates. The good fixture records proof and
  retains its expected default activation state. All ordinary publisher
  and interruption controls pass.
- **Pivot**: Reject a settings change before successful certification,
  premature owner release, or ordinary publisher behavior change.
- **Anchor**: The full signed artifact inventory and the retained
  ownership and disabled-setting tests above.

This control covers relative write order. Artifact certification and
settings activation still need a shared verified trust boundary.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44282857061)
rewrote the settings before refusing the extra payload. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44283116421)
left those exact bytes untouched and kept the owner record. The clean
fixture retained its default enabled setting. The candidate passed the
53 focused controls, 109 compatibility tests, ordinary publication,
and type checking.

## Hold the signer descriptor through a certified settings write

- **Hypothesis**: An opted-in full publication with signed input holds
  the same signer descriptor from final verification to the settings write.
- **Measurement**: During the actual scratch settings write, open a
  second descriptor and attempt the same non-blocking signer lock. Record
  its exit code. Attempt the lock again after publication returns.
- **Success**: One completed settings write sees exactly one contention
  result with exit 75. The same attempt succeeds after publication ends.
  The certificate and prior settings tests stay green.
- **Pivot**: An available descriptor during the write, retained lock
  after return, or changed ordinary publication behavior rejects it.
- **Anchor**: The shared signer registry contract and the certified write
  order check above.

This proof covers the signed nonempty publication path and cooperating
writers. Settings path ownership, empty cleanup and live installation
remain separate.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44283459129)
acquired a second signer descriptor during the settings write.
The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44283769969)
refused it with exit 75, then allowed the lock after publication
returned. It passed 54 focused controls, 110 compatibility tests,
ordinary publication, and type checking.

## Verify settings ownership before native certification writes

- **Hypothesis**: An opted-in full publication refuses an aliased settings
  file before its first payload write. It also retains an owner's edit
  made after planning and before the settings commit.
- **Measurement**: In the existing scratch fixtures, point settings at a
  synthetic owner file using a symbolic link, then test a separate hard
  link. In a third fixture, edit a regular settings file after the first
  real native write and before the settings commit.
- **Success**: Both aliased paths leave every file and their targets
  unchanged and release ownership before any native write. The late edit
  survives exactly, no activation setting changes, and the admitted
  partial publication retains its owner record. Valid owned and ordinary
  paths still pass.
- **Pivot**: A touched link target, ignored late edit, or ordinary behavior
  change rejects the settings path check.
- **Anchor**: The existing native path and retained-destination checks
  and the signer descriptor proof above.

This control bounds the last observed settings identity. It covers
cooperating publication and signer operations plus the planted edits.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44285478575)
admitted both links and the late settings edit. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44285782892)
refused the link cases before writing and retained the exact late edit.
The interrupted case retained its owner record. The candidate passed 57
focused controls, 113 compatibility tests, ordinary publication, and
type checking.

After aligning the draft with its parent, the
[platform control](https://github.com/fyodoriv/agentbrew/actions/runs/44287957155)
passed ordinary publication and formatting on Ubuntu and Windows. The
Ubuntu job also passed the 57 focused and 113 compatibility tests and type
checking. The first Windows run stopped at formatting because checkout
converted the line endings. The scratch workflow retained the committed
line endings for the passing run.

## Recheck the shared signer descriptor at publication

- **Hypothesis**: After the signer writer change lands, the native proof
  uses its descriptor check before publication writes.
- **Measurement**: Reuse the merged descriptor helper in the scratch
  fixture. Supply a check that reports lost ownership at the first
  publication boundary. Repeat at the later boundary after a real
  selected payload write. Check full certification separately.
- **Success**: A first selected refusal leaves zero payload files,
  receipts or settings and releases its process record. A late selected
  refusal keeps the partial payload and owner but writes zero receipts
  or marketplace index. A full certification refusal creates no
  receipt or settings and retains its admitted owner.
- **Pivot**: A payload write after an early refusal, a new certificate or
  index after the later refusal, or an ordinary publication change
  rejects the composed candidate.
- **Anchor**: The merged Agentbrew and Dotfiles descriptor contract,
  plus the planning and interruption controls above.

The fixture changes a callable check only. It leaves the actual signer
registry and its descriptor in the normal owned state.

The [composed baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44292026610)
ignored all three descriptor checks. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44292333014)
refused each at its registered boundary. Early selected refusal wrote
nothing. Late selected refusal retained the partial output and its owner
without writing a receipt or index. Full certification kept its owner
without writing settings or a receipt. The candidate passed 60 focused
controls, 117 compatibility tests, ordinary publication, and type
checking.

## Test process loss at three output checkpoints

- **Hypothesis**: If the opt-in native publisher loses its process
  before payload, marketplace index or activation settings, a separate
  replacement process refuses entry and preserves every new byte.
- **Measurement**: Install a signed synthetic plugin in a new scratch
  home for each checkpoint. Run the real selected or certified full
  writer in a child. Stop that child at the exact next atomic write,
  before it mutates that path. Use a separate child to retry the same
  route. Record file count, type, mode and digest below the scratch
  output roots and the process owner byte identity.
- **Success**: Three identified checkpoint exits, three retained
  owner records, three refused replacement processes, no new writes
  after refusal, and the target checkpoint path remains untouched.
- **Pivot**: A wrong checkpoint, changed post-loss output, an unsafe
  takeover, or a missing control prevents use of the interruption
  evidence. No live activation or automated recovery follows.
- **Anchor**: The interrupted-publication matrix, and the earlier
  real single-writer and in-process partial-write controls.

The first local settings case stopped before the injected checkpoint.
The scratch clone and legacy copy produced a mode-0600 guard where the
signed tree requires 0644. The shared test queue sets umask 077. Keep
that exact conservative refusal as a separate unresolved configuration.
Run the three checkpoint controls with a registered umask 022 so that
they exercise the intended settings boundary.

The mode-022 Mac control reached all three points in separate child
processes. Each exited 77 at its registered write. All three
replacement processes exited 75 without touching the retained bytes,
file types or modes. The expected incremental progress before each
boundary still needs corroboration in the hosted run.

The checkpoint fixture pins its synthetic installed guard to the
0644 mode registered in the signed tree. A single-file copy kept that
mode under either mask. The first test of this setup still failed
before the settings checkpoint. See the recursive copy control below.

The installed fixture mode alone did not reach settings under 077.
A recursive copy reproduced the distinction. It copied a 0644 source
as 0600 under 077 and as 0644 under 022. The checkpoint child uses the
registered 022 even when its parent queue keeps 077. This isolates the
three interruption controls without changing real user permissions.


The final control passed all three checkpoints in the default queue
with its parent mask unchanged. The child returned 77 before each
target write. Each replacement returned 75 and preserved the complete
observed output snapshot. This includes the completed earlier files
and receipts at the marketplace and settings boundaries.

## Refuse an incompatible copy mode before certification writes

- **Hypothesis**: Certified full publication can identify a mode it
  cannot reproduce before creating payload, index, or settings.
  The guarded write still accepts the verified 022 control.
- **Measurement**: Use the signed checkpoint fixture and a real child
  process. Compare strict 077 against 022 with an installed 0644 guard.
  For the strict case snapshot all output roots and the owner record.
  Separately change only the installed synthetic guard to 0600 while
  the publishing child stays at 022, then repeat the strict snapshot.
- **Success**: Each incompatible input stops before its first output
  write and leaves no new process owner. The normal full writer still
  certifies the original signed modes and passes all prior controls.
- **Pivot**: An output change, a retained owner before mutation, an
  ordinary default regression, or a masked source that looks
  certified stops the candidate. Preserve strict-mask refusal while
  a compatible ownership contract is evaluated.
- **Anchor**: The verified mode-mismatch result, recursive Node copy
  behavior, and the certified writer's receipt of exact file modes.

Both original refusal cases ran and exited nonzero, but the
marketplace and launcher paths appeared and the process owner
remained. The candidate moved mode validation before the first
mutation. Both inputs then refused with their complete prior
snapshots intact. All three separate-process interruption controls
still passed. This qualifies an early refusal, not support for
publishing under the incompatible mask.

## Keep Linux certification under a stricter mask

The [first hosted copy control](https://github.com/fyodoriv/agentbrew/actions/runs/44310371269)
disagreed with the Mac result. Linux kept a mode-0644 file at 0644
under both 022 and 077. Preserve this as a measured platform difference.

- **Hypothesis**: Apply the ambient copy-mask forecast only on the Mac.
  Linux continues to certify the known signed mode under 077. The installed
  mode check still rejects a changed source file on either platform.
- **Measurement**: Run the exact recursive-copy fixture with both masks
  on hosted Linux. Run the signed full publisher with an installed 0644
  guard under 077. Observe callback, native mode and owner retirement.
  Keep the Mac 077 refusal, changed-source refusal and three process
  interruption cases.
- **Success**: Linux publishes mode 0644 and retires its owner,
  the Mac preserves all prior output under 077, both platforms reject
  the altered installed guard, and all ordinary controls pass.
- **Pivot**: A Linux refusal for this known valid input, a Mac partial
  write, permission broadening, or a wrong signed mode blocks the
  forecast on that platform. The final full receipt check remains in place.
- **Anchor**: The pinned recursive copy controls and unsigned output
  exclusion in the existing full-certification contract.

The [Linux regression](https://github.com/fyodoriv/agentbrew/actions/runs/44311312195)
reproduced an unnecessary refusal on the first draft. Its signed
publisher exited 1 where the registered control required exit 0.
After applying the mask forecast only on the Mac, the
[hosted Linux run](https://github.com/fyodoriv/agentbrew/actions/runs/44311661340)
kept the mode-0644 guard under 077 and passed both native suites.
The local Mac passed all five mode and interruption cases.

## Signed CLI selection and privacy order results

The [packaged scratch build](https://github.com/fyodoriv/agentbrew/actions/runs/44311066942)
passed the hooks, MCP, rules and default controls. Each selected run
published its expected facet and made no native activation change.
Default published all facets. Every run kept its signed source and
signer registry. The three selected runs held the signer descriptor
once and released their process owners. There were no denied calls or
unclassified paths.

The [physical commit observer](https://github.com/fyodoriv/agentbrew/actions/runs/44311831668)
confirmed one index commit followed by one redaction commit in all
four cases. The build routed selected sync to the prototype only in
the scratch branch. The live writer and lifecycle coordination remain
outside that result.
