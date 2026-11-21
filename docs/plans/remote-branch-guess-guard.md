# Stop remote branch guessing in a shared checkout

Git can create a local branch from a matching remote-tracking
reference. A direct branch name in a shared checkout needs the same
protection whether or not the local branch already exists.

- **Hypothesis**: A direct namespaced branch request cannot create a
  local branch from a remote-tracking reference in a shared checkout.
  Git can still use a linked checkout or restore a named file.
- **Measurement**: Run hosted `bash hooks/checks/git-script-guard.test.sh`.
  Use a disposable real Git repository with prewritten remote-tracking
  references and no live remote. Add three separate requests for
  checkout, checkout with a trailing option terminator, and switch.
  Compare HEAD and local refs before and after each call.
- **Success**: All 3 requests refuse in the shared checkout, with 0
  changed HEAD or local refs. One linked branch use and both ordinary
  file controls pass. Existing recorder and read-only cases pass.
- **Pivot**: At least 1 unintended branch creation, HEAD change, file
  refusal, linked checkout refusal or external call rejects the change.
- **Anchor**: The task's namespaced branch case,
  [Git checkout disambiguation](https://git-scm.com/docs/git-checkout#_argument_disambiguation),
  and the [local branch guard](named-branch-checkout-guard.md).

The fixture sets remote-tracking references locally. It never contacts
a remote or uses a real user checkout. A file control covers the
ordinary existing-file shorthand. A missing file can be named with
`git checkout -- path`.

The [hosted baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44913804389)
created all three local branches and returned exit 0 on Linux and macOS.
The linked and file controls passed. The previous guard forwarded a missing local ref.
The wrapper now checks for a linked checkout when the request could
guess a branch. It uses Git's effective worktree and prefix for the
existing-file shorthand. This observes the filesystem at check time.
Git can still prefer a tag over an identically named file. Use the
explicit file syntax when the intended operation is a file checkout.
