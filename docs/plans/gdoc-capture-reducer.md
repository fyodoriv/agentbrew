# Google Docs capture reducer preparation

This standalone Rust crate tests capture decisions for [issue #561](https://github.com/fyodoriv/agentbrew/issues/561).
Dotfiles owns browser tabs and leases. The future adapter must use that
owner and its verified close operation. This crate has no browser, CLI,
skill, process, or filesystem wiring.

## Hypothesis and result

Can the capture logic keep ten page images in order and publish a
completion only after verified cleanup? The registered fixture has eight
families and 14 cases. The fail-closed stub compiled and ran all 14 cases.
Thirteen failed and one passed. The reducer passed all 14 with the same
test and lock bytes.

```sh
JOBS=1 CARGO_BUILD_JOBS=1 heavy-run cargo test --locked \
  --manifest-path rust/gdoc-capture/Cargo.toml \
  --test capture_contract -- --test-threads=1
```

Keep at 14/14 passing. Pivot on any missed case, false completion, foreign
operation, or lost recoverable ownership. The two runs used a typed fake
owner and sink. The PNG decoder reads real synthetic PNG bytes. The
overlap test shares an independent target table across two runs.

| Family | Cases |
| --- | ---: |
| Ordered capture and verified close | 1 |
| Capture deadline | 1 |
| Typed interrupt and termination | 2 |
| Operation failure | 1 |
| Overlapping captures | 1 |
| Missing or unqualified owner | 2 |
| Repeated page or invalid image | 3 |
| Unknown close, child, or open identity | 3 |

## Native acceptance remains open

A real adapter must qualify the exact owner executable, prove child
termination with the shared process owner, and enforce private output and
recovery writes. A shell exit or a close HTTP acknowledgment alone cannot
prove those conditions. Use the same owner and target after a confirmed
open. Keep recovery state when close is uncertain. Keep the existing
ten-page live rendering and zero-focus-change acceptance open.

Anchor: Basili, Caldiera and Rombach (1994), Goal Question Metric; Munafò
et al. (2017), preregistration; the [issue preparation](owned-issue-preparation.md#google-docs-capture--issue-561).

## Owner arguments and private output

This slice converts typed operations to exact owner arguments and fixed
synthetic eval input. It checks reviewed owner bytes and exact replies.
The held output port keeps images and recovery in a private run directory.
It publishes a complete manifest with a no-replace rename. There is no
child launch, production URL, browser, or skill wiring.

The Dotfiles owner passed nine disposable cases with network denied.
The Rust wrapper stub passed one case and failed nine. The preparation
passed those ten and the new canonical screenshot symlink control. The
new control caught a mutant that removed only the screenshot file's
no-follow flag. The original 14 reducer cases also passed.

Set `DOTFILES_SOURCE` to a clone with the pinned commit. The wrapper test
reads the owner file without executing it.

```sh
owner_commit=24d7f41f65eb3c542553f41acacc07bf93619b45
scratch="$(mktemp -d)"
git -C "$DOTFILES_SOURCE" archive "$owner_commit" bin/agent-tab |
  tar -xf - -C "$scratch"
GDOC_QUALIFIED_OWNER="$scratch/bin/agent-tab" JOBS=1 CARGO_BUILD_JOBS=1 \
  heavy-run cargo test --locked --manifest-path rust/gdoc-capture/Cargo.toml \
  --test wrapper_contract -- --test-threads=1
```

Keep all 11 wrapper and 14 reducer cases. Pivot on any unsafe read, foreign
write, partial completion, or missed case. Native work still needs owner
provenance through launch, bounded stream reads, child-group proof and a
private child file mode. These tests provide no crash durability, real
process deadline, browser rendering, or focus evidence.
