# Reviewed source registry implementation plan

## Overall goal and vision

Account for owned executable bodies that the native inventory cannot yet extract.
Keep their real callers, output identities and migration slices visible before
any production port. A missing parser must stay non-green until exact source
review supplies the missing discovery evidence.

This extends the registered `rust-source-inventory` preparation task. It does not
approve any source record, establish a complete ledger or replace installed
runtime code. The registered inventory task and [migration plan](rust-migration.md)
remain the acceptance authorities. The draft inventory implementation plan
`docs/plans/rust-source-inventory.md` must ship with its checker implementation.

## Decision and alternatives

Add a strict reviewed-source registry to the trusted checker artifact. Native
parsers remain authoritative where they understand the source. The registry
supplies exact missing facts for a reviewed unsupported producer or language.
The ordinary manifest must still classify every resulting fact and typed edge.

A whole-file hash exemption would identify source without discovering its
embedded bodies or callers. A manifest-controlled allowlist would let the input
grant itself authority. Suffix-only discovery already missed owned source.
Implementing a universal language analyzer would exceed this preparation task.
These alternatives are rejected.

Reuse the existing snapshot, native fact, call receipt, region and typed-edge
models. Reuse a maintained literal decoder where a reviewed source span needs
one. Do not execute a source file to decode a literal or resolve a caller.

## Evidence and current state

Rust source paths below refer to the active implementation draft, not shipped
code on the default branch. The task commands remain proposed until that
implementation is delivered.

| Claim | Current source of truth | Delivery path | Status |
| --- | --- | --- | --- |
| Inventory scope includes embedded and generated programs | `TASKS.md`, `rust-source-inventory`; `docs/plans/rust-source-inventory.md` | Developer measurement binary | fact |
| Source identity includes current index and actual working bytes | `rust/src/snapshot.rs`, indexed-object comparison in `read` | Held-root Git and no-follow file reader | fact |
| The manifest cannot grant a generic unknown-source exemption | `rust/src/model.rs` strict manifest types | Manifest validation | fact |
| Actual helper, fixture and exporter producers need explicit caller/body/output evidence | `scripts/worktree-deps.sh`, `scripts/check-lockfile-sync.sh`, `rust/tests/snapshot.rs`, `rust/tests/inventory.rs`, `skill-plugins/workflow/run-goal/scripts/export-goals.py` | Existing source consumers | fact |
| A trusted compiled registry can supply those missing facts without overriding native contradictions | Boundary contract below | Proposed registry adapter | proposed |
| Registry records and the final repository ledger are complete | Future source review and required inventory gate | Not established by this plan | verify |

## Scope

Include only exact reviewed unsupported boundaries from real source. Initial
families are Python/Perl programs and their subprocess bodies, Rust preparation
fixture producers, and the owned Perl/Python bodies in build scripts. Review
fragments are proposals until their source records and expected facts pass the
controls below.

Do not add production ports, a benchmark engine, arbitrary runtime registry
paths, environment overrides, a worker selector or a language runtime. Keep
worker lifecycle changes and their timing contract separate. Keep frozen
support retained and unresolved; do not create work for it.

No registry record may suppress a known native body, callee, output, literal
target, source-policy error or typed-edge contradiction. Unknown host calls do
not become safe merely because the same source file has a reviewed record.

## Boundary contracts

### Registered hypothesis and measurement

**Goal:** complete executable-scope evidence without silently accepting an
unsupported producer.

**Question:** can exact reviewed source, caller, body and output bindings supply
the missing discovery facts while preserving native contradictions and valid
data-only decisions?

**Metric:** 100% expected decisions in the frozen matrix below; zero missed
owned nested bodies, false passes, false rejections, source executions or
manifest-created authority grants. These are the existing task thresholds.

**Success:** keep the adapter only when every registered decision matches and
every actual reviewed-source oracle agrees. The full task additionally needs
100% reviewed repository classification and zero unclassified owned executable
components. A fixture result alone does not satisfy that requirement.

**Pivot:** any valid missed body, incorrect caller/output binding, false pass,
false rejection or native contradiction override rejects this registry design.
Change the record/authority boundary rather than lowering the threshold.
Compiler, dependency, setup and incomplete-source failures are inconclusive.

