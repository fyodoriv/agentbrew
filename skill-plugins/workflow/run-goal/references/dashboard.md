# Goals dashboard

One claude.ai Dashboard shows every `/goal` run on this machine. Phase 6
step 7 refreshes it at the end of each goal. Skip it when the agent cannot
publish Artifacts.

## Datasets

`scripts/export-goals.py` reads the hook files in
`~/.cache/agentbrew/run-goal/` (or `$RUN_GOAL_STATE_DIR`) and writes to
`~/.local/state/run-goal/dashboard/` (or `--out`):

| File | One row per | Columns |
|---|---|---|
| `goals.json` | goal | `goal_id` (first 8 chars of the session id), `date`, `title`, `criteria`, `met`, `status`, `prs`, `retro_items` |
| `retro_items.json` | top-level retro bullet | `goal_id`, `category` (its `##` heading), `text` |
| `manifest.json` | dataset | `id`, `title`, `description`, `file`, `staleAfterHours` |

- `title`: the first 80 characters of `Raw goal:` in the contract.
- `criteria`: list items under `## Done when`.
- `status` and `met`: from a `Goal result: <met|partly met|blocked> (N/M met)`
  line in the retro file. Without it, `done` when a retro exists, else `open`.
- `prs`: distinct `https://github.com/<owner>/<repo>/pull/<n>` URLs in the retro.

Privacy: the exporter only reads its inputs. Titles and retro lines are
scrubbed: matches of the private pattern in
`~/.config/oss-readiness/oss-readiness.env` become `[private]`; tokens,
emails, and paths outside `~/apps/tooling` become placeholders. Anyone who
can open the dashboard can read the attached files.

## Refresh steps

1. Run `python3 <run-goal source>/scripts/export-goals.py`.
2. Read `~/.local/state/run-goal/dashboard-url`. When it is missing, create
   the dashboard once: Artifact `publish` with
   `type_url: https://claude.ai/artifact/GZLZthZ2sQjn7T16skfdeF` and
   `title: "Goals"`, then save the returned URL to that file. It stays local;
   never commit it.
3. Upload each manifest file as an asset (`upload_asset`) and write
   `datasets/<id>` with `source: {kind: "file", url, name}`, the manifest's
   `title`, `description`, and `staleAfterHours`, and `updated: {at, by: "run-goal"}`.
4. Write `dash/meta` (`{title: "Goals"}`) and `files/index.html` from
   `dashboard/index.html` only on create or when that template changed.
5. Read `data/users/me` doc `check`, as the Dashboard type says.

Comments on the dashboard are handled by `watch-issues`.
