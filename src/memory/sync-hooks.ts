import type { AgentBrewState } from "../types.js";
import { isMemoryEnabled } from "./enable.js";
import { installMemoryLaunchAgents, kickstartMemoryDaemon, memoryLaunchAgentSupported } from "./launchagent.js";
import {
  createFetchMemoryMcpClient,
  mcpInitializeHealthy,
  mcpToolsListHealthy,
  waitForMemoryMcpHealthy,
} from "./mcp-client.js";
import { reconcileAllInstalledPacks } from "./pack-reconcile.js";

export interface PrepareMemoryDeps {
  launchAgentSupported?: () => boolean;
  installLaunchAgents?: () => { installed: boolean; changed?: boolean; reason?: string };
  initializeHealthy?: () => Promise<boolean>;
  toolsListHealthy?: () => Promise<boolean>;
  readinessHealthy?: () => Promise<boolean>;
  waitUntilHealthy?: () => Promise<boolean>;
  kickstart?: () => boolean | undefined;
}

/** Ensure loopback memory daemon is reachable before MCP fanout when memory is enabled. */
export async function prepareMemoryForMcpSync(state: AgentBrewState, deps: PrepareMemoryDeps = {}): Promise<void> {
  if (!isMemoryEnabled(state)) return;
  const supported = (deps.launchAgentSupported ?? memoryLaunchAgentSupported)();
  const install = deps.installLaunchAgents ?? installMemoryLaunchAgents;
  const initializeHealthy = deps.initializeHealthy ?? (() => mcpInitializeHealthy());
  const toolsListHealthy = deps.toolsListHealthy ?? (() => mcpToolsListHealthy());
  const readinessHealthy =
    deps.readinessHealthy ??
    (async () => {
      const initialized = await initializeHealthy();
      return initialized && (await toolsListHealthy());
    });
  const waitUntilHealthy = deps.waitUntilHealthy ?? (() => waitForMemoryMcpHealthy());
  const kickstart = deps.kickstart ?? kickstartMemoryDaemon;

  const launchAgent = supported ? install() : { installed: false, changed: false };
  let healthy = launchAgent.changed ? await waitUntilHealthy() : await readinessHealthy();
  if (!healthy && supported) {
    kickstart();
    healthy = await waitUntilHealthy();
  }
  if (!healthy) throw new Error("shared memory MCP unavailable after LaunchAgent reconciliation");
}

/** Reconcile only installed pack ledgers — never auto-installs discovered packs. */
export async function syncInstalledMemoryPacks(state: AgentBrewState): Promise<number> {
  if (!isMemoryEnabled(state)) return 0;
  await prepareMemoryForMcpSync(state);
  const client = createFetchMemoryMcpClient();
  const results = await reconcileAllInstalledPacks(client);
  return results.length;
}
