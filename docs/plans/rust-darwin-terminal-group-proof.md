# Bounded Darwin terminal-group proof experiment

The worker and Cargo commands below describe the active Rust implementation
draft, not shipped default-branch code. This registers the platform experiment
before its source patch, dependencies or runtime behavior change.

## Evidence ledger

| Claim | Source | Status |
| --- | --- | --- |
| The successful test command is followed by group-signal EPERM and worker failure | Frozen lifecycle diagnostic receipts | fact |
| Group EPERM can also mean a live denied member | Inspected primary XNU signal source | fact |
| The published safe libproc list API allocates a queried count before a caller cap | Pinned published package source | fact |
| A fixed-cap PID-identity query can establish only the reserved terminal leader remains | Proposed adapter and controls | proposed |
| The inspected kernel source matches an installed supported host | Version/source qualification and native controls | verify |

## Source ownership and dependency route

The temporary upstream copy is `rust/vendor/libproc-0.14.11`. Its MIT notice,
archive checksum, unmodified-source manifest and exact patch are part of the
review. Classify unmodified upstream code separately from the owned safe API
patch; do not exempt the whole vendor folder from inventory. Never edit the
shared Cargo registry. No upstream issue, comment or fork publication is
authorized by this registration.

Use a Darwin-only path dependency from the application manifest, with exact
package version `=0.14.11` and path `vendor/libproc-0.14.11`. The application
adapter is proposed at `rust/src/darwin_group.rs`; the existing worker remains
the sole owner of its child and cleanup deadline. There is no runtime registry,
selector or environment override for proof outcomes.

The safe API exposes only the group and a bounded capacity; the application
always supplies exactly two slots. Reject invalid or overflowing capacity
before allocation or FFI. Preserve the existing upstream unsafe blocks, and
show their unchanged content independently of the safe wrapper diff. No new
application unsafe code or guessed raw binding is allowed.

Before activating an exhaustion proof, qualify the supported Darwin boundary
against versioned kernel/source evidence and actual-host controls. Inspected
mutable main content hashes alone do not qualify an installed kernel. An
unsupported or unverified host remains non-green; do not silently generalize
from one machine or treat a test-only forced result as production capability.

## Overall goal and vision

Preserve normal metadata success and bounded cleanup without accepting a denied
signal to a live group. This is a platform adapter for the registered worker
lifecycle experiment, not production migration or whole-inventory completion.

The measured worker reports a successful terminal leader, no cancellation and
an idle control endpoint, then a group-signal EPERM. Normal success fails at
TERM; the held-output case delivers TERM and fails at KILL after descendants
exit. This is a return-status failure, not a 30-second deadline violation.

XNU `killpg1` excludes SZOMB entries from group iteration, then returns EPERM when
no signalable live entry remains. A group with only its unreaped leader can
therefore return EPERM. A live denied member can produce the same error. EPERM,
stdout EOF and a same-UID assumption cannot prove safe retirement.

## Hypothesis, measurement and decision

**Goal:** retain the original successful metadata results with zero leftover
owned group members, foreign signals or caller-policy changes.

**Question:** can a bounded, complete, group-filtered PID-identity query prove
that an EPERM group contains only the reserved terminal leader?

**Metric and success:** 100% expected decisions in the controls below; zero
false empty-group decisions, live owned leftovers or signals after lease loss.
Normal success must remain success. The 30-second total and 2-second cancellation
bounds, ESRCH absence oracles and registered resource-validity predicates stay
unchanged. Any valid violation rejects this adapter; invalid timing is explicitly
inconclusive and non-green. Do not relax bounds or interpret expected errors as
successful metadata results.

