# Cargo producer diagnostic prediction

The hosted macOS producer-cache test twice found the final executable but no
`release/deps` directory. The same two focused cases passed locally. The root
cause is unknown; do not change the trust check or weaken the assertion.

- **Hypothesis:** A closed diagnostic of the resolved Cargo kind and target
  layout will distinguish a fixture tool from an actual Cargo build and show
  whether the expected producer directory was ever created.
- **Measurement:** Run the focused diagnostic controls, then the hosted macOS
  gate. Inspect the closed fields emitted when the directory is absent.
- **Success:** At least three controls cover real-like output, fixture output,
  and unavailable version. The hosted failure reports all diagnostic fields
  without absolute paths, environment values, or raw command output.
- **Pivot:** If one field requires private values or cannot distinguish the
  cases, keep the test failing and add a narrower safe probe. Do not call the
  cause known until a failing reproduction or direct evidence confirms it.
- **Anchor:** `src/source-build-capability.test.ts:510`, hosted CI runs
  43318889450 and 43323151849, and the focused local two-case pass.