Exact proposed focused command, to be delivered by this work:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test reviewed_sources -- --test-threads=1
```

The existing registered task command remains proposed until its checker ships:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- inventory --check
```

Record the exact source tree, source/lock/toolchain identities, command, exit
and actual decisions. Commit this prediction before registry implementation or
new fixture results. First observe semantic red against the tested native
source driver with the registry adapter unchanged. A supported native positive
must pass in the same baseline. The selected complete unsupported-source
positive must fail at the missing reviewed-source boundary. A generic
`not-implemented` stub, failing metadata transport, missing test target or
compiler error does not isolate this experiment and is inconclusive.

**Anchors:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
Munafò et al. (2017), preregistration; the existing inventory task's guarded
success and pivot thresholds. This is not a performance experiment.

### Authority, owner and lifecycle

The registry is owned by the reviewed checker artifact. Its strict version-one
data is embedded at build time. There is no runtime path, environment variable
or inventory-manifest field that selects a replacement registry.

The parsed registry has checker-invocation scope. It is immutable for that
invocation. Do not add a cross-invocation cache or a process-wide mutable
registry. An artifact/source mismatch fails closed; it does not trigger source
execution, an automatic refresh or a network lookup.

The selected repository remains one held-root snapshot. The existing index,
working-byte, untracked-path, no-follow, no-helper and command-limit contracts
apply. Registry data itself remains an ordinary tracked reviewed data file.
Do not add another circular-receipt exception or exempt its source directory.

### Source record and validation

Each record must contain:

- Version, exact repository-relative path, indexed Git blob, language, reason
  and explicit review completeness state.
- The whole-program fact and the existing owner/migration classification.
- Every reviewed execution, source, write, copy or generation boundary in scope.
- Exact UTF-8 byte spans within that verified blob. Bind callee spelling,
  resolved identity or named runtime input, argument roles, body spans and
  decoder, outputs and actual consuming boundary.
- Explicit unresolved boundaries. Missing evidence stays non-green; an empty
  boundary list cannot imply a partially reviewed producer is inert.
- Data-only regions only where the reviewed consumer parses or prints data
  without executing it. A suffix, comment, upstream name or quoted command is
  not sufficient authority.

Verify source identity and byte bounds before decoding. A Git blob plus a byte
range identifies the exact reviewed source span; the record must also supply
its caller/body/output semantics. The file receipt alone is not discovery.
Never expand runtime inputs or read owner configuration to fill those fields.

Use native facts and typed receipts directly where supported. Else produce the
same exact component and typed-edge obligations from the reviewed boundary.
Known literal targets and outputs must retain their observed identities.
An imports/copies edge cannot satisfy execution. Unknown or conflicting facts
stay non-green. Native contradictions take priority over registry records.

