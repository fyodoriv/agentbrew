# Agent memory comparison — November 11, 2026

The current shared memory already delegates storage and search to the
open-source `mcp-memory-service`. Keep it as the baseline while testing a
patched version and comparing Beacon and Supermemory. None has yet won an
equal, local coding-task evaluation. The current 11.7.0 pin needs a security
upgrade before it can be recommended without qualification.

## Current setup

Agentbrew owns the local daemon, its configuration, backup checks, and client
registration. The engine is the upstream SQLite-backed service, pinned in
[`src/memory/constants.ts`](../../src/memory/constants.ts). The
[shared-memory story](../user-stories/29-shared-memory-packs.md) describes its
loopback endpoint and project-memory ingestion. Claude Code and Codex use the
same endpoint. OpenCode's configuration declares that endpoint; an actual Kimi
session still needs a successful recall test.

On November 11, a Codex-written research record was returned by Claude Code's
`memory_search` tool. This proves one cross-client read, not general retrieval
quality or OpenCode compatibility.

## Security gate

[Upstream advisory GHSA-8p26-g7wp-65jw](https://github.com/doobidoo/mcp-memory-service/security/advisories/GHSA-8p26-g7wp-65jw)
describes cross-origin access to unauthenticated local transports through
version 12.5.0; version 12.6.0 is the stated fix. The live 11.7.0 daemon
accepted unauthenticated discovery and an untrusted-origin preflight returned
wildcard CORS headers. No destructive exploit was run. Browser protections and
the complete attack path were not tested.

Version [12.8.0](https://github.com/doobidoo/mcp-memory-service/releases/tag/v12.8.0)
is the latest release observed for this research. Its compatibility and
database migrations must pass the isolated checks in the
[upgrade prediction](../plans/memory-transport-upgrade.md) before deployment.
On November 11, the upstream [published advisory list](https://github.com/doobidoo/mcp-memory-service/security/advisories)
included multiple version ranges covering 11.7.0. None listed 12.8.0 as
affected. Each advisory has its own configuration and exposure conditions;
the version comparison does not prove an exploit or rule out unknown issues.

## Candidates

| Product | Relevant strengths | Limitation for this decision |
|---|---|---|
| [Beacon](https://github.com/Asymptote-Labs/agent-beacon) | Captures activity across Claude Code, Codex, and OpenCode. Its [local MCP](https://github.com/Asymptote-Labs/agent-beacon/blob/main/docs/cli/mcp.mdx) serves reviewed project memory and local traces. | Its interactive setup preselects cloud forwarding. Trace capture can retain session content. Its [evaluation command](https://github.com/Asymptote-Labs/agent-beacon/blob/main/docs/cli/memory.mdx) defaults to a hosted evaluator. Local-only retrieval and end-to-end quality have not been measured here. |
| [MCP Memory Service](https://github.com/doobidoo/mcp-memory-service) | Existing local SQLite and ONNX search, MCP and REST, backed by an upstream maintainer. | The installed pin predates security fixes. A newer release still needs migration and client tests. |
| [Cognee](https://github.com/topoteretes/cognee) | Open-source graph memory, local-model Python setup, and an MCP server with remember, recall, and forget tools. | Its [MCP server defaults to a separate dataset per agent](https://github.com/topoteretes/cognee/blob/main/cognee-mcp/README.md); sharing needs explicit configuration. Its tool names differ from Agentbrew's lifecycle. The local MCP setup, migration, and all three clients need a matched test. |
| [Supermemory](https://supermemory.ai/blog/opencode-memory/) | Vendor documents plugins for Claude Code, Codex, and OpenCode, including OpenCode 2, with shared project memory and a local server option. | Its [self-hosting guide](https://github.com/supermemoryai/supermemory/blob/main/apps/docs/self-hosting/overview.mdx) says the server binary is not open source, has a free-tier document limit, and does not include the hosted MCP server. Local model, telemetry, retention, migration, and cross-client behavior need testing. |
| [Mem0](https://github.com/mem0ai/mem0) | Hosted and self-hosted memory APIs. | Its former self-hosted [OpenMemory MCP project is archived](https://github.com/mem0ai/openmemory/blob/main/openmemory-archive/README.md); current local coding-agent integration needs verification. |
| [Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge-graph retrieval. | Its MCP and REST servers are reference implementations, not production deployments; upstream says they omit authentication and authorization. |
| [Letta](https://github.com/letta-ai/letta-code) | Persistent agent state and a [local backend](https://docs.letta.com/self-hosting/app-server). | It is an agent platform; its fit as a drop-in shared store for all existing clients has not been demonstrated. |

Beacon is a candidate for capturing useful lessons, including as a complement
to the existing store. Its local MCP exposes approved memory; it does not itself
approve pending candidates. Do not install cloud forwarding or capture private
traces for the comparison. Use synthetic data and a separate local store.

Beacon's [local workflow](https://github.com/Asymptote-Labs/agent-beacon/blob/main/docs/cli/memory.mdx)
scores traces but does not write the lesson text. A person or agent can author
a candidate without the hosted evaluator, then approve it. Approved memory is
project-scoped; its local MCP memory tools are read-only. This differs from the
current agent workflow, which can write a shared memory directly. Local Beacon
is therefore not yet shown to be a drop-in replacement for that workflow.

Supermemory is worth a separate local trial because its documented plugins
cover the requested clients. Its [product page](https://supermemory.ai/product/)
calls the local binary open source, while its self-hosting guide says that
binary comes from a non-public codebase. Treat the licensing claim as
inconsistent until the vendor clarifies it. Do not install its plugins into
live agent profiles or auto-capture existing sessions for a trial; start with
synthetic data in an isolated store and check all network destinations.

## Published hosted pricing

Prices below were checked November 11 and can change. They are not the cost of
the local, open-source options or of any separately billed models.

- [Beacon Cloud](https://beacon.sh/pricing) lists a free tier and Pro at $20 per month when billed annually. The pricing page lists agent memory save and recall over MCP under Pro.
- [Mem0](https://mem0.ai/pricing) lists a free tier with request limits and a bring-your-own-model-key option, plus custom plans.
- [Zep](https://www.getzep.com/pricing/) lists its Flex hosted plan at $125 per month billed monthly, with usage credits.
- [Letta](https://docs.letta.com/pricing) lists a free individual plan with external model credentials and Pro at $20 per month.

## Compare outcomes, not claims

The [VibeMemBench paper](https://arxiv.org/abs/2609.23570) reports that most
tested memory-system and solver pairings did not exceed their matched
memory-off baseline on executable coding tasks. It does not establish a result
for this setup. The upstream service's published
[retrieval benchmark](https://github.com/doobidoo/mcp-memory-service/blob/main/docs/BENCHMARKS.md)
measures an earlier version, not the proposed upgrade.

Use an existing execution-graded benchmark such as
[agent-memory-bench](https://github.com/GiulioDER/agent-memory-bench), plus
synthetic cross-client recall, stale-fact, isolation, and deletion checks.
Compare equal tasks, models, context budgets, and a memory-off baseline. Record
task success, recall, latency, local storage, costs, and data destinations.
Do not name a winner until the compared configurations have actually run.

The benchmark's published grid tests retrieval against a preloaded corpus; it
does not test how products extract or persist memories. It is Claude-specific,
and its authors also make a competing memory product. Beacon and the current
service need reviewed adapters before a matched run. Treat the benchmark as one
input, not proof of a complete cross-agent ranking.
