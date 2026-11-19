# Keep skill preparation out of a selection without skills

Task: `sync-selection-preflight`. This stage covers one preparation
route in the shared sync runner. It does not change native plugin
publication.

Before its modules run, an ordinary sync does two skill-only steps. It
refetches stale managed skill sources, which can also register a new
team skill in state. Then it copies installed skill files from the
refreshed caches. Only the `skills` module reads those caches. Source
review shows both steps also run for a selection such as
`sync --only hooks`. The README already says to select `skills` to
update tracked skill sources. A selected pull already skips the
deployed-skill refresh when `skills` is excluded.

- **Hypothesis**: Gating both steps on the selection reduces the
  unrequested skill-preparation calls from 2 to 0 for every live
  selection without `skills`. A selection with `skills`, and a sync with
  no selection, keep 1 call each.
- **Measurement**: Extend `src/sync-runner.test.ts`. Replace the two
  imported boundaries (`softUpdateStaleOverlaySources` and
  `refreshInstalledSkills`) with counting fakes. Give the fake state one
  managed source named `https://example.com/fixture-managed.git`. Run
  the real sequential and parallel runners for each row below. Run
  `JOBS=1 heavy-run npm exec -- vitest run src/sync-runner.test.ts --maxWorkers=1`
  before and after the fix. The three task files
  (`src/cli-sync-agentfile.test.ts`, `src/cli-sync-pull.test.ts`,
  `src/update.test.ts`) and the hosted gate are the compatibility
  controls.

| Case | `syncModules` | Dry run | Source refetch calls | Skill copy calls | Snapshot calls |
| --- | --- | --- | --- | --- | --- |
| selected hooks | `hooks` | no | 0 | 0 | 1 |
| selected rest | every module except `skills` | no | 0 | 0 | 1 |
| selected skills | `skills` | no | 1 | 1 | 1 |
| selected pair | `hooks`, `skills` | no | 1 | 1 | 1 |
| no selection | none | no | 1 | 1 | 1 |
| selected preview | `skills` | yes | 0 | 0 | 0 |

- **Success**: Every row matches in both runners. The two
  negative rows fail on the current source with 1 call each and pass
  after the fix. All other tests in the file and the three task files
  pass.
- **Pivot**: A selection with `skills` or a sync with no selection that
  loses a call, a changed snapshot count, or a changed preview rejects
  the gate. Then revise where the runner prepares skills.
- **Anchor**: The selected pull's existing `skills` guards in
  `src/update.ts`; README "Selected pull modules"; Basili, Caldiera and
  Rombach (1994), GQM; Munafò et al. (2017), preregistration.

Call counts at replaced boundaries do not prove zero physical writes.
This stage claims only that the runner no longer enters the two steps.
The pre-sync snapshot stays for every live run: it is the rollback
point, not module content.

Not covered here: a selection with hooks, MCP or rules still refreshes
the complete native marketplace. That route waits for the coordinated
writer rollout and interruption handling in
[native publication facet ownership](native-publication-facet-ownership.md).
