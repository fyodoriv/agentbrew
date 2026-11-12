# Shared memory transport upgrade prediction

## Before implementation

- **Root cause:** The managed daemon pins `mcp-memory-service` 11.7.0 and runs unauthenticated Streamable HTTP on loopback. Its preflight accepts arbitrary origins. The upstream advisory identifies this class of exposure and says 12.6.0 fixes it.
- **Hypothesis:** Upgrading the existing upstream service to 12.8.0 will reject an untrusted origin while retaining shared recall, writes, backups, and existing memory data for Claude Code, Codex, and OpenCode with Kimi.
- **Baseline:** `agentbrew memory transport-report --json` reports a permissive origin and unauthenticated discovery. A preflight to the loopback MCP endpoint returns `Access-Control-Allow-Origin: *`.
- **Measurement:** Run `npm run verify:changed`; on an isolated synthetic 11.7 database, exercise an upgrade to 12.8 and compare stored facts and recall before and after. Probe valid loopback MCP discovery and an untrusted-origin preflight. After deployment, run `agentbrew memory doctor`, `agentbrew memory transport-report --json`, and an explicit store-and-recall check in each of Claude Code, Codex, and OpenCode with Kimi.
- **Success:** The candidate rejects the untrusted origin, discovers the expected tools, retains every synthetic fact, passes the affected gate, and each requested client recalls the same harmless test fact. A verified backup exists before any live migration.
- **Pivot:** If any synthetic fact is lost, any client cannot recall, the candidate accepts the untrusted origin, or rollback is unproven, do not upgrade the live database. Diagnose or use another maintained provider.
- **Stability guard:** The backup verification, doctor, existing memory lifecycle tests, and client tool schemas pass; no live memory is copied into a test fixture or external service.
- **Anchor:** [GHSA-8p26-g7wp-65jw](https://github.com/doobidoo/mcp-memory-service/security/advisories/GHSA-8p26-g7wp-65jw) and [upstream 12.8.0 changelog](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/CHANGELOG.md).

The user has asked for the best maintained setup. This security test is a
required gate, not evidence that this provider is best at memory retrieval.

## Migration evidence

The live database reported schema version 12 in a read-only query. The verified
12.8.0 wheel contains later schema migrations through 022. Its migration runner
has recovery logic for existing databases, but inspecting that code does not
prove a safe upgrade or downgrade. Test with synthetic data first. A live
rollback must restore a verified pre-upgrade backup; do not assume an older
binary can safely open a database migrated by the newer version.

Static inspection of the wheel shows later migrations create tables or indexes,
alter tables, and run an update. This is another reason to verify a restore,
not a substitute for running the candidate against synthetic data.

A scratch rehearsal is prepared to write harmless facts with the old service,
make a SQLite backup, read them with the new service, then restore the backup
and read them with the old service. It first checks that its OS isolation blocks
network and access outside scratch. It uses the upstream test-only hash
embedding fallback. A pass would not validate the installed ONNX embedding
model, the HTTP origin fix, or any real client. Never enable this fallback on
the live database: mixing hash vectors with real embeddings can damage recall.

A second rehearsal is queued with ONNX enabled and hash fallback disabled. It
will verify the public model archive against the upstream checksum, then check
exact and semantic recall across upgrade and backup restore. It has not run.
Both rehearsals use freshly resolved package dependencies; they do not prove
that every dependency matches the installed daemon's environment.

A separate scratch HTTP rehearsal is prepared to reproduce the old origin
behavior and check the patched version. It uses a temporary loopback port and a
separate synthetic database for each version. Its isolation check must first
prove that the temporary port works and the live memory port is unreachable.
The test has not run yet.

The candidate restricts browser origins and configures authentication
separately. A successful origin check alone does not prove that local requests
require a credential. Check both properties in the deployed configuration.

The candidate's published tool registry and the live `tools/list` response
were compared for the memory lifecycle tools Agentbrew calls. The candidate
declares each checked tool without removing fields or adding required fields
in the directly nested object and array schemas. The same check found no
changes to their simple type, enum, and numeric or string bounds. It does not
cover schema combinators, returned data, permissions, or runtime compatibility.

A separate static comparison of the 11.7.0 and 12.8.0 package registries found
no changed paths for combinators, references, patterns, additional-property
rules, array-size rules, uniqueness, or formats in those tools. This compares
the published package definitions, not the running server's output, and does
not establish full schema or runtime compatibility.

The pinned candidate package was installed by `uvx`, and `memory --version`
reported 12.8.0 with exit code 0. This proves the CLI starts; it does not start
the memory daemon or test a database.

The daemon's launch configuration is generated by Agentbrew from
`src/memory/constants.ts` and `src/memory/launchagent.ts`. The old dotfiles
`mcp-memory-launchagent` is a retired entry point and refuses to start a second
daemon. The version comment in `constants.ts` still mentions that old owner;
correct it when changing the pin.

## Protect existing databases before restart

Reconciliation writes the new daemon definition and restarts the job when its
pin changes. The current path does not first create a verified pre-upgrade
backup. A successful daily backup check does not prove the latest writes are
in that backup. The draft pin change must not be deployed or published as a
finished upgrade until this boundary is addressed.

- **Hypothesis:** Reusing the existing SQLite backup and verification helpers
  before a daemon version change preserves a recoverable pre-upgrade snapshot.
- **Measurement:** Exercise a synthetic existing database with successful and
  failed backup paths, then inspect the generated job and backup on disk.
- **Success:** Every tested upgrade backs up and verifies the correct database
  before the new daemon starts; zero failed backups replace or restart the
  existing daemon. New installs without a database still start.
- **Pivot:** If the effective database path or safe restart order cannot be
  established, leave the existing daemon running and do not deploy the pin.
- **Anchor:** `src/memory/launchagent.ts`, `src/memory/backup.ts`, and
  `src/memory/paths.ts`.

An online snapshot taken while the old daemon accepts writes can miss writes
made after that snapshot. The implementation must make the restart boundary
explicit and prove its recovery behavior; a fresh timestamp alone is not proof.
Upstream also supports a base-directory setting and path aliases. Resolving the
CLI environment alone does not prove that the launchd job uses the same path;
verify the job's effective environment before treating a backup as its database.

## Backup command verification status

- **Root cause:** `memory backup` calls the backup verifier but reports a
  successful command even when verification returns `ok: false`.
- **Hypothesis:** Returning a nonzero status for a failed verification makes
  an unusable backup visible before an upgrade.
- **Measurement:** Exercise the backup command with valid and invalid synthetic
  verification results in text and JSON modes.
- **Success:** Every invalid result returns nonzero and identifies the failed
  verification; every valid result returns zero and retains its backup path.
- **Pivot:** If the command cannot distinguish those outcomes, do not use it as
  an upgrade prerequisite.
- **Anchor:** `src/commands/cli-memory.ts` and `src/memory/backup.ts`.

## OpenCode instruction gap

The shared instruction template names Claude Code and Codex, but not OpenCode.
The deployed OpenCode instructions contain the same omission. Declaring the MCP
endpoint alone does not prove that Kimi will recall or save memory.

- **Hypothesis:** Naming OpenCode in the shared-memory lifecycle will make the
  same entry, recall, and session-save procedure available to its agents.
- **Measurement:** Check the generated OpenCode instructions, then run a
  synthetic Kimi session and verify the actual bootstrap, search, and save tool
  calls and the saved fact's recall.
- **Success:** Every lifecycle call succeeds and the new fact is recalled;
  the generated instructions name OpenCode.
- **Pivot:** If any tool is unavailable or a save cannot be verified, do not
  enable a fail-closed policy for OpenCode; investigate its client permissions
  and transport first.
- **Anchor:** `templates/AGENTS.md` and the OpenCode entry in
  `src/core/agents.yaml`.
