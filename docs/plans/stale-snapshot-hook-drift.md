# Detect stale hooks in standalone Agentbrew builds

**Hypothesis:** A standalone runtime can carry an older hook manifest or hook
script while its bundled JavaScript still matches the saved origin. Including
shipped hook files in the snapshot check raises detection from 0 of 2
controlled hook changes to 2 of 2. Repository builds read the hook files
from their checkout.

**Measurement:** Run `npx vitest run src/cli-build-health.test.ts` in hosted
CI. The fixtures compare a recorded build revision with the verified origin
tip after a manifest change, a hook script change, and a test-only change.
The existing plain sync fixture checks that sync prints any detected warning.

**Success:** Both shipped changes produce 1 warning with the exact source and
origin revisions. Test-only and docs-only changes produce 0 warnings. The
checkout case stays clear when only its live hook files changed.

**Pivot:** If 1 control gets a false warning or a shipped hook change remains
silent, correct the comparison against the actual package file set before
using it in sync or doctor.

**Anchor:** The runtime comparison in commit cfa5d71b and the package's
published file list in `package.json`.

## Installed verification

The source warning covers the next build. The old executable in an existing
shell needs separate verification through the supported repair path. Run
`agentbrew hooks verify --agent claude-code --json` from the accepted source
build after the repair. Keep the two runtime tasks open until the ordinary
command selects current hooks and the probe shows zero missing hook scripts.
