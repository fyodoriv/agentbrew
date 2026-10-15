---
name: rule-audit
description: List Cursor rules that never apply. Use when the user asks why a rule has no effect.
---

# Rule audit

Read each file in `~/.cursor/rules/`. Find rules with `alwaysApply: false` and no globs.

List those rules. For each one, give the line to add.
