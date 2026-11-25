import { homedir } from "node:os";
import { basename, join } from "node:path";

const [mode, action, outcome] = process.argv.slice(2);
const home = process.cwd();
if (
  !basename(home).startsWith("agentbrew-sync-preview-") ||
  homedir() !== home ||
  process.env.AGENTBREW_EVENTS_FILE !== join(home, "events.jsonl") ||
  !["sequential", "parallel"].includes(mode) ||
  !["preview", "real"].includes(action) ||
  !["success", "failure"].includes(outcome)
) {
  throw new Error("Invalid sync receipt fixture inputs");
}

const { runSyncParallel, runSyncWithErrorCollection } = await import("./sync-runner.js");
const runner = mode === "parallel" ? runSyncParallel : runSyncWithErrorCollection;
await runner(
  [
    {
      name: "instructions",
      async fn(shared) {
        console.log("synthetic module ran");
        if (shared?.manifest) shared.manifest.managedMcpServers = ["fixture"];
        if (outcome === "failure") throw new Error("synthetic module failed");
      },
    },
  ],
  {
    skipGlobalAgentfile: true,
    installAgentfileItems: false,
    dryRun: action === "preview",
    syncModules: ["instructions"],
    compact: true,
  },
);
