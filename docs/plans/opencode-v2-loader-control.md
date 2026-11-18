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
attempted 49 inventory reads within its limit. The package was never
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
attempted 52 inventory reads against one owned server. It found no active control, no setup
marker and no classified diagnostic. The server was reaped. This leaves
V2 admission unverified in the hosted profile. The measured legacy
rejection still holds.

The persistent controls count attempted reads. They do not separately
record how many inventory responses succeeded or whether the expected
configuration document entered the server location. An independent
server health and configuration observation must establish that boundary
before another loader test.

## Verify the server configuration route independently

- **Hypothesis**: The explicit loopback endpoint answers a config request
  and returns the fixture's global configuration document.
- **Measurement**: Start one fresh pinned server with the known scratch
  home and loopback boundary. Wait at most ten seconds for its socket.
  Run `debug config --server` for the same scratch project and validate
  the resulting JSON. Count the known fixture configuration and plugin
  target in the response without printing it. Attempt one inventory
  read and report its exit result separately. Reap the server.
- **Success**: Socket ready, successful JSON config read with one known
  global config document and its chosen local target, one successful
  inventory read and an owned server reaped.
- **Pivot**: A missing config or failed client path rejects this setup
  as a loader experiment, regardless of the inventory list.
- **Anchor**: The pinned [debug config handler](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/cli/src/commands/handlers/debug/config.ts)
  and [server connection resolver](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/cli/src/services/server-connection.ts).

