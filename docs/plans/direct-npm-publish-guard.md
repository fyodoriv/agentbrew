# Guard direct npm publication

The existing optional Bash hook already checks Git and GitHub commands.
This phase adds the leading literal `npm publish` command from the
`block-remaining-dangerous-commands` task. The owner uses the documented
release command and 2FA in a real terminal.

- **Hypothesis:** The optional hook refuses 5 of 5 registered direct publish forms and preserves supported package inspection and existing hook decisions.
- **Measurement:** Run `bash hooks/checks/no-destructive-commands.test.sh npm` and the full deployed fixture with inert Git, GitHub CLI and npm recorders.
- **Success:** Refuse all 5 protected forms, allow all 8 inspection or unrelated forms, preserve all 47 old decisions, and execute 0 recorded tools.
- **Pivot:** Stop on 1 wrong decision or 1 recorded tool effective invocation.
- **Anchor:** [npm publish](https://docs.npmjs.com/cli/commands/npm-publish), [npm pack](https://docs.npmjs.com/cli/commands/npm-pack), and the repository release procedure in `docs/ci.md`.

| Refuse | Allow |
| --- | --- |
| Direct publish | Package dry-run preview using pack |
| Direct publish of a tarball with a tag | Package help through the help command |
| Explicit executable path and adjacent quoted word segments | Package version inspection |
| Escape within a direct publish command word | Literal prose containing the publish command |
| Direct publish with a dry-run option | An unrelated npm script named publish |
| | A named npm script that documents the owner release path |
| | An event for a different agent tool |
| | A later command in the shell input |

Apply this policy to literal leading words before shell expansion. Use
`npm pack --dry-run` to preview the package from the agent. Keep aliases,
options before the subcommand, wrappers and later commands outside this
phase. The fixture uses synthetic text and never publishes a package.

## Keep the npm screen independent

- **Hypothesis:** Separating npm-only text matches from the GitHub parser preserves normal commands whose multiline values mention npm publishing.
- **Measurement:** Run `bash hooks/checks/no-destructive-commands.test.sh npm` with the 2 review controls, then run the full fixture.
- **Success:** Allow both multiline inputs, preserve the 60 previous decisions, and execute 0 Git, GitHub or npm commands.
- **Pivot:** Stop on 1 wrong decision or 1 tool call.
- **Anchor:** The prior [direct GitHub guard registration](github-destructive-command-guard.md) and the [GitHub CLI merge body argument](https://cli.github.com/manual/gh_pr_merge).

The new controls pass a multiline body to an ordinary GitHub CLI merge
and a multiline message to an ordinary Git command. Each includes the
literal phrase `npm publish` before the first newline in the quote.
