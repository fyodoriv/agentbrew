import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { logSkipped } from "../core/logger.js";
import { expandHome } from "../utils.js";

/** Auto-sync runs every 30 minutes. Single source of truth for all scheduler backends. */
export const AUTO_SYNC_INTERVAL_MINUTES = 30;
export const AUTO_SYNC_INTERVAL_SECONDS = AUTO_SYNC_INTERVAL_MINUTES * 60;

/**
 * LANG for every com.agentbrew.* LaunchAgent. launchd starts jobs without a
 * locale, and Homebrew gawk (the dotfiles bin/awk shim) then fails every regex
 * match that is not anchored at the start of the line.
 */
export const LAUNCHAGENT_LANG = "C.UTF-8";

/** Returns the agentbrew logs directory path (where auto-sync writes its rotating logs). */
export function getLogDir(): string {
  return expandHome("~/.local/share/agentbrew/logs");
}

/**
 * Returns the directory containing the Node binary running agentbrew.
 * Captured at install time so LaunchAgent/systemd PATH includes it,
 * even for NVM, mise, asdf, volta, fnm, and n users.
 */
export function getNodeBinDir(): string {
  return dirname(process.execPath);
}

function expandDotfilesHome(value: string, home: string): string {
  return value
    .trim()
    .replace(/^\$\{HOME\}(?=\/|$)/u, home)
    .replace(/^\$HOME(?=\/|$)/u, home)
    .replace(/^~(?=\/|$)/u, home);
}

function readConfiguredDotfilesDir(home: string): string | undefined {
  try {
    const contents = readFileSync(join(home, ".config", "dotfiles", "env.sh"), "utf8");
    const match = /^\s*(?:export\s+)?DOTFILES_DIR=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/mu.exec(contents);
    return match?.[1] ?? match?.[2] ?? match?.[3];
  } catch {
    return undefined;
  }
}

/**
 * Resolve the active dotfiles/bin for LaunchAgent and hook PATH templates.
 * Chezmoi's generated env.sh wins: launchd never sees the caller's shell, and
 * agent shells export DOTFILES_DIR as a development checkout, which must not
 * leak into plists. DOTFILES_DIR applies only when env.sh names no existing
 * checkout.
 */
export function resolveDotfilesBinPath(home: string): string {
  for (const dotfilesDir of [readConfiguredDotfilesDir(home), process.env.DOTFILES_DIR]) {
    if (!dotfilesDir) continue;
    const candidate = join(expandDotfilesHome(dotfilesDir, home), "bin");
    if (existsSync(candidate)) return candidate;
  }

  for (const candidate of [`${home}/apps/tooling/dotfiles/bin`, `${home}/apps/dotfiles/bin`, `${home}/dotfiles/bin`]) {
    if (existsSync(candidate)) return candidate;
  }
  return `${home}/apps/tooling/dotfiles/bin`;
}

/** fnm default Node bin (matches dotfiles launchagent-path / gui-path). */
export function resolveFnmNodeBin(home: string): string | undefined {
  const nodeVersionFile = join(home, ".node-version");
  if (!existsSync(nodeVersionFile)) return undefined;
  try {
    const raw = readFileSync(nodeVersionFile, "utf-8").trim().replace(/^v/u, "");
    if (!raw) return undefined;
    const fnmBin = join(home, ".local/share/fnm/node-versions", `v${raw}`, "installation/bin");
    return existsSync(fnmBin) ? fnmBin : undefined;
  } catch (e) {
    logSkipped("sync/scheduler-paths/resolveFnmNodeBin", e);
    return undefined;
  }
}

/**
 * Build LaunchAgent PATH matching dotfiles `launchagent-path` with nodeBinDir first
 * so `agentbrew fix` resolves under fnm/NVM even when launchd spawns with a minimal PATH.
 */
export function buildLaunchAgentPath(home: string, nodeBinDir: string = getNodeBinDir()): string {
  const parts: string[] = [nodeBinDir];
  const fnmBin = resolveFnmNodeBin(home);
  if (fnmBin && fnmBin !== nodeBinDir) {
    parts.push(fnmBin);
  }
  parts.push(resolveDotfilesBinPath(home));

  if (existsSync("/opt/homebrew/opt/curl/bin")) parts.push("/opt/homebrew/opt/curl/bin");
  if (existsSync("/opt/homebrew/bin")) parts.push("/opt/homebrew/bin");
  if (existsSync("/opt/homebrew/sbin")) parts.push("/opt/homebrew/sbin");

  const localBin = join(home, ".local/bin");
  if (existsSync(localBin)) parts.push(localBin);

  if (existsSync("/usr/local/opt/curl/bin")) parts.push("/usr/local/opt/curl/bin");
  parts.push("/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin");

  const homeBin = join(home, "bin");
  if (existsSync(homeBin)) parts.push(homeBin);

  return parts.join(":");
}

