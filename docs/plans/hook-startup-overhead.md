# Cut avoidable launches from managed hooks

[Agentbrew #1151](https://github.com/fyodoriv/agentbrew/issues/1151) reports
slow process startup on endpoint-managed Macs. The report names three
affected checks and two Python callers.

- **Hypothesis:** The shared startup path can remove external directory
  and input readers while preserving verdicts. A shared interpreter
  selector gives the Python calls a configured or system-toolchain path.
- **Measurement:** Pass a harmless Bash payload through the three reported
  hooks with recording directory and input helpers. Compare the counts
  and verdicts. Verify interpreter priority through an explicit fixture
  runner, the installed Mac toolchain when present, and Linux CI.
- **Success:** All three Bash cases preserve their verdicts and launch
  zero external directory or input helpers. Explicit interpreter override
  and system-toolchain selection pass. The managed hook fixture emits
  a 15-second timeout. The ordinary hook and hosted checks pass.
- **Pivot:** Any changed verdict, truncated JSON, unsafe interpreter path,
  or regression for runtimes without the platform toolchain rejects the
  approach.
- **Anchor:** Issue #1151, shared JSON and verdict helpers, and the
  managed hook manifest test.

The fixtures measure the reported startup paths. Timing on the managed
machine remains separate field evidence.

## Observed results

Each of the three Bash payloads returned exit 0 before and after the
repair. Each went from five `dirname` launches and one `cat` launch to
zero of either. The isolated bootstrap also used neither executable.

All 34 focused startup, manifest, and agent-guide checks passed. The
search helper passed 69 existing cases and the PR helper passed 50.
The Xcode-selected interpreter on this Mac passed signature verification
and ran in isolated mode. The fixtures also checked explicit override
precedence and confirmed the managed timeout default.
