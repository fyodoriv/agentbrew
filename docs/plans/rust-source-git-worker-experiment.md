# Held-root Git worker experiment

## Registered outcome

This is a source-snapshot safety preparation step inside `rust-source-inventory`.
Keep the existing task thresholds. No production port or full inventory coverage
is claimed by this experiment.

**Goal:** keep every Git metadata response bound to the directory object selected
by one inventory invocation. **Question:** does an invocation-owned Rust worker
remove pathname races without changing the parent process directory or executing
repository-configured helpers? **Metric:** correct outcomes in the frozen worker
controls below. Success requires 100% expected decisions, 0 wrong-root responses,
0 parent-directory changes, 0 marker-helper executions, and 0 surviving owned
children after terminal failure or timeout. Any violation rejects this transport;
change its lifecycle or upstream adapter before proceeding. Do not weaken source,
privacy, worker-identity or cleanup rules to retain it.

Exact proposed measurement after the test-target split:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib --test snapshot -- --test-threads=1
```

The existing 12 snapshot and five parser controls must remain represented with
no ignored or skipped cases. Integration tests provide Cargo's exact trusted
measurement-binary path. Root owns compilation and exact-tree receipts.
Compiler, packaging and fixture setup errors are inconclusive, not behavioral
red. A focused actual path-based baseline must show the wrong-root outcome
before the worker fix is implemented.

**Anchor:** Basili, Caldiera and Rombach (1994), Goal-Question-Metric;
Munafò et al. (2017), preregistration;
[POSIX `fchdir`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/fchdir.html);
[the safe rustix process API](https://docs.rs/rustix/1.1.4/rustix/process/fn.fchdir.html);
[Git fsmonitor configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-corefsmonitor).
The primary rustix 1.1.4 source places `fchdir` in `process`, not `fs`.

## Existing failure mechanism and baseline

The current helper starts Git with `Command::current_dir(path)`. A directory
handle protects later working-file reads, but does not bind earlier Git reads.
A pathname can identify another directory after a rename or replacement.
Checking the name before spawn leaves a check/use race.

Preserve the path-based adapter as the baseline. Add the held-directory transport
interface first, still delegating to the existing path-based helper. In a scratch
repository, retain the selected directory handle, rename that directory, and
replace its original name with another scratch repository or a symlink to it.
Invoke the actual central metadata operation and compare the response with the
held original object. Use harmless fixture metadata, not private payloads.
Record the actual failing assertion before replacing the transport.

The source selection may canonicalize normal host aliases such as macOS `/tmp`
and the user's explicit worktree alias. Each source path below the held root
still uses no-follow traversal. The worker must not adopt `/dev/fd/<number>` as
a directory path: the native Mac probe returned ENOTDIR for that route.

## Chosen lifecycle and protocol

The inventory invocation owns the selected root directory descriptor and every
worker Child handle. One worker process owns its working directory from startup
to `exec`. It changes only that worker process directory; it never changes the
inventory parent's working directory.

1. Open the selected root directory before any Git plumbing read. Preserve the
   trusted Git metadata boundary and reject a selected subdirectory of a repo.
2. Spawn the exact trusted measurement binary in an internal versioned worker
   mode. Production uses its own executable; tests pass Cargo's exact binary
   artifact path through an explicit per-invocation test configuration. Never
   select a worker executable from the scanned repository or a new environment
   override.
3. Map the held root File only to the worker's stderr descriptor through Stdio.
   The spawn operation creates that child's inherited descriptor. Do not clear
   CLOEXEC or mutate a persistent inheritable descriptor in the parent.
4. At single-threaded worker startup, validate the directory descriptor and use
   safe `rustix::process::fchdir`. Do not parse source, start threads or run Git
   before this point.
5. Accept only a fixed internal read-operation enum through argv. Construct Git
   arguments in one owner module. Do not accept raw Git argv, config or payload
   values through this mode. Unknown operation/version/startup state fails closed.
6. Exec the owner Git wrapper with the existing read-only defensive settings.
   Keep HOME, PATH, XDG and wrapper policy context. Do not bypass the wrapper,
   reset owner settings, or override production hooksPath.
7. Keep stdin/stdout as the existing pipes. `cat-file --batch` needs newline-
   delimited, validated object IDs from the captured index; that is a concrete
   protocol input at `snapshot::objects`, not a source program or credential.
   Other operations send no input. Never put the batch or source content in argv.
8. Before exec, restore Git stderr to null, matching the current adapter. Worker
   stderr is an internal startup capability, not an error stream. This preserves
   the current diagnostic limit: Git failures report a sanitized error/status,
   without raw Git stderr. Never merge stderr with the NUL-delimited stdout.

Exec preserves the worker PID. The existing parent child owner can enforce the
same output caps, deadline, kill and wait behavior across worker startup and Git.
Close the directory mapping when Git's standard descriptors are installed.
Every early return, spawn failure, broken pipe and timeout closes invocation-
owned pipes and reaps its owned child. No source program is executed by discovery.

## Frozen controls

| Case | Expected outcome |
|---|---|
| Held root is renamed, old path replaced by a scratch repo | Response remains bound to held repo |
| Held root is renamed, old path replaced by an external symlink | Same binding; never read the replacement |
| Normal macOS temp alias and explicit worktree alias | Existing root semantics preserved |
| Selected nested directory below a repository | Reject as repository-root mismatch |
| Two invocation-owned roots | No cross-root data and no parent cwd change |
| Wrong worker mode, version, descriptor type or operation | Reject before any Git read |
| Object batch, spaces and raw malformed Git path | Preserve framing and existing rejection/no-echo contracts |
| Repository-configured fsmonitor marker helper | Zero helper executions for exact production read operations |
| Marker helper positive control outside discovery | Prove the helper can run, so absence is not a broken canary |
| Stalled child, broken input/output pipe and terminal failure | Bounded failure, owned child reaped, no parent cwd change |

The marker helper is a harmless scratch fixture. Preserve the owner Git wrapper.
Verify primary Git behavior and the exact read operations; do not infer safety
from closed argv alone. The current per-command `core.fsmonitor=false` setting
must remain in the fixed operation owner. This does not authorize clearing the
owner's configuration or scanning an agent home.

## Registration checkpoint

Commit this prediction before the new worker implementation. The first baseline
uses the current pathname transport through the production metadata interface;
the fix then changes the transport only. Root owns this commit and all actual
Cargo jobs. A successful parser/snapshot API checkpoint is retained as separate
evidence, not relabeled as worker or whole-inventory coverage.
