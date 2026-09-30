import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import chokidar from "chokidar";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import { installCron, isCronInstalled, uninstallCron } from "./cron.js";
import {
  getLaunchAgentPlistPath,
  getLegacyPlistsOnDisk,
  installLaunchAgent,
  isLaunchAgentInstalled,
  uninstallLaunchAgent,
} from "./launchagent.js";
import { getAgentBrewBin, getLogDir } from "./scheduler-paths.js";
import { hasSystemctl, installSystemdTimer, isSystemdTimerInstalled, uninstallSystemdTimer } from "./systemd.js";
import { installTaskScheduler, isTaskSchedulerInstalled, uninstallTaskScheduler } from "./taskscheduler.js";

export { installCron, isCronInstalled, uninstallCron } from "./cron.js";
// Re-export backend symbols so callers can import everything from auto-sync.
export {
  cleanupLegacyAgents,
  installLaunchAgent,
  isLaunchAgentInstalled,
  uninstallLaunchAgent,
} from "./launchagent.js";
export { getLogDir } from "./scheduler-paths.js";
export { installSystemdTimer, isSystemdTimerInstalled, uninstallSystemdTimer } from "./systemd.js";

function getConfigDir(): string {
  return expandHome("~/.config/agentbrew");
}

/** Maximum log file size in bytes before trimming to the last LOG_KEEP_LINES lines. */
const LOG_MAX_BYTES = 1_048_576; // 1 MB
const LOG_KEEP_LINES = 500;
const NOTIFY_TIMEOUT_MS = 5_000;
const SYNC_TIMEOUT_MS = 30_000;
const FILE_WRITE_STABILITY_MS = 500;
const DEBOUNCE_DELAY_MS = 2_000;

/**
 * Trim a log file to the last LOG_KEEP_LINES lines when it exceeds LOG_MAX_BYTES.
 * Prevents unbounded growth on machines running auto-sync for months.
 */
export function trimLogIfNeeded(logFile: string): void {
  try {
    const size = statSync(logFile).size;
    if (size <= LOG_MAX_BYTES) return;
    const content = readFileSync(logFile, "utf-8");
    const lines = content.split("\n");
    const kept = lines.slice(-LOG_KEEP_LINES).join("\n");
    writeFileAtomicSync(logFile, kept, "utf-8");
  } catch (e) {
    logSkipped("sync/auto-sync/writeFileSync", e);
    // Non-critical — log rotation failure should never crash the sync
  }
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);

  const logDir = getLogDir();
  try {
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, "auto-sync.log");
    trimLogIfNeeded(logFile);
    appendFileSync(logFile, `${line}\n`, "utf-8");
  } catch (e) {
    logSkipped("sync/auto-sync/appendFileSync", e);
    // Non-critical — log write failure must never crash the sync process
  }
}

function notify(title: string, message: string): void {
  if (process.platform !== "darwin") return;
  try {
    execFileSync("osascript", ["-e", `display notification "${message}" with title "${title}"`], {
      stdio: "pipe",
      timeout: NOTIFY_TIMEOUT_MS,
    });
  } catch (e) {
    logSkipped("sync/auto-sync/execFileSync", e);
    // Notification not critical
  }
}

function runSync(): void {
  const bin = getAgentBrewBin();
  try {
    execFileSync(bin, ["sync"], { stdio: "pipe", timeout: SYNC_TIMEOUT_MS });
  } catch (error) {
    log(`Sync failed: ${errorMessage(error)}`);
  }
}

/** Start a file watcher on the config directory and run sync on every change. */
export async function watchAndSync(): Promise<void> {
  const configDir = getConfigDir();
  if (!existsSync(configDir)) {
    console.error(chalk.yellow("Config directory not found. Run `agentbrew init` first."));
    return;
  }

  log(`Starting file watcher on ${configDir}`);
  console.log(chalk.bold("\nWatching for changes..."));
  console.log(chalk.dim(`  Config dir: ${configDir}`));
  console.log(chalk.dim(`  Log file: ${getLogDir()}/auto-sync.log`));
  console.log(chalk.dim("  Press Ctrl+C to stop.\n"));

  const watcher = chokidar.watch(configDir, {
    ignoreInitial: true,
    ignored: ["**/*.log"],
    awaitWriteFinish: { stabilityThreshold: FILE_WRITE_STABILITY_MS },
  });

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  watcher.on("all", (_event, filePath) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      log(`Change detected: ${filePath} — syncing...`);
      runSync();
      log("Sync complete.");
      notify("agentbrew", "Config change detected and synced.");
    }, DEBOUNCE_DELAY_MS);
  });

  // Close the watcher cleanly on SIGINT/SIGTERM so file descriptors are released
  // before the process exits rather than leaking on forced termination.
  const closeWatcher = (): Promise<void> => {
    if (debounceTimer) clearTimeout(debounceTimer);
    return watcher.close();
  };

  // Keep process alive until a termination signal is received.
  await new Promise<void>((resolve) => {
    const handleSignal = (): void => {
      void closeWatcher()
        .then(resolve)
        .catch((err) => {
          logSkipped("auto-sync/watcher-close", err);
          resolve();
        });
    };
    process.once("SIGINT", handleSignal);
    process.once("SIGTERM", handleSignal);
  });
  process.exit(0);
}

/** The platform-specific backend used to schedule periodic drift repair. */
export type AutoSyncBackend = "launchagent" | "systemd" | "cron" | "taskscheduler" | "none";

