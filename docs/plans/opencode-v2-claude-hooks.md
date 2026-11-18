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
