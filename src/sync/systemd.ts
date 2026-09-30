import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { logSkipped } from "../core/logger.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import { AUTO_SYNC_INTERVAL_MINUTES, getAgentBrewBin, getLogDir, getNodeBinDir } from "./scheduler-paths.js";

function getSystemdUserDir(): string {
  return expandHome("~/.config/systemd/user");
}

function getSystemdServicePath(): string {
  return join(getSystemdUserDir(), "agentbrew-check.service");
}

function getSystemdTimerPath(): string {
  return join(getSystemdUserDir(), "agentbrew-check.timer");
}

function buildSystemdService(): string {
  const bin = getAgentBrewBin();
  const nodeBinDir = getNodeBinDir();
  return `[Unit]
Description=agentbrew auto-repair sync

[Service]
Type=oneshot
ExecStart=${bin} fix
Environment=PATH=${nodeBinDir}:/usr/local/bin:/usr/bin:/bin:%h/.local/bin
`;
}

function buildSystemdTimer(): string {
  return `[Unit]
Description=agentbrew periodic drift check

[Timer]
OnBootSec=5min
OnUnitActiveSec=${AUTO_SYNC_INTERVAL_MINUTES}min
Persistent=true

[Install]
WantedBy=timers.target
`;
}

/** Returns true when the systemctl binary is available on this system. */
export function hasSystemctl(): boolean {
  try {
    execFileSync("which", ["systemctl"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch (e) {
    logSkipped("sync/systemd/execFileSync", e);
    return false;
  }
}

/** Install the Linux systemd user timer that runs drift repair periodically. */
export async function installSystemdTimer(): Promise<void> {
  const serviceDir = getSystemdUserDir();
  const logDir = getLogDir();
  mkdirSync(serviceDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  writeFileAtomicSync(getSystemdServicePath(), buildSystemdService(), "utf-8");
  writeFileAtomicSync(getSystemdTimerPath(), buildSystemdTimer(), "utf-8");

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe", timeout: 10_000 });
    execFileSync("systemctl", ["--user", "enable", "--now", "agentbrew-check.timer"], {
      stdio: "pipe",
      timeout: 10_000,
    });
    console.log(`${ICON_SUCCESS} systemd timer installed and started.`);
    console.log("  Auto-repair runs every 30 minutes.");
    console.log(`  Service: ${getSystemdServicePath()}`);
    console.log(`  Timer: ${getSystemdTimerPath()}`);
    console.log(`  Logs: ${logDir}/`);
  } catch (e) {
    logSkipped("sync/systemd/log", e);
    console.error(chalk.yellow("systemd units created but could not be enabled."));
    console.log("  Enable manually: systemctl --user enable --now agentbrew-check.timer");
  }
}

/** Uninstall the Linux systemd user timer and remove the unit files. */
export async function uninstallSystemdTimer(): Promise<void> {
  const servicePath = getSystemdServicePath();
  const timerPath = getSystemdTimerPath();

  if (!existsSync(timerPath) && !existsSync(servicePath)) {
    console.error(chalk.yellow("systemd timer not installed."));
    return;
  }

  try {
    execFileSync("systemctl", ["--user", "disable", "--now", "agentbrew-check.timer"], {
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch (e) {
    logSkipped("sync/systemd/execFileSync", e);
    // May not be active
  }

  if (existsSync(timerPath)) unlinkSync(timerPath);
  if (existsSync(servicePath)) unlinkSync(servicePath);

  try {
    execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "pipe", timeout: 10_000 });
  } catch (e) {
    logSkipped("sync/systemd/execFileSync", e);
    // Best effort
  }

  console.log(`${ICON_SUCCESS} systemd timer uninstalled.`);
}

/** Returns true when the systemd timer unit file is present on disk. */
export function isSystemdTimerInstalled(): boolean {
  return existsSync(getSystemdTimerPath());
}
