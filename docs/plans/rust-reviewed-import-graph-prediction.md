# Reviewed Python import graph design prediction

The stale parser has an imported-function caller. Its current reviewed record
supports one CLI entry, and validation rejects additional same-file components.
A standalone source oracle cannot make the inventory enforce that route.

- **Hypothesis:** A narrow source-bound design can express both the existing
  CLI entry and the source-declared `exec_module` and function-call obligations
  without accepting an unreviewed caller or suppressing existing diagnostics.
- **Measurement:** Review the complete pinned caller and callee and current
  `reviewed_sources` → discovery → validation interfaces. Produce a concrete
  edge and source-identity contract plus an independently reviewed in-memory
  fixture plan. Pin the source at `a24fc723`: caller blob
  `546e2ca9bfb25e03f39a0aa90ff3135e34c95ae5`, callee blob
  `fd4447d1593298fd5a92e714d048f0d1ef715b9b`, and CLI hook blob
  `dd2851f92585e716230bc5daa5955a6564c75a19`. Do not run analyzed source,
  Git metadata workers or a live hook.
- **Success:** The design specifies 2 source identities, both entry routes,
  the separate module-execution and function-call relationships, and a
  no-worker validation path. It names controls for at least 8 failure classes:
  changed caller or callee, wrong path or mode, missing execution or call edge,
  ambiguous spans, and manifest-only forgery. Each control must identify its
  own refusal and prevent partial clean admission. Unknown caller coverage and all
  unrelated diagnostics remain non-green. Existing fixtures keep their meaning.
- **Pivot:** If a complete caller review or exact typed edge semantics cannot be
  justified, leave the parser stale. Do not implement a partial clean admission,
  weaken the existing same-file guard generally, or treat an import reference
  as proof of execution. Source-declared calls do not prove a caller or branch
  was reached. An in-memory fixture does not authenticate a production snapshot.
  This design cannot qualify the physical worker or compiled inspector.
- **Anchor:** `rust-reviewed-parser-refresh-prediction.md`,
  `rust-source-reviewed-registry.md`, `rust/src/discovery.rs`,
  `rust/src/validation.rs`, and Basili et al. (1994), Goal Question Metric.
