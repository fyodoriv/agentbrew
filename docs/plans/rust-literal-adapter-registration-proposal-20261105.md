# Narrow Rust literal-writer adapter: registration proposal

Status: proposed, not registered. No adapter, test target, dependency change,
compiler invocation or product measurement was made for this proposal.
The source is clean draft #767 at
`ed65c092e81ad62c54e49aea6573e59f66eeeddd`.

## Overall goal and vision

Account for a narrow Rust writer family through discovery and manifest
validation. A supported writer must bind its actual physical source bytes,
callee, arguments, generated body, output and required edges. A parsed Rust
file alone does not count as a fully bound program.

This is a new supplemental corpus. Bounded recovery did not find a sealed
earlier Rust 6/18 corpus. PR #749 is history-scanner projection, not this
experiment. Preserve all original inventory categories, parser controls and
trusted-registry controls unchanged. Preserve the existing source branches.
This experiment cannot retire whole-family coverage, symbolic outputs, the
repository ledger, bundler qualification or the blocked shared native worker.

## Decision and alternatives

Reuse Syn 2.0.119, the existing language-independent Graph/Event/Datum/Site
model, native fact conversion, promotion, body worklist and validation. Add
one bounded Rust evidence adapter. Do not create another inventory engine,
literal unescaper, compiler runner, Cargo build runner or line scanner.

Default to explicit incomplete evidence for aliases, dynamic expressions,
methods, builders, conditional configuration, arbitrary macros, attributes
that change module lookup, and generated bindings. Reject conflicting native
evidence even when a ledger is structurally complete.

## Evidence and current state

| Claim | Source at ed65c092 | Status |
| --- | --- | --- |
| Rust is recognized but normally requires reviewed evidence | `rust/src/source_kind.rs:19`; `discovery.rs:510-555` | fact |
| Facts and receipt models can express writer evidence | `host_graph.rs:10-56`; `native_facts.rs:374-450`; `observations.rs:5-61` | fact |
| Absorption creates calls/bodies and queues decoded bodies | `discovery.rs:678-791` | fact |
| Outputs, receipts and required edges are validated | `native_validation.rs:33-211`; `validation.rs:465-513` | fact |
| Producer contradiction guard currently uses TS module membership | `discovery.rs:558-567` | fact |
| Current validation does not generally reject every extra component absent from native facts | `validation.rs:298-415` | fact |
| Syn has parsing/full/visit without printing | `rust/Cargo.toml:24` | fact |
| Syn Spanned is unavailable without printing | cached Syn 2.0.119 `src/lib.rs:524-526` | fact |
| Syn parse_file removes BOM and shebang prefixes | cached Syn `src/lib.rs:992-1015` | fact |
| proc-macro2 byte_range is accurate outside procedural macros with span-locations | cached proc-macro2 1.0.107 `src/lib.rs:469-481` | fact |
| The supplemental corpus reaches discovery and validation without native workers | corpus contract below | proposed |

