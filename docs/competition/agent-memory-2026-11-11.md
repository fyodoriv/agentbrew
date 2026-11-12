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
same endpoint. On November 12, an OpenCode session using Kimi called
`memory_search` and its recorded tool result contained the public advisory
record. This proves one shared read, not the full session lifecycle.

On November 11, a Codex-written research record was returned by Claude Code's
`memory_search` tool. Together, these are targeted cross-client reads, not a
measure of general retrieval quality or complete lifecycle compatibility.

The OpenCode trial used a scratch project. Its configuration included a rule
intended to deny code-mode `execute`, but the recorded session shows completed
`execute` calls. Those calls searched the memory tools and made a read-only
query. The reason for the rule mismatch is unverified; do not rely on that
scratch policy as an enforcement boundary. Bootstrap and session-save calls
were not demonstrated in this trial. OpenCode's [policy documentation](https://opencode.ai/docs/policies/#precedence)
says broader configuration can override a project policy and invalid rules
can be dropped. Either is a possible explanation, not a confirmed cause. Use
an external isolation boundary when testing untrusted tool behavior.

The upstream memory service supplies an [OpenCode plugin](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/opencode/README.md)
that supports OpenCode 2 and may reduce custom integration work. Its pinned
adapter passed its own unit tests in a network-denied scratch environment.
Those tests show that its OpenCode 2 capture adapter reads assistant text only.
The example enables automatic capture and session summaries. An isolated test
of the pinned marker detector returned false for ordinary `#skip` and
`#remember` inputs. A separate synthetic OpenCode 2 adapter test dropped a
user message containing `#skip` while retaining the assistant reply for capture
processing. A network-denied synthetic assistant-event test observed one mock
memory API write whose body included `#skip`. This does not prove every event
path or a real server write. Do not enable automatic capture on real sessions
until the write path and privacy behavior are verified. The adapter tests do not prove
end-to-end lifecycle behavior or correction capture.

