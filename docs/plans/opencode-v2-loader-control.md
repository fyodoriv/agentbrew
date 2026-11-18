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

The [explicit-package run](https://github.com/fyodoriv/agentbrew/actions/runs/44290805781)
also exited zero with no active control, no setup marker and no classified
diagnostic. The explicit directory and SDK alone were insufficient.

## Observe activation in a single owned server

The pinned [CLI startup helper](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/cli/src/services/plugin-startup.ts)
documents that a cold location can return an empty plugin list. The
pinned [list handler](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/cli/src/commands/handlers/plugin/list.ts)
reads the server's inventory once. Check whether a retained server can
finish loading the same explicit local package.

- **Hypothesis**: A fresh, owned server reaches a state where the known
  V2 control is listed and has written its one marker.
- **Measurement**: Keep the same package, version, workspace and loopback
  boundary. Start one owned server on a free loopback port. Query only
  that fixed location until the control is listed and the expected
  marker exists, or at most 30 seconds. Stop and reap the same server.
- **Success**: One version-verified server, one setup marker and an
  active-list match in at most 30 seconds, followed by successful cleanup.
- **Pivot**: A missing match or marker still leaves loader admission
  unverified. Do not upgrade the earlier one-shot receipts.
- **Anchor**: The pinned source and both earlier one-shot receipts.

The [owned-server run](https://github.com/fyodoriv/agentbrew/actions/runs/44291561041)
queried the location 49 times within its limit. The package was never
listed and wrote no marker. The server was reaped. Readiness alone did
not explain the missing admission in this setup.

## Test the native V2 definition in the proven discovery directory

The pinned [module schema](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/plugin/module.ts)
accepts a default object with an ID and a setup function. The earlier
legacy rejection proves the loader visited the older global plugin
directory. Test that same direct-file discovery path with a V2 object
that needs no external SDK package resolution.

- **Hypothesis**: The same loader admits one native V2 definition from
  the already observed direct-file directory.
- **Measurement**: Replace the configured directory fixture with one
  JavaScript file in the older global plugin directory. The default
  object writes the same synthetic marker. Reuse the version, owned
  loopback server, 30-second bound and cleanup check.
- **Success**: The control is listed once, records one setup marker, and
  the owned server is reaped. Keep catalogue absence on the earlier
  package route as a separate result.
- **Pivot**: A missing result leaves even this path unqualified. Use
  the exact pinned loader contract and a separate proof before porting
  any hook behavior.
- **Anchor**: The pinned module schema and direct legacy rejection.

The [direct-file run](https://github.com/fyodoriv/agentbrew/actions/runs/44292425961)
queried one owned server 52 times. It found no active control, no setup
marker and no classified diagnostic. The server was reaped. This leaves
V2 admission unverified in the hosted profile. The measured legacy
rejection still holds.
