# Draft judge

The agent that wrote a draft cannot check it: its own mistakes pass. Before
any draft that will be posted as the user (a PR review, a chat message, a DM,
a thread reply, an issue or PR comment) is shown to the user, send it to a
fresh subagent judge. The judge has not seen the reasoning behind the draft.

## Judge input

- The whole draft, word for word.
- The source facts it relies on: for a review, the PR state, checks, and the
  diff hunks each comment points at; for a message, the thread or ticket data
  and the member list of the target conversation.
- The checks below.

## Checks

1. Every person the draft asks is a member of the target conversation. A
   non-member is named in plain text with "I'll ping them directly", and the
   ask goes to them in its own message.
2. Every ticket, PR, and issue id is a link with the id as its label, for
   example `[ABC-123](https://tracker.example.com/browse/ABC-123)`.
3. Every fact matches the source data. Nothing is assumed: "X is the assignee
   and the ticket is closed" does not mean "X closed it".
4. It says who it is for and what each person must do, or that no action is
   needed.
5. Reviews only: each finding sits under its severity heading, and a finding
   with no `Failure scenario:` line is not worded as a proven bug.

6. A review ask has a functional judge PASS for every stated feature at the
   current head. Reject a missing feature verdict, missing proof, or any FAIL.
   If the optional human-review or audience-order rule is enabled, the user
   has confirmed the required check or proof page before this draft is saved.

7. When the optional chat-merge-recent-message rule applies, reject an edit if
   a reader already acted on the original. Also reject an edit for a nudge or
   follow-up on a later calendar day in the user's timezone, even within
   24 hours. Check the original timestamp and reader activity in the source.
   The new message still follows the existing send approval rules.

## Judge answer

The first line is `APPROVED` or `REJECTED`. Any other first line counts as
`REJECTED`. After `REJECTED`, one line per failed check: the check number, the
quoted text, and the fix. Fix the draft and judge it again. Show or post the
draft only after `APPROVED`.

- After 3 `REJECTED` rounds, stop. Tell the user which checks still failed
  and hold the draft.
- Any change to an approved draft (the user's edit, a new run after the head
  moved) needs a new judge round before it is posted.
