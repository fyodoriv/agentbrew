# Verify the remaining Git guard command cases

The dangerous-command task names creation flags and an explicit commit
hook setting that the opt-in Git wrapper handles. Its previous fixture
does not give each listed form its own decision record.

- **Hypothesis**: The installed-layout fixture refuses all 4 remaining
  direct forms before sending a mutation to Git. The same branch flags
  stay available from verified linked checkouts.
- **Measurement**: Run hosted `bash hooks/checks/git-script-guard.test.sh`
  and `bash hooks/checks/no-destructive-commands.test.sh`. Use the
  existing Git recorder and verify its arguments in a shared checkout
  and in linked checkouts. Keep both existing fixtures and the
  read-only real Git comparison.
- **Success**: All 4 shared or hook override cases refuse, with 0
  Git operations sent for those inputs. All 4 linked and worktree
  controls reach the recorder with the original arguments. Both
  fixtures and the full hosted gates pass.
- **Pivot**: One forwarded guarded operation, one changed allowed
  argument list or one previous fixture regression keeps the task open.
- **Anchor**: The `block-remaining-dangerous-commands` acceptance in
  the [task file before completion](https://github.com/fyodoriv/agentbrew/blob/11308daed01b151be7a54774b933cb0bd6659b0d/TASKS.md),
  the [existing session wrapper](git-script-guard.md) and
  [Git's checkout documentation](https://git-scm.com/docs/git-checkout).

The recorder covers opted-in direct forms. It does not enable the
hooks on this machine or execute a Git mutation.

The named local branch check covers a branch that already exists.
When no local branch exists, Git can guess a branch from a remote-tracking
reference. Review of the registered task identified that separate direct
case. Keep the task open until the remote-tracking case passes as well.