Primary language references checked Nov 5:
[Rust paths](https://doc.rust-lang.org/reference/paths.html),
[module source rules](https://doc.rust-lang.org/reference/items/modules.html),
and [include semantics](https://doc.rust-lang.org/std/macro.include.html).
Modules may use `name.rs` or `name/mod.rs`, but not both. Include lookup is
relative to the physical source file and inserts unhygienic tokens. The first
slice therefore accepts only whole-item literal includes with fully reviewed
namespace context; it does not claim general macro expansion.

## Scope

The companion document `rust-literal-adapter-corpus-proposal-20261105.md`
defines six primary positive cases and fifty negative variants in eighteen
groups. Each negative is counted separately. Supplemental preservation cases
have their own denominator. Do not report 0/18 unsafe decisions or count group
labels as independently executed controls.

Only synthetic in-memory Snapshots are proposed for the new corpus. Source
bytes, modes, index identities, ignored records, complete manifest values,
expected receipts and required diagnostic witnesses are fixed there. No
ambient source reads, Git process, compiler invocation by discovery, owner
configuration, environment lookup or native worker belongs to these tests.
Normal compilation of the test target occurs only after registration and
approval. Resource inputs use lossless byte/map descriptions rather than
printing megabytes of repeated padding. These descriptions are exact input
data; they are not expected values derived from candidate observations.

## Boundary contracts

### Source and lifetime

Parser buffers, ASTs, namespace decisions and spans have one-source-analysis
scope. Aggregated facts and the optional test observation trace have one
discovery-invocation scope. No persistent cache, process registry, globalThis
owner, runtime selector or mutable module registry is introduced.

Preserve the source limit 2,097,152 bytes, decoded-body limit 33,554,432 bytes,
source-count limit 100,000 and body depth 16. A limit diagnostic prevents a
clean report; no partial facts may imply acceptance.

### Exact spans and literals

Add only the already locked proc-macro2 1.0.107 as a direct dependency, with
`span-locations`. Keep Syn features unchanged. Read token and delimiter spans
directly; do not import syn::spanned::Spanned or add printing for convenience.
Check all conversions to u32. Calls end after their closing parenthesis,
before semicolon, question mark or method suffix. Literal argument spans
include their literal token delimiters. Function owner offset is the `fn`
keyword in original source; an inline module does not change physical paths.

For an initial UTF-8 BOM, replace its three bytes with three ASCII spaces in
the parser buffer before parsing as Syn File. This is a same-byte-length map;
the original bytes remain the receipt authority. Do not call parse_file on
the original BOM/shebang and pretend its shifted coordinates are original.
Do not normalize CRLF or convert columns to bytes. P03 includes a BOM, CRLF
prefix, multibyte text and a raw string whose body line breaks are explicitly
LF. Unknown shebangs remain refused. Rust inner attributes are not shebangs.

Use Syn LitStr/LitByteStr value decoding only. The initial accepted literals
are UTF-8 strings and UTF-8 byte strings; unsupported encodings stay incomplete.
The proposal's source strings and decoded expectations are independent data.

### Namespace, module and include authority

Primary positive Snapshots contain an explicit minimal Cargo package with
edition 2021 and `[lib] path = "src/lib.rs"`. Read this only from Snapshot
bytes using the existing TOML library. Never call Cargo or read dependency
directories. Refuse absent/ambiguous edition or crate-root context when it is
needed to establish std authority. Workspace inheritance, multiple candidate
crate contexts, dependency aliases named std, no_std, extern aliases, glob
imports and unresolved namespace changes remain registry-required. A callee
ending in `fs::write` is not enough.

The narrow standard spelling is `::std::fs::write`; an unprefixed
`std::fs::write` is accepted only after the same bounded namespace proof.
No `fs::write`, imported writer alias, local alias, wrapper call, generic
specialization, method or cross-file value resolution is claimed. Conservative
refusal must not relabel an unknown call as an observed standard writer.

Resolve unambiguous out-of-line modules by Rust directory rules through
Snapshot-indexed paths. Keep distinct physical-source and logical-module
identity. Whitelist literal whole-item include! only after proving that no
macro binding can replace it. Included bytes join the same source worklist
with Rust language, even for a nonstandard suffix. Keep include context
unhygienic: a binding introduced there can invalidate std proof in its parent.
Path attributes, expression/statement includes, macro redefinitions,
configuration attributes, escape, ignored/missing targets, symlink hazards
and ambiguous module choices are explicit refusals.

Module/include obligations use `imports` edges between physical program IDs.
Writer output paths retain the literal runtime value. Do not rebase them to
the Rust source's parent directory. Generated targets are not materialized.

### Discovery, validation and registry contradictions

Primary positives and N16/N17 call public discovery::discover, inspect its
actual boundaries/facts/receipts/required edges, and pass that Discovery into
validation::validate. They never fill observed facts from the expected data.
The manifest is parsed from the companion's frozen complete JSON.

A source with only supported constructs may become fully covered. A file
with any unsupported call/configuration remains registry-required while
retaining trustworthy supported-site facts. Resolved std calls with unknown
arguments may emit known-operation evidence plus unknown Datum values, but
must remain non-green. No data classification can erase their source witness.

Track native coverage explicitly at source/site scope inside discovery.
For a fully covered Rust source, reject invented native call/body manifest
claims with `native-fact-mismatch` (new diagnostic, proposed). For a supported
native site in a partly unsupported file, the registry cannot override it.
Fully covered files reject any reviewed producer for their source, including
an invented site. A partial file can retain an exact approved producer only
for its unsupported site; the existing symbolic Rust canary must survive.
Do not replace this rule with a blanket rejection for every `.rs` path.

N18 uses a proposed cfg(test)-only explicit per-invocation producer-evidence
input to the same private discovery orchestration. Production public discover
continues to obtain evidence solely from its compiled inspected registry.
There is no CLI/env/file authority input, mutable module override or public
injection API. Test trace records identify native witnesses and refusal
reasons, without granting authority or changing production report schemas.
The seam is for testing the composition guard after trusted inspection;
it does not qualify the independent record inspector. Existing source-bound
record/ownership controls remain required. Root must approve this seam before
test code. If it cannot share the real orchestration, stop and register a
different method; a stale-producer diagnostic cannot qualify N18.

### Registration and metrics

**Hypothesis:** fully bound narrow cases rise from predicted 0/6 to 6/6.
Wrong-claim and unsafe admission remain zero across all fifty fixed negative
variants. Existing preserved expectations do not change. This is correctness
measurement, not speed, memory, complete Rust support or migration completion.

**Measurement:** after root reviews the exact corpus and normal docs-only
registration is committed, add only the proposed library test module
`rust/src/rust_family_tests.rs`, selected by `rust_family_tests::`. Commit
prediction before its first executable test code or semantic result.

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib rust_family_tests:: -- --test-threads=1
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib -- --test-threads=1
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test package_entries --test upstream_ownership -- --test-threads=1
```

The module does not exist now. A missing target, compiler/setup failure or
zero-selected run is inconclusive. The unchanged-source baseline must reach
the real API and show six missing native bindings, with an available native
positive preservation case passing. Record each negative as qualified refusal,
unsafe permit, wrong refusal or unqualified due to missing native witness.
A registry-required message alone cannot qualify N16/N17 or N18. Resource
cases must reach their specific boundary rather than an unrelated parser error.

**Success:** 6/6 fully bound primary positives; 50/50 qualified negative
decisions with 0 unsafe permits, 0 wrong diagnostic witnesses and 0 unqualified
controls; all separately counted preservation expectations and available
registered library/package/ownership controls pass. Every accepted primary
case has an empty validation diagnostic set. Do not reuse historical 83/12/19
as fresh results. Normal repository gates and independent exact-source review
remain required. The unavailable worker suite remains an explicit blocker.

**Pivot:** any unsafe permit, lost valid control, wrong physical byte span,
body/output/caller mismatch, silent unsupported form, unqualified negative or
unexpected dependency identity/checksum change rejects this adapter method.
Stop before production integration. Fix the semantic boundary or register a
new method before new results; never narrow the frozen corpus after results.

**Anchor:** Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration; the pinned Syn/proc-macro2 source contracts above. This
supplement cannot change the original task's 100%/zero-error thresholds.

## Numbered work breakdown

1. **Review and commit registration.** Owner: inventory lane and root.
   Depends on exact corpus/seam review. Deliver this proposal and its complete
   corpus as docs only using a clean suitable worktree, normal docs gate and
   a pre-result commit. No failed checkpoint or source commit is authorized.
2. **Qualify unchanged-source baseline.** Depends on 1. Add the sealed pure
   library test data/module, including independent native witnesses and valid
   setup control. Run the first exact command above. Retain real failing
   decisions and classify unqualified negatives; never call them safe passes.
3. **Add bounded evidence adapter.** Depends on 2's semantic red. Touch the
   smallest Rust frontend/discovery/coverage integration and declared direct
   dependency link. Feed native conversion and the existing body worklist;
   add no source execution or new installed behavior. Repeat the same corpus.
4. **Preserve and independently judge.** Depends on 3. Run the remaining
   available registered suites and normal repository gate. Review exact
   receipts and all original matrices. Keep draft #767 unmerged while its
   declared complete-worker/ledger/activation acceptance remains open.

Initial estimate: 6–12 hours for this bounded implementation and review, with
resource/seam qualification uncertainty. This is not measured runtime or a
promise of full-family completion. Stop and re-estimate if scope grows.

## Rollout, security and regression coverage

Review private proposal first. Then use docs-only registration on a suitable
clean worktree. Root commits it normally before executable test code. Keep
source and test changes frozen during each run. All cargo tests use heavy-run
with one compiler worker and one test thread; preserve owner queue limits.
No worker, metadata transport, install, sync or live machine inventory runs
belong to this slice. Do not execute the synthetic Rust, shell or macro text.

Preserve original inventory controls at `rust-source-inventory.md:197`, parser
extension controls at `rust-source-parser-experiment.md:64` (registration
fe8221d, SHA256 0581bf268251c45f2753749eb6a55c134fe2236dcd3288f51152720b820b76e2),
and all trusted-record controls in `rust-source-reviewed-registry.md`
(registration 3b3f70b). Existing exact Rust canary, invalid-record and upstream
ownership controls are independent obligations. No public completion claim,
ledger retirement or checker activation follows from this slice's green result.

Rollback removes the new adapter/coverage integration and returns unsupported
Rust to registry-required. It never erases retained source or weakens ledger,
privacy, ownership, native worker or caller requirements.
