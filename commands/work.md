---
description: Run the work day with agentbrew: ordered checkups, the machine rule, watch mode, and an end-of-day report
allowed-tools: Bash(agentbrew:*)
---

Run `agentbrew work --json` (`npx agentbrew work --json` when `agentbrew` is not on PATH). It reads local files only and changes nothing. Its text fields are your instructions; this file adds only what they leave out.

Before the first step, tell the user in two lines: the kind of machine (`machine`) and the steps you will run.

- `rule`: follow it all day. Every public issue, PR, or comment stays a draft until the user says yes; show the exact text first.
- `stages`: run them in order. Run a stage's steps in parallel, one subagent per step; wait for the whole stage to finish, then start the next. A one-step stage runs in this session. A subagent never asks the user: it returns its questions with its result.
- `steps`: run each one with the Skill tool. When `userOnly` is true or the Skill tool cannot load it, read the file at `path` and follow it (starting `/work` is the user's request to run it). `path` is looked up under `~/.claude` (skills, then commands); when it is null, look where your agent keeps skills, or say in one line that the step is not installed and go on.
- `flow`: back to back. When a step is blocked, say so in one line and go on to the next step. Stop only for `stopOnlyFor`.
- `questions`: end each cycle (after the last step, and after each watch pass) with one batched ask. Check that each item is still open first.
- `watch`: to notice changes, arm a Monitor on the `watch-issues` skill's `scripts/watch-repos.sh <interval> owner/repo@branch...`. It prints one line when a branch head moves or an issue or PR is updated. Do not repeat a line that did not change. Follow `repoWatch.how` and, after the last step and on each pass, `pluginReview.how`.
- `dashboard`: one page for the day, at the same URL all day. With an Artifact tool, list your Artifacts: if one has the `dashboard.title` title, update it in place, otherwise publish it. With none, write one self-contained HTML file at `dashboard.localPath`. Each row of `dashboard.rows`: step, status, a one-line summary, needs-you text, and a link. Write dates as "Mon Oct 26". The top: done, running, and needs-you counts, then a "Needs you" list with the saved questions. Follow `dashboard.publish` for when to write each copy; `dashboard.statusPath` takes `{ "title", "rows", "questions" }` (the `/work` pane reads it). Create the folders first. Give the user the link once, at the start.
- `endOfDay`: when the user says "end of day", stop every loop you started and run it. The report says what was done (PRs, numbers), what is blocked and why, and what comes next. Link the day's dashboard in it.

Team steps go in an Agentfile's `workSteps:` (`scope:`, `after:`, `longRunning:`; README, "Work day"), then `agentbrew sync`. Do not copy this command to change it; `agentbrew config set builtinCommands off` turns built-in commands off.
