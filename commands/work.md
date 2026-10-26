---
description: Run the work day with agentbrew: ordered checkups, the machine rule, watch mode, and an end-of-day report
allowed-tools: Bash(agentbrew:*)
---

Run `agentbrew work --json`. If `agentbrew` is not on PATH, run `npx agentbrew work --json`. It reads local files only and changes nothing. It returns:

- `rule`: what you may edit on this machine. Follow it all day.
  - A company machine (a company plugin is installed): edit only the company plugin repos it names. On public repos, open an issue instead of editing.
  - A personal machine: edit the public repos the user works on.
  - On both: every public issue, PR, or comment stays a draft until the user says yes. Show the exact text first.
- `steps`: the steps, as slash commands, back to back (see `flow`). Each step also has `scope` (what it changes; empty means it runs alone), `after` (steps that must finish first), and `longRunning` (a live feed or watcher). agentbrew's own steps come first, then the steps each Agentfile adds with `workSteps:`. Each step has a `path` (the skill or command file it runs) and `userOnly`. When `userOnly` is true, or the Skill tool cannot load the step, read the file at `path` and follow it: starting `/work` is the user's request to run it. `path` is looked up under `~/.claude` (skills, then commands). If it is null, the step was not found there: if your agent keeps skills elsewhere, look there; otherwise say in one line that the step is not installed and go on.
- `stages`: the run order. Run the steps of one stage in parallel, one subagent per step. Wait for the whole stage to finish, then start the next stage. A stage with one step runs in this session. Each subagent saves its user questions and returns them with its result; do not let a subagent ask the user.
- `flow`: run every step and phase back to back. Never stop to ask "continue?". When a step is blocked, report it in one line and go on to the next step.
- `stopOnlyFor`: the only reasons to stop and wait: a merge conflict you cannot resolve, a destructive or public action that needs approval, or a choice only the user can make.
- `questions`: save every other question a step raises (for example a checkup's final questions). End each cycle (after the last step, and after each watch pass) with one batched ask of every item that waits on the user: decisions, drafts to send, sign-ins, approvals. First check that each item is still open (for example, that a draft was not already sent). For each item, say what it is, what each option does, and your pick.
- `watch`: after the last step, keep watching. Re-run a step when its input changes (a new issue, a red check, a new review). Print one line per update. Do not repeat a line that did not change.
- `dashboard`: one page for the whole day.
  - Before the first step, reuse today's page or create it. With an Artifact tool, list your Artifacts; if one is titled `dashboard.title`, update it in place, otherwise publish a new one with that title. With no Artifact tool, write one self-contained HTML file at `dashboard.localPath` (create its folder first) and rewrite that same file on each update.
  - Rows start as `waiting`. Write dates as "Mon Oct 26", never ISO.
  - Publish one row per step from `dashboard.rows`: step, status (`done`, `running`, `waiting`, `blocked`, or `failed`), a one-line summary, needs-you text, and a link.
  - Update a row each time its step changes. Keep the same URL all day.
  - The top of the page shows done, running, and needs-you counts, then a "Needs you" list. Put the saved questions (see `questions`) there too.
  - Give the user the link once, at the start.
- `endOfDay`: when the user says "end of day", stop every loop you started, run the end-of-day step, then draft a Today / Tomorrow report: what was done (with PRs and numbers), what is blocked and why, and what comes next. Link the day's dashboard in it.

Before the first step, tell the user in two lines: which kind of machine this is, and the steps you will run.

To add steps for a team, add them to an Agentfile, for example the company overlay's:

```yaml
workSteps:
  - /tooling-checkup
  - /oncall-checkup
  - step: /career-checkup
    scope: ~/apps/career        # what it changes; steps with no overlap run in parallel
    after: /tooling-checkup     # wait for this step first
  - step: /live-feed
    scope: ~/apps/feed
    longRunning: true           # a watcher: starts after every other step
```

A step with no `scope:` runs alone, which is the safe default. Write each scope as an absolute or `~` path, or a service name such as `github.com`.

Then run `agentbrew sync`. Do not copy this command to change it. If the user does not want built-in commands, run `agentbrew config set builtinCommands off`.
