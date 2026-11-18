# Qualify Claude command hooks on OpenCode 2

The installed bridge exports a V1 hook map. OpenCode 2.3.0 rejected that
export before a provider request. Hosted loopback checks admitted a native
V2 bridge, ran the existing commands, and loaded the combined source from
the exact managed plugin path. The earlier provider timeout has a separate
cause to establish.

- **Hypothesis**: Versioned deployment admits both pinned runtimes and
  retains all four registered V2 safety effects. GQM asks whether a V2
  action reaches its Claude command and obeys the result before execution.
- **Measurement**: In temporary homes, run the ownership and sync tests
  with pinned version responses, then use the artifacts rendered by that
  code in OpenCode 1.19.5 and 2.3.0. Count the exact approve, amend, deny and
  lifecycle markers. Check the prompt and tool feedback in the local model
  fixture. Run the hosted gate.
- **Success**: Two of two loaders accept. Each of the four V2 effects is
  exact, zero denied tool effects run, zero owner files change, and both
  read-only previews leave helper bytes and manifest unchanged.
- **Pivot**: A missing guard, duplicate hook, incompatible runtime,
  owner-file change, or unknown version replacement blocks that route.
  Leave any unrelated provider timeout open. Keep unsupported events
  separate from the capability that the live tests cover.
- **Anchor**: The existing task, [V2 admission at the managed
  destination](https://github.com/fyodoriv/agentbrew/actions/runs/44300093697),
  and the [V2 guard matrix](https://github.com/fyodoriv/agentbrew/actions/runs/44298180750).

Treat the V1 source as the common implementation. Select the V2 adapter
only after the CLI reports a supported major. Reuse the existing single
target, atomic write and manifest ownership check. A missing or unsupported
version leaves the installed helper in place. Write no OpenCode config.

## Qualify cold and warm CLI session callbacks

- **Hypothesis**: The loopback health endpoint can respond before OpenCode
  activates its plugin instance. Creating a session before activation can
  explain the absent start marker in the exact CLI guard controls.
- **Measurement**: Start two fresh OpenCode 2.3.0 servers with the built
  Agentbrew bridge. Use the same approved tool fixture for each. Wait
  only for authenticated health on cold, and additionally wait for the
  two expected plugin IDs on warm. Count known start markers and the
  exact guard effect in both.
- **Success**: Both controls approve once. Warm produces one start marker
  and cold produces none, with zero unexpected markers on either.
- **Pivot**: A warm missing callback or an extra marker leaves the timing
  cause open. Test observed ordering before changing ownership logic.
- **Anchor**: The scoped lifecycle and CLI guard results above, and the
  pinned V2 CLI session resolution through its explicit directory.
