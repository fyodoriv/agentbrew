# Check scripted edits and home-directory file writers

Registered on 2026-11-20. Initial target: `0606c398`. Task: [#1021](https://github.com/fyodoriv/agentbrew/issues/1021).

- **Hypothesis**: A unique whole-line anchor and a full diff catch omitted safety lines before tests. A small reviewer checklist catches the file-writer edge cases that an ordinary file write misses.
- **Measurement**: Run `npx vitest run src/skills/run-goal-file-writer-review.test.ts` on hosted CI. Ask an independent reader to identify the lost lines and required reviewer checks from one synthetic case.
- **Success**: Catch both missing safety lines before testing. Check all five groups for file and parent links, non-regular targets, missing HOME, a late-arriving destination, and status reads. Keep the same result when every old eval is read in order.
- **Pivot**: Stop after one missed safety line, one excluded check group, one overwrite or blocking read permitted by the guidance, or one altered earlier eval.
- **Anchor**: [Task #1021](https://github.com/fyodoriv/agentbrew/issues/1021) and the current [scripted edit guidance](../../skill-plugins/workflow/run-goal/references/execution.md#during-execution).

The edit, filesystem states and review are synthetic. The fixture never runs
a writer or opens a named pipe.
