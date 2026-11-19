# Check the toolchain before scaffold hooks

New projects already check whether their selected language tools exist.
Extend that command to check the Node version pin and the native launchers
declared by the project. Use the same check for both Git hook routes.

- **Hypothesis:** A wrong Node pin moves from a late success or failure to
  one actionable toolchain diagnostic before any secret or docs check. A
  declared native launcher that cannot start fails at the same boundary.
- **Measurement:** Run a scratch Git project with the rendered hook files
  and real Lefthook. Run the repo-local fallback without Lefthook. Record
  the return code, diagnostic count, and later hook canaries for a wrong
  pin, a supported pin, and a declared native launcher failure. Compare
  ten ordered pairs of old and new healthy commit hook runs on the same
  host with `heavy-run --exclusive`.
- **Success:** One toolchain line and zero later calls on each rejection.
  The normal Node, Python, Rust, and tool-free controls still reach their
  later checks. Median added healthy time is at most 300 ms.
- **Pivot:** Reject on one wrong admission, one lost valid project shape,
  one duplicate toolchain check per hook route, or median overhead greater
  than 300 ms.
- **Anchor:** [Lefthook priority](https://lefthook.dev/configuration/priority/),
  Minsky `scripts/check-toolchain.mjs`, and Nygard (2007), *Release It!*.

Adopt the archived major and minor match for numeric version pins. A major
only pin compares only the major. Native checks use existing local
launchers for declared Biome and Lefthook dependencies. The fixture uses a
fixed wrong version and local synthetic launchers, with no install or push
from the scratch project.

## Observed

On November 19, both baseline routes admitted the wrong Node pin. Each
ran the secret and docs probes and printed zero toolchain diagnostics.
Both candidate routes passed seven controls. The wrong pin and a broken
declared launcher each produced one diagnostic before later checks.
Working Node, Python, Rust, and tool-free fixtures reached later checks.
The repo-local hook originally exposed a broken dispatcher's exit 17. The
corrected hook returned 1 with one diagnostic and zero later calls. The
final candidate passed seven controls in each of the direct, delegated, and
fallback routes. Ten paired healthy runs per route with the local Biome
launcher added median times of 83.4 ms through Lefthook 2.2.2, 93.3 ms
through its delegated route, and 82.2 ms through the fallback.
