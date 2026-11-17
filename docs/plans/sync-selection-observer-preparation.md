# Prepare isolated sync-selection observations

The [handoff](sync-selection-continuation-handoff-20261106.md) preserves
the earlier mutation receipt and the four sealed inputs. The earlier
binding checks qualified only the module list. Prepare the actual CLI
and update call observations before proposing a behavior change.

- **Hypothesis**: The existing isolated Vitest setup can run the CLI
  and update entry points with instrumentation at their real imports.
  The recorder emits only case ID, outer result, and known effect names.
- **Measurement**: Validate dedicated and default discovery using
  `npx vitest list --filesOnly --staticParse`. The dedicated config is
  `vitest.sync-selection-observation.config.ts`. Run its calibration
  only on hosted CI. It observes one complete receipt, one guarded
  action refusal and one missing or ambiguous result.
- **Success**: Default discovery excludes the single preparation file.
  The dedicated config includes it and inherits both isolation setup
  files. All 3 calibration cases pass. The four target cases stay unrun
  until the preparation is merged and read back at its exact revision.
- **Pivot**: Any attempted network call, physical preparation, unexpected
  default test discovery, leaked value, or failed gate blocks baseline
  capture. A successful calibration does not qualify product behavior.
- **Anchor**: The 2026-11-06 continuation handoff and the isolated binding
  preparation.

The target harness will call the real `buildProgram`, `filterSyncModules`,
`buildSyncModules` and `update`. Instrument imported workspace, state,
policy, native publisher, redaction, installation and event boundaries.
Track each module by its fixed label. Block subprocesses and network in
the selected test worker. The scratch paths and final real native output
checks remain a separate phase. Do not infer missing real writes from
mock call counts.
