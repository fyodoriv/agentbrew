import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { input } from "@inquirer/prompts";
import chalk from "chalk";
import { getStateServers } from "../agentfile.js";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import type { McpServer } from "../types.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { checkGitAvailable } from "../utils.js";
import { extractEnvVars, isEnvVarResolved } from "./mcp-setup.js";

// ── Constants ────────────────────────────────────────────────────────────────

/** Cache directory for git-installed MCP server repos. */
export const GIT_CACHE_DIR = join(homedir(), ".config", "agentbrew", "mcp-repos");

/** Timeout for fast git operations: fetch, checkout, pull, rev-parse. */
const GIT_FAST_TIMEOUT_MS = 30_000;

/** Timeout for git clone — needs more time for initial download. */
const GIT_CLONE_TIMEOUT_MS = 60_000;

/** Timeout for npm install and npm run build inside cloned repos. */
const NPM_BUILD_TIMEOUT_MS = 120_000;

/** Candidate entrypoint filenames checked in preference order. */
const ENTRYPOINT_CANDIDATES = [
  "dist/index.js",
  "build/index.js",
  "index.js",
  "dist/server.js",
  "build/server.js",
  "server.js",
  "run_server.py",
  "server.py",
  "main.py",
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface DetectedEntrypoint {
  command: string;
  args: string[];
}

interface GitInstallOptions {
  /** Git ref (branch, tag, commit) to pin. Defaults to default branch HEAD. */
  ref?: string;
  /** Override the server name derived from the repo URL. */
  name?: string;
  /** Skip the interactive env var prompt (non-interactive mode). */
  nonInteractive?: boolean;
}

// ── Repo name derivation ──────────────────────────────────────────────────────

/** Allowed characters for repo/server names used as directory names. */
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * Validate that a repo name is safe to use as a directory name.
 * Rejects path separators and traversal sequences (e.g. `../../etc`).
 */
export function validateRepoName(name: string): void {
  if (!name || !SAFE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid server name '${name}': must contain only alphanumeric characters, dots, hyphens, and underscores.`,
    );
  }
}

/**
 * Derive a local cache name from a git URL.
 * Strips .git suffix and uses the last path component.
 */
export function deriveRepoName(gitUrl: string): string {
  const lastSegment = gitUrl.split("/").at(-1) ?? gitUrl;
  return lastSegment.replace(/\.git$/, "");
}

// ── Git operations ────────────────────────────────────────────────────────────

/**
 * Clone a git repo into the agentbrew MCP cache, or fetch + checkout if already present.
 * Returns the path to the local repo directory.
 */
export function cloneOrUpdateRepo(gitUrl: string, repoName: string, gitRef?: string): string {
  validateRepoName(repoName);
  const repoDir = join(GIT_CACHE_DIR, repoName);

  if (existsSync(repoDir)) {
    console.log(chalk.dim(`  Updating existing repo at ${repoDir}...`));
    try {
      execFileSync("git", ["fetch", "--tags"], { cwd: repoDir, stdio: "pipe", timeout: GIT_FAST_TIMEOUT_MS });
      if (gitRef) {
        execFileSync("git", ["checkout", gitRef], { cwd: repoDir, stdio: "pipe", timeout: GIT_FAST_TIMEOUT_MS });
      } else {
        execFileSync("git", ["pull"], { cwd: repoDir, stdio: "pipe", timeout: GIT_FAST_TIMEOUT_MS });
      }
    } catch (error) {
      const message = errorMessage(error);
      throw new Error(`Failed to update repo: ${message}`);
    }
  } else {
    console.log(chalk.dim(`  Cloning ${gitUrl}...`));
    const extraArgs = gitRef ? ["--branch", gitRef] : [];
    const result = spawnSync("git", ["clone", ...extraArgs, gitUrl, repoDir], {
      stdio: "pipe",
      timeout: GIT_CLONE_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? "";
      throw new Error(`git clone failed: ${stderr.trim() || "unknown error"}`);
    }
  }

  return repoDir;
}

/**
 * Resolve the current HEAD commit SHA for a repo directory.
 * Used to record the pinned ref in state for reproducibility.
 */
export function resolveHeadSha(repoDir: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoDir,
      stdio: "pipe",
      timeout: GIT_FAST_TIMEOUT_MS,
    })
      .toString()
      .trim();
  } catch (e) {
    logSkipped("mcp/mcp-git/trim", e);
    return "unknown";
  }
}

// ── Build step ────────────────────────────────────────────────────────────────

/**
 * Run `npm install` + `npm run build` for a Node.js repo if a build script is present.
 * Emits a warning (instead of throwing) on failure so the install can continue with any
 * pre-built files that may already exist in the repo.
 */
export function buildRepoIfNeeded(repoDir: string): void {
  const packageJsonPath = join(repoDir, "package.json");
  if (!existsSync(packageJsonPath)) return;

  let hasBuildScript = false;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    hasBuildScript = Boolean(packageJson.scripts?.build);
  } catch (e) {
    logSkipped("mcp/mcp-git/Boolean", e);
    return;
  }

  if (!hasBuildScript) return;

  console.log(chalk.dim("  Running npm install + build..."));
  try {
    execFileSync("npm", ["install", "--prefer-offline"], {
      cwd: repoDir,
      stdio: "pipe",
      timeout: NPM_BUILD_TIMEOUT_MS,
    });
    execFileSync("npm", ["run", "build"], { cwd: repoDir, stdio: "pipe", timeout: NPM_BUILD_TIMEOUT_MS });
  } catch (error) {
    const message = errorMessage(error);
    console.log(chalk.yellow(`  ⚠ Build step failed: ${message}. Continuing with pre-built files.`));
  }
}

// ── Entrypoint detection ──────────────────────────────────────────────────────

/** Try to resolve an entrypoint from package.json main/bin fields. */
function detectEntrypointFromPackageJson(repoDir: string): DetectedEntrypoint | undefined {
  const packageJsonPath = join(repoDir, "package.json");
  if (!existsSync(packageJsonPath)) return undefined;

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      main?: string;
      bin?: string | Record<string, string>;
    };

    const binField = packageJson.bin;
    if (binField) {
      const binRelPath = typeof binField === "string" ? binField : Object.values(binField)[0];
      if (binRelPath) {
        const resolved = join(repoDir, binRelPath);
        if (existsSync(resolved)) return { command: "node", args: [resolved] };
      }
    }

    if (packageJson.main) {
      const resolved = join(repoDir, packageJson.main);
      if (existsSync(resolved)) return { command: "node", args: [resolved] };
    }
  } catch (e) {
    logSkipped("mcp/mcp-git/join", e);
    // Malformed package.json — cannot detect
  }

  return undefined;
}

/**
 * Detect the MCP server entrypoint for a cloned repo directory.
 * Checks well-known candidate paths and falls back to package.json main/bin fields.
 * Returns undefined if no entrypoint can be determined.
 */
export function detectEntrypoint(repoDir: string): DetectedEntrypoint | undefined {
  for (const candidate of ENTRYPOINT_CANDIDATES) {
    const fullPath = join(repoDir, candidate);
    if (!existsSync(fullPath)) continue;

    if (candidate.endsWith(".py")) {
      return { command: "python3", args: [fullPath] };
    }
    return { command: "node", args: [fullPath] };
  }

  return detectEntrypointFromPackageJson(repoDir);
}

// ── Env var prompting ─────────────────────────────────────────────────────────

/**
 * Prompt user for any env vars referenced in args/env that are not already set in the process.
 * Reuses extractEnvVars + isEnvVarResolved from mcp-setup for consistent behavior.
 */
export async function promptForMissingEnvVars(
  serverDraft: Pick<McpServer, "args" | "env">,
): Promise<Record<string, string>> {
  const requiredVars = extractEnvVars(serverDraft);
  const missingVars = requiredVars.filter((variable) => !isEnvVarResolved(variable));

  if (missingVars.length === 0) return {};

  console.log(chalk.bold("\n  Environment variables required:\n"));
  const collected: Record<string, string> = {};

  for (const varName of missingVars) {
    const value = await input({
      message: `  Paste your ${chalk.cyan(varName)}:`,
      validate: (val) => val.trim().length > 0 || "Value cannot be empty",
    });
    collected[varName] = value.trim();
    process.env[varName] = value.trim();
  }

  return collected;
}

// ── Main install flow ─────────────────────────────────────────────────────────

/**
 * Install an MCP server from a git URL.
 * Clones the repo into the agentbrew cache, optionally builds it, detects the
 * entrypoint, prompts for any missing env vars, registers in state, and syncs
 * to all agents. Supports pinning to a specific ref for reproducibility.
 */
export async function installMcpFromGit(gitUrl: string, options?: GitInstallOptions): Promise<void> {
  if (!checkGitAvailable()) {
    process.exitCode = 1;
    return;
  }

  const serverName = options?.name ?? deriveRepoName(gitUrl);
  const repoDir = join(GIT_CACHE_DIR, serverName);

  console.log(chalk.bold(`\nInstalling MCP server from git: ${chalk.cyan(gitUrl)}\n`));

  // 1. Clone or update the repo
  let clonedDir: string;
  try {
    clonedDir = cloneOrUpdateRepo(gitUrl, serverName, options?.ref);
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    return;
  }

  // 2. Build if a build script is present
  buildRepoIfNeeded(clonedDir);

  // 3. Detect entrypoint
  const entrypoint = detectEntrypoint(clonedDir);
  if (!entrypoint) {
    const candidates = ENTRYPOINT_CANDIDATES.join(", ");
    console.log(
      chalk.red(
        `  ✗ Could not detect entrypoint in ${clonedDir}.\n` +
          `    Expected one of: ${candidates}\n` +
          `    Use 'agentbrew install ${serverName} -c <command> -a <args...>' to add manually.`,
      ),
    );
    return;
  }

  console.log(chalk.dim(`  Detected entrypoint: ${entrypoint.command} ${entrypoint.args.join(" ")}`));

  // 4. Prompt for any missing env vars
  if (!options?.nonInteractive) {
    try {
      await promptForMissingEnvVars({ args: entrypoint.args, env: {} });
    } catch (error) {
      if (error instanceof ExitPromptError) {
        console.log(chalk.yellow("\n  Installation cancelled.\n"));
        return;
      }
      throw error;
    }
  }

  // 5. Resolve pinned ref (use provided ref or current HEAD SHA)
  const sha = resolveHeadSha(clonedDir);
  const pinnedRef = options?.ref ?? sha;

  // 6. Register in state and sync to all agents
  const { addMcpServer } = await import("../sync/mcp-sync.js");
  await addMcpServer(
    serverName,
    entrypoint.command,
    entrypoint.args,
    {},
    {
      gitUrl,
      gitRef: pinnedRef,
    },
  );

  console.log(`  ${ICON_SUCCESS} ${serverName} installed from git (${pinnedRef})`);
  console.log(chalk.dim(`    Repo cached at: ${repoDir}\n`));
}

// ── Update flow ───────────────────────────────────────────────────────────────

/**
 * Pull the latest changes for a git-installed MCP server, rebuild, re-detect the entrypoint,
 * and re-sync to all agents. Only works for servers with a gitUrl stored in state.
 */
export async function updateMcpFromGit(serverName: string): Promise<void> {
  if (!checkGitAvailable()) {
    process.exitCode = 1;
    return;
  }

  const { requireState, saveState } = await import("../state.js");
  const state = requireState();
  if (!state) return;

  const server = getStateServers(state).find((s) => s.name === serverName);
  if (!server) {
    console.error(chalk.red(`  ✗ MCP server '${serverName}' not found in state.`));
    return;
  }

  if (!server.gitUrl) {
    console.log(
      chalk.red(
        `  ✗ '${serverName}' was not installed from git.\n    'agentbrew mcp update' only updates git-installed servers.\n    Use 'agentbrew install' to reconfigure it manually.`,
      ),
    );
    return;
  }

  console.log(chalk.bold(`\nUpdating ${chalk.cyan(serverName)} from git...\n`));

  const repoDir = join(GIT_CACHE_DIR, serverName);
  try {
    cloneOrUpdateRepo(server.gitUrl, serverName);
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    console.log(chalk.dim("  Check the repo URL and your network connection, then retry with `agentbrew mcp update`."));
    return;
  }

  buildRepoIfNeeded(repoDir);

  const entrypoint = detectEntrypoint(repoDir);
  if (!entrypoint) {
    console.error(chalk.red("  ✗ Could not detect entrypoint after update. Server config unchanged."));
    return;
  }

  const newSha = resolveHeadSha(repoDir);
  server.command = entrypoint.command;
  server.args = entrypoint.args;
  server.gitRef = newSha;
  saveState(state);

  const { syncMcpServers } = await import("../sync/mcp-sync.js");
  await syncMcpServers();

  console.log(`  ${ICON_SUCCESS} ${serverName} updated to ${newSha}\n`);
}