The same upstream release also provides [Codex memory hooks](https://github.com/doobidoo/mcp-memory-service/blob/v12.8.0/codex/README.md)
for retrieval and session checkpoints. Its published tests include a user
`#skip` turn and forced `#remember` capture; this is a different adapter from
the OpenCode plugin. In a network-denied scratch test, the Codex hook's shared
marker detector recognized the same ordinary `#skip` and `#remember` examples
that the OpenCode detector missed. A separate synthetic parser test retained a
user correction and final answer while excluding instruction, commentary, and
reasoning records. Parsing is not capture: the hook defaults to a 300-character
minimum, and a short synthetic correction failed its classifier without an
override. It requires Codex hook trust and reads local transcripts.
Compatibility with this machine's existing hooks, privacy rules, and shared
memory lifecycle is unverified; do not install it into the live setup yet.

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
An isolated HTTP rehearsal confirmed that the old version accepted an
untrusted origin and the candidate rejected it; both accepted local MCP
initialization. The test used synthetic stores and did not modify live data.
On November 11, the upstream [published advisory list](https://github.com/doobidoo/mcp-memory-service/security/advisories)
included multiple version ranges covering 11.7.0. None listed 12.8.0 as
affected. Each advisory has its own configuration and exposure conditions;
the version comparison does not prove an exploit or rule out unknown issues.

## Candidates

| Product | Relevant strengths | Limitation for this decision |
|---|---|---|
| [Beacon](https://github.com/Asymptote-Labs/agent-beacon) | Captures activity across Claude Code, Codex, and OpenCode. Its [local MCP](https://github.com/Asymptote-Labs/agent-beacon/blob/main/docs/cli/mcp.mdx) serves reviewed project memory and local traces. | Its interactive setup preselects cloud forwarding. Trace capture can retain session content. Its [evaluation command](https://github.com/Asymptote-Labs/agent-beacon/blob/main/docs/cli/memory.mdx) defaults to a hosted evaluator. A synthetic local-only recall test passed; end-to-end quality and all client lifecycles remain unmeasured. |
| [MCP Memory Service](https://github.com/doobidoo/mcp-memory-service) | Existing local SQLite and ONNX search, MCP and REST, backed by an upstream maintainer. | The installed pin predates security fixes. A newer release still needs migration and client tests. |
| [Cognee](https://github.com/topoteretes/cognee) | Open-source graph memory, local-model Python setup, and an MCP server with remember, recall, and forget tools. | Its [MCP server defaults to a separate dataset per agent](https://github.com/topoteretes/cognee/blob/main/cognee-mcp/README.md); sharing needs explicit configuration. Its tool names differ from Agentbrew's lifecycle. The local MCP setup, migration, and all three clients need a matched test. |
| [Supermemory](https://supermemory.ai/blog/opencode-memory/) | Vendor documents plugins for Claude Code, Codex, and OpenCode, including OpenCode 2, with shared project memory and a local server option. | Its [self-hosting guide](https://github.com/supermemoryai/supermemory/blob/main/apps/docs/self-hosting/overview.mdx) says the server binary is not open source, has a free-tier document limit, and does not include the hosted MCP server. Local model, telemetry, retention, migration, and cross-client behavior need testing. |
| [OpenViking](https://github.com/volcengine/OpenViking) | AGPL-licensed memory platform with [Claude, Codex, and OpenCode integrations](https://github.com/volcengine/OpenViking/blob/main/docs/en/agent-integrations/01-overview.md), including an OpenCode 2 plugin. It supports local embeddings. | Memory extraction [requires a model](https://github.com/volcengine/OpenViking/blob/main/docs/en/faq/faq.md). Its [OpenCode plugin](https://github.com/volcengine/OpenViking/blob/main/examples/opencode-plugin/README.md) documents Git-origin project identity and broad cross-project recall by default. The [integration guide](https://github.com/volcengine/OpenViking/blob/main/docs/en/agent-integrations/10-opencode.md) says it captures tool output verbatim. Test isolation, provider destinations, capture, and shared identity before using real sessions. |
| [Mem0](https://github.com/mem0ai/mem0) | Hosted and self-hosted memory APIs. | Its former self-hosted [OpenMemory MCP project is archived](https://github.com/mem0ai/openmemory/blob/main/openmemory-archive/README.md); current local coding-agent integration needs verification. |
| [Graphiti](https://github.com/getzep/graphiti) | Temporal knowledge-graph retrieval. | Its MCP and REST servers are reference implementations, not production deployments; upstream says they omit authentication and authorization. |
| [Letta](https://github.com/letta-ai/letta-code) | Persistent agent state and a [local backend](https://docs.letta.com/self-hosting/app-server). | It is an agent platform; its fit as a drop-in shared store for all existing clients has not been demonstrated. |
| [World Model MCP](https://github.com/SaravananJaichandar/world-model-mcp) | Local MIT-licensed memory with provenance; its README documents Claude Code and a [Codex adapter](https://github.com/SaravananJaichandar/world-model-mcp/blob/main/adapters/codex/README.md). | The Codex adapter is labeled experimental. The README does not document an OpenCode adapter; shared storage, client lifecycle, and privacy need a trial. Its published coding benchmark is maintained by the same author as the product. |
| [OpenCode Agent Memory](https://github.com/cytsaiap-xyz/opencode-agent-memory) | Local OpenCode session collection, a scheduled LLM distiller, and read-only MCP search. Its design records evidence and supports a self-hosted model. | Its collector is OpenCode-specific, and the MCP server does not provide the current shared write lifecycle. Its documented quick start backfills historical sessions and installs scheduled jobs; do not run it against private history for a trial. Cross-client behavior, maintenance, and quality are unverified. |

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
On November 12, isolated tests with network access denied created and approved
a candidate from a synthetic Claude Code trace. Local MCP returned the lesson
for its project and no result for a second project. Other clients and memory
quality were not tested.

Supermemory is worth a separate local trial because its documented plugins
cover the requested clients. Its [product page](https://supermemory.ai/product/)
calls the local binary open source, while its self-hosting guide says that
binary comes from a non-public codebase. Treat the licensing claim as
inconsistent until the vendor clarifies it. Do not install its plugins into
live agent profiles or auto-capture existing sessions for a trial; start with
synthetic data in an isolated store and check all network destinations.
The 0.0.9 macOS release passed its published checksum and a version probe
after isolation controls blocked outside files and the live memory socket.
This is not a memory, model-provider, or cross-agent integration test.
The [local-server configuration guide](https://github.com/supermemoryai/supermemory/blob/main/apps/docs/self-hosting/configuration.mdx)
says telemetry is collected unless disabled and documents switches to suppress
the startup key, browser launch, and update check. Local embeddings are the
default; memory extraction also needs a configured model. Test these settings
and network traffic rather than assuming local storage means offline operation.

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
At benchmark revision `c1b15726f1153b02dda0490ca1936bb86a809514`, its
[Supermemory adapter](https://github.com/GiulioDER/agent-memory-bench/blob/c1b15726f1153b02dda0490ca1936bb86a809514/adapters/supermemory/adapter.py)
defaults to the local API and uses the official Claude Code plugin. This offers
a reusable comparison arm, but it has not been run for this decision.
Its current published run reports no statistically clear winner. It used one
seed per task and did not match memory arms for token budget. Its authors also
disclose that the run's registration followed the first session. These limits
make it useful for designing a comparison, not for choosing our winner.

The [Agent Memory Leaderboard coding analysis](https://agentmemories.ai/blog?post=coding-leaderboard-analysis-20260915)
reports a separate evaluation using historical tasks from 12 repositories and
150 tasks to solve. Its [evaluation process](https://agentmemories.ai/)
requires publicly reachable participant endpoints, so it is not a reason to
expose the local memory database. The published rankings do not establish the
best choice for this machine or compare the specific configurations here.

The author of World Model MCP also published a
[pre-registered repeat-mistake benchmark](https://github.com/SaravananJaichandar/coding-agent-memory-benchmark).
It compares memory on and off for 49 paired tasks with Claude Code. It is a
single-author, self-published product study, not an independent comparison of
the candidates above or a test of Codex and OpenCode.
