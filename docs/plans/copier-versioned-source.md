# Preserve the source of a versioned Copier template

Goal. Projects created from a versioned Copier template can receive template fixes and keep their own edits.

Question. Does the scaffold preserve updates with both physical and lexical temporary paths?

Hypothesis. Select versioned mode when Git identifies a root that contains `copier.yml`. Physical-path update failures should drop from one of one to zero of one. The lexical-alias control should stay at zero of one.

Baseline. The existing update test failed at its exit status assertion on both the base and the fetch candidate with a physical temporary path. The same candidate passed with a lexical alias to the same directory. The scaffold treats equal path strings as a local copy and removes the saved template source even when the paths identify the versioned root.

Measurement. Use the same admitted npm 10.9.9 launcher and one worker. On macOS, set `CASE_TMPDIR` to a private physical path under `/private/tmp` and then to its same-directory `/tmp` alias. Run the full file with the physical path. Add a control that scaffolds from a scratch copy of the skill outside Git and checks that its answers contain the local-copy marker instead of the absolute template path.

```sh
heavy-run env TMPDIR="$CASE_TMPDIR" npx vitest run src/skills/new-project-contract.test.ts -t 'brings a template fix into an older repo' --maxWorkers=1
heavy-run env TMPDIR="$PHYSICAL_TMPDIR" npx vitest run src/skills/new-project-contract.test.ts --maxWorkers=1
```

Success. Both selected update assertions pass. The full file has zero failures and the local-copy control runs and passes. A skipped selected assertion leaves the result inconclusive.

Pivot. Abandon explicit mode classification if either eligible update still fails or the local-copy control regresses.

Anchor. Basili, Caldiera and Rombach, The Goal Question Metric Approach (1994).
