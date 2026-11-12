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

On November 12, an isolated rehearsal stored harmless facts on 11.7, made a
SQLite backup, recalled the facts on 12.8, then restored the backup and recalled
them on 11.7. It checked that isolation denied outside files and network. This
run used the upstream test-only hash embedding fallback. Never enable that
fallback on the live database: mixing hash vectors with real embeddings can
damage recall.

A second rehearsal passed the same upgrade and restore sequence using ONNX,
with hash fallback disabled and the public model archive verified against the
upstream checksum. It checked exact recall and semantic retrieval using each
original fact as the query. Its first run failed because CoreML could not create
a working directory inside the isolation boundary; the passing retry selected
the CPU provider explicitly. It does not prove CoreML behavior or live data
compatibility.
The upstream 12.8 `memory check-db` command reported schema 22 with no pending
migrations on that upgraded synthetic database. On the restored 11.7 snapshot,
it returned nonzero and listed eight pending migrations. The command opens the
specified database read-only. This check can help detect an incomplete upgrade,
but it does not prove semantic recall or protect writes around a restart.
Always pass the verified path explicitly: in the inspected 12.8 wheel,
`check-db`'s automatic path resolver ignores `MCP_MEMORY_BASE_DIR`, although
the storage backend uses that setting. A synthetic call to that resolver
confirmed the mismatch. Otherwise a successful check could inspect a different
database from the one the daemon uses.

- **Maintenance hypothesis:** Passing Agentbrew's resolved database path to
  upstream `check-db` makes its fallback honor a custom base directory.
- **Measurement:** Exercise the maintenance fallback with a synthetic custom
  base directory and inspect the `check-db` arguments.
- **Success:** Every tested fallback passes the expected absolute database path;
  a successful `maintain` does not invoke `check-db`.
- **Pivot:** If the daemon path cannot be established, do not treat fallback
  success as proof that the running daemon's database was checked.
- **Anchor:** `src/memory/invoke.ts`, `src/memory/paths.ts`, and the inspected
  upstream 12.8 `cli/main.py` resolver.

The custom-base test failed before the change and passed after Agentbrew began
passing `--db-path`. The normal maintenance-success test also passed. This
fix resolves the CLI's configured path; it does not read the daemon's dotenv.
Both rehearsals use freshly resolved package dependencies; they do not prove
that every dependency matches the installed daemon's environment.

A separate scratch HTTP rehearsal is prepared to reproduce the old origin
behavior and check the patched version. It uses a temporary loopback port and a
separate synthetic database for each version. Its isolation check must first
prove that the temporary port works and the live memory port is unreachable.
The isolated rehearsal passed on November 12: the old version returned 200
to an untrusted-origin initialization and wildcard preflight; the candidate
returned 403 and no wildcard. Both accepted local initialization. The live
daemon has not been changed.

The candidate restricts browser origins and configures authentication
separately. A successful origin check alone does not prove that local requests
require a credential. Check both properties in the deployed configuration.

