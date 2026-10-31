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
4. Keep a local prep note. Link it from the memory entry and link the relevant
   memory references back from that note. The note's body stays local.

Do not copy raw private records, credentials, account sessions, privacy opt-ins,
or schedules between hosts. A rule can require careful research; it cannot
authorize a new data transfer or enable an account feature.

## Verification

`src/sync/shared-memory-catalog-rule.test.ts` uses the real catalog install and
rules sync path in a scratch HOME. A synthetic external renderer supplies
the primary hosts' delegated output. The test checks
selected rule content on both hosts, preserves host-local notes, and never
reads an account or a real message, document, email, or meeting body.
