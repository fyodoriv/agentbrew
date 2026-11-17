# Choose an available writer for a shared rules file

- Hypothesis: without ai-rules, the shared OpenCode file with zero managed sections now has one. With a delegated result, that writer still takes precedence.
- Measurement: run the existing integration file with a missing ai-rules executable and the selected-writer controls in `src/sync/rules-sync.test.ts`.
- Success: one managed section per native destination, no rules drift after sync, and a delegated result wins when present.
- Pivot: keep the previous skip policy if restoring delegation causes duplicate sections or disagreement between the writer and drift checker.
- Anchor: `rules-shared-file-native-fallback` and the recorded hosted exception.

Use one file-owner selection for both sync and status. Skip a delegated-only file when its renderer provides no result.
