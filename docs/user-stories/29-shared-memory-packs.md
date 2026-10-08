# Shared Memory Packs

> I want org-neutral semantic memory with optional curated packs — one loopback daemon, explicit install, and team overlays that never delete my local memories.

```bash
agentbrew memory enable              # wire shared HTTP MCP + optional LaunchAgent (macOS)
agentbrew memory disable             # remove managed wiring; SQLite data preserved
agentbrew memory status --json       # daemon, schema, backup freshness
agentbrew memory doctor --ready      # startup gate: full MCP discovery + bootstrap
agentbrew memory doctor              # exit non-zero when discovery/runtime unhealthy
agentbrew memory transport-report --json # read-only evidence before a transport/auth migration
agentbrew memory fix                 # kickstart daemon + run maintenance
agentbrew memory backup              # safe SQLite backup via sqlite3 .backup
agentbrew memory verify-backup       # integrity_check + active row count
agentbrew memory maintain [--deep]   # schema check + optional deep maintenance
agentbrew memory pack list           # discovered packs (global + team overlay paths)
agentbrew memory pack install <id>   # explicit install into local semantic store
agentbrew memory pack update <id>    # reconcile installed pack to manifest fingerprint
agentbrew memory pack verify <id>    # dry-run diff vs ledger
agentbrew memory pack uninstall <id> # dry-run unless --confirm; pack-tagged rows only
```

## Ownership

| Layer | Owner | Notes |
| --- | --- | --- |
| Memory runtime (daemon, SQLite, backups) | **agentbrew** | Org-neutral; delegates to pinned `mcp-memory-service[sqlite]==11.7.0` via `uvx` |
| Generic / example packs | **agentbrew** | Fixture under `src/memory/fixtures/` — never org-specific content |
| Private / team packs | **team overlay** | Declared in overlay `Agentfile.yaml` `memoryPacks:` paths; agentbrew discovers and persists resolved paths only |
| Local DB, backups, memory IDs | **never committed** | Live under `~/Library/Application Support/mcp-memory/` and `~/.config/agentbrew/memory-packs/` |

## Invariants

1. **Explicit pack install** — packs are never auto-loaded from overlay discovery alone. `memory pack install` (or `sync` refreshing **installed** ledgers only) writes records.
2. **Sync refreshes installed only** — `agentbrew sync` reconciles packs listed in `~/.config/agentbrew/memory-packs/<id>.json` ledgers, not every discovered pack path.
3. **`team unset` never deletes pack memories** — overlay removal clears catalog/MCP wiring and resolved pack paths from state; SQLite rows and ledgers remain on disk.
4. **Shared HTTP transport** — one loopback Streamable HTTP endpoint (`127.0.0.1:18765/mcp`) fans out to all agents via MCP sync; avoids duplicate Python/ONNX processes per agent.
5. **Discovery is a health invariant** — readiness completes Streamable HTTP `initialize` → `notifications/initialized` → `tools/list`, preserves `MCP-Session-Id`, accepts JSON/SSE, and fails when `tools/list` is empty or unavailable.
6. **Bootstrap is a health invariant** — the managed daemon always sets `MCP_BOOTSTRAP_ENABLED=true` and caps bootstrap at 1,536 tokens; `memory doctor` fails when `get_bootstrap_profile` is disabled or unavailable.
7. **Sync reconciles without churn** — when memory is enabled, sync repairs a missing or drifted LaunchAgent and waits for full HTTP discovery readiness before pack work or MCP fanout. An unchanged loaded plist is not restarted.
8. **Upstream schemas are exact** — client calls use `tag_match`, `metadata.tags`, `content_hash`, and versioned `updates` as defined by pinned `mcp-memory-service[sqlite]==11.7.0`.
9. **Uninstall safety** — `memory pack uninstall` requires `--confirm` after a dry-run summary; deletes only rows tagged with the verified pack id/hash; sentinel and non-pack memories are preserved.
10. **Managed registration self-heals** — when `memory.enabled` is true, state contains one valid managed `memory` HTTP server. `agentbrew sync` repairs a missing or malformed entry before fan-out, and `agentbrew memory fix` also restores daemon readiness without replacing the SQLite database or deleting memory rows.
11. **Agentfile declarations converge** — base and overlay `memory.enabled` declarations merge monotonically, and `memoryPacks` paths are normalized relative to their declaring Agentfiles before they enter state. Generating an Agentfile preserves these fields without serializing the managed HTTP transport as a generic MCP entry.
12. **Claude project-memory ingestion is managed** — `agentbrew memory sync-projects` is the only project-file ingestion transport. Normal runs ingest only stores whose hashed metadata fingerprint changed; `--force` is the explicit recovery re-ingest. Records carry `claude-project-memory`, readable `project:<slug>`, and collision-resistant `project-source:sha256:…` tags. The readable label may collide and is never the sole provenance key. Recall remains global by default; callers use the source tag only for intentional filtering. The command exits zero when the daemon is unavailable and records only hashed file-tree metadata, counts, timestamps, and bounded scheduler outcomes. Claude Code's non-blocking `SessionEnd` hook records a receipt and debounces only after success; the daily job remains recovery.
13. **Primary-agent recall is shared** — Claude Code, Cursor, and Codex receive the same managed loopback memory MCP through the normal fan-out. Claude's project directory is one source, not a separate memory backend.
14. **Transport hardening is evidence-gated** — the pinned 11.7 runtime continues to use its compatible session-based discovery path until `memory transport-report` records loopback, Origin, unauthenticated-access, timeout, and five-primary-agent compatibility evidence. The report is read-only and does not make an authentication or protocol migration decision.

## Pack layout (v1)

```
my-pack/
  pack.yaml       # manifest — id, version, title, privacy, records, fingerprint
  records.jsonl   # deterministic JSONL (see ARCHITECTURE.md § Shared semantic memory)
  validation/     # optional scripts
  eval/           # optional eval fixtures
```

## Agentfile (optional)

```yaml
memory:
  enabled: true
memoryPacks:
  - ./packs/acme-internal   # overlay-relative; resolved at team set, not auto-installed
```

## When to use

- **Enable memory** when you want cross-agent semantic recall without per-agent stdio MCP processes.
- **Install a pack** when you have curated, versioned knowledge (runbooks, conventions) to seed the store.
- **Team overlay packs** when org-specific content must stay out of the public agentbrew repo — ship packs in the overlay repo, declare paths in `memoryPacks:`.
- **Claude project files** when a durable Claude Code fact should be searchable
  from every primary agent — `agentbrew memory sync-projects` (or its
  non-blocking session and daily triggers) indexes the source files without
  turning them into a pack.

## Related

- [US 03: Add MCP server](03-add-mcp-server.md) — catalog `memory` entry and HTTP URL pattern
- [US 27: Team overlays](27-team-overlay.md) — overlay-owned private packs
- [US 06: Drift detection](06-drift-detection.md) — `sync` / `fix` ensure memory daemon before MCP fanout
