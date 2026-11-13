# Shared memory transport upgrade prediction

## Node 22 capability detection correction

- **Root cause:** On Node 22.23.4, `node:sqlite` imports successfully but is absent from `builtinModules`. The reservation test mistakes this runtime for one without SQLite and expects a successful operation to fail.
- **Hypothesis:** Detecting the actual SQLite import will select the correct reservation tests on Node 22 and Node 24, while keeping the missing-module failure test on Node 20.
- **Measurement:** Run `node_modules/vitest/vitest.mjs run src/memory/write-reservation.test.ts` using Node 20, 22, and 24.
- **Success:** All runnable tests pass on each of the three runtimes; Node 22 and 24 run the SQLite lock tests, and Node 20 runs the unavailable-runtime test.
- **Pivot:** If any runtime chooses the wrong tests or any lock or fail-closed assertion fails, retain the draft and investigate before merging.
- **Anchor:** GitHub Actions run 43321701534, job 131543721578; `src/memory/write-reservation.test.ts`.

The Node 22.23.4 test reproduced the CI failure before the change. After the
import probe, the focused file passed on Node 20.20.2, 22.23.4, and 24.21.0.
Node 20 ran the unavailable-runtime case; Nodes 22 and 24 ran the lock cases.

## Before implementation

- **Root cause:** The managed daemon pins `mcp-memory-service` 11.7.0 and runs unauthenticated Streamable HTTP on loopback. Its preflight accepts arbitrary origins. The upstream advisory identifies this class of exposure and says 12.6.0 fixes it.
- **Hypothesis:** Upgrading the existing upstream service to 12.8.0 will reject an untrusted origin while retaining shared recall, writes, backups, and existing memory data for Claude Code, Codex, and OpenCode with Kimi.
- **Baseline:** `agentbrew memory transport-report --json` reports a permissive origin and unauthenticated discovery. A preflight to the loopback MCP endpoint returns `Access-Control-Allow-Origin: *`.
- **Measurement:** Run `npm run verify:changed`; on an isolated synthetic 11.7 database, exercise an upgrade to 12.8 and compare stored facts and recall before and after. Probe valid loopback MCP discovery and an untrusted-origin preflight. After deployment, run `agentbrew memory doctor`, `agentbrew memory transport-report --json`, and an explicit store-and-recall check in each of Claude Code, Codex, and OpenCode with Kimi.
- **Success:** The candidate rejects the untrusted origin, discovers the expected tools, retains every synthetic fact, passes the affected gate, and each requested client recalls the same harmless test fact. A verified backup exists before any live migration.
- **Pivot:** If any synthetic fact is lost, any client cannot recall, the candidate accepts the untrusted origin, or rollback is unproven, do not upgrade the live database. Diagnose or use another maintained provider.
- **Stability guard:** The backup verification, doctor, existing memory lifecycle tests, and client tool schemas pass; no live memory is copied into a test fixture or external service.
- **Anchor:** [GHSA-8p26-g7wp-65jw](https://github.com/doobidoo/mcp-memory-service/security/advisories/GHSA-8p26-g7wp-65jw) and [upstream 12.8.0 changelog](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/CHANGELOG.md).

November 13 update: upstream released 12.9.0 with additional security fixes.
The earlier 12.8.0 experiments remain historical evidence, not authorization
to deploy that version. A 12.9.0 candidate needs its own isolation, migration,
rollback, and client checks before a live change.

### Version 12.9.0 synthetic migration prediction

- **Hypothesis:** The new upstream release retains synthetic facts after a
  migration from 11.7.0, and a verified pre-migration backup restores those
  facts for 11.7.0.
- **Measurement:** Run the existing isolated synthetic migration rehearsal
  against 12.9.0 with fresh scratch databases and hash embeddings.
- **Success:** Every synthetic fact is recalled before and after migration and
  after backup restore; the network and outside-file controls deny access.
- **Pivot:** If any fact, isolation control, or restore check fails, do not
  propose 12.9.0 for live installation until the failure is resolved.
- **Anchor:** [12.9.0 release notes](https://github.com/doobidoo/mcp-memory-service/releases/tag/v12.9.0)
  and the existing 12.8.0 synthetic rehearsal in this plan.

The isolated rehearsal recalled every synthetic fact before migration, after
12.9.0 migration, and after restoring the pre-migration backup to 11.7.0. Its
outside-file and network-denial controls passed. It used hash embeddings; it
alone does not establish HTTP origin behavior, live ONNX behavior, client parity,
or a safe live daemon handoff.

A separate isolated HTTP rehearsal accepted local MCP initialization on both
versions. The untrusted origin received HTTP 200 and a wildcard preflight on
11.7.0, and HTTP 403 without a wildcard preflight on 12.9.0. The synthetic
port was reachable while the live memory port was denied. This does not prove
live ONNX behavior, client parity, or a safe daemon handoff.

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
On November 12, a read-only inspection of the running launchd job's Python
child showed an open SQLite file at Agentbrew's expected default path, with
its WAL files. This identifies the current process's open file at that moment;
it does not prove which file a later process will select or prevent another
controller changing the job during an upgrade.
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

- **Restart-sequence hypothesis:** Stopping the old managed daemon, verifying
  a fresh SQLite backup, and confirming it remains stopped before starting the
  candidate protects the restore point and avoids overwriting live data on a
  failed candidate start.
- **Measurement:** Exercise the sequence against synthetic databases and
  controlled stop, backup, verification, concurrent-restart and candidate
  failures. Inspect the database and backup after each failure.
- **Success:** In every tested failure before candidate start, the candidate is
  never invoked. After candidate start, no failure overwrites the live database
  with the older snapshot; both the database and snapshot remain available.
- **Pivot:** If a concurrent restart cannot be detected at the handoff or if
  effective database identity is uncertain, do not use the sequence live.
- **Anchor:** `src/memory/backup.ts`, `src/memory/launchagent.ts`, and
  [SQLite online backups](https://www.sqlite.org/backup.html).

The draft sequence has synthetic tests for a failed stop, backup verification,
a restart observed during backup, candidate failure, and an unhealthy
candidate. It leaves the database and snapshot separate after candidate start.
It is not connected to sync or a CLI action. Database identity and exclusive
control of the launchd job remain unproven; the draft sequence must not be used
for a live upgrade yet.

- **Reservation hypothesis:** A SQLite writer reservation held by the upgrade
  process prevents another SQLite writer from changing the database while the
  old daemon is stopped and its snapshot is taken.
- **Measurement:** Use a scratch SQLite database and a second process to test
  write contention, backup under reservation, release after exceptions,
  database replacement, and unsupported runtime behavior.
- **Success:** Zero tested competing writes succeed while reserved; a verified
  snapshot includes committed pre-lock data; the lock releases on all tested
  exits; unsupported runtimes and replaced paths refuse the operation.
- **Pivot:** If the runtime cannot provide the reservation, fail closed. A
  successful reservation alone does not establish an exclusive launchd
  handoff after release and must not authorize a live upgrade.
- **Anchor:** [SQLite transaction behavior](https://www.sqlite.org/lang_transaction.html)
  and Node's [`node:sqlite` API](https://nodejs.org/api/sqlite.html).

The draft now holds the reservation in the upgrade process during stop and
snapshot. Focused tests verified competing-write rejection, backup, release on
error, replaced-file detection, and refusal when the built-in module is absent.
A scratch database produced by the upstream service accepted the reservation;
an end-to-end snapshot check passed on a synthetic upstream-format database.
Node 20 lacks this module
and the draft fails closed there. The reservation now remains held through
candidate registration and ends before the readiness check. This blocks
competing SQLite writes during that interval, but does not stop another process
from replacing the launchd job. A temporary synthetic launchd job registered
while the reservation was held and wrote after release; cleanup was verified.
This did not test the real service or competing launchd changes.

- **Candidate-registration hypothesis:** Registering the candidate while the
  SQLite reservation is still held prevents competing database writes between
  the verified snapshot and the launch request. Releasing the reservation
  before waiting for readiness lets the candidate initialize its database.
- **Measurement:** Attempt a competing write during candidate registration,
  then write during the candidate health check after reservation release.
  Exercise registration and health failures against a synthetic database.
- **Success:** The competing write fails, the post-release write succeeds, and
  no tested candidate failure restores an old snapshot over current data.
- **Pivot:** If registration waits for database readiness while the reservation
  is held, or if competing launchd changes are not controlled, do not deploy.
- **Anchor:** `src/memory/upgrade-sequence.ts` and upstream 12.8
  `server_impl.py` initialization order.

- **launchd hypothesis:** Registering a uniquely named synthetic job returns
  while its process is waiting for a SQLite writer reservation, and that
  process can write after the reservation is released.
- **Measurement:** Queue a macOS launchd trial with a temporary job and scratch
  SQLite database; verify the job starts, cannot commit under the reservation,
  commits after release, and is removed afterward.
- **Success:** The synthetic job completes the post-release write and no test
  job remains registered. No real memory database or daemon is opened.
- **Pivot:** If registration waits for the blocked write, cleanup fails, or
  another process can replace the real daemon during handoff, do not deploy.
- **Anchor:** `src/memory/upgrade-sequence.ts` and
  [SQLite transaction behavior](https://www.sqlite.org/lang_transaction.html).

The synthetic trial met its stated success condition. It does not establish
exclusive control of the real daemon or prove upstream service readiness.

- **Service handoff hypothesis:** A temporary launchd job can start the actual
  candidate service against a reserved synthetic database and reach MCP
  readiness after the reservation is released.
- **Measurement:** Start the candidate in an isolated scratch environment with
  network denied, hold a SQLite write reservation across job registration,
  then release it and check MCP initialization and synthetic recall.
- **Success:** Registration returns while the reservation is held, MCP
  initialization and recall succeed after release, and the temporary job is
  removed. The test never accesses the live database or daemon.
- **Pivot:** If isolation, startup, recall, or cleanup fails, do not use the
  proposed handoff for a live upgrade. A pass still does not prove exclusive
  ownership against another launchd controller.
- **Anchor:** The candidate's `server_impl.py` initialization order and
  [SQLite transaction behavior](https://www.sqlite.org/lang_transaction.html).

The isolated candidate 12.8.0 trial met the success condition on a synthetic
database, including MCP initialization and exact recall. Its temporary job
was removed. The first harness attempts failed on nested sandbox execution and
Python path access; the successful retry retained the outer network-denying
sandbox. The real daemon and competing launchd controllers remain untested.

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

Upstream's [backup script](https://github.com/doobidoo/mcp-memory-service/blob/main/scripts/backup/backup_sqlite_vec.sh)
copies the database and sidecars separately, suppresses copy errors, and derives
the source from the base directory rather than the explicit SQLite path aliases.
It does not verify a snapshot. Do not use it as proof of a recoverable live
backup; retain the SQLite online backup and verification checks for this setup.

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

### Synthetic bootstrap isolation

- **Hypothesis:** OpenCode with Kimi can call the existing service's bootstrap
  tool against a separate empty store without reading the live memory service.
- **Measurement:** Start the pinned upstream service with a scratch database;
  run OpenCode with a scratch home and a project MCP endpoint pointing to the
  scratch service. Verify a tool result from `get_bootstrap_profile` and
  independently deny and probe access to the live memory port and user files.
- **Success:** The isolation controls pass, the synthetic bootstrap tool call
  succeeds, and both test processes stop cleanly. No live records are read.
- **Pivot:** If isolation, endpoint selection, bootstrap, or cleanup is not
  proven, stop the test and leave the OpenCode lifecycle instruction unchanged.
- **Anchor:** `src/memory/constants.ts`, the upstream MCP tool schema, and
  OpenCode's [configuration documentation](https://opencode.ai/docs/config/).

On November 12, the scratch server started and the controls confirmed that the
client could reach scratch state but could not reach the live memory port or an
outside file. Two client attempts timed out after 180 seconds each, including
one with the scratch file watcher disabled. The scratch server stopped. No
bootstrap result was observed, so the lifecycle instruction remains unchanged.

A third isolated attempt allowed the `/var` path needed by system DNS. DNS
resolution then succeeded. The client still could not read an outside sentinel or
reach the live memory port. Kimi called `get_bootstrap_profile` against the
separate empty store and received a behavioral profile. The scratch server
stopped. This proves one bootstrap call, not every OpenCode configuration.

### OpenCode shared-memory instruction

- **Hypothesis:** Naming OpenCode in the shared lifecycle makes its deployed
  instructions call the same bootstrap, search, and session-save tools used by
  Claude Code and Codex when shared memory is configured.
- **Measurement:** Add a contract assertion for OpenCode in the shared-memory
  section, confirm it fails before the instruction change, and rerun the
  contract and instruction-sync tests after the change.
- **Success:** One new assertion fails before the change and passes afterward;
  zero affected tests fail, with the existing failure and privacy rules intact.
- **Pivot:** If a host cannot use the existing lifecycle or a test fails, do not
  deploy the changed instruction.
- **Anchor:** `templates/AGENTS.md`, `src/core/agents.yaml`, and the isolated
  bootstrap plus synthetic Kimi recall and session-save trials above.

### Hosted trial trigger contract

- **Hypothesis:** Declaring the research workflow's existing triggers in the
  repository's workflow allowlist restores the CI contract without broadening
  the workflow's permissions or triggers.
- **Measurement:** `npx vitest run src/docs/ci-workflows.test.ts`.
- **Success:** The reproduced trigger-contract failure falls from one to zero,
  and every workflow security assertion passes.
- **Pivot:** If any assertion still fails or the workflow needs more privileges,
  leave the draft unmerged and investigate.
- **Anchor:** `src/docs/ci-workflows.test.ts` and `docs/ci.md`.

The isolated local Supermemory server reported that its embedded workflow
engine could not find a free port range. Its sandbox allowed only the trial
server and local-model ports. This identifies a test restriction; it does not
establish that Supermemory itself is unusable.

### Hosted Supermemory isolation repair

- **Root cause:** The trial denied the workflow engine's derived loopback
  ports, macOS network configuration, and hosts-file lookup. It also chose a
  chat model without a reported embedding capability.
- **Hypothesis:** Allowing only the empty derived loopback range, the named
  macOS service, and the hosts file, while using a pinned embedding model,
  lets the synthetic trial reach search without access to live memory.
- **Measurement:** Run the research trial on hosted macOS and its isolation
  controls; verify the pinned model and synthetic add/search result.
- **Success:** All isolation controls pass, startup succeeds, one synthetic
  fact is retrieved, and zero trial listeners remain.
- **Pivot:** On any isolation, startup, search, or cleanup failure, leave the
  candidate unranked and inspect the exact failure before further changes.
- **Anchor:** The local synthetic trial, the pinned server's port formula,
  and [Ollama's embedding model documentation](https://ollama.com/library/all-minilm).

The hosted trial passed after the isolation repair. In a separate local trial,
the synthetic phrase appeared in a source chunk. It did not appear in a memory
field during the following minute. In a longer isolated trial, a later
memory-only search returned the phrase in a memory field. The documented
extraction-status field was absent in the observed response. This does not
establish how well the candidate performs on coding tasks.

### Search result evidence

- **Hypothesis:** Checking result fields rather than the whole response avoids
  counting an echoed query as recall and distinguishes memories from chunks.
- **Measurement:** Run a fixture with an echoed query and no results, then
  fixtures with a matching memory and a matching chunk; rerun the hosted trial.
- **Success:** Zero false hits for the echo and one correct hit for each result
  type; the hosted trial reports which type contains the synthetic phrase.
- **Pivot:** If the response shape differs or any fixture fails, do not count
  the trial as recall evidence until its response is understood.
- **Anchor:** [Supermemory search response fields](https://github.com/supermemoryai/skills/blob/main/supermemory/SKILL.md).

## Beacon local review and recall

- **Hypothesis:** A synthetic candidate can be approved and retrieved through
  Beacon's local MCP server without network access.
- **Measurement:** In a scratch project, approve the existing synthetic
  candidate, start the local stdio server with network access denied, and call
  its memory search tool. Check the returned lesson and project scope.
- **Success:** The approved lesson is returned for its own project and is not
  returned for a different scratch project.
- **Pivot:** If approval or MCP recall needs external access or crosses project
  scope, do not recommend this workflow for local private memory.
- **Anchor:** [Beacon's local memory workflow](https://github.com/Asymptote-Labs/agent-beacon/blob/main/docs/cli/memory.mdx).

The isolated trial approved and retrieved the synthetic lesson for its own
project and returned no result for a second project with network access denied.
It did not measure automatic extraction, all client integrations, or quality.

## Upstream OpenCode capture marker

- **Hypothesis:** Since the pinned plugin's marker detector returns false for
  an ordinary `#skip`, its capture handler will send a matching synthetic
  assistant message to the memory API despite that marker.
- **Measurement:** Feed one synthetic decision message to the pinned plugin's
  event handler with a mock HTTP client and network access denied; count memory
  writes and inspect only the synthetic request body.
- **Success:** The mock sees one memory write containing the synthetic marker.
  This confirms the consequence of the already-observed detector result.
- **Pivot:** If no write occurs, inspect the handler and test setup before
  deciding whether automatic capture can be enabled. Do not test real data.
- **Anchor:** [Upstream 12.8.0 plugin](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/opencode/memory-plugin.js).

The network-denied synthetic event test observed one mock memory write, and
its request body included the `#skip` marker. The test passed only a synthetic
assistant message; it does not establish the behavior of every OpenCode event
or whether a real server would accept the write. Keep automatic capture off
for real sessions until the upstream marker and privacy behavior are fixed or
independently verified.

## Upstream Codex short correction

- **Hypothesis:** Under default capture settings, an ordinary short correction
  is not stored, while the same correction with `#remember` is stored.
- **Measurement:** Run the pinned upstream hook with synthetic transcripts,
  a mock HTTP client, isolated files, and network denied. Count writes for
  each of the two cases.
- **Success:** The unmarked correction produces zero writes and the marked
  correction produces one write containing the synthetic correction.
- **Pivot:** If either count differs, inspect the hook behavior and test setup
  before recommending the default lifecycle.
- **Anchor:** [Upstream 12.8.0 Codex hook](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/codex/memory-hook.js).

- **Skip-turn hypothesis:** The same upstream hook excludes a synthetic
  `#skip` user turn and its otherwise capturable assistant reply.
- **Measurement:** Send marked and unmarked synthetic turns to the isolated
  hook with a mock HTTP client and compare their write counts.
- **Success:** The marked turn writes zero memories and the matching unmarked
  control writes one. No network or real transcript is used.
- **Pivot:** If the marked turn writes or the control does not, do not rely on
  this hook for privacy until the cause is understood.
- **Anchor:** [Upstream Codex hook tests](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/codex/tests/memory-hook.test.js).

The network-denied synthetic hook trial matched both predictions. The short
unmarked correction produced no mock write, while the marked correction
produced one. A marked skip turn produced no write, and its unmarked control
produced one. This tests the hook with a mock HTTP client, not a live memory
service or a real Codex session.

## Supermemory local text trial

- **Hypothesis:** The published local server can ingest and retrieve a
  synthetic text memory using the installed Ollama service without external
  network access or access to the existing shared-memory service.
- **Measurement:** Run the checksum-verified 0.0.9 server with a scratch home
  and store, telemetry and update checks disabled, local Ollama models, and an
  external isolation policy that blocks outside network and the live memory
  socket. Submit a synthetic fact and query it through the documented API.
- **Success:** The trial confirms its isolation controls, retrieves the
  synthetic fact after ingestion, and leaves no trial listener running. It
  never reads actual agent transcripts or prints its generated key.
  This is a search smoke test; it does not prove that memory extraction, as
  distinct from source-chunk retrieval, succeeded.
- **Pivot:** If an embedding model is unavailable offline, local ingestion
  fails, isolation cannot be proven, or cleanup fails, report the failed step
  and do not recommend the integration on this evidence.
- **Anchor:** [Supermemory local setup](https://github.com/supermemoryai/supermemory/blob/main/apps/docs/self-hosting/overview.mdx)
  and [configuration](https://github.com/supermemoryai/supermemory/blob/main/apps/docs/self-hosting/configuration.mdx).

The same synthetic trial may run on a disposable hosted macOS runner. Download
the pinned server and local model before isolation; the trial itself must
restrict network access to its own listener and the local model. Its result is
independent evidence, not proof of the installed Mac or any agent integration.
The separately running Ollama server is outside that sandbox, so the policy
does not prove that requests made indirectly through Ollama cannot leave the
runner. Use only synthetic text and no user credentials for that trial.
The first hosted attempt stopped before isolation or server startup because
the trial specified the local 4B model's digest for the 0.6B model. A local
model-list check reproduced that mismatch. The trial now checks both the
correct model name and its published digest.
The next hosted attempt downloaded the correct model but the system Python
shim could not resolve Xcode inside the sandbox. The same error reproduced in
a restricted local `xcrun` probe. Resolving Python before entering the sandbox
and allowing its developer-tool files let a local Python probe start; the full
hosted trial still needs to run.
The next hosted attempt passed the outside-file, live-port and direct-network
isolation controls, but the server exited before readiness. The listener was
removed. Server output was kept private because it may contain a generated
key. The trial now reports only fixed failure categories and exit status.
The next run again passed isolation and exited with status 1 without matching
those categories. The diagnostic now also reports a fixed vocabulary of
non-secret technical words, without printing server text or the key.
The hosted server returned status 1 with terms for storage, the engine and
embeddings. A vendor issue documents a separate startup error file, so the
next diagnostic also classifies that scratch file without printing its text.
