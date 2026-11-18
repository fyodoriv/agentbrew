# Keep repeated state warnings readable during memory maintenance

Issue #1089 recorded repeated source-cache warnings and a previous
maintenance process exit of -9. The current LaunchAgent reports
exit 0. The earlier kill still needs a cause. This change measures
only repeated state validation inside one command.

- **Hypothesis**: Six reloads of one active source-cache warning
  produce one line. A different warning or an issue that clears
  and returns produces a new line.
- **Measurement**: Use the real state manager and synthetic state.
  Load once, then invalidate and reload five times. Separately
  replace, clear and restore a warning. Run state and memory tests.
- **Success**: One diagnostic in six identical loads. The distinct
  and recurring cases each report once. Validation returns the
  existing state and performs zero additional writes.
- **Pivot**: Any lost new diagnostic, extra write, skipped load or
  change in validation output rejects the approach. Keep the prior
  LaunchAgent failure open until independently explained.
- **Anchor**: Issue #1089 and `src/core/state-manager.ts`.

The baseline emitted six identical notices. The corrected manager
emitted one and still read all six times without a write. A different
notice and a cleared notice that returned both appeared once.
All 120 state and memory compatibility tests passed.
