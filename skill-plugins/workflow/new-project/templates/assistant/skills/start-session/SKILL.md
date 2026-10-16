---
name: start-session
description: Starts a {{NAME}} session. Loads the user profile, the memory index, and anything due, then proposes the next step. Use when the user opens the assistant, says "start", "what's next", or "let's begin". Don't use for a one-line factual question.
---

# Start a session

1. Read `private/profile/USER.md`. If it is missing, copy `profile/USER.example.md`
   there and ask the user to fill the three most important fields.
2. Read `private/memory/MEMORY.md` and open only the entries that match today's goal.
3. List what is due (reviews, follow-ups, deadlines), oldest first.
4. Propose one next step and why. Wait for the user's choice.
5. At the end, write one line per new durable fact to `private/memory/MEMORY.md`.

Each assistant feature is its own skill in `skills/<feature>/SKILL.md` with a
case in `evals/cases/`. Register this folder as a local source in `Agentfile.yaml`.
