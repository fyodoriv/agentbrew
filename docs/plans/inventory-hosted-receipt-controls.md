# Hosted inventory receipt controls

Registered before changing CI on 2026-11-11. The general hosted gate runs
`npm run verify`; it does not run the nine Rust owner-success receipt tests.
The user asked to rely on hosted CI for the full gate. These are pure format
controls; they do not qualify a worker or permit a physical observation.

Hypothesis: a separate hosted job on Linux and macOS can fetch the locked
crate dependencies, then run the exact nine named receipt tests offline with
no skipped tests and no worker launch. It must expose a failure as a failed
check rather than silently skip it.

Measurement: check out the PR tree without persisted credentials, install the
crate's declared Rust 1.97 toolchain, fetch the committed lockfile, then run
`cargo test --locked --offline --manifest-path rust/Cargo.toml --test owner_success_receipt -- --test-threads=1`.
Capture only the test transcript. Check all nine registered names appear once
as passing and the summary reports 9 passed, 0 failed and 0 ignored. Run on
both hosted operating systems. Existing verify and private-reference gates
remain unchanged.

Success: both hosted jobs report exactly nine passing controls, zero skipped
or failed, and no process-worker test is selected. The workflow has read-only
repository permissions and does not print environment, credentials or raw
user data. Pivot: a missing toolchain, dependency, test or ambiguous transcript
is inconclusive; fix the hosted setup or keep the draft open. A general green
CI result cannot replace these checks or establish worker ownership.

Anchor: draft #767, `owner-success-receipt-810.md`, issue #810; Basili,
Caldiera and Rombach 1994 (GQM); Munafò et al. 2017 (pre-registration).
