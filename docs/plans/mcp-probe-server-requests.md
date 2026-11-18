# Answer MCP server requests during a stdio health probe

Issue [#1046](https://github.com/fyodoriv/agentbrew/issues/1046) reports
that servers behind the proxy wait for `roots/list` before listing tools.
The probe currently dispatches only replies to its own request IDs.

- **Hypothesis**: An isolated stdio server completes the tools list after
  getting three standard replies from the probe. An incoming request ID
  can overlap a probe request ID without taking over its reply handler.
- **Measurement**: Run `npm exec -- vitest run src/mcp/probe.test.ts src/mcp/probe-spec.test.ts`.
  The new fixture starts a real Node subprocess without network or
  credentials. It withholds tools until it verifies an empty root list,
  a successful ping, and a method-not-found error. It sends a notification
  and rejects any response to it.
- **Success**: Three exact reply frames with the original IDs, zero
  workspace paths and zero notification responses. One correct tools
  count without waiting for the deadline. Existing stdio, error and
  HTTP controls pass.
- **Pivot**: Any disclosed path, misrouted ID, extra frame, unsupported
  request accepted as a tool result, or timeout regression blocks rollout.
- **Anchor**: MCP [roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)
  and [ping](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/ping).
