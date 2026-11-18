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
compatibility tests, and type checking. The macOS control also
has a required qualification job. The
[real cross-tool run](https://github.com/fyodoriv/agentbrew/actions/runs/44253654456)
used merged Dotfiles #754 and passed the lock, release, row and
inode checks.
