# Preserve the last real sync when previewing

Registration date: 2026-11-20. Initial target: `3acb18e6`.

- **Hypothesis**: A selected sync preview can report its own result while preserving the manifest, error log, and event stream from the last real sync. Both runners currently reach record writers after a preview. The shared manifest writer also runs in parallel previews.
- **Measurement**: Run `npx vitest run src/sync-preview-receipts.test.ts` on the hosted Linux and macOS runners. Seed three known files in a disposable home and use one synthetic selected module in each runner. Cross preview and real runs with sequential and parallel modes and success and failure. Compare file bytes, module execution, process exit status, and fixed summary text.
- **Success**: All 4 preview cases preserve all 3 seeded files. The 2 successful previews report completion without a “Synced” footer. The 2 failed previews exit 1 and show the synthetic module error. All 4 real controls keep their expected record behavior.
- **Pivot**: Stop at 1 unsafe or ambiguous scratch home, 1 unexpected real-control result, or fewer than 1 reproduced preview failure before changing the runner. Investigate the fixture or scope before proceeding.
- **Anchor**: The sync preview promise in [the README](../../README.md#sync), the [sync runner](../../src/sync-runner.ts), and the [sync error log and event writer](../../src/core/errors.ts).

The cases exercise the shared runners with a synthetic module. Other sync
entry options and writes inside individual deployment modules are outside
this measurement.
