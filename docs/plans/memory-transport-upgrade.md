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

The candidate's published tool registry and the live `tools/list` response
were compared for the memory lifecycle tools Agentbrew calls. The candidate
declares each checked tool without removing fields or adding required fields
in the directly nested object and array schemas. The same check found no
changes to their simple type, enum, and numeric or string bounds. It does not
cover schema combinators, returned data, permissions, or runtime compatibility.
