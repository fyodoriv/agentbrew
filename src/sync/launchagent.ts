import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname } from "node:path";
import chalk from "chalk";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { logSkipped } from "../core/logger.js";
import {
  ensurePlistLocale,
  extractPlistPath,
  listAgentbrewLaunchAgentPlists,
  plistManagesOwnPath,
  setPlistPath,
} from "../drift-checks/launchagent-path.js";
import { isLabelDisabledInLaunchctlOutput } from "../memory/launchagent.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { expandHome } from "../utils.js";
import {
  AUTO_SYNC_INTERVAL_SECONDS,
  buildLaunchAgentFixArgs,
  buildLaunchAgentPath,
  getLogDir,
  LAUNCHAGENT_LANG,
  launchAgentPathHasRequiredPrefixes,
} from "./scheduler-paths.js";

// ── Timeout constant ─────────────────────────────────────────────

/** Timeout in milliseconds for `launchctl` subcommands (10 seconds). */
const LAUNCHCTL_TIMEOUT_MS = 10_000;

/** launchd label of the auto-repair LaunchAgent. */
export const LAUNCHAGENT_LABEL = "com.agentbrew.check";

function getLaunchAgentPath(): string {
  return expandHome(`~/Library/LaunchAgents/${LAUNCHAGENT_LABEL}.plist`);
}

const LEGACY_PLIST_NAMES = ["com.agentbrew.watch", "com.agentbrew.drift"];

function getLegacyPlistPaths(): string[] {
  return LEGACY_PLIST_NAMES.map((name) => expandHome(`~/Library/LaunchAgents/${name}.plist`));
}

function buildPlistContent(): string {
  const home = expandHome("~");
  const pathValue = buildLaunchAgentPath(home);
  const fixArgs = buildLaunchAgentFixArgs();
  const programArgsXml = fixArgs.map((arg) => `        <string>${arg}</string>`).join("\n");
  // WorkingDirectory must not be `/` (launchd default). MCP smoke probes inherit
  // this cwd — tasks-mcp used to recurse from `/` and peg the CPU with `fd`.
  const workingDirectory = getLogDir();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.agentbrew.check</string>
    <key>ProgramArguments</key>
    <array>
${programArgsXml}
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDirectory}</string>
    <key>StartInterval</key>
    <integer>${AUTO_SYNC_INTERVAL_SECONDS}</integer>
    <key>StandardOutPath</key>
    <string>LOGDIR/launchagent.log</string>
    <key>StandardErrorPath</key>
    <string>LOGDIR/launchagent.err</string>
    <key>RunAtLoad</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${pathValue}</string>
        <key>LANG</key>
        <string>${LAUNCHAGENT_LANG}</string>
        <key>HOME</key>
        <string>${home}</string>
    </dict>
