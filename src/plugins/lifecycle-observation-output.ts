import { writeSync } from "node:fs";
import { lifecycleObservation } from "./lifecycle-observation.js";

export function marketplaceObservation() {
  const enabled = process.env.PLUGIN_LIFECYCLE_FIXTURE_OUTPUT === "1";
  return lifecycleObservation(
    "marketplace-copy",
    (record) => {
      if (!enabled) return;
      const line = `lifecycle-stage ${record}\n`;
      if (writeSync(2, line) !== Buffer.byteLength(line)) throw new Error("Incomplete lifecycle stage record");
    },
    undefined,
    () => {
      if (enabled) writeSync(1, "lifecycle-stage-recorder-failed\n");
    },
  );
}
