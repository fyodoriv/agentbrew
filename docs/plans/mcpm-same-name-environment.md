# Let managed MCPM stdio servers inherit same-name variables

Issue [#1047](https://github.com/fyodoriv/agentbrew/issues/1047) reports
that a literal placeholder in MCPM overrides the real parent variable.
MCPM v2.15.0's stdio proxy always supplies an override map to FastMCP,
which starts from the parent's environment. Omit a bare same-name
placeholder from the managed MCPM projection.

- **Hypothesis**: The Agentbrew MCPM write contains zero bare same-name
  overrides and does not include their live values. Desired registry
  readback accepts the projected definition and detects the old literal.
  A catalog entry that needs this projection uses its managed transport
  instead of the raw public install route.
- **Measurement**: Run the focused delegated MCP and catalog tests. Use
  fake subprocesses and scratch configs. Verify a same-name placeholder,
  a pure-placeholder map, literal and different-name controls, remote
  headers, expected readback, stale readback, and the catalog bridge.
- **Success**: Every named case passes. Zero raw fixture secret values
  in argv or files. Native formats and source declarations remain exact.
- **Pivot**: A false readback pass, loss of an explicit value, changed
  native config comparison, extra raw registry write, or unknown
  inheritance semantics blocks rollout.
- **Anchor**: MCPM v2.15.0
  [stdio proxy](https://github.com/pathintegral-institute/mcpm.sh/blob/v2.15.0/src/mcpm/fastmcp_integration/proxy.py).
