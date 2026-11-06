# Source inventory parser experiment

## Registered outcome

This is a method change inside `rust-source-inventory`, not a new threshold.
The committed task prediction remains: 100% of registered expected decisions,
0 missed planted omissions, and 0 false rejections of complete positive controls.
The reviewed source ledger must still classify 100% of owned executable regions.
No production port or performance gain is claimed.

**Goal:** prevent owned programs and outputs from escaping the migration scope.
**Question:** can native upstream syntax trees, followed by a bounded caller
closure, bind each observed execution or write site to its actual source,
operation, arguments and output identity?
**Metric:** expected decisions from the registered fixture matrix. Keep only
100% agreement. Any missed omission or invalid rejection changes the parser,
caller abstraction or supported boundary before a port proceeds. Do not add a
blanket data, UI, shell or upstream exception to make a counterexample pass.

Measurement:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --test inventory -- --test-threads=1
```

Run the snapshot safety cases under the same owner queue and worker budget.
Root owns actual build/test execution and records the exact source tree.
Compiler or dependency errors are inconclusive. Successful compilation with
expected checker assertions establishes a failing baseline; a green command
with no registered cases does not establish coverage.

The acceptance command remains the committed task's command:

```sh
heavy-run cargo run --locked --release --manifest-path rust/Cargo.toml --bin migration-check -- inventory --check
```

**Anchor:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
Munafò et al. (2017), preregistration;
[Tree-sitter syntax-tree guidance](https://tree-sitter.github.io/tree-sitter/using-parsers/);
[OXC parser validity contract](https://docs.rs/oxc_parser/latest/oxc_parser/struct.ParserReturn.html).
A syntax tree is evidence about syntax. It is not proof of arbitrary runtime
behavior. Preserve unknown and unsupported states as failures.

## Why the first private method is rejected

The initial fixed-name, line-based scanner was never delivered or reported as
complete. Independent read-only review found concrete fail-open paths:

- A known interpreter with a variable or missing source target could disappear.
- A newly caller-reached extensionless or unusual-suffix source was classified
  without scanning its embedded children.
- Aliased process/writer functions and cross-module wrappers evaded name checks.
- Deduplication by line hid a second call after the first call was resolved.
- A generic edge could satisfy a resolution without matching its operation,
  argument or observed output path.
- An inert `cat` heredoc could be scanned as executing shell code.

These are static counterexamples, not invented before/after runtime numbers.
The old private candidate remains audit evidence. No passing matrix or full
source coverage is attributed to it. Preserve its files before replacing it.

## Frozen additional controls

Each mutation refreshes ordinary file receipts. Complete but misleading ledgers
must fail, so a missing root record or stale hash cannot stand in for discovery.
These controls extend the committed 16-category matrix without relaxing it.

| Control | Required decision |
|---|---|
| `bash "$SCRIPT"` with an unbound script expression | Reject unresolved execution |
| `node missing.opaque` with no indexed or declared generated source | Reject unresolved execution |
| Caller reaches `helpers.rules` which contains Python `-c` | Reject omitted Python child |
| Named import alias of a writer creates an executable | Reject omitted program/output contract |
| Namespace/destructured process alias executes an inline body | Reject omitted caller/body |
| A local alias passes through a cross-module wrapper | Reject omitted reachable write/execute boundary |
| One line contains two calls, only one has a complete ledger | Reject the second omission |
| Process resolution is backed only by an imports/copies edge | Reject wrong operation edge |
| Process resolution names an unrelated owned target | Reject wrong argument/target binding |
| Generator ledger names a different literal output path | Reject wrong output identity |
| A `cat` heredoc contains a Node example | Accept reviewed non-executing data |
| A quoted inert host record contains process-looking text | Accept reviewed non-executing data |
| A regular executable or symlink replaces root `dist/` directory | Reject omission; never follow the link |
| Supported current TypeScript type-query/generic import syntax | Accept valid syntax; never silently omit errors |

Complete counterparts must pass for alias, closure, same-line call and output
binding cases. Bindings must use AST node identities/spans, not a source-line
count or an arbitrary reviewed string. Unknown expressions require a named,
reviewed input contract for that exact expression; they cannot impersonate a
known literal target or output.

## Reuse decision and bounded implementation

Use an upstream native TypeScript/JavaScript parser for host syntax and an
upstream Bash grammar for shell syntax. Keep source execution disabled.

The candidate selection, verified against primary registry metadata on
2026-11-02, is OXC `0.156.0` (parser, allocator, span, AST, visitor and semantic
bindings) and Tree-sitter `0.27.1` with Bash grammar `0.25.1`. OXC's declared
minimum Rust version is `1.97.0`; the available Homebrew toolchain is `1.99.1`.
This is a developer-toolchain requirement, not an installed agentbrew runtime
change. Pin exact selected crates and checksums before the first parser build.
Disable optional CFG, JSDoc, WASM, bindgen and regex parsing when not required.

Primary metadata:

- [OXC parser release metadata](https://crates.io/api/v1/crates/oxc_parser/0.156.0)
- [OXC semantic release metadata](https://crates.io/api/v1/crates/oxc_semantic/0.156.0)
- [Tree-sitter release metadata](https://crates.io/api/v1/crates/tree-sitter/0.27.1)
- [Bash grammar release metadata](https://crates.io/api/v1/crates/tree-sitter-bash/0.25.1)
- [Official Bash Rust binding](https://docs.rs/tree-sitter-bash/0.25.1/tree_sitter_bash/)

Do not use the old official TypeScript grammar `0.23.2` unchanged: its known
`typeof import` generic-call parse problem overlaps current repository tests.
Do not suppress parser errors or fall back to file suffixes after a parse error.

Parser state and syntax trees belong to one repository-check invocation.
Resolve module/caller work with a bounded worklist and visited identities.
Recognize inert strings, comments and heredoc bodies from syntax context.
Preserve source spans and operation/argument receipts for every call separately.
A source promoted by a caller enters the same discovery worklist as a normal
program. Preserve the existing exact Git/working-byte and no-follow boundary.

Do not grow this into a general compiler, execute the source, fetch modules or
scan agent homes. Fail closed for unsupported dynamic forms. The reviewed
manifest records intentional external-input contracts; it never grants writes
to deployment paths or permission to ignore owned code.

## Registration checkpoint

Commit this prediction before the new parser implementation. Existing private
scanner files are rejected-method evidence, not the new parser candidate.
The first parser result must name this committed prediction and its exact
frozen control cases. Root owns the registration commit and gate receipts.
