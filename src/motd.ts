import chalk from "chalk";
import { getConfigServers } from "./agentfile.js";
import { checkForAutoUpgrade } from "./auto-upgrade.js";
import { loadSyncErrors } from "./core/errors.js";
import { clearRepairLog, getRepairSummary, touchLastSeen } from "./repair-log.js";
import { loadState } from "./state.js";
import { formatAge } from "./utils.js";

const STALE_THRESHOLD_HOURS = 24;

const SILENT_COMMANDS = new Set(["status", "check", "doctor", "help", "completions", "init", "browse"]);

function isSyncStale(isoDate: string): boolean {
  const age = Date.now() - new Date(isoDate).getTime();
  return age > STALE_THRESHOLD_HOURS * 60 * 60 * 1000;
}

export function printMotd(commandName: string | undefined): void {
  if (!commandName || SILENT_COMMANDS.has(commandName)) return;

  const state = loadState();
  if (!state) return;

  const agents = state.agents?.filter((a) => a.detected)?.length ?? 0;
  const servers = getConfigServers().length;

  const parts: string[] = [];
  parts.push(`${agents} agents`);
  parts.push(`${servers} servers`);

  const errorLog = loadSyncErrors();
  if (errorLog?.lastSyncAt) {
    const stale = isSyncStale(errorLog.lastSyncAt);
    const ageText = formatAge(errorLog.lastSyncAt);
    const syncLabel = stale ? chalk.yellow(`synced ${ageText} ⚠`) : `synced ${ageText}`;
    parts.push(syncLabel);

    if (errorLog.errors.length > 0) {
      parts.push(chalk.yellow(`${errorLog.errors.length} sync error(s)`));
    }
  }

  console.log(chalk.dim(`\n⚡ ${parts.join(" · ")}`));

  // Show auto-repair summary from background runs since last interactive command
  const repairSummary = getRepairSummary();
  if (repairSummary) {
    console.log(chalk.dim(`  🔧 ${repairSummary}`));
    clearRepairLog();
  }

  checkForAutoUpgrade();
  touchLastSeen();
}
