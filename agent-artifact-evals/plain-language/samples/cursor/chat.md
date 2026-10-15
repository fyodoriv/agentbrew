Your rule file loads, but Cursor ignores it in Ask mode.

- Cause: the rule sets `alwaysApply: false` and has no globs.
- Fix: set `alwaysApply: true`, or add a glob.

**Needed from you:** pick one of the two fixes.
