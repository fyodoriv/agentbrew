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