**Measurement:** keep the registered exclusive command unchanged:

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run --exclusive cargo test --locked --manifest-path rust/Cargo.toml --lib --test snapshot --test lifecycle -- --test-threads=1
```

**Pivot:** any false empty-group decision, denied-live success, released-identity
signal or valid deadline violation abandons this adapter. Preparation-only
instrumentation and synthetic adapter checks do not count as lifecycle success.

**Anchors:** Basili, Caldiera and Rombach (1994), GQM; Munafò et al. (2017),
preregistration; POSIX kill/wait ownership; the source-backed XNU visibility and
execution-transition contracts below.

## Kernel visibility contract: PID identities

Primary sources:
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c
  `killpg1`: excludes SZOMB group entries and derives EPERM from nfound.
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/proc_info.c
  `proc_listpids`: checks whole-query permission, filters exact p_pgrpid under
  proc_list_lock, visits allproc and zombproc, and skips proc_is_shadow entries.
- https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_exec.c
  the execution transition swaps PID-hash membership and old/new shadow flags
  while holding the SAME proc_list_lock.

Completeness refers to PID identities, not every temporary proc structure.
The shadow filter must not be described as an unfiltered proc-structure walk.
The execution swap keeps one non-shadow representation of the PID identity
visible to the locked group query. Actual self-exec descendant controls remain
required; do not use this source argument as runtime acceptance by itself.

The inspected source-content SHA256 receipts are:
- kern_sig.c: 343742eb42c5b584c529d348f9772ce03ffedd3be9d986badd60692459b6acdf
- proc_info.c: 557092f14fbad3341100f59e0391d2e812c54b79a7404c89b2af97471ad67082
- kern_exec.c: 89531d33618b8361064236189212c3c96be1b32e098690b17802b6b15d932d1a

These content receipts identify the reviewed source; mutable main URLs are not
version receipts. The relevant execution-swap code in this inspected file is at
proc_list_lock, phash_replace_locked and transfer of P_REF_SHADOW.

Use only group member PID numbers. Do not request names, argv, paths, users,
BSDInfo records, all-PID results, home data or process payloads. A denied whole
query remains an error. Host handlers, masks and resource settings stay unchanged.

## Reserved leader and exhausted-group decision

On Darwin, after EPERM, accept an exhausted group only when all are true:

1. The specific leader is exclusively owned and unreaped. WNOWAIT reports its
   terminal status; that reserved PID is this invocation's PGID.
2. A complete kernel-filtered result for this PGID contains exactly that leader
   PID and no other PID identity, whether live or zombie.
3. WNOWAIT ownership is valid again after the query. Reap only after final signal
   or proof decisions. ECHILD invalidates ownership; never signal the old number.
4. Every query, retry, final signal, reap and pipe action stays inside the original
   cleanup deadline and absolute operation deadline.

An extra member, zero or wrong PID, missing leader, query or permission failure,
full or malformed buffer, unsupported operation or lease loss is non-green.
Do not derive an empty group from stdout EOF or UID equality.

## Fixed two-slot bound

Only two PID slots, exactly eight bytes, are needed. The proof asks whether the
reserved leader is the only member. Enforce this cap BEFORE allocation and FFI.
Never query a kernel-sized count and allocate it first.

A returned byte count must be nonnegative, aligned to a PID word and at most the
provided eight bytes. A full two-slot buffer is NOT complete, even if exactly two
members exist. A complete singleton is accepted only if it equals the reserved
terminal leader. Zero, wrong PID, duplicate or full results remain non-green.
No capacity growth, all-process fallback or per-PID name/status query is allowed.

Allow at most 200 probes at 10 ms spacing, stopping sooner at the original
cleanup deadline. These are proposed resource limits, not another timer. A
remaining zombie can disappear during ordinary cleanup; retry only inside the
same lease and existing 2-second/30-second budgets. Proof failure must not start
an extra cleanup period.

## Exact published upstream source and build inputs

Select published libproc 0.14.11, not mutable master:
- Archive: https://static.crates.io/crates/libproc/libproc-0.14.11.crate
- Published index: https://index.crates.io/li/bp/libproc
- Archive SHA256, verified against the exact version's index checksum:
  a54ad7278b8bc5301d5ffd2a94251c004feb971feba96c971ea4063645990757
- License: MIT. Preserve its LICENSE and copyright text with any source copy.
- LICENSE SHA256: 96476b7db2b7185d597311f4cb25091dfbfe75ad8197562e4bff72d797bb331c
- Published Cargo.toml SHA256:
  7ff7688557b994022c4819809c4ed2526bc09d48074b328b25445bd0e283efae
- Published Cargo.toml.orig SHA256:
  bc6e4dccfadb58622fbe7467aacd20d3ac730cf59a7030430279fc84936f12bc
- Published build.rs SHA256:
  4588201d84f707ea117e31e19e89559f0eba8ef4d6a16456d671bec7f248ff26
- Published src/libproc/sys/macos.rs SHA256:
  035dc35e6d988cd9e36000ac7aff6e0f763e7b86278aae1c9e38fefabfcc1be4

The published manifest declares Rust 1.72, edition 2018, errno ^0.3.14, libc
^0.2.176 and build-time bindgen ^0.72.1, default features off, runtime feature on.
Its Linux/Redox/Android development dependencies are procfs ^0.18.0 and tempfile
^3.3.0; they are not needed by the Darwin application adapter. Mutable master
has since changed build inputs; it is not used as the package receipt.

On macOS the published build script uses bindgen's RustTarget::stable(72, 0),
Rust edition 2018, disabled layout tests, `#include <libproc.h>`, and clang args
`-x c++ -I /Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/`.
It writes osx_libproc_bindings.rs only under Cargo OUT_DIR. Capture the exact
resolved bindgen/transitive checksums in Cargo.lock and the selected compiler,
libclang and SDK/header receipts before the first build. No arbitrary toolchain
or dependency install is authorized by this proposal. Missing build inputs are
inconclusive, not a reason to silently substitute mutable source or bindings.

## Bounded safe upstream API patch

The existing safe pids_by_type API is NOT acceptable as-is: it queries a count
then allocates that count before a caller cap can run. Prepare an isolated patch
to the pinned upstream source behind a Darwin-only application adapter.

Do not add application unsafe code or a new unsafe FFI block. Keep the existing
upstream count-query and data-query FFI blocks byte-for-byte. Move the existing
data-query block into one shared private helper. The legacy count-query path
calls that helper unchanged; a new safe bounded group-list path checks its cap
and calls the helper directly, without running the count query. Add safe count,
alignment and capacity validation before the unchanged upstream set_len block.

