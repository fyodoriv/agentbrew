---
name: handoff
description: >
  Compact the current conversation into a handoff document so a fresh agent
  session can continue without losing context. Use when a long session is
  ending or a context limit is close.
argument-hint: "[what the next session will focus on]"
---

# Handoff

Write a handoff document summarising the current conversation so a fresh agent can continue the work.

Save it to a path produced by `mktemp -t handoff-XXXXXX.md` (read the file first with the Read tool before writing).

**Do not duplicate** content already in other artifacts — reference them by path instead:
- Committed code: reference file path + commit SHA
- Open PRs / issues: reference URL or number
- TASKS.md entries: reference task ID
- ADRs / specs: reference path

Include:
1. **What was accomplished** this session (1–3 bullets, reference artifacts by path/SHA)
2. **Current state** — what's working, what's broken, what's in-flight
3. **Next steps** — ordered, specific, actionable
4. **Gotchas** — non-obvious things that tripped up this session that a fresh agent would hit again
5. **Suggested skills** for the next session, if any

If the user passed an argument, treat it as a description of what the next session will focus on and tailor the "Next steps" section accordingly.
