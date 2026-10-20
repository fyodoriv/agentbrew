---
description: Start {{NAME}} and walk through what it needs from you now
---

Run `{{NAME}}` (no arguments) from the repo. It sets up what is missing, starts the long-running parts with sane defaults (reusing ones already running), refreshes, and prints what matters now.

Then, answer first: the state it printed, each question it asks (ask the user in plain words; never invent an answer), and each proposal (apply only after the user says yes).

To change a default, use `{{NAME}} config set <key> <value>` (see `{{NAME}} config`); never edit settings files by hand.
