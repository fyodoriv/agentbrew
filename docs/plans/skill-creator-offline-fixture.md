# Keep the optional skill creator test offline

The macOS gate in run 44251992514 spent about 15 seconds in
each case that installed the fixture once. The two cases with
two installs reached the existing 30-second test limit at
`src/sync/skill-creator-catalog.test.ts:175` and `:207`. The
fixture substitutes the source checkout. Installer version
recording still reaches Git's 15-second remote lookup.

- **Hypothesis**: The remote version lookup explains the repeated
  15-second interval. A pinned synthetic version allows all six
  cases to run offline without changing installer or sync behavior.
- **Measurement**: Refuse `git ls-remote` at the test's process
  boundary, count attempted calls and run the complete file on
  hosted Linux and macOS. Keep current assertions and time bound.
- **Success**: The baseline detects at least one remote lookup.
  The candidate passes 6 of 6 cases with zero remote lookups
  and completes the test file in under five seconds per host.
- **Pivot**: No observed lookup, any changed assertion or another
  slow boundary rejects this explanation. Keep the gate failure open.
- **Anchor**: Hosted log 44251992514 and the remote lookup in
  `src/skills/skill-versions.ts`.
