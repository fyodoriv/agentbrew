import { spawn } from "node:child_process";
import { logSkipped } from "./logger.js";
import { sendDailyDue, type TelemetryDeps } from "./telemetry.js";

/**
 * The automatic send after a sync, as a separate process.
 *
 * A network call can hang where no timeout reaches it: a DNS lookup that
 * never returns cannot be cancelled, and it keeps a process alive. So the
 * sync never does the send itself. When a send is due, it starts
 * `agentbrew telemetry send --auto` as a detached process and does not wait
 * for it. That process has its own hard time limit (src/cli.ts).
 *
 * The command line holds no key and no argument from the user. The child
 * reads the key the same way every command does.
 */
export function startDailySend(deps: TelemetryDeps & { spawnImpl?: typeof spawn } = {}): boolean {
  try {
    const script = process.argv[1];
    if (!script || !sendDailyDue(deps)) return false;
    const child = (deps.spawnImpl ?? spawn)(
      process.execPath,
      [...process.execArgv, script, "telemetry", "send", "--auto"],
      // AGENTBREW_EVENTS=0: the send is not a command the user ran, so it records no event.
      { detached: true, stdio: "ignore", env: { ...process.env, AGENTBREW_EVENTS: "0" } },
    );
    // A start that fails (no process slot) must not break the sync.
    child.on("error", (e) => logSkipped("core/telemetry-auto/spawn", e instanceof Error ? e.name : "error"));
    child.unref();
    return true;
  } catch (e) {
    logSkipped("core/telemetry-auto/startDailySend", e);
    return false;
  }
}
