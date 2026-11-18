# Qualify the OpenCode 2 loader before porting hooks

The earlier OpenCode 2.3.0 experiment involved a local model. Separate
loader admission from all provider requests. Qualify one minimal V2
entrypoint before adapting the existing command hooks.

- **Hypothesis**: OpenCode 2.3.0 lists one known V2 plugin and runs its
  setup once. The current V1 named export is rejected by the same loader.
- **Measurement**: Install the official `@opencode/cli@2.3.0` in a hosted
  scratch directory. Run its standalone plugin-list command twice in
  separate empty homes, each with a 60-second bound. In the first home,
  discover the existing V1 bridge. In the second, discover one V2
  `Plugin.define` control that records a single synthetic setup marker.
  Keep only loopback access after installation. Print the version and
  fixed results, with provider calls and raw logs out of the report.
- **Success**: The legacy control has one classified rejection and zero
  setup markers. The V2 control appears in the CLI's active list and
  records exactly one setup marker. Both commands finish within the
  bound. The two scratch homes are the only configured locations.
- **Pivot**: A missing version, missing observable rejection, duplicate or
  missing marker, or startup failure is inconclusive. Keep loader results
  separate from the earlier model startup result.
- **Anchor**: [OpenCode installation](https://opencode.ai/docs/),
  [OpenCode migration](https://opencode.ai/docs/build/plugins/migrate-v1),
  and the earlier [isolated comparison](opencode-v2-hook-qualification.md).

This is a loader control. The bridge itself still needs exact V2 input and
output contracts, separate V1 and V2 hook controls, and owner-safe deployment.