The installed 11.7 package accepts `MCP_CORS_ORIGINS` for its preflight
response. Source inspection indicates that an explicit allowlist can remove the
wildcard for an unlisted origin. This was not tested as a deployed mitigation,
and it does not validate the Host or Origin of non-preflight requests. The
[advisory](https://github.com/doobidoo/mcp-memory-service/security/advisories/GHSA-8p26-g7wp-65jw)
also identifies DNS rebinding, so a CORS setting alone is not a complete fix.
The advisory excludes the alternative FastMCP entry point, but the 11.7 wheel
exposes a different tool set there, without the required bootstrap or session
legacy tools. It is not a proven replacement for the managed daemon.

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
Both inspected upstream wheels also load the first available `.env` from a
search list that includes the working directory, package ancestors, and
`~/.mcp-memory/.env`. Those settings can select the database when launchd's
environment does not. Checking only Agentbrew's environment or `launchctl
getenv` therefore cannot establish the effective database path. On this Mac,
the home-directory and memory-home `.env` candidates were absent when checked;
package-ancestor candidates and future changes still need consideration. Do
not print or copy the content of any such file.
The `memory fix` repair path can also kick-start the daemon when its MCP check
fails. An upgrade safeguard must account for that path: a refused or failed
upgrade must not let repair start the new version before the snapshot is safe.

- **Guard hypothesis:** When the installed job's package pin differs from the
  desired pin, automatic reconciliation and repair can fail closed before
  replacing or starting the job. This is an intermediate guard, not an upgrade.
- **Measurement:** Run synthetic LaunchAgent and repair tests with matching,
  changed, missing, and unreadable package pins, and with failed MCP discovery.
- **Success:** No tested changed or unknown existing pin causes a plist write,
  unload, load, or kick-start; matching pins and fresh installs retain their
  previous behavior. A refused upgrade is reported as a failure.
- **Pivot:** If any route can restart a new pin without the protected backup,
  leave the version unchanged and do not deploy the guard as upgrade support.
- **Anchor:** `src/memory/launchagent.ts` and `src/commands/cli-memory.ts`.

The draft guard blocks a changed or unreadable pin in an existing plist or a
loaded job. Both sync and repair stop before kick-starting after a refusal. Its
focused tests pass, including a failed launchd probe. With a missing plist, the
draft also refuses setup for a known default database, home dotenv, custom
launchd path or backend, or an unreadable launchd environment. This is not yet
a safe upgrade path: package-ancestor dotenv and other unobserved configuration
can still conceal an existing database. Shutdown, backup and restart also need a
protected, tested sequence before changing the pin.

- **Identity hypothesis:** Refusing to start a new managed job when a known
  database already exists without a plist, or when a loaded job reports a
  different or unknown pin, closes those automatic-start gaps.
- **Measurement:** Exercise synthetic LaunchAgent output and scratch database
  paths for matching, changed, malformed, absent and unreadable cases.
- **Success:** Zero tested existing or unknown databases without a managed
  plist start automatically; zero tested loaded-job pin mismatches cause a
  plist replacement, reload or kick-start. A fresh empty home and matching
  loaded job remain usable.
- **Pivot:** If the effective launchd environment or loaded job cannot be
  identified, block the automatic start and leave the upgrade undeployed.
- **Anchor:** `src/memory/launchagent.ts`, `src/memory/paths.ts`, and the
  launchd `print` output for the managed daemon.

- **Enable-state hypothesis:** A refused upgrade must not mark an inactive
  memory configuration as enabled, while an already-enabled configuration is
  preserved so it can continue to use the old daemon.
- **Measurement:** Exercise `enableMemory` with both initial states and a
  synthetic upgrade refusal.
- **Success:** Zero refused attempts change the input state; the result reports
  whether memory was already enabled and retains the refusal reason.
- **Pivot:** If the state cannot be preserved without changing the existing
  configuration, do not ship the upgrade guard.
- **Anchor:** `src/memory/enable.ts` and `src/commands/cli-memory.ts`.

The inactive-state regression failed before the change. After the change, the
inactive and already-enabled cases both preserve their input state; the CLI
does not save state or claim enablement when it reports a refusal.

In a synthetic WAL-mode SQLite check, `BEGIN IMMEDIATE` blocked another writer
while a separate SQLite backup completed. A second check confirmed that a
writer already holding the lock prevented an early snapshot, and its commit
was visible after the lock became available. This does not test launchd,
interrupted lock ownership, daemon shutdown, or rollback.
An experimental subprocess lock also passed basic contention and backup tests,
but checking the subprocess from its parent cannot make lock ownership atomic
with a later launchd operation. It is not wired into the upgrade path and does
not establish the required restart safety.

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

## Backup collisions

- **Root cause hypothesis:** Backup names have one-second resolution, and the
  copy helper removes an existing destination before copying. Two backups in
  the same second could replace a valid restore point or leave it incomplete.
- **Hypothesis:** Giving each backup an exclusive destination preserves every
  successful snapshot when backup requests overlap or share a timestamp.
- **Measurement:** Create two synthetic backups with the same timestamp after
  different database writes, then verify and read both snapshots. Exercise a
  failed destination write without altering an existing backup.
- **Success:** Both successful snapshots remain independently readable with
  their original rows; a failed write preserves the existing backup in every
  tested case. Existing backup discovery and rotation tests still pass.
- **Pivot:** If exclusive creation cannot be guaranteed across processes or
  filesystems, do not use the changed backup path for the upgrade.
- **Anchor:** `src/memory/backup.ts` and SQLite's
  [online backup documentation](https://www.sqlite.org/backup.html).

The collision and existing-destination tests failed before the change and passed
after it. A separate two-process test preserved and verified both snapshots.
Publishing uses an exclusive hard link from a staged file in the destination
directory. If that filesystem does not support hard links, creation fails
instead of replacing a prior backup.

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
