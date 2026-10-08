import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { buildLaunchAgentPath, LAUNCHAGENT_LANG, resolveAgentBrewCliJsPath } from "../sync/scheduler-paths.js";
import { MEMORY_DAEMON_ENVIRONMENT, MEMORY_PINNED_SPEC } from "./constants.js";
import { resolveUvxBin } from "./invoke.js";
import { memoryLaunchAgentLogDir } from "./paths.js";

export const MEMORY_AGENT_LABEL = "com.agentbrew.mcp-memory";
export const MEMORY_MAINTAIN_LABEL = "com.agentbrew.mcp-memory-maintain";

function launchAgentsDir(): string {
  return join(homedir(), "Library/LaunchAgents");
}

function memoryPlistPath(): string {
  return join(launchAgentsDir(), `${MEMORY_AGENT_LABEL}.plist`);
}

function maintainPlistPath(): string {
  return join(launchAgentsDir(), `${MEMORY_MAINTAIN_LABEL}.plist`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * The daemon runs Python through an absolute uvx path, so its PATH must not
 * depend on the caller's Node or DOTFILES_DIR: any plist change reloads the
 * daemon, and Cursor does not reconnect after the refused connection.
 */
export function memoryDaemonPath(home: string, uvxBin: string): string {
  const dirs = [dirname(uvxBin), `${home}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set(dirs), "/usr/sbin", "/sbin"].join(":");
}

export function buildMemoryDaemonPlist(home: string, logDir: string, uvxBin: string): string {
  const pathValue = memoryDaemonPath(home, uvxBin);
  const daemonEnvironmentXml = Object.entries(MEMORY_DAEMON_ENVIRONMENT)
    .map(([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MEMORY_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${uvxBin}</string>
    <string>--system-certs</string>
    <string>--from</string>
    <string>${MEMORY_PINNED_SPEC}</string>
    <string>memory</string>
    <string>server</string>
    <string>--streamable-http</string>
    <string>--sse-host</string>
    <string>127.0.0.1</string>
    <string>--sse-port</string>
    <string>18765</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>WorkingDirectory</key>
  <string>${home}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>${pathValue}</string>
    <key>LANG</key>
    <string>${LAUNCHAGENT_LANG}</string>
${daemonEnvironmentXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/mcp-memory.out.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/mcp-memory.err.log</string>
</dict>
</plist>`;
}

function buildMaintainPlist(home: string, pathValue: string, logDir: string): string {
  const maintainArgs = [process.execPath, resolveAgentBrewCliJsPath(), "memory", "maintain"];
  const programArgsXml = maintainArgs.map((arg) => `    <string>${arg}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MEMORY_MAINTAIN_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgsXml}
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>15</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${home}</string>
    <key>PATH</key>
    <string>${pathValue}</string>
    <key>LANG</key>
    <string>${LAUNCHAGENT_LANG}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/mcp-memory-maintain.out.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/mcp-memory-maintain.err.log</string>
</dict>
</plist>`;
}

function loadPlist(plistPath: string): void {
  execFileSync("launchctl", ["load", plistPath], { stdio: "pipe" });
}

function unloadPlist(plistPath: string): void {
  try {
    execFileSync("launchctl", ["unload", plistPath], { stdio: "pipe" });
  } catch {
    // may not be loaded
  }
}

function isPlistLoaded(label: string): boolean {
  try {
    execFileSync("launchctl", ["print", `gui/${userInfo().uid}/${label}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function isLabelDisabledInLaunchctlOutput(output: string, label: string): boolean {
  return output.includes(`"${label}" => disabled`);
}

function isPlistDisabled(label: string): boolean {
  try {
    const output = execFileSync("launchctl", ["print-disabled", `gui/${userInfo().uid}`], {
      encoding: "utf-8",
    });
    return isLabelDisabledInLaunchctlOutput(output, label);
  } catch {
    return false;
  }
}

interface ReconcilePlistResult {
  changed: boolean;
  loaded: boolean;
  disabled: boolean;
  reloaded: boolean;
}

function reconcilePlist(
  plistPath: string,
  label: string,
  content: string,
  options: { required: boolean },
): ReconcilePlistResult {
  const contentChanged = !existsSync(plistPath) || readFileSync(plistPath, "utf-8") !== content;
  const wasLoaded = isPlistLoaded(label);
  if (!contentChanged && wasLoaded) {
    return { changed: false, loaded: true, disabled: false, reloaded: false };
  }
  if (contentChanged) writeFileAtomicSync(plistPath, content, "utf-8");
  if (wasLoaded) unloadPlist(plistPath);
  const disabled = !options.required && isPlistDisabled(label);
  if (disabled) return { changed: contentChanged, loaded: false, disabled: true, reloaded: false };
  try {
    if (options.required) {
      execFileSync("launchctl", ["enable", `gui/${userInfo().uid}/${label}`], { stdio: "pipe" });
    }
    loadPlist(plistPath);
    const loaded = isPlistLoaded(label);
    return {
      changed: contentChanged || !wasLoaded,
      loaded,
      disabled: false,
      reloaded: !wasLoaded && loaded,
    };
  } catch {
    return {
      changed: contentChanged || !wasLoaded,
      loaded: false,
      disabled: false,
      reloaded: false,
    };
  }
}

export function memoryLaunchAgentSupported(): boolean {
  return process.platform === "darwin";
}

export function isMemoryLaunchAgentInstalled(): boolean {
  return existsSync(memoryPlistPath());
}

/**
 * Read the plist path and the job's own HOME from `launchctl print` output.
 * HOME comes only from the top-level `environment` block; the inherited and
 * default blocks describe launchd, not the job.
 */
export function parseLaunchctlJobIdentity(output: string): { path: string | null; home: string | null } {
  const path = /^\tpath = (.+)$/m.exec(output)?.[1]?.trim() ?? null;
  const environment = /^\tenvironment = \{\n([\s\S]*?)^\t\}/m.exec(output)?.[1] ?? "";
  const home = /^\t\tHOME => (.+)$/m.exec(environment)?.[1]?.trim() ?? null;
  return { path, home };
}

export interface MemoryLaunchAgentIdentity {
  loaded: boolean;
  path: string | null;
  home: string | null;
  /** True when the loaded job uses the canonical plist path and the operator HOME. */
  canonical: boolean;
}

/** Identity of the loaded memory daemon job, so callers can catch a job loaded from a temporary HOME. */
export function memoryLaunchAgentIdentity(): MemoryLaunchAgentIdentity {
  let output: string;
  try {
    output = execFileSync("launchctl", ["print", `gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return { loaded: false, path: null, home: null, canonical: false };
  }
  const { path, home } = parseLaunchctlJobIdentity(output);
  return { loaded: true, path, home, canonical: path === memoryPlistPath() && home === homedir() };
}

export interface MemoryMaintenanceLaunchAgentStatus {
  installed: boolean;
  loaded: boolean;
  disabled: boolean;
}

export function memoryMaintenanceLaunchAgentStatus(): MemoryMaintenanceLaunchAgentStatus {
  const installed = existsSync(maintainPlistPath());
  if (!installed) return { installed: false, loaded: false, disabled: false };
  return {
    installed,
    loaded: isPlistLoaded(MEMORY_MAINTAIN_LABEL),
    disabled: isPlistDisabled(MEMORY_MAINTAIN_LABEL),
  };
}

export function installMemoryLaunchAgents(): {
  installed: boolean;
  changed?: boolean;
  daemonRestarted?: boolean;
  daemonLoaded?: boolean;
  maintainLoaded?: boolean;
  maintainDisabled?: boolean;
  maintainReloaded?: boolean;
  reason?: string;
} {
  if (!memoryLaunchAgentSupported()) {
    return { installed: false, reason: "no boot persistence on non-macOS" };
  }
  const home = homedir();
  const logDir = memoryLaunchAgentLogDir();
  mkdirSync(logDir, { recursive: true });
  mkdirSync(launchAgentsDir(), { recursive: true });
  const pathValue = buildLaunchAgentPath(home);
  const uvxBin = resolveUvxBin();
  if (!uvxBin) {
    return { installed: false, reason: "uvx not found on PATH — install uv before enabling memory LaunchAgent" };
  }

  const daemonPlist = memoryPlistPath();
  const daemon = reconcilePlist(daemonPlist, MEMORY_AGENT_LABEL, buildMemoryDaemonPlist(home, logDir, uvxBin), {
    required: true,
  });

  const maintain = maintainPlistPath();
  const maintenance = reconcilePlist(maintain, MEMORY_MAINTAIN_LABEL, buildMaintainPlist(home, pathValue, logDir), {
    required: false,
  });

  return {
    installed: true,
    changed: daemon.changed || maintenance.changed,
    daemonRestarted: daemon.changed,
    daemonLoaded: daemon.loaded,
    maintainLoaded: maintenance.loaded,
    maintainDisabled: maintenance.disabled,
    maintainReloaded: maintenance.reloaded,
  };
}

export function uninstallMemoryLaunchAgents(): void {
  if (!memoryLaunchAgentSupported()) return;
  for (const plist of [memoryPlistPath(), maintainPlistPath()]) {
    if (!existsSync(plist)) continue;
    unloadPlist(plist);
    unlinkSync(plist);
  }
}

export function kickstartMemoryDaemon(): boolean {
  if (!memoryLaunchAgentSupported()) return false;
  try {
    execFileSync("launchctl", ["kickstart", "-k", `gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`], {
      stdio: "pipe",
    });
    return true;
  } catch {
    // best effort
    return false;
  }
}
