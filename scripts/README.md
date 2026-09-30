# Maintenance Scripts

## Sanitizing Historical Agent Attribution

`sanitize-history.sh` and `sanitize-open-prs.sh` remove historical
tool-specific agent attribution from commit messages and pull request bodies.
They are intentionally dry-run by default.

Both scripts source the same attribution regex library as the global git and
GitHub wrappers:

```bash
~/apps/dotfiles/lib/strip-agent-attribution.sh
```

Set `AGENT_ATTRIBUTION_LIB=/path/to/strip-agent-attribution.sh` to test against
a fixture or another checkout. Do not copy the regex into these scripts; the
shared library is the source of truth.

### Commit Message History

Preview a repo:

```bash
scripts/sanitize-history.sh --repo ~/apps/agentbrew --preview
```

The preview prints matching commit counts, matching line counts, sample commit
subjects, and a sample before/after message diff.

Apply only in a disposable or freshly cloned repo:

```bash
scripts/sanitize-history.sh \
  --repo ~/apps/agentbrew \
  --apply \
  --confirm-repo agentbrew
```

`--apply` requires:

- `git-filter-repo` on `PATH`
- a clean working tree
- `--confirm-repo <directory-name>`

The script rewrites commit SHAs but never pushes. Force-pushing rewritten
history is a public write and requires explicit per-repo approval in the current
session. If branch protection rejects the push, follow the
[branch-protection override procedure](#branch-protection-override-procedure)
instead of bypassing hooks or retrying blindly. Use `--force` only for
disposable clones where `git-filter-repo`'s fresh-clone guard is expected to
fire.

### Open Pull Request Bodies

Preview open pull requests:

```bash
scripts/sanitize-open-prs.sh \
  --repo <your-ghe-host>/<your-org>/agentbrew \
  --preview
```

Apply after explicit approval:

```bash
scripts/sanitize-open-prs.sh \
  --repo <your-ghe-host>/<your-org>/agentbrew \
  --apply \
  --confirm-repo <your-ghe-host>/<your-org>/agentbrew \
  --confirm-public-write
```

`--apply` calls `gh pr edit --body-file` for matching open pull requests.
Editing pull request bodies is a public write; get approval for the exact repo
and run before using it.

### Branch Protection Override Procedure

This repo does not automate protected-branch overrides. When a sanitized history
needs to replace a protected branch:

1. Run `scripts/sanitize-history.sh --preview` after the rewrite and save the
   zero-match output.
2. Run the target repo's full verification suite on the rewritten branch.
3. Ask a repo admin for one explicit approval covering the exact
   `git push --force-with-lease <remote> <branch>` command.
4. If admin override is unavailable, stop and use a rename-main or archive-old-
   main plan reviewed by the repo owner.

Never use `--no-verify`, `--force`, or direct protected-branch pushes without
that current-session approval.

## Hook Observation Gate

`hook-observation.sh` reports how the deterministic hooks in `hooks/manifest.yaml`
have behaved over a trailing window, reading the runtime decision log that
`hooks/lib/log-decision.sh` writes to `~/.cache/agentbrew/hook-decisions.jsonl`.

```bash
scripts/hook-observation.sh [--since DAYS] [--log PATH] [--manifest PATH] [--strict]
```

It classifies each manifest hook over the window:

- **enforced** — logged ≥1 `block`/`warn`/`mutate` decision (the hook caught real
  violations).
- **ran-no-enforce** — saw matching tool calls (`allow`/`bypass`) but never
  enforced — a suspect matcher or detection bug. **Fails the gate** (exit 1).
- **no-opportunity** — zero decisions at all (no matching tool call in the
  window): a rare trigger, or the hook isn't wired. Informational by default;
  `--strict` makes it fail too.

This is the empirical proof a hook is catching violations, and the precondition
check Phase 3 (`hooks-phase-3-decommission-rules`) runs before deleting a rule
from `shared-rules.md` — never remove a prose rule whose hook isn't `enforced`.
Exit 0 = every hook that had an opportunity enforced at least once.
