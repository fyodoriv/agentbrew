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
