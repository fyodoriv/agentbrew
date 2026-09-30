import type { Manifest } from "../manifest.js";
import type { AgentBrewState } from "../types.js";
import type { Logger } from "./logger.js";
import { createLogger, createSilentLogger } from "./logger.js";
import type { StateManager } from "./state-manager.js";
import { createInMemoryStateManager, getStateManager } from "./state-manager.js";

export interface Context {
  logger: Logger;
  state: StateManager;
  /** Shared manifest for parallel sync — all modules read/write the same
   *  in-memory object, saved once after all modules complete. */
  manifest?: Manifest;
}

export function createContext(options?: { quiet?: boolean; compact?: boolean }): Context {
  // Lazy proxy — delegates to the singleton which is initialized by state.ts on first use
  const lazyState: StateManager = {
    load: () => getStateManager().load(),
    require: (opts) => getStateManager().require(opts),
    save: (s) => getStateManager().save(s),
    update: (fn) => getStateManager().update(fn),
    invalidate: () => getStateManager().invalidate(),
    agents: () => getStateManager().agents(),
    sources: () => getStateManager().sources(),
    mcpServers: () => getStateManager().mcpServers(),
  };
  return {
    logger: createLogger(options?.quiet, options?.compact),
    state: lazyState,
  };
}

export function createTestContext(
  initialState?: AgentBrewState,
): Context & { stateManager: ReturnType<typeof createInMemoryStateManager> } {
  const stateManager = createInMemoryStateManager(initialState);
  return {
    logger: createSilentLogger(),
    state: stateManager,
    stateManager,
  };
}