/** Detect which scheduling backend is appropriate for the current platform. */
export function detectBackend(): AutoSyncBackend {
  if (process.platform === "darwin") return "launchagent";
  if (process.platform === "linux") {
    return hasSystemctl() ? "systemd" : "cron";
  }
  if (process.platform === "win32") return "taskscheduler";
  return "none";
}

/** Detect which scheduling backend is currently active (installed). */
export function activeBackend(): AutoSyncBackend {
  if (isLaunchAgentInstalled()) return "launchagent";
  if (isSystemdTimerInstalled()) return "systemd";
  if (isCronInstalled()) return "cron";
  if (isTaskSchedulerInstalled()) return "taskscheduler";
  return "none";
}

/** Install the best available auto-sync backend for the current platform. */
export async function installAutoSync(): Promise<void> {
  const backend = detectBackend();
  switch (backend) {
    case "launchagent":
      await installLaunchAgent();
      break;
    case "systemd":
      await installSystemdTimer();
      break;
    case "cron":
      await installCron();
      break;
    case "taskscheduler":
      await installTaskScheduler();
      break;
    case "none":
      console.error(chalk.yellow("Auto-sync is not supported on this platform."));
      break;
  }
}

/** Uninstall whichever auto-sync backend is currently active. */
export async function uninstallAutoSync(): Promise<void> {
  const backend = activeBackend();
  switch (backend) {
    case "launchagent":
      await uninstallLaunchAgent();
      break;
    case "systemd":
      await uninstallSystemdTimer();
      break;
    case "cron":
      await uninstallCron();
      break;
    case "taskscheduler":
      await uninstallTaskScheduler();
      break;
    case "none":
      console.error(chalk.yellow("No auto-sync backend is installed."));
      break;
  }
}

/** Returns true when any auto-sync backend is currently installed. */
export function isAutoSyncInstalled(): boolean {
  return activeBackend() !== "none";
}

function showLaunchAgentStatus(): void {
  if (process.platform !== "darwin" && !isLaunchAgentInstalled()) return;
  const plistPath = getLaunchAgentPlistPath();
  if (existsSync(plistPath)) {
    console.log(`  ${ICON_SUCCESS} LaunchAgent installed (30-min auto-repair)`);
  } else if (process.platform === "darwin") {
    console.error(`  ${chalk.dim("○")} LaunchAgent not installed`);
    console.log(chalk.dim("    Install: agentbrew auto-sync install"));
  }

  const legacyFound = getLegacyPlistsOnDisk();
  if (legacyFound.length > 0) {
    console.log(chalk.yellow(`  ⚠ ${legacyFound.length} legacy LaunchAgent(s) detected`));
    console.log(chalk.dim("    Run: agentbrew auto-sync cleanup"));
  }
}

function showSystemdStatus(): void {
  if (process.platform !== "linux" && !isSystemdTimerInstalled()) return;
  if (isSystemdTimerInstalled()) {
    console.log(`  ${ICON_SUCCESS} systemd timer installed (30-min auto-repair)`);
  } else if (process.platform === "linux" && hasSystemctl()) {
    console.error(`  ${chalk.dim("○")} systemd timer not installed`);
    console.log(chalk.dim("    Install: agentbrew auto-sync install"));
  }
}

function showCronStatus(): void {
  if (process.platform !== "linux" && !isCronInstalled()) return;
  if (isCronInstalled()) {
    console.log(`  ${ICON_SUCCESS} cron job installed (30-min auto-repair)`);
  } else if (process.platform === "linux" && !hasSystemctl()) {
    console.error(`  ${chalk.dim("○")} cron job not installed`);
    console.log(chalk.dim("    Install: agentbrew auto-sync install"));
  }
}

function showTaskSchedulerStatus(): void {
  if (process.platform !== "win32" && !isTaskSchedulerInstalled()) return;
  if (isTaskSchedulerInstalled()) {
    console.log(`  ${ICON_SUCCESS} Windows Task Scheduler task installed (30-min auto-repair)`);
  } else if (process.platform === "win32") {
    console.error(`  ${chalk.dim("○")} Windows Task Scheduler task not installed`);
    console.log(chalk.dim("    Install: agentbrew auto-sync install"));
  }
}

function showLastLogActivity(logDir: string): void {
  const logFiles = [join(logDir, "auto-sync.log"), join(logDir, "cron.log")];
  let lastLine: string | undefined;
  for (const lf of logFiles) {
    if (existsSync(lf)) {
      const lines = readFileSync(lf, "utf-8").trim().split("\n");
      lastLine = lines[lines.length - 1];
    }
  }
  if (lastLine) {
    console.log(`  Last activity: ${lastLine}`);
  } else {
    console.error(chalk.dim("  No log file yet."));
  }
}

/** Print a detailed status of all auto-sync backends and recent log activity. */
export async function autoSyncStatus(): Promise<void> {
  console.log(chalk.bold("\nAuto-sync status\n"));

  showLaunchAgentStatus();
  showSystemdStatus();
  showCronStatus();

  // Unsupported platform
  if (
    process.platform !== "darwin" &&
    process.platform !== "linux" &&
    process.platform !== "win32" &&
    !isAutoSyncInstalled()
  ) {
    console.error(chalk.yellow("  Auto-sync is not supported on this platform."));
  }

  showTaskSchedulerStatus();
  showLastLogActivity(getLogDir());

  console.log();
}
