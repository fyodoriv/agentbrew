# Native source inventory preparation

## Outcome and registered experiment

Provide `migration-check inventory --check` before any production port. The
committed `rust-source-inventory` task registers the experiment: complete
reviewed classification, no unknown owned executable component, and no missed
planted omission. Keep every valid positive control accepted. A false pass or
false rejection changes the discovery method rather than the threshold.

The exact acceptance command remains:

```sh
heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- inventory --check
```

Run the frozen fixture matrix with:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml -- --test-threads=1
```

Every expected decision must agree: all omission controls reject with the
registered diagnostic; all complete and inert controls pass. Source code must
never run during inventory.

Use the machine owner’s queue slot and project-cap settings. Do not set a
second outer slot count. Run native tests with one compiler worker and one
test thread. Compilation,
tests and the complete repository gate use the shared machine reservation.
This preparation adds neither a production replacement nor a performance
comparison. It does not establish arbitrary-program static-analysis completeness.

## Measured foundation and pending acceptance

The test-only producer-composition seam proposed in
[this prediction](rust-producer-composition-seam-prediction.md) is approved for
the narrow host-source controls described there. It cannot supply production
evidence, replace a failed inspector result, qualify frozen N15/N18 Rust
cases, or authorize a worker. The registered full corpus and independent
source-bound inspector requirements remain unchanged.

The current implementation is developer preparation. It does not replace an
installed runtime. The inventory validator has a bounded candidate, but its
complete reviewed repository ledger is absent. Do not report this task as
complete. The [reviewed registry plan](rust-source-reviewed-registry.md) defines
exact unsupported-boundary evidence.

The isolated registry candidate compiled all test targets, then passed 53
native controls, 34 inventory decisions and 9 reviewed-source controls with no
skipped or filtered cases. This bounded fixture result is not a coverage
percentage or an integrated-worker result. Source-bound oracles cover the
actual Python data parser and exact Rust shell canary. Caller scope in the
producer record is a compiled, reviewed source span, not general Rust syntax
analysis. Whole-file Rust and other unsupported producers remain unresolved.

The held-root experiment first reproduced two real wrong-root reads: replacing
the selected pathname made both reads return the replacement repository's
index. After the registered worker change, both controls passed complete
snapshots. The same checkpoint passed all 17 snapshot and 5 syntax controls.
A later v1 checkpoint passed all 19 snapshot controls, including fsmonitor
and promisor positive canaries, helper suppression and a present local object.
The integrated v2 descendant/pipe lifecycle contract remains non-green. The
bounded Darwin metadata API passed 15 controls; that result does not qualify
its worker recovery path on the installed kernel.

The remaining integration must complete the bounded caller/source worklist,
registered adversarial inventory matrix and reviewed ledger. Unsupported Rust
fixture producers may use an exact reviewed producer/boundary registry. Each
entry must name source regions, callers, produced executable bodies and output
identities. It needs omission controls. It cannot silently mark an unknown
producer as inert or use a file receipt alone as discovery evidence.

Inventory integration fixtures invoke the exact Cargo checker artifact through
its JSON CLI. Production reads select the current checker executable. A Rust
test harness is not a checker worker, and there is no runtime worker-path setting.

## Source boundary

The checked object is one repository working tree and its current Git index.
Enumerate index entries and both ordinary and ignored untracked paths with NUL
delimiters. Inspect ignored paths through no-follow metadata only; never read
their payloads. Reject unmerged entries, unsupported modes, unsafe paths and
ordinary new files. An ignore rule alone is not a source exemption.

Prune only these exact repository-root directories before untracked listing:

| Path | Non-source owner |
|---|---|
| `node_modules/` | Package-manager dependencies |
| `dist/` | Bundler output |
| `coverage/` | Test coverage output |
| `rust/target/` | Cargo build output |
| `.metrics/` | Gate plans, timings and caches from `scripts/verify.sh` |

Tracked entries remain inputs under every prefix. Nested directories with the
same basename are not pruned. Unknown ignored paths fail closed. An exact
`non_source_allowances` record can name reviewed non-source data. Narrow
`private-configuration` contracts allow generic `.env`, `.env.*`, `.envrc`,
`*.pem` or `*.key` names without copying private names or contents into the
manifest. Neither contract accepts an executable, a symlink, a known source
name or an ignored target reached by an indexed execution caller. Unread
configuration is owner-declared non-source input, not proven inert content. The validator includes
its workspace, tests and integration scripts in the same inventory.

Git is a trusted metadata adapter for the selected local checkout. Disable
inherited repository-redirecting Git overrides, system/global configuration,
external fsmonitor and filters, lazy fetch and replacement objects. Preserve
caller HOME, PATH, XDG and owner-wrapper context. Do not bypass the installed
Git wrapper or alter its production hook policy. Repository-local metadata remains
inside this trust boundary; this is not a parser for hostile arbitrary `.git`
configuration. Bound command time and output. Terminate and reap an owned
metadata process on failure.

The v1 worker's immutable `READ_GIT_CONFIG` and `READ_GIT_ENV` facts also define
the helper-canary policy. A positive scratch-Git control omits only the barrier
under test. The closed production reads retain that barrier. The fsmonitor
helper must first leave a marker; each production read must leave it untouched.
The promisor fixture packs a local commit and tree that reference an absent
blob. Its unique local protocol is explicitly allowed, so the no-lazy-fetch
barrier must prevent helper execution while preserving the local missing-object
frame. A present-object control checks ordinary batch behavior.

These Git helper fixtures use a minimal POSIX executable that appends a fixed
marker and exits. Git requires this executable boundary for its helper contracts.
The fixture child appends a unique helper directory after the existing PATH;
the owner Git wrapper keeps its routing. All metadata, markers and protocol
names are synthetic. The helper performs no command dispatch or network work.
These canaries do not establish descendant or pipe-lifecycle acceptance.

Read index blobs through Git without filters or source execution. Compare each
regular working file's actual bytes against its index blob through a directory
handle and no-follow opens. Inspect link bytes without opening the target.
Reject links that leave the indexed tree, missing targets and cycles. This
does not enumerate a live agent home or authorize writes to generated targets.

Manifest `rust/inventory.json` is versioned JSON with separate file, component
and edge records. A reviewed Git blob guards every ordinary source file. Its
own file record is the sole `inventory-description` record and has no circular
self-blob requirement. The strict schema and complete record checks still
apply to it; it cannot hide executable code or exempt another file.

## Review and discovery

Each file has an exact reviewed disposition. Each program region has an owner,
source anchor, language, form, caller boundary and migration slice or a narrow
justified exception. Components and source/generated-output edges have unique
IDs. Output identities are repository-relative aliases, never expanded home
paths. A file-level shell or presentation exception cannot erase a nested
program or generated output.

Conservative evidence adapters cover file modes, shebangs, known source forms,
shell interpreter calls and heredocs, process/generator calls, package command
fields, workflow run bodies and generated template conditions. Their discovered
facts must match reviewed region records. Dynamic boundaries need an explicit
reviewed resolution; an unknown target is not automatically upstream or data.
Changes to comments or data also need a fresh file receipt, but inert examples
are not invented executable components.

A decoded body owns its generated or embedded form. A shared wrapper call may
have both parameterized and literal contexts. One context must not overwrite
another body's classification. Call receipts preserve each source span, actual
callee, operation and argument identity; a line-wide anchor is not sufficient.

Cross-check the existing helper source registry, hook manifest, package entry
points and bundler entries. Native table adapters read the actual exported
helper-map rows and the scoped `tsup` configuration constructor. An unrelated
function with the same name cannot supply bundler evidence. Referenced helper
and entry paths must exist in the indexed source set. These table adapters are
not yet the complete source/caller worklist.

A variable command under a conditional, loop or background context remains
unknown. A prior literal assignment does not prove that command's runtime
identity. Literal interpreter calls in the same context remain discoverable.
A `for` or `select` header also invalidates an older binding after the loop,
even when its body contains only a function definition.

Package `bin` entries are separate executable callers, including aliases that
share a target and string-form declarations. The [package-entry experiment](rust-package-bin-inventory.md)
binds each alias to an indexed program or a unique generated output from an
observed producer with a literal output path equal to the package target. A
symbolic output receipt identifies a producer input, not a static package path;
it cannot satisfy that entry. Missing entries, edges, unsafe paths, unresolved links and
shadowing package/table keys fail closed. Ignored bundles are never opened to
supply their source evidence. This does not yet qualify arbitrary bundler
output mappings or complete the repository ledger.

Upstream ownership is separate from executable-family evidence. The
[ownership experiment](rust-upstream-ownership.md) binds the pinned package's
original, comment-only, mixed-patch and newly owned files to compiled provenance
anchors and observed Cargo/Rust consumers. The consumer remains Darwin/test
scoped. An upstream label clears neither unsupported-language diagnostics nor
worker, snapshot or edge failures. Mixed whole programs stay unresolved; new
owned modules cannot inherit the upstream label. Dependency additions and their
source/lock qualification are recorded in `rust/upstream-dependency-receipt.json`.

Preserve declared source-to-bundle-to-deployment edges. The source inventory is
distinct from the deployment ownership manifest.

UI allowances name presentation regions. Shell allowances name the execution
context they require. Frozen support is reported as unresolved retained residue;
it receives no port, fix or new feature through this task.

## Frozen control matrix

Run the production checker on scratch Git source trees. Where a control changes
source, refresh the ordinary file receipt in the fixture so a stale hash alone
cannot stand in for content/caller detection.

| Control | Expected decision |
|---|---|
| Extensionless executable, then a non-executable-mode file reached by a package command | Reject missing program classification |
| Python inline body inserted into reviewed shell | Reject missing embedded component |
| Quoted Node heredoc inside necessary shell; reviewed headroom-shaped counterpart | Reject omission; accept complete counterpart |
| TypeScript writer creates an extensionless executable | Reject missing program/output edge |
| Python `-I -c` through a resolved `python_bin` variable | Reject missing Python region |
| Package script calls an unlisted extensionless target | Reject caller/target omission |
| Workflow multiline run body contains `node -e` | Reject missing command/embedded region |
| Conditional executable scaffold template | Reject missing conditional output |
| Test helper writes a fake executable program | Reject omitted generated program |
| Registered hook sources a file with an unusual suffix | Reject newly reachable program omission |
| Screenshot orchestration or goal-data exporter is relabeled UI | Reject invalid broad exception |
| Frozen residue is relabeled ordinary shell or migrated | Reject policy mismatch |
| Generated-output edge is removed but generator remains | Reject missing edge |
| Unknown executable language or unresolved dynamic caller | Reject unsupported boundary |
| Component rename or external symlink replaces reviewed source | Reject stale membership/link; never read external target |
| Inert examples, comment mentions, fixture records and upstream references | Accept their reviewed non-executing treatment |

## Implementation checkpoints

1. Add the locked native workspace, strict schema and CLI dispatch. Land tests
   against missing validation behavior before filling the checker.
2. Add bounded Git and no-follow working-tree adapters. Keep repository snapshot
   state local to one invocation; no registry persists between calls.
3. Add conservative fact discovery and exact manifest validation. Complete the
   reviewed source ledger and registry edges, then run the registered controls.
4. Connect both verification routes, document receipt updates and obtain an
   independent source and adversarial review. Root owns final delivery.

## Dependency decision

Use Serde and serde_json for the data format. Use rustix's safe directory-relative
filesystem API for no-follow reads rather than handwritten unsafe traversal.
Pin selected versions and checksums in Cargo.lock. Git is an upstream read-only
adapter; reviewed project programs are never invoked by discovery. Dependency
selection is preparation tooling, not a new runtime requirement for installed
agentbrew users.

## Snapshot bounds and observed fixture gotcha

Git plumbing calls have a 30-second deadline. Metadata output is capped at
8 MiB. Each accepted object is at most 16 MiB; aggregate object content is at
most 128 MiB. Raw batch output has a separate 144 MiB cap including framing.
Working-file reads stop after 16 MiB plus one byte. These are acceptance and
I/O bounds, not measured peak-memory claims.

An isolated test environment still needs an existing scratch HOME for the
owner Git wrapper. Put that home beside the scratch repository. Omitting it
made the first adapter baseline fail in fixture setup before calling the
adapter. Production retains the caller’s owner context and never uses the
fixture home.

## Discovery limits and review

The validator combines exact receipts, conservative evidence adapters,
explicit caller/generator registries and reviewed contracts. It does not
prove arbitrary-program static analysis. A dynamic boundary is incomplete
until a reviewed resolution names its owned target or explicit external/input
contract and a corresponding edge. Never fill unknowns with an automatic UI,
shell, upstream or data label. Inert examples and comments remain data when
there is no execution boundary. New unsupported source forms require another
registered control and an adapter change before their receipts are accepted.
