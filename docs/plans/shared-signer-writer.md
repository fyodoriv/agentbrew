# Coordinate Agentbrew signer writes with Dotfiles

Dotfiles now holds an adjacent registry lock during trust and revoke.
Agentbrew also writes the registry. Give its two writer commands the
same kernel-lock convention on macOS and Linux. Each command must
retain unrelated rows and the existing file mode. Commands on other
platforms keep their existing path. The native publisher does not
adopt this lock through this change.

- **Hypothesis**: A competing Dotfiles writer causes both Agentbrew
  registry commands to return exit 75 before changing the file. The
  commands can write after release. Existing trusted rows, policy
  comments, and unrelated principals survive.
- **Measurement**: Run the signer writer controls on macOS and Linux
  against a synthetic registry and an independently held descriptor.
  Repeat with the real Dotfiles executable from the merged signer-lock
  change. Check the CLI exit code, registry bytes, mode, and lock inode.
  Exercise the legacy path on Windows.
- **Success**: Two blocked writes leave the file unchanged, two free
  writes succeed, and all other rows and the lock identity remain
  unchanged. A stale native publisher record does not block revocation.
- **Pivot**: An admitted competing write, lost signer row, changed
  registry mode, broken legacy path, or blocked emergency revocation
  rejects the candidate.
- **Anchor**: Dotfiles #754 and the cross-tool scratch descriptor proof
  from Agentbrew run 44245169949.

The [baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44253279319)
reproduced a successful write under contention and loss of
unrelated policy text. The Windows compatibility case passed.
The [candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44253525489)
passed the focused Linux and Windows jobs, the Linux lifecycle
compatibility tests, and type checking. Its Linux and Windows evidence is retained. The latest candidate
carries the macOS control. The
[real cross-tool run](https://github.com/fyodoriv/agentbrew/actions/runs/44253654456)
used merged Dotfiles #754 and passed the lock, release, row and
inode checks.

## Match valid rows with mixed whitespace

Independent review found that the registry parser preserves the
space between a key type and its value when returning a signer.
Trust and revoke compare that result to a canonical one-space key.

- **Hypothesis**: A row with tabs and multiple spaces names the
  same signer as a one-space CLI argument.
- **Measurement**: Run trust, list and revoke against a mixed-space
  row. Compare file bytes after an idempotent trust and after revoke.
- **Success**: Trust leaves every byte unchanged, list reports one
  canonical key and revoke removes just that row.
- **Pivot**: A duplicate row, a false refusal, or changed unrelated
  bytes rejects the parser.
- **Anchor**: Dotfiles' field-based registry parser and the
  independent review of Agentbrew's key normalization.

A row with `namespaces` followed by validity restrictions also
matches the Dotfiles writer. Trust must leave that row unchanged.
Revoke may remove the exact row. The Agentbrew signature verifier
must not read restricted rows as unrestricted trust. The restricted
control fails qualification on a duplicate row, an accepted broad
trust entry, or a lost unrelated field.

## Refuse changed registry state before replacement

- **Hypothesis**: If a registry changes while Agentbrew stages a
  replacement, trust refuses and leaves the newer contents in place.
- **Measurement**: Use a synchronous synthetic filesystem observation
  at the staging boundary. Record the changed registry, error result
  and whether another registry or its permissions moved.
- **Success**: The changed file remains byte-for-byte intact and
  the write refuses. All five existing signer controls still pass.
- **Pivot**: A staged older view replaces the newer file, the lock
  inode changes, or an unrelated row moves.
- **Anchor**: The no-follow observation and pre-replace check in
  Dotfiles' signer writer.

This check lasts through the final pre-rename review. The lock
coordinates cooperating writers.

The [row baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44254414525)
wrote a duplicate row for each of two valid formats. The
[candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44254590961)
passed both row controls on Linux and Windows. The
[staging baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44254806781)
overwrote a newer synthetic observation. The
[final hosted candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44255087314)
passed the Linux staging and lock tests and the Windows signer tests.
The [final cross-tool run](https://github.com/fyodoriv/agentbrew/actions/runs/44255581643)
passed against the merged Dotfiles command.
