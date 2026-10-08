---
name: to-issues
description: >
  Convert a plan, spec, or PRD into independently-grabbable tasks or GitHub
  issues using vertical slices. Classifies each as AFK (agent-executable) or
  HITL (human required). Use after /spec or /plan to produce actionable work.
argument-hint: "[plan or spec to decompose]"
---

# To Issues

## What this produces

A dependency-ordered list of tasks where each task is:
- **Independently completable** — no implicit shared state with concurrent tasks
- **Classified**: AFK (agent can execute without human input) or HITL (requires human)
- **Durable**: no file paths, no line numbers — only domain behavior descriptions

## Task Backend

Detect the repo's task backend by checking for `.tasksmd.json` at the git root. If it declares `backend: github-issues`, file tasks as GitHub Issues via `tasks create`. Otherwise, append to TASKS.md as usual.

## Step 1: Read the source

Read the available context: the user's plan, spec, PRD, or conversation. If
none is available, ask: "What do you want broken down?"

## Step 2: Clarify granularity

Before creating anything, ask:
- "Should tasks be fine-grained (1 hour each) or coarse (half-day slices)?"
- "Are there dependency constraints I should know about?"

## Step 3: Map dependencies

Build the dependency graph:
- What must exist before each task can start?
- What can run in parallel?
- What blocks the most other tasks? (Do that first.)

## Step 4: Classify each slice

**AFK** — The agent can execute this without human input:
- Requirements are fully specified
- No external credentials, approvals, or physical actions needed
- Verifiable by running tests or checking observable output

**HITL** — A human must be involved:
- Requires decision, approval, or design judgment
- Needs access the agent doesn't have (credentials, prod access, customer)
- Result is subjective or requires stakeholder review

## Step 5: Write the tasks

For each task:
```
[AFK/HITL] [short imperative title]
Acceptance: [how to verify this is done — observable behavior, not file changes]
Depends on: [task IDs, or "none"]
```

Emit in dependency order: blockers first, dependents after.

## Step 6: Publish

If GitHub is available and the user confirms: create issues using the GitHub
MCP server. Publish blockers first so real issue numbers can be referenced in
dependent tasks' "Blocked by" fields.

If no GitHub, write to TASKS.md or the project's task format.

---

Issues must not reference specific file paths or line numbers — those change.
Reference domain concepts: "the authentication middleware", "the payment webhook".
