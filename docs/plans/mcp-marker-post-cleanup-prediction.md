# Interrupted install marker observation prediction

The early diagnostic in `mcp-interrupted-ready-marker` hit its timing pivot.
This separate proposal observes only an already-empty marker after the existing
child close and owned-process checks. The hosted cause remains unknown.

- **Hypothesis:** A failure-only post-cleanup read can distinguish whether the
  marker is missing, empty, nonempty or unreadable at that later boundary,
  without recording its contents or altering the earlier child/signal sequence.
- **Measurement:** Focused no-signal scratch-file controls exercise the four states, a
  symlink and a nonregular file without processes or signals. Then hosted CI runs the
  existing interruption case. No local physical test is authorized here.
- **Success:** Four of four closed states are correct; zero supplied path or
  content canaries appear in the diagnostic; zero extra I/O, retries, signals,
  children or reordered operations occur before the existing cleanup ends.
  The added read occurs only when the first read was empty and cleanup and
  existing checks completed. Open without following a symlink, require a
  regular file, read at most one byte, and close on every path. Map non-ENOENT
  errors and nonregular files to unreadable. Preserve earlier setup and cleanup
  errors. Report no timing equivalence claim or unsupported root cause.
- **Pivot:** Any changed pre-cleanup sequence, leaked value, unsanitized error,
  unsupported state or unsafe local reproduction stops the change. A nonempty
  later marker is an observation, not proof that a particular writer caused it;
  pathname replacement and same-user races remain possible.
- **Anchor:** Hosted job 132299647921, `mcp-interrupted-ready-marker`, and
  `src/mcp/mcp-git-install.test.ts:1112,1391–1406`; Basili et al. (1994), GQM.

## Focused result

A no-signal scratch-file control passed for missing, empty, nonempty, symlink and
directory cases; it exposed no path or content canary. An independent source
review confirmed placement after the existing cleanup checks and no new signal.
The final-component no-follow check does not protect ancestor replacement, and
opening precedes the regular-file check; this remains limited to the
fixture-owned directory. A later state cannot identify the writer. The physical
test and its numeric PID checks are unchanged and are not qualified by this
control. Hosted verification is still required.
