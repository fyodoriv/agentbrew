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
- **The goal grants someone access**: read your own rights first (for a
  GitHub repo, `permissions.admin`). Find the person's account, but invite
  only after the operator confirms it. Without admin rights, write a short
  BLOCKED report: who can grant access, and what the person can already do.
