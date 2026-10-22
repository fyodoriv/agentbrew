---
name: report-upstream
description: >
  Offer to report a problem or an improvement idea in a tool you are using
  (agentbrew, dotfiles, careerbrew, or any repo with a "Report problems and
  ideas" section in its CONTRIBUTING.md) as an issue on that tool's own repo,
  safely: scrub private details, show the exact text, post only after the
  person says yes, and offer a fix PR only after a second yes. Use when such a
  tool fails, surprises you, has a wrong or missing doc, or could clearly work
  better, or when the person says "report this", "file an issue upstream", or
  "tell the author". Don't use for bugs in the person's own project code.
---

# Report upstream

The authors of these tools want to hear about every problem and every idea.
Fyodor, the author of agentbrew, dotfiles, and careerbrew, reads every report
and is glad to get it. A short, safe report from a real user is the most
useful contribution there is. So when a tool lets you down, offer to report it.

## When to offer

Offer once per distinct finding, at a natural pause (after the current step,
not in the middle of it):

- a command of the tool failed, hung, or printed something wrong;
- the tool did something the docs did not say, or the docs are wrong or missing;
- you had to work around the tool;
- you see a clear, small improvement.

Do not offer when:

- `~/.config/agentbrew/upstream-feedback.off` exists (the person ran
  `agentbrew report --off`), or the person said no to reports in this session;
- the finding is in the person's own code, not in the tool;
- nobody is at the keyboard (scheduled or `claude -p` runs): save the draft
  with `agentbrew report` (no `--yes`) and mention its path in the run report.

## Which repo

| Tool | Repo |
|---|---|
| agentbrew (CLI, built-in skills, hooks, rules) | `fyodoriv/agentbrew` |
| dotfiles (shell, `dotfiles` command, LaunchAgents) | `fyodoriv/dotfiles` |
| careerbrew | `fyodoriv/careerbrew` |
| a skill installed by agentbrew | its source repo (`agentbrew status --verbose`) |
| a fork or clone you work in | its upstream (`agentbrew report` finds it) |

When the signed-in GitHub account owns that repo, do not open an issue: add a
task to the repo's own task queue (`TASKS.md` or its tracker) instead.

## Steps

1. **Draft** the issue in a Markdown file: what you ran, what you expected,
   what happened (the error line), the tool version (`agentbrew --version`,
   `git -C <repo> rev-parse --short HEAD`), and a suggested fix if you have
   one. Keep it short. Leave out the person's own project details.
2. **Scrub and preview**:
   `agentbrew report --title "<title>" --body-file <draft.md> --repo <owner/name>`.
   It replaces home paths, user names, emails, tokens and keys, IP addresses,
   internal host names, and the person's private leak-gate patterns with
   placeholders. Then it re-scans the result, lists similar issues, prints the
   exact final text, and saves the draft. It posts nothing.
   Without agentbrew: do the same by hand and show the result.
3. **Ask** in one message, with the full context: the safety checklist, the
   exact title and body, any similar issue, and the question "Post this issue
   to github.com/<owner/name>? It is public. (yes / edit / no)". Say that the
   author welcomes it. If a similar issue exists, offer a comment there instead.
4. **Post only on a clear yes**: run the same command with `--yes`. On "edit",
   change the draft and go back to step 2. On "no", drop it and do not offer
   again for this finding.
5. **Offer a fix PR** after posting, only if the fix looks small: "Want me to
   make a PR that fixes it?" Only on a second yes: branch, fix, run the repo's
   gate, then `agentbrew contribute` (it forks for you). Link the issue in the
   PR body.

## Safety rules

- Never post, comment, or open a PR without the person's yes for that action.
- Never paste secrets, tokens, customer data, private repo names, or the
  person's file contents into a report, even scrubbed.
- If the re-scan reports anything left (`✗`), edit the draft; never post it.
- One report per finding. Never batch-post or retry a refused report.
