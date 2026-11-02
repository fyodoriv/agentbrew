---
description: Detect this project's gate, run it, and report fresh evidence
---

# Verify this project

Read the project's AGENTS.md, package scripts and CI configuration before
running anything. Print the project type and exact gate selected. Prefer its
own documented gate (`verify`, `check`, `lint:ci`, `make check`, a gate script)
over a bare linter or a guessed list of commands. Never install tools or alter
source just to make verification green without the user's task authorizing it.

## Select the gate

Use existing files and the lockfile to choose the package manager. Check
files with `rg --files --hidden -g '<quoted pattern>'` (or a quoted `find`
pattern); never expand `.eslintrc*` as an unquoted zsh glob.

- Node.js / TypeScript: use the declared repo gate. Without one, inspect the
  `test`, `check`, `lint`, `typecheck` scripts and run relevant existing scripts.
  Use `tsc --build` only when the repo's TypeScript setup supports build mode;
  do not guess it for a no-emit project.
- Makefile: use documented `make check` when that target exists.
- Rust: use the repo gate, otherwise `cargo check` and `cargo test`.
- Go: use the repo gate, otherwise `go vet ./...` and `go test ./...`.
- Python with `tox.ini`: inspect the configured env names and use
  `tox -e lint,<test env>`; its lint env can include formatting and types.
- An unsupported or ambiguous project: name the missing gate; do not report
  success without executing a relevant check.

Run each heavy step as its own `heavy-run <command>` call where available;
never combine a full suite and a linter in a compound shell command. Start a
potentially queued run in the background and wait for its real exit status.
Use `yarn <script>` on Yarn 2+, never `yarn -s <script>`.

## Trust the result

Save the gate output outside the repo. Read `rc=$?` from the gate itself;
never take a pipe or a trailing echo's success as the gate result. Report
command, exit code and the relevant pass or failure lines. Mark anything
not run explicitly. A failing gate is not a passing verification.

In a multi-repo change, verify every changed worktree and report each repo.
Reuse a full run only when no changed input is newer than its log and its
commit and environment still match. Do not switch branches beneath a running
gate. Use a separate detached worktree for baseline comparisons, including
untracked files in the changed-state inventory. Do not stash or delete the
user's files to manufacture a clean base.

Before calling a failure pre-existing, run the same gate with the same flags
in a detached worktree of `origin/<default>` and compare sorted error lists.
Re-run one failing network-bound test alone before classifying it; a passing
retry does not erase an unexplained failure. Read actual CI logs first.

A fresh worktree may lack `.husky/_/`. Use the documented install/bootstrap
step, or copy generated hook support from a verified compatible checkout;
never use `--no-verify` or disable hooks.
