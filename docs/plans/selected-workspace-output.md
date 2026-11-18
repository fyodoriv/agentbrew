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

## Preserve ownership across invocations

The [path baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44240098583)
reused the shared output in all three cases. The
[first candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44240264722)
passed those file lifetime controls. Independent review found that the
application layer derives its persistent owner from the file's parent.
That would attach rules and skill directories to the removed temporary
directory. Keep the old workspace owner directory, create it only when
a cold live run needs it, and keep the actual workspace file private.

- **Hypothesis**: Two live selected applies share one existing workspace
  owner. Scratch paths never appear in persisted rule or skill ownership.
- **Measurement**: From a cold scratch home, run the full Commander
  and explicit application routes twice. Change the source rule
  between runs. Observe saved rule owners, content hashes, source
  directory ownership, and stale-owner cleanup after both scratch
  paths are removed.
- **Success**: Preserve one durable owner and one copy of each
  declaration, replace the first rule body once, and remove zero valid
  settings or rules during stale-owner cleanup. Generate zero shared
  workspace YAML files. The first phase route and cleanup cases pass.
- **Pivot**: A transient owner, duplicate registration, stale removal,
  unexpected config output, or default-route regression rejects the
  candidate.
- **Anchor**: Agentfile owner derivation, rule and skill owner records,
  and `src/sync/stale-agentfile-artifacts.ts`.

The [real ownership baseline](https://github.com/fyodoriv/agentbrew/actions/runs/44240588657)
recorded a transient owner. The first ownership candidate passed all
four focused cases, but the broader suite found a no-workspace mock
compatibility issue. Load the owner path only after workspace preparation
returns a private file. Create the stable directory immediately before
live application. The [combined candidate](https://github.com/fyodoriv/agentbrew/actions/runs/44241020630)
passed four focused cases, all 73 compatibility tests and type checking.
The cold two-run case kept a single rule and skill owner. It created no
shared workspace YAML file.
