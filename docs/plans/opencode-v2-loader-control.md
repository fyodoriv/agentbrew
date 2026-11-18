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

The [identity-bound run](https://github.com/fyodoriv/agentbrew/actions/runs/44296108566)
observed one correct start and end and zero other calls. Its initial
authenticated health probe returned 503. That kept the complete
fixture red. The pinned [server process](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/server/src/process.ts)
opens the socket before readiness and returns 503 during startup.

- **Hypothesis**: Waiting for the documented readiness response makes
  the fixture observe health after the server is ready.
- **Measurement**: After the socket opens, accept only 503 as a transient
  response for at most ten seconds. Require 200 before any config or
  lifecycle measurement. Record the first response and final status.
- **Success**: Health becomes 200 within ten seconds. Anonymous access
  still returns 401. The same authenticated config, inventory,
  lifecycle and bridge measurements all pass without deadline changes.
- **Pivot**: Any other health response, expired readiness, missing hook
  or extra call leaves the fixture unqualified.

The [ready server run](https://github.com/fyodoriv/agentbrew/actions/runs/44296480113)
observed authenticated startup move from 503 to 200. It then recorded
one correct Claude start hook and one correct end hook for the same
empty V2 session. There were zero other hook calls and no retained
scratch session ID. The server was reaped. The result covers one
plugin instance and its own observed session. Restart continuity,
tool effects, prompt effects and deployment remain open.

## Exercise a real V2 before-tool hook on a harmless tool

- **Hypothesis**: A real V2 tool call reaches the existing Claude
  before-tool handler. Its approved input change reaches the tool.
- **Measurement**: Use the verified isolated OpenCode 2.3.0 server. A
  local protocol fixture returns two fixed chat responses: one call to
  the scratch write-marker tool, then ordinary text. Register the tool
  and the V2 before-tool adapter in the scratch plugin. The existing
  Claude handler receives one argument and replaces it with a distinct
  fixture value. Read only the fixed invocation count and final marker.
- **Success**: The scratch provider receives two requests. The Claude
  hook sees the first value exactly once. The tool sees the amended
  value exactly once and never sees the original. One session completes
  and the owned server and protocol fixture stop within their bounds.
- **Pivot**: A missing callback, original-input write, unexpected tool
  or model call, or incomplete session leaves the adapter unqualified.
- **Anchor**: The verified V2 setup route, the existing Claude
  `tool.execute.before` handler and [OpenCode tool hooks](https://opencode.ai/docs/build/plugins/server#tools-1).

This proof runs one local fixture model response sequence. It keeps live
provider settings and deployed bridges outside the experiment.

The [before-tool baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44297443309)
reached the local provider but its first request did not offer the fixture
tool. There were zero bridge and tool calls. The result does not
distinguish a title request from a tool selection problem.

The pinned [run command](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/cli/src/commands/commands.ts)
accepts an explicit session title. Run one fresh named session, with the
same two-response oracle and no change to time limits. Record only
whether the request offers the exact tool, a namespaced variant, a
code-mode tool, another tool, or no tools. If the first request still
does not offer the exact tool, stop before exercising any callback.

The [named-session candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44297772216)
offered the exact tool. It received the two expected provider requests,
called the existing before-tool handler once, and wrote one amended
marker with zero original writes. The session and both processes ended.
The title removed the unqualified first request in this fixture.

## Distinguish approval, amendment and denial on the V2 path

- **Hypothesis**: The real before-tool handler gives the fixture tool
  the original value on approval, the changed value on amendment, and
  no execution on denial.
- **Measurement**: Use three separate fresh, named scratch sessions and
  the exact local protocol fixture. The approval hook exits zero.
  The amendment hook returns the tested updated input. The denial hook
  returns exit 2 with a fixed synthetic reason. Capture only exact
  marker counts and whether the runtime surfaces that denial reason.
- **Success**: Approval writes one original marker, amendment writes
  one amended marker, and denial writes zero markers. Each hook sees
  one original value. In the denial case the known reason reaches
  either the local model's tool-result message or the CLI. All owned
  processes stop.
- **Pivot**: A word missing from the actual tool output, a second hook
  invocation, a denial without its exact reason or a denied execution
  leaves that behavior unqualified.
- **Anchor**: The real V2 amended-input proof and the existing bridge's
  exit, denial and update contracts.

The [before-tool matrix](https://github.com/fyodoriv/agentbrew/actions/runs/44298180750)
passed all three V2 cases. Approval wrote one original marker. Amendment
wrote one amended marker. Denial wrote neither and surfaced the known
reason. All three local sessions and their owned processes ended.

## Verify prompt and successful tool feedback in V2

- **Hypothesis**: The existing Claude prompt and after-tool handlers
  can add their fixed feedback to the real V2 pipeline.
- **Measurement**: Use only the amended-input scratch control. Map the
  V2 prompt text to the existing prompt handler. Map a completed
  string tool result to the existing after-tool handler. The local
  protocol fixture counts the prompt note in its first user message
  and the tool note in its second request's tool result.
- **Success**: One prompt-hook invocation with the known text, one
  after-tool invocation with the amended input and original output,
  exactly one expected note in each provider message, both prior
  amended controls preserved, and all owned processes stopped.
- **Pivot**: A missing note, wrong field, unexpected invocation,
  changed before-tool result or incomplete session leaves the route
  unqualified.
- **Anchor**: The pinned [V2 prompt hook](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/plugin/src/promise/session.ts)
  and [V2 tool hooks](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/plugin/src/promise/tool.ts).

The pinned core normalizes a string result to a content array before the
after-tool hook. The corrected control passed on an actual local pipeline
with one prompt note and one after-tool note.

## Verify the existing single-file deployment path

- **Hypothesis**: The native default export can load from the exact V1
  managed destination, while sharing the working command-hook implementation.
- **Measurement**: Run the existing V2 prompt, tool and amended-input control.
  Put the combined bridge source only at the scratch global
  `opencode/plugin/claude-hooks.js` path. Remove the explicit plugins config.
  Confirm the runtime serves a fresh authenticated request using that file.
- **Success**: One setup, one prompt, one before-tool and one after-tool
  call, each expected provider note once, one amended tool effect, zero
  extra calls, and all owned processes stopped.
- **Pivot**: If auto-discovery still needs a config entry, a split plugin or
  more than one deploy step, preserve the current V1 routing while testing
  a supported location with transactional ownership.
- **Anchor**: The pinned [source discovery](https://github.com/anomalyco/opencode/blob/a6b15d33daf6ab7d35569f6d711fdb630b9f04e7/packages/core/src/plugin/source-directory.ts)
  and the current managed helper destination in `src/sync/helper-scripts.ts`.

The [V2 single-file control](https://github.com/fyodoriv/agentbrew/actions/runs/44300093697)
passed without an explicit plugin config.

## Verify the unchanged V1 bridge on a real V1 server

- **Hypothesis**: The unchanged legacy artifact at the same managed
  destination still loads and runs its existing two lifecycle callbacks.
- **Measurement**: Use published `opencode-ai@1.19.5`. Install only the
  existing source at `opencode/plugin/claude-hooks.js` under a new temporary
  home. Create and delete a session over loopback and check fixed markers
  from the two real Claude commands. No provider is needed.
- **Success**: Two successful session operations, one start marker and
  one end marker for the same session, zero extra markers, and the server
  process stopped.
- **Pivot**: A refused installed artifact, a missing marker, a duplicate
  or an unexpected provider dependency leaves cross-version routing open.
- **Anchor**: The pinned [V1 session API](https://github.com/anomalyco/opencode/blob/810c0eba1a7348036f8bdf61e6632d0c36c6876c/packages/opencode/src/server/routes/instance/httpapi/groups/session.ts)
  and the existing `ClaudeHooks` named V1 export.
