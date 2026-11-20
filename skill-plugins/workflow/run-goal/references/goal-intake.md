# Shape a messy goal

Use this in Phase 1 when the goal text is long, dictated, full of typos, or
vague. Without it, the agent takes a rambling request literally, starts on the
wrong thing, and asks questions the files could answer.

## 1. Understand before you ask

- Read for intent, not wording. Fix typos and dictation errors silently.
- Pull out four things: the **outcome** (what is true when done), **why** it
  matters, the **constraints**, and any **side asks** mixed in. A side ask is
  not part of this goal: park it (step 4) or file it as its own task.
- Look things up before you ask: the repo, memory, and the user's task
  tracker. The pieces of a goal often already exist as scattered tasks.
- When the text holds a chain of connected decisions ("but first I need to
  know..."), name the chain and say what comes first. The upstream step is
  the goal. The downstream steps become chunks or parked items.
- Follow-up messages refine the same goal. Only an unrelated topic is a new
  goal.
- A goal can arrive in two parts. `/goal` refuses a condition over 4,000
  characters, so the user may set a short goal ("based on prompts I'll share
  now") and paste the full request in a message before or after it. Treat
  that pasted request as the goal text: copy it verbatim and build the
  contract from it, not from the short condition. Do not ask the user to
  shorten it.

## 2. Push back

Say it plainly, with a recommendation, when:

- A tool, skill, or simpler route already does this.
- The scope is too big for one goal. Propose the first goal and park the rest.
- A part is a nice-to-have that will not change the result. Suggest dropping it.
- The goal cannot be checked ("make it better"). Propose a concrete end state.
- It conflicts with an existing rule, plan, or open question.

## 3. Chunk the work

- Each chunk fits in one sitting (about 15 to 60 minutes) and has one check.
- The riskiest or most uncertain chunk goes first.
- The chunks become the Phase 4 task list. Parked items go under **Out of
  scope** in the contract.

## 4. Fold it into the contract

Write the result straight into the Phase 2 contract. Do not print a second,
separate goal summary. Add two lines to it:

```
**Chunks:** 1. <small step> — check: <how we know it worked> ...
**Parked for later:** <split-off ideas, if any>
```

## Shorthand goals

`/goal deliver` (also "deliver it", "ship and prove it") is a full goal. It
means: take this session's work from where it stands to proven and live, in
whatever repo, app, or machine the session is in. Expand it into the
contract with these criteria. Do not ask what "deliver" means.

1. **Related work, listed.** Find what this session created: its commits,
   branches, worktrees, uncommitted files, and PRs, plus PRs opened by
   sessions it started. Name each one in the contract with its URL or path.
   Another author's PR is out of scope: deliver never merges, closes, or
   force-pushes work this session did not create.
2. **Green and reviewed.** Every related PR passes its hosted checks at its
   current head. A fresh-context reviewer reads each diff before merge. Read
   the log of a failed check before you fix it.
3. **Merged.** Merge each PR the way the repo's delivery rules say, under a
   cited approval (repo `AGENTS.md`, the user's standing rules), with every
   required review approved. Never bypass a check, also on an outage. Without
   an approval, park the merge and ask once at the end; if nothing else is
   left, write the BLOCKED report.
4. **Live in the final environment.** Find where users meet the work from the
   repo docs (install, deploy, or sync sections). A local install step those
   docs name runs as part of delivery: `agentbrew sync` for skills and rules,
   `dotfiles apply` for machine config. A deploy to a shared or production
   target, a publish, or a release needs a cited approval; without one, park
   it. Then read the live state back: installed files byte-equal to the
   merged source, the loaded service, the served page.
5. **Proved there.** Use the delivered thing where users meet it, on real
   input, with the baseline taken before the merge: run the installed script,
   start a fresh agent session that sees the skill, open the live URL.
6. **Shown and explained.** Publish a report with a before/after table, and
   explain in plain words what changed for the user.

The metric is the before/after number from step 5. Pick it and take its
baseline before the first merge.

## Special cases

- **The goal is only the user's own work** (no agent work in it): do not arm
  the goal checker. Offer to put the chunks in their task tracker instead.
- **"Revert to what it used to be"**: read the backup or snapshot from before
  the change first. Restore those exact values, and print them next to the
  live ones. Memory of the old state is not evidence: a backup once showed
  that a setting the agent thought was off had been on.
- **The user is away** ("work while I sleep"): ask nothing. Pick work that
  needs no input and has a real reference to test against. List the rest as
  "needs you" in a summary that takes about five minutes to read.
- **The goal links sources** ("parse all links in this message"): resolve each
  one before the contract. Follow short links to the final URL, read docs and
  slides through a connector (not a sign-in page), and diff a local clone
  against its upstream (it may be a stale fork). List each source in the
  contract with what it gave.
- **The goal integrates an existing service**: search authorized projects and
  their current docs for a working client first. Cite the source and the
  documented route before choosing a new transport. Keep its consent and
  credential checks. When deployment needs the owner, cite the source for the
  remaining step and report the unverified outcome.
- **The goal asks for current readiness**: read the authorized system of record
  and record the read time. Report the observed tier and the requested target
  separately. Derive the gaps from the live checks for the target tier. Give
  an independent reviewer the same authorized capture and ask them to verify
  each gap. If the current source cannot be read, keep readiness unverified.
- **The goal grants someone access**: read your own rights first (for a
  GitHub repo, `permissions.admin`). Find the person's account, but invite
  only after the operator confirms it. Without admin rights, write a short
  BLOCKED report: who can grant access, and what the person can already do.

## Host authentication intake

Before the contract, identify each Git host the goal must fetch from and check
the authentication path the fetch will actually use. For GitHub CLI hosts,
check stored login with token environment overrides removed, including
`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, and
`GITHUB_ENTERPRISE_TOKEN`. Check the effective credential separately.
For example, run `env -u GH_TOKEN -u GITHUB_TOKEN -u GH_ENTERPRISE_TOKEN -u
GITHUB_ENTERPRISE_TOKEN gh auth status -h <host>` for stored login. Do not
pass `--show-token` or enable shell tracing.

If an environment token overrides a stored token, compare them only in private
process memory. Report match, mismatch, absence or unavailable, not either
value. Never put tokens in logs, chat or untrusted destinations; authorized
authentication may transmit them to the intended host. A mismatch alone does
not prove either token invalid.

Report stored-login failures separately. Put a human re-login in the contract
only when the actual authorized fetch route needs it. If a stale override
wins, identify its source and correct or remove it as authorized; recheck the
effective fetch route after repair. Do not ask a verified healthy host to
re-login even if an unused stored login fails. If a probe is unavailable,
mark that route unknown.
