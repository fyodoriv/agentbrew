# Guard recursive forced deletion outside scratch

The `block-remaining-dangerous-commands` task already has Git and npm
controls. This phase extends its existing opt-in Bash hook.

- **Hypothesis**: The guard can refuse direct recursive forced deletion
  outside a verified temporary folder while allowing the registered
  temporary-directory example.
- **Measurement**: Run hosted `bash hooks/checks/no-destructive-commands.test.sh`.
  Submit inert command text to the installed-layout hook. Use actual
  disposable paths, a file link, a fake deletion tool and isolated
  environment values. Compare each expected decision and command receipt.
- **Success**: At least 8 refused fixtures and 4 allowed fixtures pass.
  Both flags are required to activate this phase. The existing Git,
  GitHub and npm decisions pass, and 0 deletion invocations reach the tool.
- **Pivot**: At least 1 unsafe allow, 1 safe temporary path refusal,
  1 deletion execution or 1 prior guard regression rejects the change.
- **Anchor**: The task's temporary-directory acceptance case and the
  existing leading-command guard.

Recognize the first direct executable and ordinary short or long force
and recursion flags. Check every operand. Allow strict descendants of
verified public temporary bases or an owned session scratch directory.
Reject the root, relative paths, traversal and link components below
the root. Accept the precise unquoted temporary-variable example only
after verifying the configured temporary base. Do not evaluate a shell
expansion. The file observation qualifies this accidental-damage check
for the registered shape and its named operand. It does not inspect
the full descendant tree or establish a mount boundary through it.
The temporary-variable fixture shares one inherited value with the
hook. An absolute operand remains independent of later shell settings.
Broader shell and concurrent path changes remain outside this phase.

The [hosted baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44907152424/job/136855065739)
allowed all nine unsafe controls. The five allowed controls and the
prior guards passed. No deletion invocation left the fixture.
