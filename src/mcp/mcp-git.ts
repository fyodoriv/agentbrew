import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import { getStateServers } from "../agentfile.js";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import type { McpServer } from "../types.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { checkGitAvailable } from "../utils.js";
import {
  assertCacheOrigin,
  assertOwnRepo,
  assertPinnedRef,
  CacheRefusal,
  cacheGitEnv,
  checkoutPinnedRef,
  headCommit,
  isDetachedHead,
  isInHeadCommit,
  isLocalRepoPath,
} from "./git-ref.js";
import { extractEnvVars, isEnvVarResolved } from "./mcp-setup.js";
import { appendToShellConfig, getShellConfigPath } from "./mcp-wizard.js";

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
  /** Git tag, branch, or full commit ID to pin (see checkoutPinnedRef). Defaults to default branch HEAD. */
  ref?: string;
  /** Override the server name derived from the repo URL. */
  name?: string;
  /** `--env` pairs for the server: `KEY=VALUE` stores the value, `KEY` alone a `${KEY}` reference. */
  envPairs?: readonly string[];
  /** Never prompt (`--yes`): a missing env var fails with its name instead. */
  nonInteractive?: boolean;
}

/** An env var name a shell can export. */
const ENV_VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A `${KEY}` reference name: upper case, as the sync converters in env-vars.ts read it. */
const ENV_REF_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * The server env from `--env` pairs. `KEY=VALUE` stores the value as given;
 * `KEY` alone stores the `${KEY}` reference, which agents read from their own
 * environment. Throws on a name that is not a valid env var name; the message
 * names the key only, never a value.
 */
export function gitServerEnv(pairs: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [index, pair] of pairs.entries()) {
    const eq = pair.indexOf("=");
    const key = eq < 0 ? pair : pair.slice(0, eq);
    // Name the entry by position: a pasted secret with no key must not be echoed.
    // An empty or `=`-only value is refused too: base64 padding makes a token look like KEY=VALUE.
    const value = eq < 0 ? "" : pair.slice(eq + 1);
    if (!(eq < 0 ? ENV_REF_NAME : ENV_VAR_NAME).test(key) || (eq >= 0 && /^=*$/.test(value))) {
      throw new Error(
        `--env entry ${index + 1} is not KEY=VALUE (with a value) or an upper-case KEY (letters, digits, and _) to read from the environment.`,
      );
    }
    env[key] = eq < 0 ? `\${${key}}` : value;
  }
  return env;
}

// ── Repo name derivation ──────────────────────────────────────────────────────

/** Allowed characters for repo/server names used as directory names. */
const SAFE_NAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/**
 * Validate that a repo name is safe to use as a directory name.
 * Rejects path separators, traversal sequences (e.g. `../../etc`), and names made only of dots.
 */
