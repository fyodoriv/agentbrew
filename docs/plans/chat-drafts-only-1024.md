# Offer an opt-in chat draft rule

Users who send their own chat messages need a rule that also covers replies
and suggested edits. Use the existing catalog and generated rule files.

- **Hypothesis**: A single optional rule covers all four controls, from zero
  to four. It stays off for users who did not select it.
- **Measurement**: Run `npx vitest run src/sync/judged-delivery-rules.test.ts`.
  Check the catalog, the exact draft instruction, precedence over message
  merging, and the generated Claude Code and Codex files in a scratch home.
- **Success**: All four controls pass. The rule appears once per generated
  file after install. There are zero live chat calls and zero new defaults.
- **Pivot**: Any unintended default, duplicate rule, missing host, or
  instruction that lets a goal retry widen approval rejects the change.
- **Anchor**: [Issue #1024](https://github.com/fyodoriv/agentbrew/issues/1024)
  and the existing judged draft safeguards.
