/**
 * Fingerprint of everything the sync-time mcpm bridge reads.
 *
 * The bridge in `src/sync/mcp-sync.ts` spawns `mcpm new` plus one
 * `mcpm client edit` per intersection client for each server it thinks is
 * out of date. mcpm is a Python CLI, so each spawn costs one to several
 * seconds. When a client never shows the entry (mcpm writes it somewhere
 * else, or not at all), the server looks out of date on every sync, and
 * every sync pays the full cost again (issue #580).
 *
 * Sync stores this fingerprint in the manifest after a non-dry run. The next
 * sync skips the bridge when the fingerprint is the same: nothing the bridge
 * reads has changed, so another attempt cannot give a different result.
 * Any change to a state server, the detected clients, mcpm's `servers.json`
 * entry, or a client's entry for a state server changes the fingerprint.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { logSkipped } from "../core/logger.js";
import { MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import { readMcpmServer } from "../sync/mcp-delegate.js";
import type { AgentConfig, McpServer } from "../types.js";
import { expandHome } from "../utils.js";
import { readMcpJson } from "./mcp.js";
import { MCPM_PREFIX } from "./mcpm-hygiene.js";

function readClientEntries(agent: Omit<AgentConfig, "detected">, servers: readonly McpServer[]): unknown {
  if (!agent.mcpConfig || (agent.mcpFormat ?? "json") !== "json") return null;
  const path = expandHome(agent.mcpConfig);
  if (!existsSync(path)) return null;
  try {
    const config = readMcpJson(path) as Record<string, unknown>;
    const map = config[agent.mcpKey ?? "mcpServers"];
    if (typeof map !== "object" || map === null) return {};
    const entries = map as Record<string, unknown>;
    // Only the keys the bridge checks, so unrelated writes to the same file
    // (for example Claude Code's own history in ~/.claude.json) do not count.
    return servers.map((server) => [entries[server.name] ?? null, entries[`${MCPM_PREFIX}${server.name}`] ?? null]);
  } catch (error) {
    logSkipped("mcp/mcpm-bridge-fingerprint/read", error);
    return "unreadable";
  }
}

export function computeMcpmBridgeFingerprint(
  servers: readonly McpServer[],
  agentDefinitions: readonly Omit<AgentConfig, "detected">[],
  detectedAgents: readonly string[],
): string {
  const sorted = [...servers].sort((a, b) => a.name.localeCompare(b.name));
  const clients = [...new Set(detectedAgents.filter((name) => MCP_INTERSECTION_AGENTS.has(name)))].sort();
  const payload = {
    servers: sorted.map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      url: server.url,
      headers: server.headers,
    })),
    mcpm: sorted.map((server) => readMcpmServer(server.name) ?? null),
    clients: clients.map((name) => {
      const agent = agentDefinitions.find((definition) => definition.name === name);
      return [name, agent ? readClientEntries(agent, sorted) : null];
    }),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
