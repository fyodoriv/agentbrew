# Keep the readiness target when a command writes literal text

The end-of-turn PR readiness hook can interpret inert merge text as
new PR activity. When a real PR command appears earlier, this can also
clear its known target and replace the status check with a warning.
The separate proposed pre-merge hook is outside this change.

- **Hypothesis**: Five narrow kinds of literal prose do not start or
  replace a PR status check. A real preceding PR with a failed check
  still blocks. A real, unsupported shell operation still warns.
- **Measurement**: Run `bash hooks/checks/a-pr-is-not-ready.test.sh`
  against five fixed prose shapes: echo, printf, git commit message,
  standalone quoted heredoc, and quoted heredoc to a text file.
  Test each alone and after a real PR command. Do not execute the
  command samples. Stub all GitHub calls.
- **Success**: Five of five prose shapes produce no PR target alone.
  All five preserve the real PR target, with zero wrong API lookups.
  A real failing PR still blocks and unsupported shell syntax retains
  the existing warning behavior.
- **Pivot**: Any simulated executable suffix, active substitution,
  unquoted heredoc, real command or parser failure treated as prose
  rejects this change. Keep the recognized shell syntax narrow.
- **Anchor**: [issue #1090](https://github.com/fyodoriv/agentbrew/issues/1090),
  the checked-in PR readiness tests, and the Bash manual on heredocs.
