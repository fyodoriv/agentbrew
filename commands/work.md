---
description: Run the work day with agentbrew: ordered checkups, the machine rule, watch mode, and an end-of-day report
allowed-tools: Bash(agentbrew:*)
---

Run `agentbrew work --json`. If `agentbrew` is not on PATH, run `npx agentbrew work --json`. It reads local files only and changes nothing. It returns:

- `rule`: what you may edit on this machine. Follow it all day.
  - A company machine (a company plugin is installed): edit only the company plugin repos it names. On public repos, open an issue instead of editing.
  - A personal machine: edit the public repos the user works on.
  - On both: every public issue, PR, or comment stays a draft until the user says yes. Show the exact text first.
- `steps`: run them in this order, one at a time, as slash commands. agentbrew's own steps come first, then the steps each Agentfile adds with `workSteps:`. If a step is not installed, say so in one line and go on.
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
