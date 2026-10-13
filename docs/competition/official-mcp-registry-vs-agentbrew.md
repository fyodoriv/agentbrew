# Official MCP Registry vs agentbrew

## TL;DR

The official MCP Registry (`registry.modelcontextprotocol.io`) is the canonical
metadata source for public MCP servers. agentbrew should read install metadata
from it instead of hand-curating pointers in `src/catalog.yaml`.

**Verdict: Delegate (read-only, opt-in until the registry reaches 1.0/GA).**
**Next action:** when the registry API leaves `v0`, make registry lookup the
default (TASKS.md `flip-catalog-to-registry-first-at-ga`).

## Before and after

| | Before (2026-10-12) | After (opt-in) |
|---|---|---|
| Server not in `src/catalog.yaml` | `install` fails: "not found in catalog or sources" | `AGENTBREW_MCP_REGISTRY=1` resolves it from the registry |
| Server in `src/catalog.yaml` | catalog entry | catalog entry; the registry is never asked |
| Registry name maps to a catalog name | n/a | catalog entry wins |
| Registry down or offline | n/a | one warning line, then the local catalog and sources |
| Default behavior | local catalog only | unchanged: local catalog only |

## How it works

- Adapter: [`src/adapters/mcp-registry.ts`](../../src/adapters/mcp-registry.ts).
- A full name (`io.github.upstash/context7`) uses
  `GET /v0/servers/{name}/versions/latest`. A short name uses
  `GET /v0/servers?search=<name>&version=latest` and must match exactly one
  server; otherwise agentbrew asks for the full name.
- Mapping to a catalog MCP entry: an npm stdio package becomes
  `npx -y <package>@<version>`, a pypi stdio package becomes
  `uvx <package>==<version>`, and a `streamable-http` or `sse` remote becomes a
  `url` entry. Required env vars become `${NAME}` placeholders; optional ones are
  named in the entry note. Header templates such as `{api_key}` become
  `${API_KEY}`. OCI-only servers are not supported yet.
- The local server name is the last segment of the registry name. A generic
  segment (`mcp`, `server`) keeps the namespace, so `ac.inference.sh/mcp`
  becomes `ac-inference-sh-mcp`.
- The install itself runs through the normal `installMcpServer` path, so the
  server deploys to every agent and lands in the global Agentfile.

## Why opt-in

The registry API is still `v0` and has no stability promise. The task that
added this (`delegate-catalog-to-official-mcp-registry`) gated the switch to
registry-first on GA. Until then the local catalog stays authoritative.
