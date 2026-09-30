import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import chalk from "chalk";
import { logSkipped } from "../core/logger.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { AUTO_SYNC_INTERVAL_MINUTES, getAgentBrewBin, getLogDir } from "./scheduler-paths.js";

const CRON_MARKER = "# agentbrew auto-sync";

function getCronEntry(): string {
  const bin = getAgentBrewBin();
  return `*/${AUTO_SYNC_INTERVAL_MINUTES} * * * * ${bin} fix >> ${getLogDir()}/cron.log 2>&1 ${CRON_MARKER}`;
}

function readCrontab(): string {
  try {
    return execFileSync("crontab", ["-l"], { stdio: "pipe", timeout: 5_000 }).toString();
  } catch (e) {
    logSkipped("sync/cron/execFileSync", e);
    return "";
  }
}

/** Install a cron job that runs drift repair every 30 minutes. */
export async function installCron(): Promise<void> {
  const logDir = getLogDir();
  mkdirSync(logDir, { recursive: true });

  const existing = readCrontab();
  if (existing.includes(CRON_MARKER)) {
    console.log(chalk.yellow("cron job already installed."));
    return;
  }

  const newCrontab = `${existing.trimEnd()}\n${getCronEntry()}\n`;
  try {
    const result = spawnSync("crontab", ["-"], { input: newCrontab, stdio: ["pipe", "pipe", "pipe"], timeout: 5_000 });
    if (result.status !== 0 || result.error) {
      const msg = result.stderr?.toString().trim() || result.error?.message || "unknown error";
      console.error(chalk.red(`Failed to install cron job: ${msg}`));
      console.log(chalk.dim(`  Add manually: ${getCronEntry()}`));
      return;
    }
    console.log(`${ICON_SUCCESS} cron job installed.`);
    console.log("  Auto-repair runs every 30 minutes.");
    console.log(`  Logs: ${logDir}/`);
  } catch (e) {
    logSkipped("sync/cron/log", e);
    console.error(chalk.red("Failed to install cron job."));
    console.log(chalk.dim(`  Add manually: ${getCronEntry()}`));
  }
}

/** Uninstall the cron job that runs drift repair. */
export async function uninstallCron(): Promise<void> {
  const existing = readCrontab();
  if (!existing.includes(CRON_MARKER)) {
    console.error(chalk.yellow("cron job not installed."));
    return;
  }

  const filtered = existing
    .split("\n")
    .filter((line) => !line.includes(CRON_MARKER))
    .join("\n");

  try {
    const result = spawnSync("crontab", ["-"], { input: filtered, stdio: ["pipe", "pipe", "pipe"], timeout: 5_000 });
    if (result.status !== 0 || result.error) {
      const msg = result.stderr?.toString().trim() || result.error?.message || "unknown error";
      console.error(chalk.red(`Failed to update crontab: ${msg}`));
      console.log(chalk.dim("  Try manually: crontab -e"));
      return;
    }
    console.log(`${ICON_SUCCESS} cron job uninstalled.`);
  } catch (e) {
    logSkipped("sync/cron/log", e);
    console.error(chalk.red("Failed to update crontab."));
    console.log(chalk.dim("  Try manually: crontab -e"));
  }
}

/** Returns true when the agentbrew cron marker is present in the user's crontab. */
export function isCronInstalled(): boolean {
  return readCrontab().includes(CRON_MARKER);
}
