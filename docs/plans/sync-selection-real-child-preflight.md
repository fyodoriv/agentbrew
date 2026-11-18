# Check physical files for rejected CLI selections

The hosted import observer qualified early refusal for invalid inputs.
Qualify the real bundled CLI on a disposable Linux runner. Use test-owned
empty workspaces and two independent synthetic homes. Never start a real
agent session or use local machine files.

- **Hypothesis**: Both invalid CLI forms return 1 before changing startup,
  state, event or marketplace files.
- **Measurement**: Build the exact candidate with `npm run build` on the
  pinned hosted Node version. Record its build revision and bundle digest.
  Run the built CLI for explicit empty pull and plain unknown selection.
  Drop to the runner user in a fresh network namespace. Use a fixed environment
  and a preflight canary that proves the fixture intercepts subprocesses.
  Compare the entire scratch tree by relative path, kind, mode, link target,
  regular-file SHA-256 and modification time. Read output privately and
  print only fixed status and count fields.
- **Success**: Both fresh cases exit 1, show the valid-module hint, print
  zero rejected input markers, make zero subprocess attempts and produce
  zero scratch-tree changes. The deliberate subprocess canary records
  exactly one denied attempt without launching its target.
- **Pivot**: A missing namespace, unqualified build or inadequate canary
  leaves the experiment incomplete. Any output disclosure or file change
  rejects the candidate's physical-file result.
- **Anchor**: The frozen sync selection handoff, prior timestamp mutation,
  and the imported-boundary regression under PR #1075.

The programmatic update and valid selected native facets remain separate.

## Direct update child

- **Hypothesis**: A fresh Node child that calls the real update API with an
  explicit empty selection returns 1 before it touches any fixture file.
- **Measurement**: Use the same isolated physical command. Run the real
  update source through the lockfile-pinned TypeScript loader in a third
  synthetic home. Start every case with an explicit empty telemetry key.
  Include the actual marketplace directory and read all receipts.
- **Success**: The direct update child returns 1, shows the valid-module
  hint, and reports zero changed entries or subprocess attempts. Both
  CLI controls and the blocked canary repeat their existing outcomes.
- **Pivot**: A wrong runtime, changed scratch entry, missing receipt,
  missing diagnostic or subprocess attempt leaves the result incomplete.
- **Anchor**: The original emptyAPI observation and the passing
  built CLI scratch run 44226441932.

### Loader cache control

The first direct update child exited 1 with the expected hint and zero
subprocess attempts, but changed 122 scratch entries. That did not
qualify. The pinned TypeScript loader has a transform cache under the
invocation's temporary directory. The earlier two built CLI cases still
passed. See hosted run 44227921686.

- **Hypothesis**: Disable the loader's transform cache and verify that
  importing a TypeScript-only no-op writes zero scratch entries. Then
  the direct update should leave the entire tree unchanged.
- **Measurement**: Set the pinned loader's supported TSX_DISABLE_CACHE
  switch in the clean synthetic environment. Before the direct update,
  run a TypeScript syntax control in its own home through that same
  runtime. Require an exact success marker, 0 changed entries and 0
  subprocess attempts. Keep all original file and output assertions.
- **Success**: The loader control and all three real input fixtures
  leave zero scratch changes. All original command results hold.
- **Pivot**: A loader control that does not execute or writes any entry
  does not admit the direct update proof.
- **Anchor**: The pinned loader source and physical run 44227921686.
