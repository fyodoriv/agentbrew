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

## Explicit package discovery

The [first valid version run](https://github.com/fyodoriv/agentbrew/actions/runs/44290357012)
confirmed the legacy rejection. The V2 list exited zero but showed no
active control and wrote no setup marker. This leaves V2 admission
unverified. The earlier setup run stopped at a version parser that did
not accept the documented V2 prefix.

- **Hypothesis**: An explicitly configured local package and the matching
  installed SDK let the current V2 loader list the control and run its
  one setup callback.
- **Measurement**: Reuse only the V2 control in a fresh hosted scratch
  home, configure its directory explicitly, and install the published
  `@opencode/plugin@2.3.0` before restricting the network to loopback.
  Record version, process status, active-list match, setup count and
  fixed diagnostic classes.
- **Success**: One known V2 plugin is listed and writes the exact setup
  marker once. The invocation exits zero within 60 seconds.
- **Pivot**: Another missing marker or explicit rejection leaves the
  loader open. Preserve the independently observed legacy result.
- **Anchor**: [OpenCode plugin discovery](https://opencode.ai/docs/plugins/)
  and the first version-verified result above.
