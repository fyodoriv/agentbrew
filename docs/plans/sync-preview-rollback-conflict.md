# Refuse rollback in a sync preview

Registration date: 2026-11-20. Target: `643e1b5d`.

- **Hypothesis**: The CLI can reject a combined preview and rollback before it reaches the restore or the command setup. The current parser accepts both flags, and the rollback early exit dispatches the restore before the preview runner.
- **Measurement**: Use `npx vitest run src/cli-sync-build-health.test.ts` in hosted CI. Exercise both flag orders on initialized synthetic state with a mocked restore. Inspect the exit code, error text, restore, sync, event and four setup calls. Keep standalone rollback and selected preview as controls.
- **Success**: Both mixed orders return exit 1, name both flags, and make 0 calls to the restore, workspace preparation, sync, events, build check, repair-log clear or last-seen writer. The two standalone controls each call their expected operation once.
- **Pivot**: Stop after 1 actual restore attempt, 1 missed refusal or 1 standalone behavior change. Before changing the parser, require at least 1 mock restore reproduced with both flags.
- **Anchor**: [CLI registration and early exits](https://github.com/fyodoriv/agentbrew/blob/643e1b5da856d1aeba59d39316bbd2593917aad0/src/cli.ts) and the repository's installed Commander option conflict check.

No test is allowed to restore or touch actual agent configuration. The fixture
already mocks the restore and command setup. No rollback preview is added.
