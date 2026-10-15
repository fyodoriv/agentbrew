import { collectModelDrift } from "../sync/model-sync.js";
import type { DriftItem } from "./types.js";

/**
 * Report agents whose config file names a different model (or effort) than
 * the Agentfile's `defaultModel`. Sync repairs this silently on every tick;
 * this check makes the change visible in `agentbrew status` first.
 */
export function checkModelsDrift(): DriftItem[] {
  return collectModelDrift().map((drift) => ({
    agent: drift.agentName,
    type: "models",
    detail: `expected model ${drift.expectedModel} (${drift.changes.join(", ")})`,
    diff: { updated: drift.changes },
  }));
}
