# Shared memory before research

Install the optional `memory-first-research` rule when research needs shared
context across Claude Code and ChatGPT Work/Codex. It adds a research protocol
to the existing rules pipeline. It does not install a memory service or
activate account memory, privacy options, or schedules.

## Install and deploy

Create the shared rules source if it does not exist, select the rule, then sync:

```bash
agentbrew rules init
agentbrew install memory-first-research
agentbrew sync --only rules
```

The rule is opt-in (`recommended: false`). Selecting it appends a catalog-owned
block to the local shared rules source. Sync uses the same source for Claude
Code and Codex and preserves content outside each managed section.
[US04](user-stories/04-share-rules.md) explains ownership and rollback.

## Research flow

1. Before context-dependent work for a task, message, document, email, or
   meeting, query configured shared memory with ranked semantic recall. Use a
   non-empty query. Check dates and source links before relying on a result.
2. If configured recall fails, report **shared memory unavailable** and the
   failed tool. Block context-dependent work until the configured service is
   repaired. A deterministic local CLI action can still run without a model.
   If memory is deliberately unconfigured, state that scope.
3. After research, store dated reusable findings with sources. Correct stale
   records through version-aware updates instead of copying their old claims.
   Recall new saved findings before claiming persistence. An acknowledgment or
   attempted-write counter is not proof. If recall does not find the new fact,
   report persistence as unverified. Keep deduplication enabled; do not force
   duplicate records or rewrite a valid same-task record just to obtain proof.
4. Keep a local prep note. Link it from the memory entry and link the relevant
   memory references back from that note. The note's body stays local.

Do not copy raw private records, credentials, account sessions, privacy opt-ins,
or schedules between hosts. A rule can require careful research; it cannot
authorize a new data transfer or enable an account feature.

## Headless session save

Headless `codex exec` can complete memory reads while `commit_session_legacy`
is blocked: a write needs approval, but the invocation's approval policy is
`never`. Successful bootstrap and recall do not prove write permission. This
approval failure is distinct from a failed memory transport.

Use this recipe only with explicit user authorization for the session record
and its content. It is an invocation-only exception, not a persistent setting:

1. Find the configured server ID with `codex mcp list`. The example below uses
   `memory`; substitute the actual ID. Check existing owner policy before the
   run. If an explicit server or tool approval policy, disabled tool, allowlist,
   or other denial conflicts, stop. Do not override it or enable another server.
2. Prepare only reusable, authorized facts. Keep credentials and raw personal
   or business records out of the prompt and the memory record. Obtain
   authorization before launching the headless run; it cannot ask at runtime
   under `never`.
3. Add only the per-tool CLI override to the authorized invocation. For a server
   named `memory`, the command shape is:

   ```bash
   codex exec --sandbox read-only \
     -c 'mcp_servers.memory.tools.commit_session_legacy.approval_mode="approve"' \
     'Save only the explicitly authorized session record with commit_session_legacy; report the actual result.'
   ```

   This is a shape example, not authorization to run a model or write memory.
   Keep the invocation's existing `never` approval policy, read-only filesystem,
   tool allowlists, other MCP settings and owner denials unchanged. Do not add
   this override to `config.toml`, an Agentfile, a profile or agentbrew state.
   A different configured server ID needs its matching key. This CLI recipe
   supports bare IDs that match `[A-Za-z0-9_-]+`. For an unsupported server ID,
   stop and require version-specific validation. Do not guess quoted CLI keys,
   rename the server or substitute a plugin-scoped path.
4. Stop on failure. Name the failed tool and report the save as unrecorded;
   never claim learning was saved from assistant prose or a process exit alone.
   Check the actual tool result. Independent recall is needed before claiming
   durable retrieval. If configured bootstrap or recall also fails, report
   **shared memory unavailable** and block context-dependent work until
   `agentbrew memory doctor` and recall succeed.

`approve` explicitly approves this tool for the invocation. `auto` uses the
runtime's normal approval behavior; it does not mean pre-approved. This grant
is tool-scoped, not argument-scoped: it does not enforce one call or restrict
the record's content. Keep the run narrow and verify its actual calls. A tool
approval does not grant filesystem writes or permission for other tools.

The [official configuration reference](https://developers.openai.com/codex/config-reference)
defines `mcp_servers.<id>.tools.<tool>.approval_mode`. Check support in the
installed Codex version. If the key is unsupported or policy still blocks the
save, stop and report that boundary. Use an authorized interactive approval
path when available; do not weaken policy or silently switch to another writer.

## Verification

`src/sync/shared-memory-catalog-rule.test.ts` uses the real catalog install and
rules sync path in a scratch HOME. A synthetic external renderer supplies
the primary hosts' delegated output. The test checks
selected rule content on both hosts, preserves host-local notes, and never
reads an account or a real message, document, email, or meeting body.