export function validateRepoName(name: string): void {
  // `.` and `..` would make the cache dir an existing dir, where git finds another repo.
  if (!name || !SAFE_NAME_PATTERN.test(name) || /^\.+$/.test(name)) {
    throw new Error(
      `Invalid server name '${name}': must contain only alphanumeric characters, dots, hyphens, and underscores, and not only dots.`,
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

/** Refresh the cached repo at `repoDir`, cloned from `gitUrl`, then check out `gitRef` exactly, or pull. */
function updateCachedRepo(repoDir: string, gitUrl: string, gitRef?: string): void {
  console.log(chalk.dim(`  Updating existing repo at ${repoDir}...`));
  try {
    // Never let git act on a repo that encloses the cache dir, or one that GIT_DIR names,
    // and use the cache only for the repo that made it.
    const env = cacheGitEnv();
    assertOwnRepo(repoDir, env);
    assertCacheOrigin(repoDir, gitUrl, env);
    if (gitRef) {
      // checkoutPinnedRef fetches only what the ref needs, so a moved tag never blocks it.
      checkoutPinnedRef(repoDir, gitRef, env);
    } else {
      if (isDetachedHead(repoDir, env)) {
        throw new CacheRefusal(
          `${repoDir} is pinned to a tag or commit, and agentbrew pulls only a branch pin. ` +
            `To move the pin or follow a branch, run \`agentbrew install ${basename(repoDir)} --git '${gitUrl}' --ref <tag|branch|commit>\`.`,
        );
      }
      execFileSync("git", ["fetch", "--tags"], { cwd: repoDir, env, stdio: "pipe", timeout: GIT_FAST_TIMEOUT_MS });
      execFileSync("git", ["pull"], { cwd: repoDir, env, stdio: "pipe", timeout: GIT_FAST_TIMEOUT_MS });
    }
  } catch (error) {
    if (error instanceof CacheRefusal) throw error;
    const message = errorMessage(error);
    throw new Error(`Failed to update repo: ${message}`);
  }
}

/** Clone `gitUrl` to `repoDir`. With `gitRef`, clone without a checkout, then check out that exact ref. */
function cloneFresh(gitUrl: string, repoDir: string, gitRef?: string): void {
  console.log(chalk.dim(`  Cloning ${gitUrl}...`));
  // -o origin: checkoutPinnedRef reads `origin`, whatever clone.defaultRemoteName says.
  const extraArgs = gitRef ? ["--no-checkout"] : [];
  const env = cacheGitEnv();
  const result = spawnSync("git", ["clone", "-o", "origin", ...extraArgs, "--end-of-options", gitUrl, repoDir], {
    env,
    stdio: "pipe",
    timeout: GIT_CLONE_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`git clone failed: ${stderr.trim() || "unknown error"}`);
  }
  if (!gitRef) return;
  try {
    checkoutPinnedRef(repoDir, gitRef, env);
  } catch (error) {
    // Remove the half-made clone, so the next run starts fresh instead of updating it.
    rmSync(repoDir, { recursive: true, force: true });
    throw new Error(`git checkout failed: ${errorMessage(error)}`);
  }
}

/**
 * Clone a git repo into the agentbrew MCP cache, or fetch + checkout if already present.
 * A `gitRef` is checked out exactly by {@link checkoutPinnedRef}: a tag wins over a
 * branch with the same name, and a ref that starts with `-` is refused before git runs.
 * Returns the path to the local repo directory.
 */
export function cloneOrUpdateRepo(gitUrl: string, repoName: string, gitRef?: string): string {
  validateRepoName(repoName);
  if (gitRef !== undefined) assertPinnedRef(gitRef);
  const repoDir = join(GIT_CACHE_DIR, repoName);
  // A symlink would point git at a repo outside the cache, where `checkout -B` can drop commits.
  if (lstatSync(repoDir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new CacheRefusal(`${repoDir} is a symlink. Delete the link (not its target) and run the install again.`);
  }
  if (existsSync(repoDir)) updateCachedRepo(repoDir, gitUrl, gitRef);
  else cloneFresh(gitUrl, repoDir, gitRef);
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
      env: cacheGitEnv(),
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

/** File in the cache's `.git` that names the commit the cache's build output comes from. */
const BUILT_COMMIT_FILE = "agentbrew-built-commit";

/** What `buildRepoIfNeeded` did, for deciding which build output belongs to HEAD. */
export interface BuildOutcome {
  /** A build script ran (`npm install` + `npm run build`). */
  ran: boolean;
  /** The build succeeded. */
  ok: boolean;
  /** Before this build, the cache's build output was known to come from the checked-out commit. */
  headBuiltBefore: boolean;
}

/** Record HEAD as the commit the build output in `repoDir` comes from. */
function recordBuiltCommit(repoDir: string): void {
  try {
    writeFileSync(join(repoDir, ".git", BUILT_COMMIT_FILE), `${headCommit(repoDir)}\n`);
  } catch (e) {
    logSkipped("mcp/mcp-git/recordBuiltCommit", e);
  }
}

/** True when the cache's build output in `repoDir` is known to come from the checked-out commit. */
function headWasBuilt(repoDir: string): boolean {
  const head = headCommit(repoDir);
  try {
    return head !== "" && readFileSync(join(repoDir, ".git", BUILT_COMMIT_FILE), "utf-8").trim() === head;
  } catch {
    return false;
  }
}

/** Forget which commit the build output comes from: it is from another commit now. */
function forgetBuiltCommit(repoDir: string): void {
  try {
    unlinkSync(join(repoDir, ".git", BUILT_COMMIT_FILE));
  } catch (e) {
    logSkipped("mcp/mcp-git/forgetBuiltCommit", e);
  }
}

/**
 * Run `npm install` + `npm run build` for a Node.js repo if a build script is
 * present. A failure is a warning here; the callers decide with
 * {@link assertBuildUsable} whether pre-built files may run. No build output or user file is deleted.
 * The record names the commit the cache's build output comes from: written
 * after a successful build, and after any build of a fresh clone, whose files
 * all come from HEAD.
 */
export function buildRepoIfNeeded(repoDir: string, freshClone = false): BuildOutcome {
  const headBuiltBefore = headWasBuilt(repoDir);
  const outcome: BuildOutcome = { ran: false, ok: false, headBuiltBefore };
  const packageJsonPath = join(repoDir, "package.json");
  if (!existsSync(packageJsonPath)) return outcome;

  let hasBuildScript = false;
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    hasBuildScript = Boolean(packageJson.scripts?.build);
  } catch (e) {
    logSkipped("mcp/mcp-git/Boolean", e);
    return outcome;
  }

  if (!hasBuildScript) return outcome;

  // At a new commit the record is stale until this build succeeds; a failed
  // build must not let partial output pass as a later re-pin's own.
  if (!headBuiltBefore) forgetBuiltCommit(repoDir);
  console.log(chalk.dim("  Running npm install + build..."));
  try {
    // cacheGitEnv: a build script that runs git (husky's prepare) must not act on a GIT_DIR repo.
    const env = cacheGitEnv();
    execFileSync("npm", ["install", "--prefer-offline"], {
      cwd: repoDir,
      env,
      stdio: "pipe",
      timeout: NPM_BUILD_TIMEOUT_MS,
    });
    execFileSync("npm", ["run", "build"], { cwd: repoDir, env, stdio: "pipe", timeout: NPM_BUILD_TIMEOUT_MS });
    recordBuiltCommit(repoDir);
    return { ...outcome, ran: true, ok: true };
  } catch (error) {
    const message = errorMessage(error);
    console.log(chalk.yellow(`  ⚠ Build step failed: ${message}.`));
    if (freshClone) recordBuiltCommit(repoDir);
    return { ...outcome, ran: true, ok: false };
  }
}

/**
 * Throw when the build failed at a commit the cache's build output is not
 * known to come from: that output may come from another commit, even behind
 * a tracked shim that loads it. A fresh clone holds only this commit's files,
 * so its pre-built files may still run, and so may the output of an earlier
 * successful build of this same commit.
 */
export function assertBuildUsable(repoDir: string, build: BuildOutcome, freshClone: boolean, gitUrl: string): void {
  if (!build.ran || build.ok || freshClone || build.headBuiltBefore) return;
  const head = headCommit(repoDir).slice(0, 12) || "HEAD";
  throw new Error(
    `The build failed at ${head}, and this cache has no build output known to come from it, so its output may come ` +
      `from another commit. Nothing was registered or saved. The cache stays at ${head}, and a server registered ` +
      "from it earlier runs these files. Fix the build, or pin a ref whose build works: " +
      `\`agentbrew install ${basename(repoDir)} --git '${gitUrl}' --ref <ref>\`. To start over from a fresh clone, ` +
      `move any files you keep in ${repoDir}, delete it, and run that install command.`,
  );
}

/**
 * Throw when no build ran and the entrypoint is neither in the checked-out
 * commit nor output of a successful build of it: it is left over from a build
 * at another commit (a commit that dropped its build script, for example).
 */
export function assertEntrypointUsable(
  repoDir: string,
  entrypoint: DetectedEntrypoint,
  build: BuildOutcome,
  freshClone: boolean,
): void {
  const script = entrypoint.args[0];
  if (build.ran || freshClone || build.headBuiltBefore || !script) return;
  const rel = relative(repoDir, script);
  // git tree paths use `/` on every platform.
  if (isInHeadCommit(repoDir, rel.split(sep).join("/"))) return;
  const outside = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const hint = outside ? "" : ` Delete ${script} and run the install again.`;
  throw new Error(
    `${script} is not in the checked-out commit, and no build of that commit made it: it is left over from an earlier build.${hint}`,
  );
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
    // Hidden input: a pasted secret never shows on screen or in a terminal log.
    const value = await password({
      message: `  Paste your ${chalk.cyan(varName)}:`,
      mask: true,
      validate: (val) => val.trim().length > 0 || "Value cannot be empty",
    });
    collected[varName] = value.trim();
    process.env[varName] = value.trim();
  }

  return collected;
}

/** The env of an installed server with this name, so a re-install keeps keys it does not pass again. */
async function installedServerEnv(serverName: string): Promise<Record<string, string>> {
  const { requireState } = await import("../state.js");
  const state = requireState({ quiet: true });
  const server = state ? getStateServers(state).find((s) => s.name === serverName) : undefined;
  return { ...(server?.env ?? {}) };
}

/**
 * Ask for the missing values with hidden input, then offer to save them to the
 * shell secrets file, as `agentbrew setup` does: agents read `${KEY}` from
 * their own environment, so a value kept only in this process would be lost.
 * Prints key names only.
 */
async function promptAndSaveEnvVars(draft: Pick<McpServer, "args" | "env">): Promise<void> {
  const collected = await promptForMissingEnvVars(draft);
  const keys = Object.keys(collected);
  if (keys.length === 0) return;
  const save = await confirm({
    message: `  Save ${keys.join(", ")} to ${getShellConfigPath()}, so agents can read them?`,
    default: true,
  });
  if (save) {
    const saved = Object.entries(collected).filter(([key, value]) => appendToShellConfig(key, value));
    if (saved.length > 0) {
      console.log(chalk.dim(`    ✓ Saved ${saved.map(([key]) => key).join(", ")} to ${getShellConfigPath()}`));
    }
  } else {
    console.log(chalk.yellow(`  ⚠ Not saved: agents start the server without ${keys.join(", ")} unless they have it.`));
  }
}

/**
 * True when every env var the server refers to has a value. With `--yes` or
 * no terminal, a missing one fails with exit 1 and its name, never a value,
 * so an agent never waits on a prompt. In a terminal, agentbrew asks with
 * hidden input; Ctrl-C there exits 130.
 */
async function envVarsReady(
  serverName: string,
  draft: Pick<McpServer, "args" | "env">,
  nonInteractive: boolean,
): Promise<boolean> {
  const missing = extractEnvVars(draft).filter((variable) => !isEnvVarResolved(variable));
  if (missing.length === 0) return true;
  // Both ends must be a terminal: a redirected stdout would hide the prompt.
  if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(chalk.red(`  ✗ ${serverName} needs env vars that are not set: ${missing.join(", ")}.`));
    console.error(
      chalk.dim(
        `    Set them in this shell or in ${getShellConfigPath()} and run the install again, or run it in a terminal ` +
          "without --yes to be asked. (--env KEY=VALUE stores the value as given: only for values that are not secret.)",
      ),
    );
    process.exitCode = 1;
    return false;
  }
  try {
    await promptAndSaveEnvVars(draft);
    return true;
  } catch (error) {
    if (!(error instanceof ExitPromptError)) throw error;
    console.log(chalk.yellow("\n  Installation cancelled.\n"));
    process.exitCode = 130;
    return false;
  }
}

// ── Main install flow ─────────────────────────────────────────────────────────

/**
 * Build the cached repo and detect its entrypoint. Prints why and sets exit
 * code 1 when there is none, or when a failed or skipped build would register
 * output from another commit.
 */
function buildAndFindEntrypoint(
  repoDir: string,
  gitUrl: string,
  freshClone: boolean,
  missingHint: string,
): DetectedEntrypoint | undefined {
  const build = buildRepoIfNeeded(repoDir, freshClone);
  try {
    assertBuildUsable(repoDir, build, freshClone, gitUrl);
    const entrypoint = detectEntrypoint(repoDir);
    if (!entrypoint) throw new Error(missingHint);
    assertEntrypointUsable(repoDir, entrypoint, build, freshClone);
    return entrypoint;
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    process.exitCode = 1;
    return undefined;
  }
}

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
  // Check --env before cloning, so a typo fails fast. A re-install keeps the
  // server's other env vars; the pairs passed now add or replace keys.
  let env: Record<string, string>;
  try {
    // Cheap checks first, so a typo fails before anyone types a secret.
    validateRepoName(serverName);
    if (options?.ref !== undefined) assertPinnedRef(options.ref);
    env = { ...(await installedServerEnv(serverName)), ...gitServerEnv(options?.envPairs ?? []) };
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    process.exitCode = 1;
    return;
  }
  // git records a local path as an absolute one; state does the same, so a later
  // `mcp update` run from another dir still matches the cache's origin.
  const sourceUrl = isLocalRepoPath(gitUrl) ? resolve(gitUrl) : gitUrl;

  console.log(chalk.bold(`\nInstalling MCP server from git: ${chalk.cyan(gitUrl)}\n`));

  // 1. Every --env key needs a value before the clone and build start; then clone or update
  if (!(await envVarsReady(serverName, { args: [], env }, options?.nonInteractive === true))) return;
  const freshClone = !existsSync(repoDir);
  let clonedDir: string;
  try {
    clonedDir = cloneOrUpdateRepo(sourceUrl, serverName, options?.ref);
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    process.exitCode = 1;
    return;
  }

  // 2-3. Build if a build script is present, then detect an entrypoint from this commit
  const entrypoint = buildAndFindEntrypoint(
    clonedDir,
    sourceUrl,
    freshClone,
    `Could not detect entrypoint in ${clonedDir}.\n` +
      `    Expected one of: ${ENTRYPOINT_CANDIDATES.join(", ")}\n` +
      `    Use 'agentbrew install ${serverName} -c <command> -a <args...>' to add manually.`,
  );
  if (!entrypoint) return;

  console.log(chalk.dim(`  Detected entrypoint: ${entrypoint.command} ${entrypoint.args.join(" ")}`));

  // 5. Resolve pinned ref (use provided ref or current HEAD SHA)
  const sha = resolveHeadSha(clonedDir);
  const pinnedRef = options?.ref ?? sha;

  // 6. Register in state and sync to all agents
  const { addMcpServer } = await import("../sync/mcp-sync.js");
  await addMcpServer(serverName, entrypoint.command, entrypoint.args, env, {
    gitUrl: sourceUrl,
    gitRef: pinnedRef,
  });

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
  if (!state) {
    process.exitCode = 1;
    return;
  }

  const server = getStateServers(state).find((s) => s.name === serverName);
  if (!server) {
    console.error(chalk.red(`  ✗ MCP server '${serverName}' not found in state.`));
    process.exitCode = 1;
    return;
  }

  if (!server.gitUrl) {
    console.log(
      chalk.red(
        `  ✗ '${serverName}' was not installed from git.\n    'agentbrew mcp update' only updates git-installed servers.\n    Use 'agentbrew install' to reconfigure it manually.`,
      ),
    );
    process.exitCode = 1;
    return;
  }

  console.log(chalk.bold(`\nUpdating ${chalk.cyan(serverName)} from git...\n`));

  const repoDir = join(GIT_CACHE_DIR, serverName);
  const freshClone = !existsSync(repoDir);
  try {
    cloneOrUpdateRepo(server.gitUrl, serverName);
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    // A refused cache dir says what to do; a retry cannot pass.
    if (!(error instanceof CacheRefusal)) {
      console.log(
        chalk.dim("  Check the repo URL and your network connection, then retry with `agentbrew mcp update`."),
      );
    }
    process.exitCode = 1;
    return;
  }

  const entrypoint = buildAndFindEntrypoint(
    repoDir,
    server.gitUrl,
    freshClone,
    "Could not detect entrypoint after update. Server config unchanged.",
  );
  if (!entrypoint) return;

  const newSha = resolveHeadSha(repoDir);
  server.command = entrypoint.command;
  server.args = entrypoint.args;
  server.gitRef = newSha;
  saveState(state);

  const { syncMcpServers } = await import("../sync/mcp-sync.js");
  await syncMcpServers();

  console.log(`  ${ICON_SUCCESS} ${serverName} updated to ${newSha}\n`);
}
