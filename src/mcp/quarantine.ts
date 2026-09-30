import type { McpQuarantine, McpServer } from "../types.js";
import { MCPM_PREFIX } from "./mcpm-hygiene.js";

/**
 * Why this exists
 * ---------------
 * Every other repair in `src/mcp` assumes the endpoint can be made to work:
 * fix the path, add the CA bundle, re-derive the token, re-run the sync. Some
 * endpoints cannot. A service that accepts the credential and then denies
 * authorization, a host that has been decommissioned, an entitlement only its
 * owning team can grant — none of those are repairable from this machine.
 *
 * Left in state, one such endpoint is deployed to every agent and reports a
 * failed MCP connection on every launch. The noise is the real cost: a user
 * who sees the same red line in every session stops reading the red lines, and
 * the next genuine failure goes unnoticed.
 *
 * Quarantine keeps the definition and the evidence in `state.yaml` but holds
 * the entry out of the fanout, so agents start clean and the blocked endpoint
 * is reported once, with the owner who can lift it.
 */

/** True when the server is marked unusable and must not reach any agent. */
export function isQuarantined(server: McpServer): boolean {
  return Boolean(server.quarantine?.reason);
}

export interface QuarantinePartition {
  /** Servers safe to deploy. */
  active: McpServer[];
  /** Servers held back, in state order. */
  quarantined: McpServer[];
}

/** Split a server list into the deployable set and the held-back set. */
export function partitionQuarantined(servers: readonly McpServer[]): QuarantinePartition {
  const active: McpServer[] = [];
  const quarantined: McpServer[] = [];
  for (const server of servers) {
    (isQuarantined(server) ? quarantined : active).push(server);
  }
  return { active, quarantined };
}

/**
 * Config keys a quarantined server can occupy.
 *
 * Intersection agents receive their entries through mcpm, which prefixes the
 * key. Pruning only the bare name would leave the mcpm copy connecting — and
 * failing — on every launch of those agents.
 */
export function quarantinedEntryKeys(servers: readonly McpServer[]): Set<string> {
  const keys = new Set<string>();
  for (const server of servers) {
    if (!isQuarantined(server)) continue;
    keys.add(server.name);
    keys.add(`${MCPM_PREFIX}${server.name}`);
  }
  return keys;
}

/** One line per quarantined server, for `agentbrew status` and the sync summary. */
export function formatQuarantineNotice(servers: readonly McpServer[]): string[] {
  return servers.filter(isQuarantined).map((server) => {
    const quarantine = server.quarantine as McpQuarantine;
    const owner = quarantine.owner ? ` — owner: ${quarantine.owner}` : "";
    return `${server.name}: ${quarantine.reason}${owner}`;
  });
}
