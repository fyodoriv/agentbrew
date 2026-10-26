---
description: Run the work day with agentbrew: ordered checkups, the machine rule, watch mode, and an end-of-day report
allowed-tools: Bash(agentbrew:*)
---

Run `agentbrew work --json`. If `agentbrew` is not on PATH, run `npx agentbrew work --json`. It reads local files only and changes nothing. It returns:

- `rule`: what you may edit on this machine. Follow it all day.
  - A company machine (a company plugin is installed): edit only the company plugin repos it names. On public repos, open an issue instead of editing.
  - A personal machine: edit the public repos the user works on.
  - On both: every public issue, PR, or comment stays a draft until the user says yes. Show the exact text first.
- `steps`: run them in this order, as slash commands, back to back (see `flow`). agentbrew's own steps come first, then the steps each Agentfile adds with `workSteps:`. Each step has a `path` (the skill or command file it runs) and `userOnly`. When `userOnly` is true, or the Skill tool cannot load the step, read the file at `path` and follow it: starting `/work` is the user's request to run it. `path` is looked up under `~/.claude` (skills, then commands). If it is null, the step was not found there: if your agent keeps skills elsewhere, look there; otherwise say in one line that the step is not installed and go on.
- `flow`: run every step and phase back to back. Never stop to ask "continue?". When a step is blocked, report it in one line and go on to the next step.
- `stopOnlyFor`: the only reasons to stop and wait: a merge conflict you cannot resolve, a destructive or public action that needs approval, or a choice only the user can make.
- `questions`: save every other question a step raises (for example a checkup's final questions). Ask them all once, after the last step.
- `watch`: after the last step, keep watching. Re-run a step when its input changes (a new issue, a red check, a new review). Print one line per update. Do not repeat a line that did not change.
- `endOfDay`: when the user says "end of day", stop every loop you started, run the end-of-day step, then draft a Today / Tomorrow report: what was done (with PRs and numbers), what is blocked and why, and what comes next.

Before the first step, tell the user in two lines: which kind of machine this is, and the steps you will run.

To add steps for a team, add them to an Agentfile, for example the company overlay's:

```yaml
workSteps:
  - /tooling-checkup
  - /oncall-checkup
```

Then run `agentbrew sync`. Do not copy this command to change it. If the user does not want built-in commands, run `agentbrew config set builtinCommands off`.
