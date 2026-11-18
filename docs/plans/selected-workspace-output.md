# Isolate the workspace file during selected sync

Named workspaces still write the merged Agentfile to the shared
generated path during a scoped run. The selected run needs the merged
input for its engines. It can use a private file that belongs to the
current invocation. Keep the ordinary full and pull routes on their
current shared output path.

- **Hypothesis**: An ordinary selected workspace run still receives
  the same merged configuration, but changes zero bytes at the
  shared generated workspace path. Its private intermediate file is
  removed when deployment ends or throws.
- **Measurement**: Check a selected live run, selected preview, and a
  forced exception at the CLI runner boundary. Observe the path and
  content while the runner runs, then check file and directory removal.
  Exercise the real workspace renderer with two source repos and a
  base Agentfile. Compare the shared output with a frozen marker and
  verify relative declarations resolve from their original source.
- **Success**: All three selected routes use a private file and leave
  zero temporary files after exit. The real renderer keeps the
  merged contents and leaves the shared path unchanged. The no-root,
  full run and pull controls preserve their current behavior.
- **Pivot**: Unexpected shared writes, forgotten intermediate files,
  changed path resolution or a default/pull regression rejects this
  approach. Disclose loss of normal cleanup after an external hard
  stop if that case remains out of the current process lifetime.
- **Anchor**: `core/workspaces.ts`, the existing merged workspace
  rules and the signed selected-sync baseline in
  [run 44231771838](https://github.com/fyodoriv/agentbrew/actions/runs/44231771838).

This phase qualifies the generated workspace file. Native facets,
shared state and other preparation write boundaries remain open.
