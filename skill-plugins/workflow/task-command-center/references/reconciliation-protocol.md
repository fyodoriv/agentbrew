# Product-doc, PR, and Jira reconciliation

Use this protocol whenever a shared product Google Doc is mirrored into a docs
PR and a Jira epic with child tasks. Run the complete loop on every refresh.

## 1. Read all authoritative inputs

Before writing:

1. Read every relevant Google Doc tab as structured content.
2. Read all unresolved and resolved comments; record comment IDs, quoted
   anchors, authors, and timestamps. Do not resolve or reply.
3. Read the docs PR body, comments, current files, and latest commit.
4. Read the Jira epic and every direct child, including descriptions, fields,
   links, and comments.
5. Update `LINKS.md` and record the read set in `SYNC-STATUS.md`.

Do not treat a markdown export as proof of Google Docs formatting. Delegate all
GDoc edits and verification to `markdown-for-gdoc`.

## 2. Build a source ledger

For each requirement, record:

- stable requirement ID or concise name;
- exact source quote;
- full source URL;
- Google Doc tab and heading or anchored comment ID;
- Jira key when Jira already owns the requirement;
- whether the source is product authority or engineering evidence;
- conflicts and superseding revisions.

Prefer citations that survive edits: full Google Doc URLs with tab identifiers,
heading names, comment IDs, Jira issue URLs, and immutable commit URLs. Do not
cite local paths or volatile line numbers in published Jira descriptions.

If two product sources conflict, preserve both citations and stop that
requirement's write. Do not choose a winner from implementation evidence.

## 3. Separate durable product from changing engineering

### Product contract (immutable)

Include only:

- product outcome and target user;
- user-visible behavior;
- acceptance criteria;
- boundaries and explicit out-of-scope behavior;
- source citations.

Treat this section as immutable between product-source revisions. A new comment,
PR implementation, or technical discovery cannot silently change it. When a
cited product authority explicitly revises the requirement, update the section
and add a short revision note naming the superseded citation.

### Engineering guidance (dynamic)

Include:

- current architecture and ownership;
- likely repos, packages, components, and files;
- sequencing and dependencies;
- open technical decisions and risks;
- test, observability, rollout, and validation guidance;
- last reconciliation date.

This section may change as code and decisions evolve. Never present it as a
product promise.

## 4. Use the Jira description contract

Every epic child description follows this shape:

```markdown
## Product contract (immutable)

**Outcome**
...

**User-visible behavior**
...

**Acceptance criteria**
- ...

**Boundaries**
- ...

**Source citations**
- [Product source — tab, heading](https://...)
- [Comment ID 123456 — exact clarification](https://...)

---

## Engineering guidance (dynamic)

**Current approach**
...

**Likely change surface**
- ...

**Dependencies and open decisions**
- ...

**Validation**
- ...

**Last reconciled**
YYYY-MM-DD
```

Jira fields and issue links own the parent, epic, initiative, issue type,
status, assignee, estimate, priority, sprint, and linked-development metadata.
Do not copy those values into descriptions. Do not include PR state, branch
state, or another transient delivery-status snapshot in the description.

The epic description is the durable initiative charter and aggregate product
cut line. Children contain independently testable product contracts. Do not
copy implementation detail into the epic's product scope.

Use Jira fields or dated comments for status, assignee, lane, scheduling,
deferral, and delivery snapshots. Do not rewrite descriptions for transient
project state.

### Scope consolidation and value order

- When related tickets describe one requested delivery, choose one canonical
  issue. Link and close redundant issues as duplicates.
- A user-requested single PR is a delivery boundary. Do not create a PR chain
  or companion tickets unless a proven repository constraint requires them.
- Treat explicit non-goals as excluded from scope, acceptance criteria, risks,
  and validation. End-to-end tests, dependency or import cleanup, host
  onboarding, context-parameter work, and unrelated event work are not
  default follow-on scope.
- Preserve existing working integrations unless the requested behavior needs to
  change. Do not describe an already-working path as missing work.
- Put required, highest-value behavior first. Optional cleanup belongs in a
  later task only when it becomes valuable enough to request.

## 5. Apply updates in dependency order

1. Update the command-center requirement mirror and source ledger.
2. Update dynamic architecture and plan documents.
3. Update `SYNC-STATUS.md` with source drift and unresolved conflicts.
4. Update the docs PR files and body. Its requirement checklist covers that PR
   only; Jira owns epic-wide tracking.
5. Apply surgical Google Doc edits using `markdown-for-gdoc`.
6. Update the Jira epic, then each direct child using the two-section contract.

Do not post or resolve GDoc comments. Do not add Jira comments unless the user
approved that exact communication or a standing rule explicitly permits it.

## 6. Verify every destination

After writes:

1. GDoc: `docs_get_structured` on edited ranges, then visually inspect the live
   doc. Repeat until styles, lists, links, and spacing are correct.
2. PR: re-read the rendered body and changed files; verify citations resolve.
3. Jira: re-fetch the epic and every child. Assert each child has exactly one
   `Product contract (immutable)` section, one `Engineering guidance (dynamic)`
   section, a separator, and source citations.
4. Cross-check requirement IDs and acceptance criteria across all three
   destinations.
5. Record verified post-state and remaining drift in `SYNC-STATUS.md`.

Never claim reconciliation is complete from successful write responses alone.