The narrow new safe API returns PID numbers plus explicit completeness. The
application passes a held positive PGID and exactly two slots. Expose no raw
pointer, generic native symbol, configurable utility or callback. Preserve
license and unmodified-source receipts. Never edit the shared Cargo registry.

Vendoring adds review surface and bindgen build inputs. Register its exact path,
source patch and dependency route before implementation. Keep upstream FFI
provenance auditable and replace the patch with an upstream-maintained bounded
API when available. No issue, comment, fork push or public contribution is
published by this plan. The ps alternative is not selected or approved.

## Registered controls to add

Keep all existing native, source, snapshot and lifecycle controls unchanged.
Before the behavior fix, validate the bounded API itself: zero/overflow cap
rejected before allocation/FFI; full/oversized/misaligned returns non-complete or
error; query failure non-complete; singleton result complete. Synthetic adapter
checks are necessary but insufficient.

Actual shared-supervisor controls:
- Normal terminal-only group: native complete singleton proof; success preserved.
- Held-output descendant: real group cleanup and PID absence within original bound.
- Live group with planted EPERM: failure remains; never retire it as exhausted.
- Actual descendant self-exec transitions: the closed Cargo fixture execs only
  its own compiled artifact, retains the PID across at least one confirmed exec,
  and brackets native group queries while it is live. The held terminal leader
  stays reserved. No complete singleton decision is allowed while that child
  remains alive. Record only numeric exec/query counts and PID-liveness outcomes.
  Do not claim a userspace barrier forces a kernel-internal interleaving.
- Empty, wrong, missing, extra-live, extra-zombie, duplicate, full, truncated,
  malformed and failed query results: all non-green.
- Lease loss before or after query: no old numeric PGID signal.
- Planted blanket-EPERM-success mutation: must fail the live-member control.
- Query/cleanup exhaustion: original deadline unchanged, no later drain.

All fixture operations remain closed. Production uses native decisions; no
runtime environment or CLI can force query outcomes, signal denial or a mutant.
Registration of this exact plan must precede source patch, dependency or runtime
implementation. Native acceptance still requires the full lifecycle experiment.


## Numbered work breakdown

### 1. Prepare and prove the bounded upstream API

- **Why:** the existing safe API cannot enforce the application cap before
  allocation; a malformed or partial list must not prove exhaustion.
- **Parallelism:** after registration; independent of reviewed-source registry
  work, with one owner for shared Cargo and worker files.
- **Owner/change:** pinned upstream source, safe bounded wrapper, provenance
  receipts and API controls. No supervisor EPERM behavior change yet.
- **Acceptance:** fixed-cap and malformed-result controls pass; original FFI
  blocks and license match their source receipts; no unreviewed build inputs
  or old dependency-version/checksum changes. Missing SDK/libclang is an
  inconclusive preparation failure, not permission to install a toolchain.
- **Verification:** source/patch comparison, narrow locked dependency resolution
  and bounded API controls. Proposed application unit command:
  `JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked --manifest-path rust/Cargo.toml --lib darwin_group -- --test-threads=1`.

### 2. Add the held-leader proof behind the worker boundary

- **Why:** preserve the measured successful command result without accepting a
  permission error for a live or unknown group.
- **Parallelism:** depends on step 1 and source review; actor state remains
  local to one worker invocation and its reserved leader.
- **Owner/change:** Darwin adapter and existing signal-error path only.
- **Acceptance:** both currently failing success controls become successful;
  denied-live, query failure, missing/extra PID and lease-loss controls remain
  non-green. All retries and Drop paths share the original cleanup deadline;
  no per-signal or per-retry deadline is restarted.
- **Verification:** the identical registered exclusive lifecycle command above,
  with unchanged thresholds, validity and process-absence oracles.

### 3. Validate native behavior and retain remaining acceptance

- **Why:** synthetic parsing and source inspection do not prove native group
  visibility, exec transitions or complete worker lifecycle behavior.
- **Parallelism:** after step 2; platform proof stays separate from inventory
  parser and full-repository classification work.
- **Owner/change:** closed Cargo fixture and exact platform/toolchain receipts.
- **Acceptance:** real native singleton, live/exec descendant and denied-query
  controls match their registered outcomes. Every original snapshot, lifecycle,
  inheritance, race, cancellation and unsupported-waitability obligation remains
  required. A focused success is not full lifecycle or inventory acceptance.
- **Verification:** frozen-source native controls, actual exits and output,
  outside review, then the normal repository delivery gate.

## Rollout and rollback

Register first, validate the bounded API next, then measure the worker change.
Keep both normal-success failures and every prior diagnostic receipt. Retain
explicit non-green behavior for failed proof and unsupported platforms.
Rollback removes this adapter and preserves the original refusal; it never
reinterprets EPERM as unconditional success or removes the owned-child oracle.

The temporary upstream patch has a deletion condition: replace it with a
reviewed upstream-maintained bounded API when available. That requires a new
locked-source comparison and the same native controls, not an automatic update.
