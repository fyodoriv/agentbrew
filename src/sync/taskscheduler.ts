import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import chalk from "chalk";
import { logSkipped } from "../core/logger.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { AUTO_SYNC_INTERVAL_MINUTES, getAgentBrewBin, getLogDir } from "./scheduler-paths.js";

const TASK_NAME = "AgentBrew Auto-Sync";

/** Check if the Windows Task Scheduler task exists by querying schtasks. */
export function isTaskSchedulerInstalled(): boolean {
  try {
    execFileSync("schtasks.exe", ["/Query", "/TN", TASK_NAME], {
      stdio: "pipe",
      timeout: 10_000,
    });
    return true;
  } catch (e) {
    logSkipped("sync/taskscheduler/execFileSync", e);
    return false;
  }
}

/** Install a Windows Task Scheduler task that runs drift repair periodically. */
export async function installTaskScheduler(): Promise<void> {
  const logDir = getLogDir();
  mkdirSync(logDir, { recursive: true });

  if (isTaskSchedulerInstalled()) {
    console.log(chalk.yellow("Windows Task Scheduler task already installed."));
    return;
  }

  const bin = getAgentBrewBin();
  const interval = String(AUTO_SYNC_INTERVAL_MINUTES);
  try {
    execFileSync(
      "schtasks.exe",
      ["/Create", "/TN", TASK_NAME, "/TR", `"${bin}" fix`, "/SC", "MINUTE", "/MO", interval, "/F"],
      { stdio: "pipe", timeout: 10_000 },
    );
    console.log(`${ICON_SUCCESS} Windows Task Scheduler task installed.`);
    console.log(`  Auto-repair runs every ${AUTO_SYNC_INTERVAL_MINUTES} minutes.`);
    console.log(`  Logs: ${logDir}/`);
  } catch (e) {
    logSkipped("sync/taskscheduler/log", e);
    console.error(chalk.red("Failed to install Task Scheduler task."));
    console.log(
      chalk.dim(`  Add manually: schtasks /Create /TN "${TASK_NAME}" /TR "${bin} fix" /SC MINUTE /MO ${interval}`),
    );
  }
}

/** Uninstall the Windows Task Scheduler task. */
export async function uninstallTaskScheduler(): Promise<void> {
  if (!isTaskSchedulerInstalled()) {
    console.error(chalk.yellow("Windows Task Scheduler task not installed."));
    return;
  }

  try {
    execFileSync("schtasks.exe", ["/Delete", "/TN", TASK_NAME, "/F"], {
      stdio: "pipe",
      timeout: 10_000,
    });
    console.log(`${ICON_SUCCESS} Windows Task Scheduler task uninstalled.`);
  } catch (e) {
    logSkipped("sync/taskscheduler/log", e);
    console.error(chalk.red("Failed to remove Task Scheduler task."));
    console.log(chalk.dim(`  Try manually: schtasks.exe /Delete /TN "${TASK_NAME}" /F`));
  }
}
