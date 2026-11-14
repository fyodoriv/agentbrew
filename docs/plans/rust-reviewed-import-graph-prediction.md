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

## Design review (source only)

At the pinned revision, `review_ask_event.py` declares target resolution at
lines 5–6, module initialization through `exec_module` at line 7, and a
conditional call to `classifier.reviewer_request` at line 18. The callee's
function is at `pr-command-target.py` lines 73–83. The command-line hook at
`a-pr-is-not-ready.sh:63` separately invokes the parser with a transcript path.
The classifier and event tests have their own dynamic-load routes. A textual
search does not prove complete caller coverage or that any branch ran.

A candidate contract would bind exact paths, modes, blobs and unique byte
spans for both reviewed files and the CLI hook. It would distinguish:

1. The caller module and the callee module as separate program components.
2. A source-declared resolution/import relation to the callee.
3. A distinct loader call-site that executes the callee module initialization.
4. A distinct conditional call-site that invokes the reviewed exported function.
5. The separately sourced CLI invocation and the test callers, with their own
   review boundaries. The data argument and Boolean result are not executable
   bodies.

Existing `imports` and `invokes` edges can name generic relations, but one
program-to-program edge cannot bind both call sites. The current record exposes
only a CLI entry, and `validation::validate` rejects a second component on the
reviewed parser's path. A future implementation needs source-bound identities
for the two sites and function, a narrowly scoped same-file rule, and typed
obligations emitted by discovery and required by validation. It must retain the
existing CLI binding and unrelated diagnostics. Unknown aliases, callers or
unreviewed source remain non-green; no manifest edge may authorize itself.

An in-memory snapshot test could call actual discovery and validation without a
Git worker. Independently frozen expected source facts must not be derived from
the registry being tested. Require distinct refusal controls for changed caller,
changed callee, wrong path, wrong mode, missing module-execution edge, missing
function-call edge, ambiguous span, and manifest-only forgery. Each must prevent
a partial clean result; preserve unaffected baseline reports. Such a test does
not authenticate a production snapshot or prove a real invocation.

This is a candidate, not an accepted graph schema or a complete caller review.
The caller itself dynamically loads code and needs its full boundary and
transitive consumers reviewed. Test callers and source reachability remain
unresolved. No implementation or source was executed. The pivot remains in
force until an independently reviewed contract accounts for those facts.

Independent review confirms the source distinctions but keeps the pivot in
force. Before implementation, specify missing-target and failure behavior,
alias/rebinding of `spec`, loader and classifier, the transitive caller review,
and how the site-bound components satisfy the same-file guard without a broad
exception. The listed controls are design requirements, not passing results.

The source-only caller trace also reaches `review_ask_event_test.py`, which
patches process and network call sites before dynamically loading the event
module, and `review_ask_event_runner.py`, which loads that test module. A
separate runner test writes fixture files, creates shell scripts including an
executable, starts a direct child and calls `child.kill()` on timeout or cleanup.
These source-declared writes, launches and signals are distinct boundaries;
test guards are not a blanket inertness proof. No process was started or
signaled in this review.
Their invocation, failure and cleanup paths need their own source-bound review
before they can enter a complete ledger. This trace does not claim all callers.
