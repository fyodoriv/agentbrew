# CLI flag audit (rule 16: default by default)

Every long CLI flag is listed here with the reason it is not the default.
`node scripts/check-rule-16-defaults.mjs` fails `npm run verify` when a flag in `src/` has no row.
Decision record: [`decisions/adopt-rule-16-default-by-default.md`](decisions/adopt-rule-16-default-by-default.md).

## Categories

| Category | Meaning |
|---|---|
| `opt-out` | The behavior is already the default; the flag turns it off. This is what rule 16 asks for. |
| `debug` | A debug-only exit hatch: preview, extra output, or a slower diagnostic mode. |
| `knob` | A user-config knob or an input value (a path, a name, a scope, an output format). There is no single right default. |
| `disruptive` | Too disruptive to be the default: it deletes, overwrites, skips a prompt, or does slow network work. |

## Flags

| Flag | Category | Why it is not the default |
|---|---|---|
| `--agent` | knob | Picks one agent; the default already covers every agent. |
| `--agentfile` | knob | Points at an Agentfile path; the default path is used without it. |
| `--all` | knob | Widens `mcp` output to every server; the default is the managed set. |
| `--args` | knob | Supplies server arguments; input, not behavior. |
| `--base` | knob | Names the upstream base branch for a contribution PR; input, not behavior. |
| `--body-file` | knob | Names the PR body file; input, not behavior. |
| `--built-in-skill-root` | knob | Overrides the skill folder for `--builtins`. |
| `--builtins` | knob | Narrows coverage to in-repo skills; the default counts every skill. |
| `--bundle` | knob | Names an export bundle to import; input, not behavior. |
| `--bundles` | knob | Filters browse output to bundles. |
| `--check` | debug | Read-only preview of an update or sync; the default does the work. |
| `--ci` | knob | CI exit-code mode; a human run should not exit 1 on drift. |
| `--command` | knob | Supplies the server command; input, not behavior. |
| `--confirm` | disruptive | Deletes memory; deletion must never be the default. |
| `--days` | knob | Time window for a report; the value is the knob. |
| `--deep` | disruptive | Installs and calls each MCP server; too slow and side-effecting for every probe. |
| `--discover` | debug | Prints user-added MCP servers found in agent configs; extra output for debugging. |
| `--draft` | knob | Opens the contribution PR as a draft; a per-PR choice. |
| `--dry-run` | debug | Preview without writes; the default applies the change. |
| `--env` | knob | Supplies server env vars; input, not behavior. |
| `--fix` | disruptive | Lets `status` rewrite agent configs; `status` stays read-only by default. |
| `--force` | disruptive | Re-runs work that is already done or overwrites; unsafe as a default. |
| `--from` | knob | Names the source agent or repo; input, not behavior. |
| `--from-state` | knob | Generates an Agentfile instead of running init; a different job. |
| `--git` | knob | Names a git URL or picks the git hook; input, not behavior. |
| `--global` | knob | Scope choice for install. |
| `--headers` | knob | Supplies HTTP headers; input, not behavior. |
| `--if-stale` | knob | Skips a fresh snapshot after a given age; the value is the knob. |
| `--include-deprecated` | debug | Shows deprecated catalog entries that are hidden by default. |
| `--json` | knob | Machine-readable output for scripts; humans get the table by default. |
| `--local` | knob | Scope choice for install (project folder). |
| `--markdown` | knob | Output format for docs generation. |
| `--mcp` | knob | Filters browse output to MCP servers. |
| `--model` | knob | Overrides the model the bootstrap picks. |
| `--name` | knob | Names the server; input, not behavior. |
| `--no-install` | opt-out | Opt-out of a default (install runs by default). |
| `--no-prune` | opt-out | Opt-out of a default (sync prunes by default). |
| `--no-recommended` | opt-out | Opt-out of a default (sync installs the recommended set by default). |
| `--only` | knob | Limits sync to named modules; the default syncs all. |
| `--output` | knob | Output file path. |
| `--project` | knob | Scope choice (project Agentfile). |
| `--pull` | disruptive | Fetches every source over the network; plain sync already refreshes managed sources on a TTL. |
| `--quick` | knob | Static-only measurement for hooks; the default is the full measurement. |
| `--quiet` | knob | Silences the summary for hooks and background runs. |
| `--ready` | knob | Checks only the readiness contract; a narrower job. |
| `--recommended` | knob | Installs the whole recommended set instead of one named item. |
| `--ref` | knob | Git ref for a source; input, not behavior. |
| `--refresh-rules` | disruptive | Replaces edited catalog rule blocks; must stay explicit. |
| `--replace` | disruptive | Overwrites existing items on import; unsafe as a default. |
| `--rollback` | disruptive | Restores the last snapshot over current configs; must stay explicit. |
| `--rules` | knob | Filters browse output to rules. |
| `--search` | knob | Search text for browse; input, not behavior. |
| `--sequential` | debug | Runs sync modules one by one to isolate a failure; parallel is the default. |
| `--set` | knob | Writes an explicit override value. |
| `--share` | knob | Writes an aggregate snapshot to a file; a different output, not a default. |
| `--shell` | knob | Picks the shell hook only; the default installs both hooks. |
| `--skills` | knob | Filters browse output to skills. |
| `--skip-ccusage` | opt-out | Opt-out of a default (ccusage runs by default). |
| `--skip-install` | opt-out | Opt-out of a default (init installs by default). |
| `--skip-sync` | opt-out | Opt-out of a default (init syncs by default). |
| `--revoke` | knob | Removes a plugin signer instead of adding one; a different action. |
| `--signer` | knob | Supplies an SSH public key; input, not behavior. |
| `--cwd` | knob | Supplies the repo checkout to scope plugin rules to; input, not behavior. |
| `--strict` | knob | Adds `strictPluginOnlyCustomization` to a printed admin policy; a policy choice for admins, not a default. |
| `--sources` | knob | Filters browse output to sources. |
| `--threshold` | knob | Coverage threshold value for `--ci`. |
| `--timeout` | knob | Probe timeout value. |
| `--title` | knob | Supplies the PR title; input, not behavior. |
| `--unset` | knob | Removes an explicit override. |
| `--url` | knob | Supplies a server URL; input, not behavior. |
| `--verbose` | debug | Per-item detail for debugging; the default is a summary. |
| `--verify` | knob | Checks locked SHAs instead of writing the lock; a different job. |
| `--yes` | disruptive | Skips confirmation prompts; prompts stay on by default. |

## Audit result (2026-10-16)

No flag qualified for a flip. Every opt-in flag is a knob, a debug hatch, or too disruptive. The opt-out flags already follow rule 16.