/** Prefix segments every com.agentbrew.* LaunchAgent PATH must include. */
export function requiredLaunchAgentPathPrefixes(home: string): string[] {
  const nodeBinDir = getNodeBinDir();
  const prefixes = [nodeBinDir];
  const fnmBin = resolveFnmNodeBin(home);
  if (fnmBin && fnmBin !== nodeBinDir) {
    prefixes.push(fnmBin);
  }
  prefixes.push(resolveDotfilesBinPath(home));
  return prefixes;
}

function pathStartsWithSegments(pathValue: string, segments: string[]): boolean {
  let remainder = pathValue;
  for (const segment of segments) {
    if (!remainder.startsWith(`${segment}:`) && remainder !== segment) {
      return false;
    }
    remainder = remainder.startsWith(`${segment}:`) ? remainder.slice(segment.length + 1) : "";
  }
  return true;
}

/** True when `path` has the required prefix, including Dotfiles' secure shim-first variant. */
export function launchAgentPathHasRequiredPrefixes(pathValue: string, home: string): boolean {
  const required = requiredLaunchAgentPathPrefixes(home);
  if (pathStartsWithSegments(pathValue, required)) return true;

  // Dotfiles' endpoint-path repair deliberately prepends its bin directory to
  // managed LaunchAgents. Keep its secure shim prefix valid without rewriting
  // the plist on every AgentBrew auto-repair cycle.
  const dotfilesBin = required.at(-1);
  return dotfilesBin ? pathStartsWithSegments(pathValue, [dotfilesBin, ...required.slice(0, -1)]) : false;
}

/** dist/cli.js entry used by LaunchAgent/cron — never a shebang symlink or bash wrapper. */
export function resolveAgentBrewCliJsPath(): string {
  const argv1 = process.argv[1];
  if (argv1?.endsWith("/dist/cli.js") && existsSync(argv1)) {
    return argv1;
  }
  if (argv1?.endsWith("/src/cli.ts")) {
    const distFromDev = join(dirname(dirname(argv1)), "dist/cli.js");
    if (existsSync(distFromDev)) return distFromDev;
  }

  const bin = getAgentBrewBin();
  let resolved = bin;
  try {
    if (existsSync(bin)) {
      resolved = realpathSync(bin);
    }
  } catch (e) {
    logSkipped("sync/scheduler-paths/resolveAgentBrewCliJsPath", e);
  }

  if (resolved.endsWith(".js")) {
    return resolved;
  }

  for (const candidate of [
    join(expandHome("~"), "apps/tooling/agentbrew/dist/cli.js"),
    join(expandHome("~"), "apps/agentbrew/dist/cli.js"),
    join(dirname(resolved), "../lib/node_modules/agentbrew/dist/cli.js"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  return join(expandHome("~"), "apps/tooling/agentbrew/dist/cli.js");
}

/**
 * ProgramArguments for com.agentbrew.check — invoke node + cli.js explicitly so
 * launchd never relies on `#!/usr/bin/env node` shebang resolution.
 */
export function buildLaunchAgentFixArgs(): string[] {
  return [process.execPath, resolveAgentBrewCliJsPath(), "fix"];
}

/** Resolve the agentbrew binary path — tries `which`, then process.argv, then default. */
export function getAgentBrewBin(): string {
  // 1. Try resolving via PATH (respects npm -g, brew, etc.)
  try {
    const resolved = execFileSync("which", ["agentbrew"], { stdio: "pipe", timeout: 3_000 }).toString().trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch (e) {
    logSkipped("sync/scheduler-paths/execFileSync", e);
    // `which` failed — not in PATH
  }

  // 2. Fall back to the currently-running script's path
  const argv1 = process.argv[1];
  if (argv1 && existsSync(argv1)) return argv1;

  // 3. Last resort: conventional install location
  return expandHome("~/.local/bin/agentbrew");
}
