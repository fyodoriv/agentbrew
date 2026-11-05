# Source-bound upstream ownership experiment

## Goal and limits

Classify the pinned libproc dependency without labeling upstream code as an
owned port or hiding owned patches under a vendor-directory exception. This
changes ownership policy only. Unknown executable-family, worker, snapshot,
caller and edge diagnostics remain required. No production capability or
complete inventory result is established.

Use the immutable checker-compiled review boundary. Reuse held snapshots,
regions, source sites, diagnostics and strict manifest components. Add no
manifest-controlled upstream registry or runtime authority selector.

## Registered measurement

Hypothesis: exact package provenance plus observed Cargo and Rust consumers
admits every valid original/comment-only ownership case, with zero forged
upstream admissions, lost owned patches or erased unrelated diagnostics.

The frozen policy command to deliver is:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test upstream_ownership -- --test-threads=1
```

Success: all frozen decisions agree; zero false admissions, false ownership
rejections, source executions or diagnostic suppressions. Positive ownership
controls retain their unrelated unsupported-family errors. Baseline red must
be an actual ownership-policy assertion against the unchanged checker, not a
compiler, missing target, worker or generic parser failure.

Pivot: any forged admission, native contradiction override, erased owned patch,
false positive ownership rejection or unsupported-family suppression blocks
this design. Change the boundary, not the threshold. Anchors: Basili et al.
(1994), Goal-Question-Metric; Munafò et al. (2017), preregistration.

## Trusted source identity and ownership

A compiled reviewed record pins whole provenance records, license bytes and
all expected package-file bytes and modes. Validate them with maintained SHA256,
not a digest implementation written here. The claimed archive digest in an
editable map is insufficient. Admission requires digest equality against the
compiled reviewed values. The original published archive and its sparse-index
checksum are independent review inputs; do not execute or download them during
inventory. A changed compiled registry requires source review like checker code.

The record distinguishes original bytes, code-patched originals, the example's
exact comment-only replacements and newly owned code. The example reconstruction
changes only the recorded Rust documentation-comment lines; all other bytes
remain original. Code-patched files stay mixed and unresolved. The added safe
validation module remains owned. Local provenance and documentation files do
not become executable components merely because they describe code.

An upstream component has the package owner from admitted evidence and no
owned migration slice. The label is valid only for its exact admitted program.
Unknown Rust and every existing native contradiction stay non-green. A whole
mixed program cannot be mislabeled as entirely upstream or an owned native port.

## Observed consumer boundary

Parse actual Cargo TOML, not a manifest-authored edge: bind the Darwin path
dependency, exact package/library identity, lock entry and upstream build script.
Inspect the actual Rust AST for the closed current module/call path, preserving
Darwin and test conditions. The ABI call is test-only. The direct module-path
inclusion of the owned validation file is a separate owned-source edge.

Use the existing pinned Syn with full/visit added to parsing. Support only the
reviewed direct external-crate call and module conditions. A missing call,
shadowed crate, unknown alias/condition or contradictory source remains unresolved;
comments and strings cannot supply a consumer. This is not a general Rust
execution analyzer. Source facts never grant publication or execution authority.

## Exact dependency decision

Add sha2 =0.11.1 with default features off. Published archive SHA256:
47d7069beb7d6ac7b9acd1039986e73443f24234f41074da099d6f994ac9ad19.
Its Rust floor is 1.88. Source: https://static.crates.io/crates/sha2/sha2-0.11.1.crate.

Add toml =1.2.0 with default features off and only parse/serde/std. Cargo's
version selector ignores build metadata; Cargo.lock and the source receipt bind
the exact published 1.2.0+spec-1.1.0 archive and SHA256:
c5ffcdf8f50436dbbfd675c1fe1b8e0854f42b7defea8584bdebe1aee900e561.
Its Rust floor is 1.85. Source:
https://static.crates.io/crates/toml/toml-1.2.0+spec-1.1.0.crate.

Preserve Syn =2.0.119, its parsing feature and checksum:
872831b642d1a07999a962a351ed35b955ea2cfc8f3862091e2a240a84f17297.
Only add full/visit. Its Rust floor is 1.71. These sources are MIT OR Apache-2.0;
the existing checker Rust floor remains unchanged. Qualify every newly resolved
package and preserve every prior package identity/version/checksum. Review any
existing dependency-edge changes. Refresh the root-lock receipt and compiled
anchors deliberately after the lock is qualified. Do not change upstream archive,
license or preserved unsafe-block identities.

## Frozen adversarial policy controls

- Admit valid original/comment-only ownership while retaining unsupported-family
  diagnostics; reject an unqualified component's upstream owner/disposition.
- Reject forged provenance, including colluding editable map/file changes with
  an unchanged claimed archive digest, and a wrong license or package identity.
- Reject changed expected bytes/modes, missing files, duplicate/escaping paths,
  symlinks, stale patch bytes and inconsistent comment-only replacements.
- Observe the actual Cargo dependency/build binding and Rust call with Darwin/test
  scope; reject a missing consumer, comment/string fake, shadowed name, unsupported
  alias or wrong scope. Manifest edges alone cannot supply missing observations.
- Keep mixed code patches unresolved and the added validation module owned;
  reject an owned file or mixed whole program hidden as upstream or fully native.
- Refresh ordinary fixture receipts after mutations, so stale generic receipts
  cannot stand in for provenance or consumer validation. Independently fixed
  actual-source oracles must check consumers and the original/patch partition.
- Reject manifest-created registry authority. Preserve all native contradictions,
  unknown executable families, required edges and worker/snapshot errors.

## Lifecycle and delivery

The parsed registry and admitted facts are immutable within one checker
invocation. No source executes; no owner home, network, installed state or
worker behavior changes. Keep this policy separate from executable-family
analysis and bundler closure. Root owns source commits, external publication,
complete ledger acceptance and any later worker activation.
