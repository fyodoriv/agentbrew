# Guard direct GitHub deletion and administrator merges

This phase of `block-remaining-dangerous-commands` extends the existing
opt-in Bash check. It handles a leading direct GitHub CLI command with
literal command words. The check reads command text and never executes it.

- **Hypothesis:** The check will refuse all 7 registered direct GitHub
  deletion and administrator merge cases before execution. The old check
  permits them. All 11 registered safe GitHub cases and 17 existing Git
  checks keep their expected decisions.
- **Measurement:** Run `bash hooks/checks/no-destructive-commands.test.sh github` and the
  existing fixture without arguments. Use a GitHub CLI recorder and
  synthetic owner, repository, and PR names.
- **Success:** Refuse 7 of 7 unsafe cases, allow 11 of 11 safe cases,
  preserve 17 of 17 existing decisions, and execute zero Git or GitHub
  CLI commands.
- **Pivot:** Stop if 1 safe case is blocked, 1 unsafe case is allowed,
  any existing result changes, or a tested executable is invoked.
  Leave shell expansions, wrappers, later commands, and other tools for
  separate evidence.
- **Anchor:** [GitHub CLI admin merge](https://cli.github.com/manual/gh_pr_merge),
  [repository deletion](https://cli.github.com/manual/gh_repo_delete),
  and the `block-remaining-dangerous-commands` task.

| Refuse | Allow |
| --- | --- |
| Direct repository deletion | Repository view |
| Deletion without an explicit repository | Repository list with deletion words in a value |
| Explicit executable path and quote-joined deletion words | PR merge with squash |
| Administrator flag after PR argument | PR merge with an explicit false flag |
| Explicit true flag before PR argument | PR merge with administrator spelling in body value |
| Administrative merge with target before the subcommand options end | PR merge with administrator spelling in inline body value |
| Escape-joined administrative flag | Administrator spelling after the option terminator |
| | Deletion words printed as prose |
| | Event for a different tool |
| | Command after a shell separator |
| | Comment containing administrator spelling |

## Review follow-up

The first candidate passed the registered fixture. Review found that GitHub
CLI accepts groups of short options and inherited repository selection
before the command name. A shell output path can also look like an option.
Expand the fixture before revising the parser.

- **Hypothesis:** The revised guard handles 7 additional controls for short option groups, inherited repository selection, and shell redirection.
- **Measurement:** Run `bash hooks/checks/no-destructive-commands.test.sh github` with the added cases and run the full fixture again.
- **Success:** 7 of 7 review cases pass and all 35 prior decisions stay exact, with zero executable calls.
- **Pivot:** Reject on 1 false allow in the covered direct command forms, 1 false block, or 1 command execution.
- **Anchor:** [GitHub CLI inherited options](https://cli.github.com/manual/gh_pr_merge) and [pflag short option syntax](https://github.com/spf13/pflag/blob/master/README.md#command-line-flag-syntax).

| Refuse | Allow |
| --- | --- |
| Repository selection before `pr` | Short options with an administrator spelling used as a body value |
| Repository selection between `pr` and `merge` | An unquoted shell output redirection with an option-like filename |
| A quoted redirection character in a body and an actual administrator flag | Short options with an attached body value |
| | An administrator flag turned off by a later literal false value |

Keep actual shell redirections outside the GitHub CLI command coverage.
A quoted or escaped redirection character stays part of the argument.

## Read-only help and combined redirection

- **Hypothesis:** Treat combined output redirections like other shell redirections and recognize help only when GitHub CLI receives it as an option.
- **Measurement:** Run `bash hooks/checks/no-destructive-commands.test.sh github` with the five controls below, followed by the full fixture.
- **Success:** Preserve 42 existing decisions and pass all 5 additions. Execute 0 Git or GitHub CLI commands.
- **Pivot:** Stop on 1 changed prior decision, 1 false block, or 1 covered operation incorrectly allowed.
- **Anchor:** [Bash redirections](https://www.gnu.org/software/bash/manual/html_node/Redirections.html) and [GitHub CLI help](https://cli.github.com/manual/gh_help_reference).

Allow both combined-output redirect operators, repo delete help and PR
merge help. Refuse an administrator merge whose body contains the literal
help spelling.
