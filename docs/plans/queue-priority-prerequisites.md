# Keep confirmed prerequisites visible in the priority queue

The watcher lists both Agentbrew P1 entries below as candidates.
Neither remaining acceptance can proceed against current evidence.

- The marketplace timeout preparation has landed. A recording for the
  original case still needs the one approval reserved by the
  [diagnostic plan](plugin-lifecycle-timeout-observation.md).
- GitHub reports the nine original advisories fixed. The remediation
  task still needs the supported optional dependency tree described
  in the [dependency controls](dependency-alert-controls.md).

- **Hypothesis**: Record the missing diagnostic approval and the
  open dependency ID where the watcher reads them. The combined
  P1 candidate count falls from seven to five when only these two
  entries change. Both remain open at P1.
- **Measurement**: Run the released priority watcher on both default
  branches. Compare the ordered task IDs before and after, then confirm
  both task IDs, original priorities and acceptance remain in TASKS.md.
  The existing hosted gate validates the task format.
- **Success**: 0 of the two waiting IDs in the candidate list, 0 other
  P1 entries removed, and 0 task closures attributed to this update.
- **Pivot**: Any remaining waiting recommendation, unrelated candidate
  loss, wrong task priority, or changed acceptance rejects the update.
- **Anchor**: The watcher priority contract in Agentbrew #1219, the
  lifecycle one-run admission, and the dependency peer task.

The dependency edge lets the watcher reconsider the parent after the
peer task closes. The diagnostic still requires one explicit approval.
