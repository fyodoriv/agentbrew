# Execution practices

Loaded from Phase 4 and Phase 5 of `SKILL.md`. Each bullet comes from a run
that failed without it.

Contents: During execution · Skill discovery and command identity · Gate exit status · Pre-existing failures · Metrics and stale gates · Mid-goal changes

## During execution

- A goal with more than five requirements gets a traceability test: one
  entry per requirement, mapped to the files and tests that meet it. It fails
  when a mapped path is missing, and it is the coverage metric in the contract.
- Never end a turn waiting with nothing armed to wake you (a usage-limit
  window, an agent, a build). Arm a background watchdog first: an until-loop
  on the expected output files with a hard cap (30 min). Give every
  background agent a time box and tell it to write each result file as soon
  as it is done. A watchdog that times out with few files means a stalled
  agent: stop it, keep what it wrote, and relaunch smaller.
- A subagent that stops on a usage limit keeps its work. After the reset,
  resume it with `SendMessage`; do not redo its work or start a new agent.
- Research subagents use web fetch and search only, never browser tools: a
  browser call can hang for hours. Give each fact two fetch attempts, then
  keep it marked unverified with the reason, and save after each file.
- Probe a live tool (Slack, Jira, a browser form) only on a throwaway
  target you own, such as your own self-DM, never on the deliverable. One
  probe saved a "test" draft in a team thread; another attached `t.txt` to
  the real draft.
- While you iterate, run only the related test files. Run the full suite
  once, right before each commit. Run mutation checks as one parallel batch,
  not one by one.
- Before the first e2e run, read its global setup and teardown and its
  web-server config. A delete under the real data folder, or a test server on
  the user's dev-server ports (`reuseExistingServer`), means isolate first: own
  ports, own data dir set by env, and the reset inside the server start
  command (Playwright starts `webServer` before `globalSetup`). One first e2e
  run deleted the live app's real database.
- Before you trust a loop's pass count, read one run's result line. In zsh,
  `"$T[0]"` is a subscript and expands to empty (indexes start at 1), so pytest
  got no path: a 20-run loop of one test ran the whole suite.
- When a task's measurement names one object (a fixture, a generated file) and
  your run makes a new one, say so and measure the new one too. A rerun made a
  new output that the re-applied fix did not cover.
- Right before each commit, re-check the current branch and stage exact file
  paths, never a folder. Another session can switch a shared checkout
  mid-run, and a folder add sweeps in its untracked files.
- After a scripted edit, check that `git diff --stat` shows only the lines
  you meant to change. A script that wrote a different indent turned a
  one-panel change into a diff of thousands of lines.
- Never end a turn only to wait for a background agent. Do independent work,
  or read the code yourself, while it runs.
- Verify every subagent claim you put in a deliverable. Check high-severity
  claims in the code, and drop any claim that fails the check.
- When two subagents or docs contradict each other, settle it from the
  primary source (code at a SHA, the tracker record). List the losing docs
  as stale findings in the deliverable.
- A gate you write yourself is unproven: plant one violation per rule, see it
  fail. A "flaky" step: run it alone and check its CPU time against its limit.
  A new gate that measures time: before you merge it, count its false alarms
  on the path where it will really run (inside the full gate, on a loaded
  machine), not only in a quiet or exclusive slot. One gate had 0 false
  alarms in 5 quiet runs and 2 in 20 on the real path.
- Log each non-obvious decision in one line: what you chose, and why.
- Parallel workers (subagents): give them one shared brief file with the
  delivery rules, unique log names (`$TMPDIR` is shared), and the exact base
  commit (`git rev-parse HEAD` at spawn) with "do not move the base". Keep
  within the user's parallel cap. The cap also counts the review subagent each
  worker spawns before merge: run at most the cap minus one workers, or every
  review spawn is refused and no PR can merge. Watch them for stalls with
  `scripts/stalled-agents.py` (parallel-workers reference). On one machine, the brief also holds the
  heavy-run queue rule from the reference below. When a worker reports, check
  its claims yourself (re-run its metric, look at side effects such as
  LaunchAgents it touched), and stop any background job it left running in
  a removed worktree.
- Running parallel workers or workflows (worktrees, a merge queue, a watch
  loop): read [references/parallel-workers.md](references/parallel-workers.md)
  first. It covers the base commit, the heavy-run queue, messages to running
  agents, session-owned files, merges, stacked PRs, and watch pollers.