The [route control](https://github.com/fyodoriv/agentbrew/actions/runs/44293192479)
opened a loopback socket, but both CLI reads exited 1. Neither response
supplied a configuration document. Separate the server's HTTP health
response from the CLI's global option parser and connection policy.

- **Hypothesis**: Raw health and the two placements of the documented
  global server option identify why the client returns exit 1.
- **Measurement**: In one owned fresh server, record only the status of
  `/api/info`. Run the same config read with the server option before
  and after the subcommand. Classify only fixed connection, compatibility,
  authorization or usage messages from the two captured diagnostics.
- **Success**: One externally observable HTTP status and two fixed
  client decisions, with no raw request, response, credential or log
  printed. If either config read succeeds, check the original document
  and target assertions.
- **Pivot**: An unclassified result preserves the setup gap. It gives
  no loader admission evidence.
- **Anchor**: The pinned global option and connection resolver code,
  and the prior socket and exit-code receipt.

The [health diagnostic](https://github.com/fyodoriv/agentbrew/actions/runs/44293589745)
reported HTTP 401. Both option placements returned the authentication
failure class. The pinned [server process](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/cli/src/server-process.ts)
requires a password, even on loopback. It uses the value supplied in the
server environment or generates one.

- **Hypothesis**: The same owned server accepts an authenticated health
  request and returns the expected configuration document.
- **Measurement**: Give just the scratch server and its clients the
  same ephemeral fixture password. Compare anonymous and authenticated
  health status. Read and parse configuration through the CLI, then
  attempt one plugin inventory read through the same endpoint. Print
  statuses and fixed classifications only.
- **Success**: Anonymous health 401, authenticated health 200, config
  and inventory exits zero, one matching document and package target,
  and the server reaped.
- **Pivot**: Any failed authenticated read leaves the loader unqualified.
  Preserve all previous results and keep the host outside the live path.
- **Anchor**: The observed 401 and the exact server and client source.

The [authenticated route](https://github.com/fyodoriv/agentbrew/actions/runs/44293997253)
reported 401 without authentication and 200 with the scratch credential.
Config and inventory reads both exited zero. The config response contained
one known document and one matching local package target. The server was
reaped. The earlier persistent inventory attempts had no authenticated
client, so they cannot qualify loader admission.

## Confirm the V2 definition through the verified configuration route

- **Hypothesis**: The verified route lists the explicit local V2 definition
  and its setup writes one marker.
- **Measurement**: Reuse the pinned CLI, declared package path, native
  JavaScript definition and verified loopback authentication. First
  verify the same config response. Then observe the active list and
  the marker for up to 30 seconds. Stop the owned server.
- **Success**: One expected active plugin, one exact setup marker,
  verified configuration, and successful cleanup.
- **Pivot**: Any absent, repeated or unknown output leaves loader
  admission open. Record the result separately from hook behavior.
- **Anchor**: The authenticated config receipt and the pinned V2
  module schema above.

The [authenticated loader run](https://github.com/fyodoriv/agentbrew/actions/runs/44294326435)
listed one native V2 plugin and recorded one exact setup marker.
Configuration and inventory both succeeded. The server was reaped after
the check. The experiment stayed on loopback and used no model. It
qualifies the local V2 definition and setup route on Ubuntu 2.3.0.
Real hook effects and owner-safe deployment remain separate.

## Verify V2 session event identities

- **Hypothesis**: A native V2 plugin receives one creation and one
  deletion event for the same empty scratch session, using the V2
  event payload.
- **Measurement**: Through the verified loopback profile, start one
  control that subscribes to `session.created` and `session.deleted`.
  Create one empty session at the verified location and delete that
  fixture session. Match each event's session ID to the create reply.
  Report only counts and cleanup status.
- **Success**: One admitted setup, one matching creation event, one
  matching deletion event, zero other or ambiguous events, and an owned
  server reaped. Every observation has a short deadline.
- **Pivot**: A missing or mismatched event, error or duplicate leaves
  the lifecycle route unqualified. A successful event observation
  supplies a payload contract for the bridge, with tool and prompt
  effects still open.
- **Anchor**: The pinned [session endpoints](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/protocol/src/groups/session.ts)
  and [event schema](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/schema/src/session-event.ts).

The [session event run](https://github.com/fyodoriv/agentbrew/actions/runs/44295270441)
registered one V2 plugin and one setup marker. The authenticated native
routes produced one creation and one deletion event, both with the
fixture session ID in `event.data.sessionID`. There were zero other
records. The server was reaped. This establishes session identity in the
V2 event stream. It leaves the existing Claude hook adapter unported.

## Exercise the existing Claude lifecycle handlers on V2 events

- **Hypothesis**: A native V2 event adapter can hand the verified
  session identity and directory to the existing Claude handlers.
- **Measurement**: Install the existing bridge source as a private
  supporting file for the same scratch plugin. Adapt the two known
  V2 events to the existing lifecycle handler. Only dispatch events
  that name this plugin's scratch directory. A synthetic command hook
  validates the session ID, workspace, event name and lifecycle field.
- **Success**: One matching start and one matching end through the real
  bridge, zero unexpected command calls, one active plugin and a
  reaped server. The probe sends no model request.
- **Pivot**: A missing or ambiguous scope or payload refuses dispatch
  and leaves that event mapping unqualified.
- **Anchor**: The current `claude-hooks.js` lifecycle handlers and the
  verified V2 identity control above.

The [first bridge reuse run](https://github.com/fyodoriv/agentbrew/actions/runs/44295777453)
ran one correct start hook. The deletion fell outside the required
workspace scope, so the adapter ran no end hook. The source deletion
event carries the ID, with no required location in its payload.

- **Hypothesis**: An admitted creation can bind an ID to its known
  directory for one later deletion in the same plugin instance.
- **Measurement**: Keep an instance-owned set of exact session IDs
  observed at the matching workspace. Accept one deletion with a known
  ID and either no location or the matching location. Consume the
  entry before calling the existing handler. Use the same hosted fixture.
- **Success**: One correct start, one correct end, zero other calls
  and zero unused IDs in the scratch plugin after deletion.
- **Pivot**: An unknown ID, conflicting location or duplicate record
  must not dispatch a hook. A missing mapping after a restart remains
  unqualified and needs separate evidence.
- **Anchor**: The pinned deletion schema and the rejected workspace
  control above.
