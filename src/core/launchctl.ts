import { type ExecFileSyncOptions, execFileSync, spawnSync } from "node:child_process";
import chalk from "chalk";
import { homeIsUsersHome } from "./home-guard.js";
import { logSkipped } from "./logger.js";

/** launchctl verbs that only read launchd state. Every other verb changes it. */
const READ_ONLY_VERBS = new Set(["print", "print-disabled", "list", "blame", "version", "help"]);

/** True when HOME is the real user's home folder (see homeIsUsersHome). */
export function launchdTargetsThisHome(): boolean {
  return homeIsUsersHome();
}

/** Module scope, process lifetime: print the skip notice once per process. */
let skipNoticePrinted = false;

/**
 * The one owner of `launchctl` calls. Read-only verbs always run. A verb that
 * changes launchd (load, unload, bootstrap, enable, kickstart, ...) is skipped
 * and returns "" when HOME is not the user's home folder, so a test or a
 * scratch-HOME run can write plists under that HOME but never touches the
 * user's real jobs.
 */
export function runLaunchctl(args: string[], options: ExecFileSyncOptions = {}): string {
  const verb = args[0] ?? "";
  if (!READ_ONLY_VERBS.has(verb) && !launchdTargetsThisHome()) {
    if (!skipNoticePrinted) {
      skipNoticePrinted = true;
      // stderr, so JSON output on stdout stays valid.
      console.error(chalk.dim("  Skipped launchd: HOME is not your home folder, and launchd jobs are per user."));
    }
    return "";
  }
  const output = execFileSync("launchctl", args, { stdio: "pipe", ...options, encoding: "utf-8" });
  return String(output ?? "");
}

/**
 * A read-only launchctl query that reports its exit status. Returns undefined
 * when launchctl could not run (missing binary or timeout). Refuses verbs that
 * change launchd, so a probe never needs the HOME guard.
 */
export function probeLaunchctl(args: string[], timeoutMs: number): { status: number; stdout: string } | undefined {
  if (!READ_ONLY_VERBS.has(args[0] ?? "")) throw new Error(`probeLaunchctl is read-only; got "${args[0] ?? ""}"`);
  const result = spawnSync("launchctl", args, { encoding: "utf-8", timeout: timeoutMs });
  if (result.error || result.status === null) {
    logSkipped("core/launchctl/probe", result.error);
    return undefined;
  }
  return { status: result.status, stdout: result.stdout };
}
