import { writeSync } from "node:fs";
import { lifecycleObservation } from "./lifecycle-observation.js";

export const MARKETPLACE_INVOCATION = "marketplace-copy";
export const STAGE_PREFIX = "lifecycle-stage ";
export const STAGE_FALLBACK = "lifecycle-stage-recorder-failed\n";
export const WORKER_STDERR_COMPLETE = "lifecycle-worker-stderr-complete";

export function completeMarketplaceWorkerOutput() {
  if (process.env.PLUGIN_LIFECYCLE_FIXTURE_OUTPUT !== "1") return;
  const line = `${WORKER_STDERR_COMPLETE}\n`;
  if (writeSync(2, line) !== Buffer.byteLength(line)) throw new Error("Incomplete lifecycle worker receipt");
}

export function marketplaceObservation() {
  const enabled = process.env.PLUGIN_LIFECYCLE_FIXTURE_OUTPUT === "1";
  return lifecycleObservation(
    MARKETPLACE_INVOCATION,
    (record) => {
      if (!enabled) return;
      const line = `${STAGE_PREFIX}${record}\n`;
      if (writeSync(2, line) !== Buffer.byteLength(line)) throw new Error("Incomplete lifecycle stage record");
    },
    undefined,
    () => {
      if (enabled) writeSync(1, STAGE_FALLBACK);
    },
  );
}
