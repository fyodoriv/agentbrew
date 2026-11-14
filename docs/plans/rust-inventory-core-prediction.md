# Shared inventory core prediction

Registered before implementation on 2026-11-14 for the `rust-source-inventory`
tasks in agentbrew and dotfiles. The existing draft combines discovery, process
supervision, and validation in a large implementation.

**Hypothesis:** A small reusable Rust library can compare independently observed
component identities with a reviewed manifest and reject missing, duplicate,
unowned, or unclassified components without running source code. The same
comparison applies to file, embedded-program, and generated-output identities.

**Measurement:** Hosted CI builds the offline crate and runs focused controls for
valid input and planted omissions, duplicates, invalid states, and missing owner
or caller information.

**Success:** Every planted invalid manifest is rejected, the valid manifest
passes, and the crate adds no third-party dependencies. **Pivot:** If an omitted
identity can pass, fix the comparison before any adapter uses it.

This is a validation core, not source discovery or a complete inventory. The
repository adapters must independently find executable and generated identities,
and their completeness must be tested before either inventory task is done.

**Anchor:** the two `rust-source-inventory` tasks; Basili, Caldiera, Rombach
1994; Munafò et al. 2017.
