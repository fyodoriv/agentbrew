# Identify where scheduled memory maintenance stops

Issue [#1089](https://github.com/fyodoriv/agentbrew/issues/1089) reports a
past signal 9. The current LaunchAgent returned status 0. The latest
status does not identify the earlier interruption. Capture stages
before changing deadlines or assuming a cause.

- **Hypothesis**: The scheduled job writes a fixed, synchronous stage
  marker before each maintenance operation. A missing final marker
  identifies the last stage entered. Manual runs keep their existing
  output unless they opt in.
- **Measurement**: Run `npm exec -- vitest run src/commands/cli-memory.test.ts src/memory/launchagent.test.ts`.
  Check four isolated cases: success, upstream failure, local backup
  failure, and a manual run with logging off. Check the scheduled plist
  enables logging. Verify the order against injected operation calls.
- **Success**: Exact stage sequence in all four cases, exactly one
  scheduler setting, zero markers in normal JSON output, zero raw paths,
  user data or child output in stage markers, and no changed exit or
  backup behavior.
- **Pivot**: Reject a marker that appears after its operation, a
  logging-side failure that blocks maintenance, or any change to an
  installation outside test isolation.
- **Anchor**: The reported interruption, existing maintenance success
  marker and current scheduled plist in Agentbrew.
