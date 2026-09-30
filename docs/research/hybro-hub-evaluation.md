# Hybro Hub Evaluation

> Research status: **Complete** — Recommendation: **Watch**
> Last updated: 2026-04

## Executive Summary

Hybro Hub is an early-stage (v0.1.15, alpha, 11 stars) Python daemon that bridges local A2A agents to the hybro.ai cloud portal. The A2A (Agent-to-Agent) protocol it implements is a legitimate, Google-backed, Linux Foundation-governed standard that genuinely complements MCP — but operates at a different layer. Neither Hybro Hub nor A2A integration is ready for agentbrew today.

**Recommendation: Watch.** Revisit when a top-tier agentbrew-supported agent ships native A2A config support.

## 1. What Is Hybro Hub?

A lightweight Python background daemon that:
1. **Discovers** local A2A agents by scanning localhost ports and fetching `/.well-known/agent-card.json`
2. **Registers** them with the hybro.ai cloud relay via an HTTPS API key
3. **Dispatches** messages from the hybro.ai web portal to the correct local agent
4. **Routes** responses back with optional PII detection (log-only in v0.1.15)

Bundled adapters: Ollama, OpenClaw, n8n. Requires Python 3.11+ and a hybro.ai account.

## 2. A2A Protocol Maturity

| Dimension | MCP (Model Context Protocol) | A2A (Agent-to-Agent) |
|-----------|------------------------------|----------------------|
| **Layer** | Agent-to-Tool | Agent-to-Agent |
| **Role model** | Client/server | Peers |
| **Transport** | stdio or HTTP/SSE | JSON-RPC 2.0 over HTTP(S) |
| **Discovery** | Static config file | `/.well-known/agent-card.json` |
| **State** | Stateless per call | Long-running tasks |

**Bullish signals**: Google-backed, Linux Foundation-governed, 5 official SDKs, DeepLearning.AI course, LangGraph/ADK support, active development.

**Bearish for agentbrew**: Zero agentbrew-supported agents (Claude Code, Cursor, Windsurf, Devin) have native A2A config. No A2A config file path exists to sync to.

## 3. Why Not to Integrate

1. **McpServer type can't represent A2A agents** — `McpServer` requires `command` (stdio) or `url` (SSE/HTTP with MCP protocol semantics). A2A agents use `tasks/send`, `tasks/get` JSON-RPC — structurally different.

2. **No target agent supports A2A config** — none of 50+ agents have an A2A config path. An A2A sync engine would need entirely new, currently non-existent config paths.

3. **Language mismatch** — agentbrew is Node.js; Hybro Hub is Python. Would require a new installation paradigm (pip + daemon management).

4. **Vendor lock-in** — Hybro Hub requires a hybro.ai account; gateway URL hardcoded to `api.hybro.ai`. Service shutdown = total failure.

5. **Privacy claims undelivered** — PII blocking is "planned for future release"; currently log-only.

## 4. Hybro Hub Maturity

| Signal | Detail |
|--------|--------|
| Version | v0.1.15 — pre-stable |
| PyPI status | "Development Status :: 3 - Alpha" |
| Stars | 11 |
| Age | ~17 days from first to latest release |
| Contributors | Primarily one (kevinlu310) |
| Test coverage | 10 test files, ~138KB — above-average for alpha |
| Vendor lock | hybro.ai account required |

**Verdict**: Not mature enough to depend on.

## 5. A2A vs MCP: Complementary

MCP addresses **vertical** integration (agent getting capabilities from tools). A2A addresses **horizontal** integration (agents collaborating as peers). agentbrew's value lives in the MCP/tool config layer. A2A is a different layer that will matter eventually but requires agents to ship native support first.

## 6. Revisit Triggers

Upgrade to `catalog-add` when **any one** of:
- A major agent (Claude Code, Cursor, Devin) ships a native A2A config file path
- Hybro Hub reaches v1.0 with 500+ stars and open relay spec
- A lightweight A2A adapter emerges requiring only a URL entry

Upgrade to `integrate` when:
- 3+ top agents ship A2A config support
- A standardized A2A config file format maps onto the existing `McpFormatAdapter` pattern
