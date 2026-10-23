import { type ExecFileSyncOptions, execFileSync, type SpawnSyncReturns, spawnSync } from "node:child_process";
import chalk from "chalk";
import { homeIsUsersHome } from "./home-guard.js";
import { logSkipped } from "./logger.js";

/** `systemctl --user` verbs that only read the user manager's state. */
const SYSTEMCTL_READ_ONLY = new Set([
  "is-active",
  "is-enabled",
  "is-failed",
  "show",
  "status",
  "cat",
  "list-timers",
  "list-units",
]);

/** Module scope, process lifetime: print each skip notice once per process. */
const noticesPrinted = new Set<string>();

function skipNotice(tool: string): void {
  if (noticesPrinted.has(tool)) return;
  noticesPrinted.add(tool);
  // stderr, so JSON output on stdout stays valid.
  console.error(chalk.dim(`  Skipped ${tool}: HOME is not your home folder, and ${tool} jobs are per user.`));
}

/** True when a scheduler change would reach the real user's crontab and systemd user manager. */
export function userSchedulersTargetThisHome(): boolean {
  return homeIsUsersHome();
}

/** `crontab -l`: the user's current table, read-only, always runs. */
export function readCrontabTable(options: ExecFileSyncOptions = {}): string {
  return String(execFileSync("crontab", ["-l"], { stdio: "pipe", timeout: 5_000, ...options }) ?? "");
}

/**
 * The one owner of crontab writes: `crontab -` with `table` on stdin.
 * Returns undefined (and writes nothing) when HOME is not the user's home
 * folder, so a scratch-HOME run never replaces the real user's crontab.
 */
export function writeCrontabTable(table: string): SpawnSyncReturns<Buffer> | undefined {
  if (!userSchedulersTargetThisHome()) {
    skipNotice("crontab");
    return undefined;
  }
  return spawnSync("crontab", ["-"], { input: table, stdio: ["pipe", "pipe", "pipe"], timeout: 5_000 });
}

/**
 * A read-only `systemctl --user` query that reports its exit status. Returns
 * undefined when systemctl could not run (missing binary or timeout). Refuses
 * verbs that change the user manager. The verb must be the first argument.
 */
export function probeSystemctlUser(args: string[], timeoutMs: number): { status: number; stdout: string } | undefined {
  if (!SYSTEMCTL_READ_ONLY.has(args[0] ?? ""))
    throw new Error(`probeSystemctlUser is read-only; got "${args[0] ?? ""}"`);
  const result = spawnSync("systemctl", ["--user", ...args], { encoding: "utf-8", timeout: timeoutMs });
  if (result.error || result.status === null) {
    logSkipped("core/user-scheduler/probe", result.error);
    return undefined;
  }
  return { status: result.status, stdout: result.stdout };
}

/**
 * The one owner of `systemctl --user` calls. Read-only verbs always run. A
 * verb that changes the user manager (daemon-reload, enable, disable, start,
 * stop, ...) is skipped and returns undefined when HOME is not the user's
 * home folder. The verb must be the first argument; a leading flag makes a
 * read look like a change, so it is skipped.
 */
export function runSystemctlUser(args: string[], options: ExecFileSyncOptions = {}): string | undefined {
  if (!SYSTEMCTL_READ_ONLY.has(args[0] ?? "") && !userSchedulersTargetThisHome()) {
    skipNotice("systemctl --user");
    return undefined;
  }
  return String(
    execFileSync("systemctl", ["--user", ...args], { stdio: "pipe", timeout: 10_000, ...options, encoding: "utf-8" }) ??
      "",
  );
}