- A scheduled or recurring job that runs a repo's code builds from its own
  clean worktree of the default branch (`git worktree add --detach <state
  dir> origin/main`, refreshed each run), never from the user's main
  checkout: another session can leave that checkout mid-merge or on an old
  commit, and the job then runs stale or broken code. Point the job's data
  root at the main checkout with an env var, and prove it by running the
  job's commands from that worktree once.
- When something pops up on the user's screen (a dialog, a window) and you
  trace which process started it, log the process and its parent chain.
  Never kill processes that you or your workers did not start. Killing them
  broke another session's test run and this run's own gate.
- A sandboxed Monitor may not see other processes: check a worker's pid
  with the sandbox off before you restart it. A risky mode that breaks the
  user's own limit is removed, not patched, with a test that it stays gone.
- After a session restart (`/goal continue …`, or workers reported as
  stopped): re-measure from `origin` first, then list every worktree with
  its commits ahead, uncommitted files, and push state. Resume each stopped
  worker with its saved context (`SendMessage` to its id) and give it that
  state; never assume a stopped worker's PR landed.
- After a usage-limit gap, check that each step produced its output, not
  only that it exited 0. A judge step that scored 0 items failed; rerun
  only that step.
- Before you build a task from a queue, search git history for its ID and
  files. A task that already shipped gets its stale block closed with fresh
  evidence, not a second implementation.
- A re-issued `/goal` (for example "continue previous goal") resets the
  contract file, and the edit hook blocks every write until it is saved again.
  Re-print the prior contract in chat (same scope, plus a progress line and
  any criteria added mid-goal), save it, then continue. When workers run,
  save it before any other step: until then the hook blocks their edits too. Do not start a new
  intake or question round for the same goal.
- When you read a third-party app's logs or config for secrets (tokens,
  keys), never print a value, even through a redaction filter. Count or
  test the values in a script that prints only pass/fail. A filter that
  hid strings of 20+ characters leaked 16-character lamp tokens.
- Facts from the web (company processes, API terms, research claims): give
  a research subagent a written file to fill, a rule to open every URL it
  cites, and an "omit what you cannot verify" rule. Run it in parallel with
  the code. Then add a gate step that fails when a claim has no source, so
  later edits cannot drop them.
- A deployed site behind a sign-in (Cloudflare Access, SSO) is still checkable:
  run the same server code locally over the published data, and measure there.
  A test that sets a data-dir variable from `mktemp` must check that `mktemp`
  worked; an empty variable falls back to the real data folder.
- When a goal makes data more durable or more shareable (console to file,
  local to shared store, private to public doc), first list every existing
  writer into that sink. Check each for user text (error messages, request
  bodies, file names) before docs ask anyone to share it, and log errors by
  name or code. One run piped the console to a log that a bug template asked
  users to post, and the old handler logged `err.stack` with request text.
- The pre-merge review prompt asks about every value a user can type or
  import that reaches an external sink (analytics, logs, a shared store).
  A green suite missed a slugified free-text field sent to analytics.
