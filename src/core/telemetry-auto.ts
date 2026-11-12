import { spawn } from "node:child_process";
import { logSkipped } from "./logger.js";
import { AUTO_TIMEOUT_MS, claimDailySend, quietCommand, sendDaily, type TelemetryDeps } from "./telemetry.js";

/**
 * The automatic send after a command, as a separate process.
 *
 * A network call can hang where no timeout reaches it: a DNS lookup that
 * never returns cannot be cancelled, and it keeps a process alive. So a
 * command never does the send itself. When a send is due, it starts
 * `agentbrew telemetry send --auto` as a detached process and does not wait
 * for it. That process has its own hard time limit (runAutoSend).
 *
 * Every command that is not quiet runs this check (the postAction hook in
 * cli.ts), so a machine that never runs a plain sync still sends. A quiet
 * command starts none: `--json`, completion, a hook, and `telemetry` itself.
 *
 * The command line holds no key and no argument from the user. The child
 * reads the key the same way every command does.
 */
export function startDailySend(
  deps: TelemetryDeps & { spawnImpl?: typeof spawn; command?: string; argv?: readonly string[] } = {},
): boolean {
  try {
    const script = process.argv[1];
    if (!script || quietCommand(deps.command, deps.argv) || !claimDailySend(deps)) return false;
    const child = (deps.spawnImpl ?? spawn)(
      process.execPath,
      // A debugger flag is not passed on: the child would wait for a debugger or fight for its port.
      [...process.execArgv.filter((arg) => !arg.startsWith("--inspect")), script, "telemetry", "send", "--auto"],
      // AGENTBREW_EVENTS=0: the send is not a command the user ran, so it records no event.
      { detached: true, stdio: "ignore", env: { ...process.env, AGENTBREW_EVENTS: "0" } },
    );
    // A start that fails (no process slot) must not break the command.
    child.on("error", (e) => logSkipped("core/telemetry-auto/spawn", e instanceof Error ? e.name : "error"));
    child.unref();
    return true;
  } catch (e) {
    logSkipped("core/telemetry-auto/startDailySend", e);
    return false;
  }
}

/**
 * `telemetry send --auto`: what the detached process runs. One quiet daily
 * send, then the process ends. The timer is the hard limit: a DNS lookup that
 * never returns ignores the send's own timeout and would keep the process
 * alive. `deps` are seams for tests.
 */
export async function runAutoSend(
  version: string,
  deps: { sendDaily?: (version: string) => Promise<void>; exit?: (code: number) => void } = {},
): Promise<void> {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  const timer = setTimeout(() => exit(0), AUTO_TIMEOUT_MS + 1_000);
  await (deps.sendDaily ?? sendDaily)(version);
  clearTimeout(timer);
  exit(0);
}
