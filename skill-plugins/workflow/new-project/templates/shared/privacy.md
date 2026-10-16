# Privacy

This repo is safe to push. Personal data never enters git.

## Where data lives

| Data | Location | In git? |
|---|---|---|
| Code, prompts, skills, public knowledge | the repo | yes |
| Synthetic test cases and fixtures | `evals/`, `tests/` | yes |
| Personal data: profile, notes, logs, transcripts, progress | `private/` | no (`.gitignore`) |
| Secrets and API keys | `.env` or the OS keychain | no |

## Rules for agents

1. Read and write personal data only under `private/`. Never copy it into a commit, a test, a log line, an issue, or a PR.
2. Tests and evals use synthetic data only. Put a canary string (for example
   `CANARY-7f3a`) in synthetic fixtures, and add a test that it never shows up
   in logs, `.metrics/`, or any output that leaves the machine.
3. Never send personal data to a hosted model unless `config/models.yaml` (or this doc) allows that route.
4. Back up `private/` outside git: FILL: the backup tool and where it goes (for example an encrypted restic repo). Test a restore once.