</dict>
</plist>`;
}

/** Remove stale legacy LaunchAgents before installing the current one. */
export function cleanupLegacyAgents(): number {
  let removed = 0;
  for (const plistPath of getLegacyPlistPaths()) {
    if (!existsSync(plistPath)) continue;
    try {
      execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
    } catch (e) {
      logSkipped("sync/launchagent/execFileSync", e);
      // May not be loaded
    }
    try {
      unlinkSync(plistPath);
      removed++;
    } catch (e) {
      logSkipped("sync/launchagent/unlinkSync", e);
      // Best effort
    }
  }
  return removed;
}

/** Reload a LaunchAgent after plist mutation (best-effort). */
function reloadLaunchAgentPlist(plistPath: string): void {
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
  } catch (e) {
    logSkipped("sync/launchagent/reload-unload", e);
  }
  try {
    execFileSync("launchctl", ["load", plistPath], { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
  } catch (e) {
    logSkipped("sync/launchagent/reload-load", e);
  }
}

/**
 * Update every com.agentbrew.* LaunchAgent whose PATH lacks the required
 * node + dotfiles/bin prefixes or that sets no locale. Skips
 * com.agentbrew.check — installLaunchAgent rewrites that plist wholesale.
 */
export async function repairAgentbrewLaunchAgentPaths(): Promise<number> {
  if (process.platform !== "darwin") return 0;

  const home = expandHome("~");
  const canonicalPath = buildLaunchAgentPath(home);
  const checkPlist = getLaunchAgentPath();
  let repaired = 0;

  for (const plistPath of listAgentbrewLaunchAgentPlists()) {
    if (plistPath === checkPlist) continue;

    let content: string;
    try {
      content = readFileSync(plistPath, "utf-8");
    } catch {
      continue;
    }

    const pathValue = extractPlistPath(content);
    if (!pathValue) continue;

    const withPath =
      plistManagesOwnPath(plistPath) || launchAgentPathHasRequiredPrefixes(pathValue, home)
        ? content
        : setPlistPath(content, canonicalPath);
    const updated = ensurePlistLocale(withPath);
    if (updated === content) continue;

    writeFileAtomicSync(plistPath, updated, "utf-8");
    reloadLaunchAgentPlist(plistPath);
    repaired++;
    console.log(`${ICON_SUCCESS} Repaired environment in ${plistPath}`);
  }

  return repaired;
}

/** Install the macOS LaunchAgent that runs drift repair every 30 minutes. */
export async function installLaunchAgent(): Promise<void> {
  const cleaned = cleanupLegacyAgents();
  if (cleaned > 0) {
    console.log(chalk.dim(`  Removed ${cleaned} legacy LaunchAgent(s).`));
  }

  const plistPath = getLaunchAgentPath();
  const logDir = getLogDir();
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const content = buildPlistContent().replace(/LOGDIR/g, logDir);

  writeFileAtomicSync(plistPath, content, "utf-8");

  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
  } catch (e) {
    logSkipped("sync/launchagent/execFileSync", e);
    // May not be loaded yet
  }

  try {
    execFileSync("launchctl", ["load", plistPath], { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
  } catch (e) {
    logSkipped("sync/launchagent/load", e);
  }

  // `launchctl load` exits 0 even when launchd refuses the job, so confirm it is loaded.
  const domain = `gui/${userInfo().uid}`;
  if (launchctlSucceeds(["print", `${domain}/${LAUNCHAGENT_LABEL}`])) {
    console.log(`${ICON_SUCCESS} LaunchAgent installed and loaded.`);
    console.log("  Auto-repair runs every 30 minutes.");
    console.log(`  Plist: ${plistPath}`);
    console.log(`  Logs: ${logDir}/`);
  } else if (isLaunchAgentDisabled(domain)) {
    console.error(
      chalk.yellow(`LaunchAgent written, but launchd has ${LAUNCHAGENT_LABEL} disabled, so it will not run.`),
    );
    console.log(
      `  If that is not on purpose: launchctl enable ${domain}/${LAUNCHAGENT_LABEL}, then rerun this command.`,
    );
  } else {
    console.error(chalk.yellow("LaunchAgent created but could not be loaded."));
    console.log(`  Load manually: launchctl load "${plistPath}"`);
  }
}

function launchctlSucceeds(args: string[]): boolean {
  try {
    execFileSync("launchctl", args, { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
    return true;
  } catch (e) {
    logSkipped(`sync/launchagent/${args[0]}`, e);
    return false;
  }
}

function isLaunchAgentDisabled(domain: string): boolean {
  try {
    const output = execFileSync("launchctl", ["print-disabled", domain], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: LAUNCHCTL_TIMEOUT_MS,
    });
    return isLabelDisabledInLaunchctlOutput(String(output), LAUNCHAGENT_LABEL);
  } catch (e) {
    logSkipped("sync/launchagent/print-disabled", e);
    return false;
  }
}

/** Uninstall the macOS LaunchAgent and remove the plist file. */
export async function uninstallLaunchAgent(): Promise<void> {
  const plistPath = getLaunchAgentPath();

  if (!existsSync(plistPath)) {
    console.error(chalk.yellow("LaunchAgent not installed."));
    return;
  }

  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe", timeout: LAUNCHCTL_TIMEOUT_MS });
  } catch (e) {
    logSkipped("sync/launchagent/execFileSync", e);
    // May not be loaded
  }

  unlinkSync(plistPath);
  console.log(`${ICON_SUCCESS} LaunchAgent uninstalled.`);
}

/** Returns true when the macOS LaunchAgent plist is present on disk. */
export function isLaunchAgentInstalled(): boolean {
  return existsSync(getLaunchAgentPath());
}

/** Returns the paths of any legacy LaunchAgent plists currently on disk. */
export function getLegacyPlistsOnDisk(): string[] {
  return getLegacyPlistPaths().filter((p) => existsSync(p));
}

/** Returns the path to the LaunchAgent plist for display in status output. */
export function getLaunchAgentPlistPath(): string {
  return getLaunchAgentPath();
}
