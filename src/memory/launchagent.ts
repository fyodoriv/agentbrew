import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { launchdTargetsThisHome, probeLaunchctl, runLaunchctl } from "../core/launchctl.js";
import {
  buildLaunchAgentPath,
  LAUNCHAGENT_LANG,
  resolveAgentBrewCliJsPath,
  resolveSchedulerNode,
} from "../sync/scheduler-paths.js";
import { MEMORY_DAEMON_ENVIRONMENT, MEMORY_PINNED_SPEC, MEMORY_UVX_ARGS } from "./constants.js";
import { resolveUvxBin } from "./invoke.js";
import { defaultMemoryDbPath, memoryLaunchAgentLogDir } from "./paths.js";

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
 * daemon, and some MCP clients do not reconnect after the refused connection.
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
${MEMORY_UVX_ARGS.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n")}
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

/**
 * The nightly maintenance job runs the Node link that survives upgrades, like
 * the check job (#356). `process.execPath` is a versioned Homebrew Cellar
 * folder that `brew upgrade node` deletes (#456).
 */
export function buildMaintainPlist(home: string, pathValue: string, logDir: string): string {
  const node = resolveSchedulerNode();
  const maintainArgs = [node, resolveAgentBrewCliJsPath(), "memory", "maintain"];
  // Keep AGENTBREW_NODE_BIN in the job env when the job runs it, like the
  // check job (#356), so drift accepts the chosen Node and a later run keeps it.
  const nodeOverride = process.env.AGENTBREW_NODE_BIN?.trim();
  const nodeOverrideXml =
    nodeOverride && node === nodeOverride
      ? `\n    <key>AGENTBREW_NODE_BIN</key>\n    <string>${nodeOverride}</string>`
      : "";
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
    <string>${LAUNCHAGENT_LANG}</string>${nodeOverrideXml}
  </dict>
  <key>StandardOutPath</key>
  <string>${logDir}/mcp-memory-maintain.out.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/mcp-memory-maintain.err.log</string>
</dict>
</plist>`;
}

function loadPlist(plistPath: string): void {
  runLaunchctl(["load", plistPath], { stdio: "pipe" });
}

function unloadPlist(plistPath: string): void {
  try {
    runLaunchctl(["unload", plistPath], { stdio: "pipe" });
  } catch {
    // may not be loaded
  }
}

function isPlistLoaded(label: string): boolean {
  try {
    runLaunchctl(["print", `gui/${userInfo().uid}/${label}`], { stdio: "pipe" });
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
    const output = runLaunchctl(["print-disabled", `gui/${userInfo().uid}`], {
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
      runLaunchctl(["enable", `gui/${userInfo().uid}/${label}`], { stdio: "pipe" });
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
    output = runLaunchctl(["print", `gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`], {
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

interface MemoryDaemonPlist {
  WorkingDirectory?: unknown;
  EnvironmentVariables?: unknown;
  ProgramArguments?: unknown;
}

function readMemoryDaemonPlist(plistPath: string): MemoryDaemonPlist | undefined {
  const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", "--", plistPath], {
    encoding: "utf-8",
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return undefined;
  try {
    return JSON.parse(result.stdout) as MemoryDaemonPlist;
  } catch {
    return undefined;
  }
}

function loadedMemoryEnvironmentMatches(output: string, home: string): boolean {
  const block = /^\tenvironment = \{\n([\s\S]*?)^\t\}/m.exec(output)?.[1];
  if (!block) return false;
  const entries = [...block.matchAll(/^\t\t([^\n]+?) => (.*)$/gm)];
  const env = Object.fromEntries(entries.map((entry) => [entry[1], entry[2]]));
  const expected: Record<string, string> = { HOME: home, ...MEMORY_DAEMON_ENVIRONMENT };
  if (Object.entries(expected).some(([key, value]) => env[key] !== value)) return false;
  if (
    !Object.entries(env).every(([key, value]) => {
      if (/^(XDG_DATA_HOME|XDG_CONFIG_HOME|PYTHONPATH|PYTHONHOME|VIRTUAL_ENV)$/.test(key)) return false;
      return !key.startsWith("MCP_") || expected[key] === value;
    })
  )
    return false;
  for (const name of ["inherited environment", "default environment"]) {
    const inherited = new RegExp(`^\\t${name} = \\{\\n([\\s\\S]*?)^\\t\\}`, "m").exec(output)?.[1];
    if (
      inherited === undefined ||
      /^\t\t(?:MCP_|XDG_DATA_HOME|XDG_CONFIG_HOME|PYTHONPATH|PYTHONHOME|VIRTUAL_ENV)/m.test(inherited)
    )
      return false;
  }
  return true;
}

function loadedMemoryJobPinMatches(): boolean {
  const job = probeLaunchctl(["print", `gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`], 5_000);
  if (!job) return false;
  if (job.status !== 0 && job.status !== 113) return false;
  if (!noCustomLaunchdMemoryEnvironment()) return false;
  if (job.status === 113) return true;
  const identity = parseLaunchctlJobIdentity(job.stdout);
  const workingDirectory = /^\tworking directory = (.+)$/m.exec(job.stdout)?.[1]?.trim();
  if (identity.path !== memoryPlistPath() || identity.home !== homedir() || workingDirectory !== homedir())
    return false;
  if (!loadedMemoryEnvironmentMatches(job.stdout, homedir())) return false;
  const args = /^\targuments = \{\n([\s\S]*?)^\t\}/m.exec(job.stdout)?.[1] ?? "";
  const values = args
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const savedArgs = readMemoryDaemonPlist(memoryPlistPath())?.ProgramArguments;
  return Array.isArray(savedArgs) && JSON.stringify(values) === JSON.stringify(savedArgs);
}

function installedMemoryJobIdentityMatches(plistPath: string, home: string): boolean {
  if (!existsSync(plistPath)) return true;
  try {
    const plist = readMemoryDaemonPlist(plistPath);
    if (!plist) return false;
    if (
      plist.WorkingDirectory !== home ||
      !plist.EnvironmentVariables ||
      typeof plist.EnvironmentVariables !== "object"
    )
      return false;
    const env = plist.EnvironmentVariables as Record<string, unknown>;
    const expected: Record<string, string> = { HOME: home, ...MEMORY_DAEMON_ENVIRONMENT };
    for (const [key, value] of Object.entries(env)) {
      if (key === "PATH" || key === "LANG") continue;
      if (!(key in expected) || expected[key] !== value) return false;
    }
    if (Object.entries(expected).some(([key, value]) => env[key] !== value)) return false;
    const args = plist.ProgramArguments;
    const expectedArgs = [
      ...MEMORY_UVX_ARGS,
      "server",
      "--streamable-http",
      "--sse-host",
      "127.0.0.1",
      "--sse-port",
      "18765",
    ];
    return (
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      JSON.stringify(args.slice(1)) === JSON.stringify(expectedArgs)
    );
  } catch {
    return false;
  }
}

function installedMemoryJobPinMatches(plistPath: string): boolean {
  if (!existsSync(plistPath)) return true;
  try {
    const contents = readFileSync(plistPath, "utf-8");
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u.exec(contents)?.[1] ?? "";
    const pins = [...args.matchAll(/<string>--from<\/string>\s*<string>([^<]*)<\/string>/gu)];
    return pins.length === 1 && pins[0]?.[1] === MEMORY_PINNED_SPEC;
  } catch {
    return false;
  }
}

function knownPathAbsent(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

function noKnownPriorMemory(home: string): boolean {
  const paths = [defaultMemoryDbPath(home), join(home, ".env"), join(home, ".mcp-memory", ".env")];
  if (!paths.every(knownPathAbsent)) return false;
  return noCustomLaunchdMemoryEnvironment();
}

function noCustomLaunchdMemoryEnvironment(): boolean {
  for (const name of [
    "MCP_MEMORY_SQLITE_PATH",
    "MCP_MEMORY_SQLITEVEC_PATH",
    "MCP_MEMORY_BASE_DIR",
    "MCP_MEMORY_STORAGE_BACKEND",
    "XDG_DATA_HOME",
    "XDG_CONFIG_HOME",
    "PYTHONPATH",
    "PYTHONHOME",
    "VIRTUAL_ENV",
  ]) {
    if (process.env[name]) return false;
    const value = probeLaunchctl(["getenv", name], 5_000);
    if (!value || value.status !== 0 || value.stdout.trim()) return false;
  }
  return true;
}

export function installMemoryLaunchAgents(): {
  installed: boolean;
  upgradeBlocked?: boolean;
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
  if (!launchdTargetsThisHome()) {
    return { installed: false, reason: "launchd not changed: HOME is not your home folder" };
  }
  const home = homedir();
  const logDir = memoryLaunchAgentLogDir();
  mkdirSync(logDir, { recursive: true });
  mkdirSync(launchAgentsDir(), { recursive: true });
  const pathValue = buildLaunchAgentPath(home);
  const uvxBin = resolveUvxBin();
  if (!uvxBin) {
    return {
      installed: false,
      upgradeBlocked: true,
      reason: "uvx not found on PATH — install uv before enabling memory LaunchAgent",
    };
  }

  const daemonPlist = memoryPlistPath();
  if (!existsSync(daemonPlist) && !noKnownPriorMemory(home)) {
    return {
      installed: false,
      upgradeBlocked: true,
      reason: "memory setup requires a protected backup and a verified database path",
    };
  }
  if (![join(home, ".env"), join(home, ".mcp-memory", ".env")].every(knownPathAbsent)) {
    return {
      installed: false,
      upgradeBlocked: true,
      reason: "memory setup requires a verified database path when upstream dotenv files exist",
    };
  }
  if (!loadedMemoryJobPinMatches()) {
    return {
      installed: false,
      upgradeBlocked: true,
      reason: "memory upgrade requires a protected backup and a verified running job",
    };
  }
  if (!installedMemoryJobIdentityMatches(daemonPlist, home) || !installedMemoryJobPinMatches(daemonPlist)) {
    return {
      installed: false,
      upgradeBlocked: true,
      reason: "memory upgrade requires a protected backup and a verified restart",
    };
  }
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
  if (!memoryLaunchAgentSupported() || !launchdTargetsThisHome()) return false;
  try {
    runLaunchctl(["kickstart", "-k", `gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`], {
      stdio: "pipe",
    });
    return true;
  } catch {
    // best effort
    return false;
  }
}