- When a goal keeps source data word for word, store what a tool wrote to
  disk (a saved tool-result file, a CLI's stdout) or the tool's reply copied
  without changes. Never summarize while copying. Give the store a way to
  replace a bad copy, and name the rows copied by hand in the report.

- **Outside judge out of quota:** when the outside judge tool stops (usage limit, sign-in), use another fresh-context reviewer for the same diff. Do not skip the review and do not grade the work yourself. One run's second reviewer found 3 blockers in a script that had 6 green tests and a green full gate.
- **Recount before a cutover:** right before a one-way write that copies a live list (issues, PRs, tasks), count the source again and compare it with your export. In one run 2 new issues arrived between the export and the cutover; the recount caught them and the numbering map was rebuilt.

## Skill discovery and command identity

After an install or refresh can change relevant skills, use only operations
actually exposed to the executing host. Read its current-session discovery,
then inspect the exact skill identity and source. Reconsider original conditional
steps; when availability is evidenced, load the required skill and invoke it
once, then verify its matching result. Repeated discovery does not repeat the
invocation or installation side effect.

Disk presence is not current-session discovery or invocation proof. If discovery
or invocation is unavailable, keep the original criterion unverified and continue
independent authorized work. Never invent a refresh/list API or completion
acknowledgment. Do not create another session, edit native host storage or change
account syncing/privacy to bypass that gap.

For an intended slash command, compare matching live skills and commands.
`agentbrew commands list --json` identifies the exact winning source and expected
target readiness; it does not prove the requested current-session invocation.
Record evidenced collisions or unknown precedence in Assumptions and Risks.
Claude skill precedence is host-specific; do not apply it to Codex or cloud hosts.
Use a real supported route or an authorized source correction, then verify the
requested identity with invocation readback. With no supported route or correction
authority, keep that criterion unverified. Do not delete or rename an owner's
skill, invent a qualified legacy-command name or treat a ready flag as completion.

Keep a literal CLI request's argv unchanged. A matching basename does not justify
blocking that CLI or asking a name-only question. A matching skill does not turn
it into a slash request.

## Gate exit status

Read the gate's own exit status, not a line that a wrapper printed. In
`gate; echo "exit $?"` run in the background, the background task reports
the `echo`, which always succeeds. Use `gate; rc=$?` and print `$rc`
(`status` is read-only in zsh), or read the failure lines in the log, before you trust "passed".
A pipe hides the status too: after `gate | tail -20`, `$?` is the status of
`tail`. Never pipe the gate's own output (`gate | tail`, `gate | tee`) when
its status decides the commit. Run the gate into a log, read `$rc`, and
commit and push only when it is 0:
`log="$(mktemp "${TMPDIR:-/tmp}/gate-<name>.XXXXXX")"; gate > "$log" 2>&1; rc=$?; tail -20 "$log"; echo "gate rc=$rc"; [ "$rc" -eq 0 ] && git commit … && git push`.
When the gate fails, the whole line also exits 1, so a background task reports the failure.
One run piped a failing suite into `tail`, and its commit and push still ran.
A subshell hides it the same way: `( gate > "$log"; echo "rc=$?"; tail "$log" ) && git push` pushes after a failed gate, because the subshell ends with `tail`. Keep `rc` outside the subshell and test it.
A count check such as `grep -c` swaps the gate's 0 and 1: it exits 1 when
the count is 0 (clean) and 0 when it finds a match; an error exits 2. So
never put it in the gate slot above, and never chain the next step on it
with `&&`: a clean check then skips the commit, and a check that finds a
leak lets the commit run. Stage first. Then count matches in the staged
diff, and commit only when the count is exactly 0:
`git add …; n=; d="$(mktemp "${TMPDIR:-/tmp}/staged.XXXXXX")"; git diff --cached > "$d" && n=$(grep -icE -- "${pattern:?}" "$d"); echo "count=$n"; [ "$n" = 0 ] && git commit …`.
Plain `git diff` skips staged and new files. Commit only what is staged: no `-a`, no paths after `git commit`.
A failed `git diff` leaves the count empty, so the commit does not run. An empty count means the check
did not finish (an unset pattern, a grep error, or a diff grep skipped as binary): find the cause first.

## Served output

For a managed-source deployment, retain each strict readback failure and its
actual exit. If the source advanced, do not reset it or call the original
exact-revision check successful. Under the existing source lease, record the
expected revision, actual source revision and pin separately; check source and
pin agreement. For an advance, verify that expected is an ancestor of actual;
inspect the complete intervening delta. Compare installed bytes with source
hashes for every delivered path, and record the scope and qualification of
intervening changes. A descendant alone does not prove installed content or
the whole artifact. Report exact-revision delivery and inspected
content-provenance delivery separately. A backward or divergent revision, pin disagreement or
missing evidence remains unverified for investigation. Never silently accept
an arbitrary descendant, suppress a failure or move a source or pin backward.

When the goal is about what users see (a feed, a page, a report), measure the
served output after the deploy, not only the pipeline's output.

- First find which branch and checkout the deploy job builds from. A merge to
  main may never reach it, for example when a sync job deploys whatever branch
  the main checkout is on. Put the fix on that path without dropping that
  branch's own unshipped commits (cherry-pick, not a branch switch).
- Then fetch the served output and read every entry for wrong content.
  In one run, the plan audit was 100%, but the live calendar feed still had old
  entries with wrong end times, from a path the audit never read.
- For a dashboard or report goal, include a done-criterion that compares at
  least the headline numbers with source-of-truth data: raw events, the source
  channel, or the database. Use the same time window, filters, and counting unit.
  Keep query and filter checks, but "every query runs" is not a correctness check.
  Have an independent judge trace mismatches to source records. If source access
  or required fields are missing, keep the criterion unverified and name the gap.
  Do not invent requester names or change source data to make the totals agree.
- A self-built judge needs calibration first. Fix its false failures and call them
  judge bugs, not product wins. Then have a grader that did not write the code
  check a sample against the source.

## Pre-existing failures

Before you call a failure "pre-existing", run the same test files with the
same flags on the unchanged base (a detached worktree) and compare the two
failure lists. Only a failure on both lists is pre-existing. A wait loop on
a background job must run outside the agent sandbox: `pgrep` and `ps` fail
inside it, so the loop exits at once and looks finished.

When a test fails the gate without your diff, stop retrying: a pass on a
blind rerun proves nothing. Find its root cause and fix it in its own small
PR. Then merge the fix branch into the waiting branch, prove both with one
full gate on that combined tree, and merge the fix PR first.

## Metrics and stale gates

A metric is code too. Before you trust a new counter's numbers or merge
the PR that adds it, give its diff and the metric's definition to a
fresh-context reviewer. One review of a `/work` run counter found 4 real
bugs: a stats call counted as a run, no split at an idle gap, a
lower-middle median, and every Artifact call counted as a publish.

A gate you started before your last edit tests old code. Stop it and
start it again after the edits; never report its result for the new code.

- A gate that fetches a package manager (corepack) fails on DNS in the
  sandbox. Rerun the repo's own gate outside the sandbox, and expect
  `heavy-run` queues of 15 or more jobs.
- `git symbolic-ref HEAD refs/heads/NEW` leaves an unborn branch, so every
  file shows as staged. Follow it with `git reset --soft <base>`.
- Fetch the base branch and diff it against your start point before the
  first edit and again before the PR. One goal built a Python and Rust
  pair while main deleted the Python half; the PR could not merge.
- Run a formatter only on the files you changed (`cargo fmt -- FILE`,
  `ruff format FILE`). A repo-wide run rewrote many untouched files.
- Write logs to the session scratchpad or a `mktemp` name, never a fixed
  `$TMPDIR` name: another session overwrote a shared `$TMPDIR/gate.log` and
  its failure looked like ours; a fixed `$TMPDIR/dry.txt` once showed another
  app's private data in the transcript.
- Clean up your own disk use. Keep goal scratch under
  `~/.local/state/<repo>-goal-YYYY-MM-DD/` or a `mktemp` folder, and delete
  its build output (`node_modules`, `target`, `.venv`) and finished
  checkouts before the final report. Goal runs once left 40 GB of copies
  and Rust targets there and filled the disk; dotfiles'
  `agent-scratch-prune` is only the backstop.
- Append a new row to an ordered golden list; inserting one mid-file
  renumbered every golden after it.
- A retro skill update covered by a standing approval is done in this
  session (worktree, PR, merge), not filed as a task. A memory saying the
  sandbox blocks the repo is a claim: try the write first.

## Mid-goal changes

- A new request from the user mid-goal joins the goal: add it to the
  contract file as a done-criterion, say so in one line, and deliver it in
  this run. A request to drop something works the same way: mark the
  criterion dropped in the contract file, shrink the metric's denominator,
  and stop all work on it.
  A request to remove something also gets a guard test that fails if it
  comes back (code, config and docs). Do not start a separate session for it unless the user asks.
  A new rule mid-goal also covers what you already did in this run: fix
  your past output too (for example, merge your back-to-back replies into
  one).
- A mid-goal answer can change a default the run already used (the
  recommended option of an unanswered question, or an **Assumptions**
  line). Record the answer in the contract file in place of the default,
  and fix any done-criterion or metric built on it. In the same pass,
  update every artifact built on that default: tickets, doc sections,
  drafts, and code. Park an edit that needs fresh approval, as the
  fresh-approval bullet in `SKILL.md` Phase 4 says. Print the goal check line again for
  each criterion the answer touches, with each updated artifact's link or
  path as its evidence. For a criterion with a parked edit, print it as
  `Goal check 2/4 ⏸ <criterion> — parked: <edit>`, then the links of the
  artifacts already updated. It is not done until the edit lands. One run
  filed tickets from its defaults, and then a mid-goal
  answer changed one of those defaults, so the tickets built on it no
  longer matched the answer.
  Bind metric changes with [external-waits.md](external-waits.md): preserve
  the window, denominator, unit, comparator and threshold; print the revised
  criterion for the checker. Native condition synchronization needs a supported
  accepted operation and readback. Otherwise report that binding unverified.

## Hardware, connectors and demo video

- Hardware goal: probe the transport (BLE, classic, USB) and the device's real
  ID (vendor/product ID, the user's own name for it) before you pick a tool,
  for example `system_profiler SPBluetoothDataType`. Match by ID.
- A connector reconnect runs at turn end. Re-check its status next turn before
  you call it fixed.
- Demo video: record the live, signed-in tab with CDP `Page.startScreencast`. A new
  `recordVideo` context loses the session.
- Turn on the app's live refresh first, or the video shows stale state.
- Frames arrive only when the page changes. Rebuild a fixed frame rate and cap
  idle gaps (about 1 s).
- Playwright's bundled ffmpeg has no `concat`/`image2` demuxer and no H.264.
  This works: `cat frames/*.jpg | ffmpeg -f image2pipe -framerate 5 -c:v mjpeg -i pipe:0 -c:v libvpx-vp9 -pix_fmt yuv420p out.webm`.
- Read a few frames from the output before you report the video done.

## Hosted checks

- When hosted checks exist, they are the gate. Wait for every check. Never
  merge on a pending or red one, also with a green local gate.
- A test that fails only on the clean runner has a hidden need: a tool, a
  shell, a config file, or another operating system.
- Read the job log first. `gh api repos/<o>/<r>/actions/jobs/<id>/logs`
  works while the run goes on.
- Reproduce it locally with `env -i` and a minimal `PATH` before a fix.
- The runner also adds things. Read each `env:` block of the workflow (file,
  job and step level) and set every variable in the local run, plus the
  runner's own `CI=true` and `GITHUB_ACTIONS=true`: one `DOTFILES_CI=1` there
  turned off the checks that some doctor tests assert. Use a clean git
  config too (`GIT_CONFIG_GLOBAL=<file with only a name and an email>`,
  `GIT_CONFIG_NOSYSTEM=1`): other tests needed `init.defaultBranch`.
- A blocker you handed to another session is still yours. When its next
  note brings no fix, tell that session you take the blocker back, then read
  the log and reproduce the failure yourself. Tell that session what you
  fixed, so it does not open a second fix.
- A job that fails before your tests start (a package install, a DNS error
  such as `Temporary failure resolving`) is a runner outage, not your change.
  The log proves it: quote the failing step and line. Start the failed job
  again once. If it fails the same way, do not keep waiting: in the same pull
  request, remove the need for the failing service (install the tool from
  its source repo, or add a second registry as a fallback), and say so in
  the body. One goal lost 90 minutes and five runs to a package-server DNS
  outage before two small workflow edits made both gates pass.
- A changed gate still has to pass: the merge waits for the green run of
  the edited workflow. An outage never permits a merge on a red check.
- Never push an empty commit to start a run again. Close and reopen the pull
  request, or push the real fix.
- A test of one operating system's feature runs only there
  (`it.runIf(process.platform === "darwin")`). Never weaken its assertion.

## Proof inputs and decided measurements

- A criterion that promises "real data from this machine" needs inputs this
  machine may not have: a record file that only newer installs write, an
  account or cohort that is old enough, an event that only a fresh install
  sends. Check each input at intake, read-only, before you print the
  contract. For each proof, the contract says which kind it is: real data
  now, a fixture or scratch run, or real data after a named date or event.
  Never create the missing record or send invented events to fill a chart.
  Offer, as a suggestion, a measurement that every install can produce.
  One goal promised six dashboard tiles with real data; this machine had no
  install record and no install was 14 days old, so three tiles stayed empty.
- A measurement with a registered line stops when the verdict is decided.
  When the line is "0 false alarms" and one run is a false alarm, more runs
  cannot change the verdict. Stop it, report the partial counts as measured,
  and apply the registered pivot. This matters most in a shared queue: an
  exclusive timing run holds every other project's work behind it.

## Borrowed sessions and guards the gate skips

- Some proofs read a live store through a borrowed session: a signed-in
  browser tab, a connector, a token that expires. A long goal can lose that
  session before its end. Read each row back and quote it in the chat
  as soon as its data exists, with the time of the read. Probe the session
  again before the last criterion. When it is gone, try each allowed route
  once (another browser the rules allow, the store's own CLI). If none is
  signed in, the read is a human step: say which window to open or where to
  sign in, keep the criterion unverified, and finish every other part. Never
  present rows from an earlier read as the fresh final read, and never sign
  in with a password yourself. One goal left its dashboard read-back for the
  end; by then the browser extension had dropped, and two other browsers
  showed the login page.
- A changed-files gate can skip the guards for the files you changed. Before
  you push a change to a task queue, an agent guide, or a rules file, find
  the repo tests that read that file: `rg -l "<file name>" tests src`. Then
  run them by name. They hold size budgets, allowed field values and
  required fields.
  Then merge the base branch and run them once more, because another
  session's push can break the same guard. In one goal the local gate passed
  three pushes that the hosted check then failed. The causes: an agent guide
  131 bytes over its budget, a task field outside the allowed list, and task
  fields nested one level too deep. Each miss cost a hosted round of 6 to 20
  minutes.
- When you stop a worker, its queued and running jobs stop with it. Before
  you stop one, list its jobs in the shared queue. After, start again each
  job you still need, in the background, or the branch waits on a job that
  no longer exists.
