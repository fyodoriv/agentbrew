# Package executable entry inventory experiment

## Goal and source boundary

The inventory candidate reads package scripts but does not account for the
package executable entry table. The repository declares its CLI and screenshot
entrypoints through `package.json` `bin`, with bundles produced by `tsup.config.ts`.
Add their caller and output obligations without reading ignored build payloads.
This is source-inventory preparation, not a runtime port or full-ledger proof.

## Registered prediction

**Hypothesis:** accounting for package executable entries reduces missed planted
entry/edge omissions to zero while preserving every complete control. Each alias
requires its own registry component and an `invokes` edge to exactly one indexed
program or declared generated executable output. Shared target aliases stay
separate callers. An unknown language remains unresolved.

**Measurement:** run `JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked
--manifest-path rust/Cargo.toml --test package_entries -- --test-threads=1`.
The tests call the real discovery and validation functions on synthetic snapshots;
they do not invoke the incomplete snapshot worker or execute inventoried source.

**Success:** every frozen decision agrees; zero omission false passes, valid
control false rejections, duplicate-key shadowing passes, unsafe-path acceptance,
source executions or ignored payload reads. First observe semantic red against
the unchanged discovery adapter. Compiler/setup failures are inconclusive.

**Pivot:** any missed alias/body/edge, duplicate-key shadowing, unsafe path,
ambiguous output accepted or valid complete case rejected changes the adapter
contract. Do not weaken thresholds or infer a bundle from a matching basename.

**Anchor:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
Munafò et al. (2017), preregistration; the `rust-source-inventory` task.

## Frozen controls

- Complete object-form entries naming indexed programs pass; deleting an entry
  component or its exact `invokes` edge rejects the omission.
- String-form `bin` is accepted with a valid package name. Scoped names use
  their package basename as the command alias.
- Distinct aliases for one indexed target remain distinct required callers.
- A generated target passes only through one declared output identity, with
  its producer obligation and package entry edge. No ignored output is opened.
- Missing targets, ambiguous output identities, malformed table/value/name,
  duplicate JSON keys and unsafe absolute/traversal/control/backslash paths
  reject. A leading `./` is normalized without permitting parent traversal.
- Indexed symlinks resolve only within the snapshot; escaping links and cycles
  reject. A known target with nested interpreter code retains body obligations.
- Packages without `bin` preserve their existing decisions. Ordinary inert
  metadata does not create executable callers.

## Ownership and lifecycle

Reuse the strict manifest, discovery facts, generated targets, snapshot and
edge models. Parsed package data and discovered aliases have checker-invocation
scope; nothing persists between calls. The source registry is trusted input
only as current snapshot bytes, never as executable code. Reject duplicate JSON
keys before a map can overwrite an executable identity.

Keep worker, lifecycle, judge, hook and sync sources unchanged. Existing staged
inventory work remains owned by the coordinating agent. Root owns integration,
review, complete ledger acceptance and delivery. This focused result cannot
qualify the unfinished worker or claim complete executable coverage.