For Rust string spans, `syn` 2.0.119 is the verified reuse candidate: `LitStr`
and `LitByteStr` decode literal values behind its parsing feature. If needed,
add only the pinned direct parsing dependency after the unchanged-source
baseline. Preserve old lock identities/checksums. No full Rust execution
analyzer, arbitrary dependency installation or handwritten unescape engine is
authorized by this plan. Other literal forms require a bounded decoder contract
or remain unsupported. Primary API: [syn literal types](https://docs.rs/syn/2.0.119/syn/struct.LitStr.html).

### Frozen expected-decision matrix

1. Complete reviewed source plus a complete manifest passes without execution.
2. Remove a known nested body or exact caller/output edge from the manifest:
   reject the omission.
3. Change source while retaining its reviewed receipt: reject stale evidence.
4. Remove its trusted source record: unsupported source remains non-green.
5. Substitute another owned literal callee/output: reject the contradiction.
6. Keep a body passed only to a parser as data; do not invent execution.
7. Keep a known owned body when its interpreter or output uses a named runtime
   input. The input contract cannot erase that body.
8. Supply a deliberately incomplete trusted discovery record: an independently
   fixed actual-source expected-fact control must fail. Do not generate the
   expected facts from the registry or checker being judged.
9. Add a registry record that conflicts with native evidence: reject it even
   when every manifest component and edge is present.
10. Try to grant authority through an unknown manifest field or runtime registry
    selector: reject it under the strict input contract.

Source oracles must name the actual public-safe source span and independent
expected body/caller/output identities. Schema tests and a self-generated
expected list do not prove discovery.

## Numbered work breakdown

### 1. Freeze real source oracles and record schema

- **Why:** prevent a registry from defining its own successful expected result.
- **Parallelism:** source review can run beside worker lifecycle preparation;
  record implementation depends on committed registration and actual red.
- **Owner / boundary:** agentbrew inventory preparation; trusted checker versus
  source/manifest inputs.
- **Change:** prepare `rust/tests/reviewed_sources.rs` and exact public-safe
  source fixtures; freeze the strict record schema in this plan before its
  proposed `rust/src/reviewed_sources.rs` implementation. Keep source proposals
  unapproved until checked.
- **Evidence / acceptance:** source identities, spans and independent expected
  facts agree; all matrix controls have fixed expected decisions; the unchanged
  checker reaches actual semantic red.
- **Verification:** focused command above. Preserve every exit and distinguish
  setup/compiler failures from missing-fact assertions.

### 2. Add the compiled registry adapter

- **Why:** supply unsupported discovery facts without giving the manifest an
  exemption capability.
- **Parallelism:** depends on 1; independent of a production runtime port.
- **Owner / boundary:** checker-invocation immutable registry and held snapshot.
- **Change:** implement the strict internal record types, proposed registry
  module and `rust/reviewed-sources.json`; integrate through `rust/src/discovery.rs` and
  validation. Reuse existing fact/receipt models and bounded literal decoders.
- **Evidence / acceptance:** the same focused matrix passes with zero ignored
  controls; native contradictions and unresolved inputs remain non-green.
- **Verification:** the exact focused command; compare exact pre/post source
  and dependency receipts. Do not run sources to obtain facts.

### 3. Reconcile actual reviewed records and repository ledger

- **Why:** fixture correctness does not account for the repository's real code.
- **Parallelism:** depends on 2; disjoint file-family review may run in parallel
  under one schema and exact source revision.
- **Owner / boundary:** each actual source reviewer; final inventory owner
  reconciles caller/output closure and duplicate or contradictory proposals.
- **Change:** admit only reviewed records that pass their actual-source oracle;
  refresh changed blobs and current-main membership; complete the ordinary
  component manifest. Update README developer guidance and the inventory plan
  with exact limits and remaining gaps in the same change.
- **Evidence / acceptance:** every indexed path and owned executable has a
  reviewed decision, real consumer evidence and a migration slice or narrow
  exception. Unknowns, missing boundaries and frozen residue remain explicit.
- **Verification:** required repository inventory command above, followed by
  outside review and the repository's normal delivery gate.

## Rollout, security, and regression coverage

Register this plan first. Measure actual unchanged-source red, then implement
the bounded adapter and repeat the same controls. Integrate only after the
source owner unfreezes the worktree. Preserve fixed-worker and dependency-lock
ownership; do not overwrite their files with an older private checkpoint.

Use owner-controlled heavy-run admission with one compiler worker and one test
thread. Do not set outer slot or project-cap overrides. Any combined command
that includes the existing lifecycle timing tests must use an outermost
`heavy-run --exclusive` reservation and preserve their timing-validity rules.

Keep source review local and content-minimal. Do not include credentials,
private paths, customer payloads, configuration values or conversation histories
in records, fixtures, logs or public text. Keep the normal leak and delivery
gates. Do not publish, install, sync or port a runtime as part of registration.

Rollback removes the registry adapter; unsupported source returns to explicit
non-green diagnostics. It does not relax a manifest or silently accept a source.

Open decisions: final source records, decoder forms beyond the verified bounded
candidate, source-family completeness and whole-ledger acceptance. Registration
approves this experiment only. It does not approve records or final coverage.

This method relies on review at the trusted checker boundary. It cannot prove
that an intentionally corrupted checker or an unreviewed record describes every
behavior of an arbitrary program. Outside review and fixed source-bound omission
controls enforce that limit; a hash or self-authored label alone never does.
