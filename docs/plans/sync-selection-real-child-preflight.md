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
