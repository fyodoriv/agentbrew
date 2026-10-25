import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import chalk from "chalk";
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

/** Stable Node links that survive a Node upgrade, in the order they are tried. */
export const STABLE_NODE_LINKS: readonly string[] = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];

export interface SchedulerNodeOptions {
  /** The running Node. Default: `process.execPath`, which is always a resolved real path. */
  execPath?: string;
  /** Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Default: {@link STABLE_NODE_LINKS}. */
  stableLinks?: readonly string[];
}

/** AGENTBREW_NODE_BIN values already warned about. Module scope: lives for
 *  one agentbrew process, so a bad value warns once per run, not per call. */
const warnedNodeOverrides = new Set<string>();

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** True when `path` is an absolute executable that prints a Node version. */
function nodeRuns(path: string): boolean {
  if (!isAbsolute(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    const version = execFileSync(path, ["--version"], { encoding: "utf-8", stdio: "pipe", timeout: 5_000 });
    return /^v\d+/u.test(String(version).trim());
  } catch (e) {
    logSkipped("sync/scheduler-paths/nodeRuns", e);
    return false;
  }
}

/** The Homebrew `opt` link of a Cellar keg Node: `<prefix>/Cellar/<formula>/<version>/bin/node`
 *  becomes `<prefix>/opt/<formula>/bin/node`. Homebrew moves that link on every upgrade. */
function homebrewOptNode(execPath: string): string | undefined {
  const match = /^(.+)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/u.exec(execPath);
  return match ? `${match[1]}/opt/${match[2]}/bin/node` : undefined;
}

/** fnm's default alias for an fnm-installed Node: `<fnm>/node-versions/<v>/installation/bin/node`
 *  becomes `<fnm>/aliases/default/bin/node`. fnm moves that alias when the default changes. */
function fnmDefaultNode(execPath: string): string | undefined {
  const match = /^(.+)\/node-versions\/[^/]+\/installation\/bin\/node$/u.exec(execPath);
  return match ? `${match[1]}/aliases/default/bin/node` : undefined;
}

function resolveUncached(execPath: string, override: string | undefined, stableLinks: readonly string[]): string {
  if (override) {
    if (nodeRuns(override)) return override;
    if (!warnedNodeOverrides.has(override)) {
      warnedNodeOverrides.add(override);
      console.error(chalk.yellow(`AGENTBREW_NODE_BIN=${override} is not a Node that runs; it is ignored.`));
    }
  }
  const real = realpathOrSelf(execPath);
  const managerLinks = [homebrewOptNode(real), fnmDefaultNode(real)].filter((link): link is string => !!link);
  for (const candidate of [...managerLinks, ...stableLinks]) {
    if (existsSync(candidate) && realpathOrSelf(candidate) === real) return candidate;
  }
  return execPath;
}

/**
 * The Node binary that com.agentbrew.* scheduler jobs run (#356).
 * 1. `AGENTBREW_NODE_BIN`, verbatim (links are not resolved), when it runs.
 * 2. A link that points at the running Node and survives upgrades: the
 *    Homebrew keg's `opt/<formula>/bin/node`, fnm's `aliases/default/bin/node`,
 *    then {@link STABLE_NODE_LINKS}. Each is used only when it points at the
 *    running Node.
 *    `process.execPath` is a resolved path, so on Homebrew it names the
 *    versioned Cellar folder that `brew cleanup` deletes after an upgrade.
 * 3. `process.execPath`.
 */
export function resolveSchedulerNode(options: SchedulerNodeOptions = {}): string {
  const execPath = options.execPath ?? process.execPath;
  const override = (options.env ?? process.env).AGENTBREW_NODE_BIN?.trim() || undefined;
  return resolveUncached(execPath, override, options.stableLinks ?? STABLE_NODE_LINKS);
}

/**
 * Returns the directory of the Node binary that scheduler jobs run
 * ({@link resolveSchedulerNode}). LaunchAgent/systemd PATH starts with it,
 * even for NVM, mise, asdf, volta, fnm, and n users.
 */
export function getNodeBinDir(): string {
  return dirname(resolveSchedulerNode());
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
  // Nothing exists yet: use the README's default clone path.
  return `${home}/apps/dotfiles/bin`;
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
export function requiredLaunchAgentPathPrefixes(home: string, nodeBinDir: string = getNodeBinDir()): string[] {
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
export function launchAgentPathHasRequiredPrefixes(
  pathValue: string,
  home: string,
  nodeBinDir: string = getNodeBinDir(),
): boolean {
  const required = requiredLaunchAgentPathPrefixes(home, nodeBinDir);
  if (pathStartsWithSegments(pathValue, required)) return true;

  // Dotfiles' endpoint-path repair deliberately prepends its bin directory to
  // managed LaunchAgents. Keep its secure shim prefix valid without rewriting
  // the plist on every AgentBrew auto-repair cycle.
  const dotfilesBin = required.at(-1);
  return dotfilesBin ? pathStartsWithSegments(pathValue, [dotfilesBin, ...required.slice(0, -1)]) : false;
}

const STABLE_CLI_CANDIDATES = (): string[] => [
  join(expandHome("~"), "apps/tooling/agentbrew/dist/cli.js"),
  join(expandHome("~"), "apps/agentbrew/dist/cli.js"),
];

/** True when `root` is a linked git worktree: its `.git` is a `gitdir: .../worktrees/<name>` file, not a folder.
 *  A pinned worktree path breaks the job once the worktree is removed after its PR merges (2026-10-25). */
function isLinkedWorktree(root: string): boolean {
  try {
    // A submodule's .git is a gitdir: file too, but points into .git/modules/.
    return /^gitdir: .*\/worktrees\//u.test(String(readFileSync(join(root, ".git"), "utf-8")));
  } catch {
    return false;
  }
}

/**
 * A linked git worktree is often deleted after its PR merges; a job pinned to
 * it then fails every run. Use the stable checkout instead when it exists.
 */
function stableUnlessWorktree(cliJs: string): string {
  let real = cliJs;
  try {
    real = realpathSync(cliJs) || cliJs;
  } catch (e) {
    logSkipped("sync/scheduler-paths/realpath-argv1", e);
  }
  if (!isLinkedWorktree(dirname(dirname(real)))) return cliJs;
  return STABLE_CLI_CANDIDATES().find((candidate) => existsSync(candidate)) ?? cliJs;
}

/** dist/cli.js entry used by LaunchAgent/cron — never a shebang symlink or bash wrapper. */
export function resolveAgentBrewCliJsPath(): string {
  const argv1 = process.argv[1];
  if (argv1?.endsWith("/dist/cli.js") && existsSync(argv1)) {
    return stableUnlessWorktree(argv1);
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
    ...STABLE_CLI_CANDIDATES(),
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
  return [resolveSchedulerNode(), resolveAgentBrewCliJsPath(), "fix"];
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
