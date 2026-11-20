import { closeSync } from "node:fs";
import { marketplaceObservation } from "./lifecycle-observation-output.js";

const scenario = process.argv[2];

const scenarios = ["intact", "closed-primary", "action-failed", "closed-both"];
if (!scenarios.includes(scenario)) process.exit(3);

const observe = marketplaceObservation();
const actionError = new Error("LIFECYCLE_SYNTHETIC_PRIVATE_MARKER");
let actionCalls = 0;

if (scenario === "closed-primary" || scenario === "closed-both") closeSync(2);
if (scenario === "closed-both") closeSync(1);

try {
  const value = await observe("add", () => {
    actionCalls += 1;
    if (scenario === "action-failed") {
      closeSync(2);
      throw actionError;
    }
    return "action-completed";
  });
  process.exitCode =
    scenario === "intact" && value === "action-completed" && observe.health() === "healthy" && actionCalls === 1
      ? 0
      : 3;
} catch (error) {
  const expectedActionFailure = scenario === "action-failed" && actionCalls === 1 && error === actionError;
  const expectedBeginFailure =
    (scenario === "closed-primary" || scenario === "closed-both") &&
    actionCalls === 0 &&
    (error as NodeJS.ErrnoException)?.code === "EBADF";
  process.exitCode = observe.health() === "unqualified" && (expectedActionFailure || expectedBeginFailure) ? 17 : 3;
}
