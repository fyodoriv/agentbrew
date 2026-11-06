import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import { getStateServers } from "../agentfile.js";
import { sourceCheckoutTerminationUnknown, withSourceCheckoutLeaseSync } from "../catalog/source-checkout-lease.js";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { redactUrlCredentials, stripUrlCredentials } from "../core/redact-url.js";
import type { McpServer } from "../types.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { checkGitAvailable } from "../utils.js";
import {
  acceptCandidate,
  acceptedCandidate,
  allocateCandidate,
  assertFreshCandidate,
  CandidateRefusal,
  candidateGitEnv,
  type GitCandidate,
  inspectRuntime,
  publicationLease,
  readyCandidate,
  registeredRuntime,
  verifyCandidate,
} from "./git-candidate.js";
import {
  assertCacheOrigin,
  assertOwnRepo,
  assertPinnedRef,
  CacheRefusal,
  cacheGitEnv,
  checkoutPinnedRef,
  isDetachedHead,
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
  /** Explicitly start with fresh cache-local runtime state; the previous runtime stays on disk. */
  freshRuntime?: boolean;
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
      throw new CandidateRefusal(
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

/** An unattended run: `--yes`, or no terminal on stdin or stdout (an agent or a script). Nothing may prompt. */
function isUnattended(nonInteractive = false): boolean {
  return nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY;
}

function sourceForDisplay(source: string): string {
  if (isLocalRepoPath(source))
    return [...source].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      ? "<local source>"
      : source;
  try {
    const url = new URL(source);
    if (!url.hostname) return "<git source>";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<git source>";
  }
}

function pinnedRefRequired(): CandidateRefusal {
  return new CandidateRefusal(
    "This runtime is pinned to a tag or commit. Choose an explicit pin with agentbrew install <name> --git <source> --ref <tag|branch|commit>. Review --fresh-runtime before selecting a different runtime.",
  );
}

function reportMissingRuntimeHint(error: unknown): void {
  if (error instanceof CandidateRefusal && error.reason === "missing-runtime") {
    console.log(
      chalk.dim(
        "  For a private source, configure a credential helper before installing under a new name. This refusal did not attempt a connection or authentication.",
      ),
    );
  }
}

/** Refresh the cached repo at `repoDir`, cloned from `gitUrl`, then check out `gitRef` exactly, or pull. */
function updateCachedRepo(repoDir: string, gitUrl: string, gitRef: string | undefined, unattended: boolean): void {
  console.log(chalk.dim(`  Updating existing repo at ${repoDir}...`));
  try {
    // Never let git act on a repo that encloses the cache dir, or one that GIT_DIR names,
    // and use the cache only for the repo that made it.
    const env = cacheGitEnv({ unattended });
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
    throw new Error(`Failed to update repo: ${message}`, { cause: error });
  }
}

/** Clone `gitUrl` to `repoDir`. With `gitRef`, clone without a checkout, then check out that exact ref. */
function cloneFresh(gitUrl: string, repoDir: string, gitRef: string | undefined, unattended: boolean): void {
  console.log(chalk.dim(`  Cloning ${redactUrlCredentials(gitUrl)}...`));
  // -o origin: checkoutPinnedRef reads `origin`, whatever clone.defaultRemoteName says.
  const extraArgs = gitRef ? ["--no-checkout"] : [];
  const env = cacheGitEnv({ unattended });
  const result = spawnSync("git", ["clone", "-o", "origin", ...extraArgs, "--end-of-options", gitUrl, repoDir], {
    env,
    stdio: "pipe",
    timeout: GIT_CLONE_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? "";
    throw new Error(`git clone failed: ${stderr.trim() || "unknown error"}`, {
      cause: result.error ?? (result.signal ? result : undefined),
    });
  }
  if (!gitRef) return;
  try {
    checkoutPinnedRef(repoDir, gitRef, env);
  } catch (error) {
    // Remove the half-made clone, so the next run starts fresh instead of updating it.
    if (!sourceCheckoutTerminationUnknown(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    throw new Error(`git checkout failed: ${errorMessage(error)}`, { cause: error });
  }
}

/**
 * Clone a git repo into the agentbrew MCP cache, or fetch + checkout if already present.
 * A `gitRef` is checked out exactly by {@link checkoutPinnedRef}: a tag wins over a
 * branch with the same name, and a ref that starts with `-` is refused before git runs.
 * Returns the path to the local repo directory.
 */
export function cloneOrUpdateRepo(
  gitUrl: string,
  repoName: string,
  gitRef?: string,
  options: { unattended?: boolean } = {},
): string {
  validateRepoName(repoName);
  if (gitRef !== undefined) assertPinnedRef(gitRef);
  const repoDir = join(GIT_CACHE_DIR, repoName);
  // A symlink would point git at a repo outside the cache, where `checkout -B` can drop commits.
  if (lstatSync(repoDir, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new CacheRefusal(`${repoDir} is a symlink. Delete the link (not its target) and run the install again.`);
  }
  // Unattended runs stop git's own login prompts, so a private repo with no saved login fails at once.
  const unattended = options.unattended ?? isUnattended();
  return withSourceCheckoutLeaseSync({ path: repoDir, source: gitUrl }, () => {
    if (existsSync(repoDir)) updateCachedRepo(repoDir, gitUrl, gitRef, unattended);
    else cloneFresh(gitUrl, repoDir, gitRef, unattended);
    return repoDir;
  });
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

export interface BuildOutcome {
  ran: boolean;
  ok: boolean;
  refused?: "invalid-package-metadata";
}

/** Build only a fresh invocation-owned candidate. All failed attempts remain for recovery. */
export function buildRepoIfNeeded(repoDir: string, _freshClone = true, unattended = isUnattended()): BuildOutcome {
  assertFreshCandidate(repoDir);
  const packagePath = join(repoDir, "package.json");
  if (!existsSync(packagePath)) return { ran: false, ok: false };
  let scripts: Record<string, unknown> | undefined;
  try {
    scripts = (JSON.parse(readFileSync(packagePath, "utf8")) as { scripts?: Record<string, unknown> }).scripts;
  } catch {
    return { ran: false, ok: false, refused: "invalid-package-metadata" };
  }
  if (typeof scripts?.build !== "string" || scripts.build.trim() === "") return { ran: false, ok: false };
  const env = candidateGitEnv(unattended);
  console.log(chalk.dim("  Installing and building a fresh candidate..."));
  try {
    execFileSync("npm", ["install", "--prefer-offline"], {
      cwd: repoDir,
      env,
      stdio: "pipe",
      timeout: NPM_BUILD_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    execFileSync("npm", ["run", "build"], {
      cwd: repoDir,
      env,
      stdio: "pipe",
      timeout: NPM_BUILD_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    return { ran: true, ok: true };
  } catch {
    console.log(chalk.yellow("  Candidate build failed; its directory was retained."));
    return { ran: true, ok: false };
  }
}

// ── Entrypoint detection ──────────────────────────────────────────────────────

function isNodeEntrypoint(repoDir: string, path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    if (statSync(path).isFile()) return true;
    const entry = createRequire(resolve(repoDir, "package.json")).resolve(resolve(path));
    return statSync(entry).isFile();
  } catch {
    return false;
  }
}

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
        if (isNodeEntrypoint(repoDir, resolved)) return { command: "node", args: [resolved] };
      }
    }

    if (packageJson.main) {
      const resolved = join(repoDir, packageJson.main);
      if (isNodeEntrypoint(repoDir, resolved)) return { command: "node", args: [resolved] };
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
    if (isNodeEntrypoint(repoDir, fullPath)) return { command: "node", args: [fullPath] };
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
  if (isUnattended(nonInteractive)) {
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

// ── Candidate publication ─────────────────────────────────────────────────────

export type GitPublicationOutcome = "verified" | "refused-before-publication" | "partial-or-unknown";

function definitionIdentity(server: McpServer | undefined): string {
  if (!server) return "absent";
  // Compare only in invocation memory. Env values never enter receipts or diagnostics.
  return JSON.stringify({
    command: server.command,
    args: server.args,
    env: Object.entries(server.env).sort(),
    url: server.url,
    headers: Object.entries(server.headers ?? {}).sort(),
    gitUrl: server.gitUrl,
    gitRef: server.gitRef,
  });
}

async function currentServer(name: string): Promise<McpServer | undefined> {
  const { requireState } = await import("../state.js");
  const state = requireState({ quiet: true });
  if (!state) throw new Error("MCP state is unavailable.");
  const server = getStateServers(state).find((item) => item.name === name);
  return server ? structuredClone(server) : undefined;
}

async function publicationMatches(desired: McpServer): Promise<boolean> {
  const { invalidateState, requireState } = await import("../state.js");
  const { verifyMcpServerPublication } = await import("../sync/mcp-sync.js");
  invalidateState();
  const saved = requireState({ quiet: true });
  if (!saved) return false;
  const readback = getStateServers(saved).find((item) => item.name === desired.name);
  return (
    definitionIdentity(readback) === definitionIdentity(desired) &&
    verifyMcpServerPublication(desired, saved.agents).kind === "verified"
  );
}

async function publishCandidate(
  candidate: GitCandidate,
  previous: McpServer | undefined,
  desired: McpServer,
  update: boolean,
  unattended: boolean,
): Promise<GitPublicationOutcome> {
  const release = await publicationLease();
  let started = false;
  try {
    const { invalidateState, requireState, saveState } = await import("../state.js");
    const { addMcpServer, syncMcpServers } = await import("../sync/mcp-sync.js");
    invalidateState();
    const state = requireState({ quiet: true });
    if (!state) return "refused-before-publication";
    const existing = getStateServers(state).find((item) => item.name === desired.name);
    if (definitionIdentity(existing) !== definitionIdentity(previous)) return "refused-before-publication";
    verifyCandidate(candidate, unattended);
    started = true;
    if (update) {
      if (!existing) return "partial-or-unknown";
      Object.assign(existing, desired);
      saveState(state);
      if (process.exitCode) return "partial-or-unknown";
      await syncMcpServers();
    } else {
      await addMcpServer(desired.name, desired.command, desired.args, desired.env, {
        reportSuccess: false,
        gitUrl: desired.gitUrl,
        gitRef: desired.gitRef,
        url: "",
        headers: {},
      });
    }
    if (process.exitCode) return "partial-or-unknown";
    if (!(await publicationMatches(desired))) return "partial-or-unknown";
    verifyCandidate(candidate, unattended);
    if (candidate.receipt.status !== "accepted") acceptCandidate(candidate, unattended);
    return "verified";
  } catch {
    return started ? "partial-or-unknown" : "refused-before-publication";
  } finally {
    release();
  }
}

async function prepareCandidate(input: {
  source: string;
  name: string;
  ref?: string;
  previous?: McpServer;
  freshRuntime: boolean;
  unattended: boolean;
}): Promise<GitCandidate> {
  const { source, name, ref, previous, freshRuntime, unattended } = input;
  const oldRoot = registeredRuntime(previous, join(GIT_CACHE_DIR, name), name);
  if (oldRoot) {
    const oldMetadata = inspectRuntime(oldRoot, source, unattended, ref === undefined);
    if (ref === undefined && !oldMetadata.branch) throw pinnedRefRequired();
  }
  const root = allocateCandidate(source, name, ref, unattended);
  const metadata = inspectRuntime(root, source, unattended);
  const reusable = acceptedCandidate({
    server: previous,
    root: oldRoot,
    source,
    commit: metadata.commit,
    branch: metadata.branch,
    unattended,
  });
  if (reusable) return reusable;
  if ((oldRoot || previous) && !freshRuntime) {
    throw new CandidateRefusal(
      "A different runtime starts with fresh cache-local state. Review that change, then pass --fresh-runtime. The old directory stays intact; no runtime data is copied.",
    );
  }
  const build = buildRepoIfNeeded(root, true, unattended);
  if (build.refused === "invalid-package-metadata")
    throw new CandidateRefusal(
      "MCP candidate refused: package metadata is invalid. Existing runtime files are preserved.",
    );
  if (previous && build.ran && !build.ok)
    throw new CandidateRefusal(
      `The build failed at the new candidate. Existing runtime files are preserved. Choose a working ref with agentbrew install ${name} --git '${(isLocalRepoPath(source) ? sourceForDisplay(source) : "<url>").replace(/'/g, "'\\''")}' --ref <ref> --fresh-runtime after reviewing fresh runtime state.`,
    );
  const entrypoint = detectEntrypoint(root);
  if (!entrypoint)
    throw new CandidateRefusal(
      "No usable entrypoint in this candidate. Output left over from an earlier build in the old runtime is not reused. Existing runtime and configuration are unchanged.",
    );
  return readyCandidate({
    root,
    name,
    source,
    entrypoint,
    build,
    expectedCommit: metadata.commit,
    unattended,
    requestedRef: ref,
  });
}

function publicationFailed(outcome: GitPublicationOutcome): void {
  process.exitCode = 1;
  console.error(
    chalk.red(
      outcome === "refused-before-publication"
        ? "  MCP publication refused before registration. Runtime directories were retained."
        : "  MCP publication is partial or unknown. Both runtime directories were retained. Check state and agent configs before retrying; no automatic rollback was attempted.",
    ),
  );
}

/** Build in a fresh directory, then publish only its validated runtime identity. */
export async function installMcpFromGit(gitUrl: string, options?: GitInstallOptions): Promise<void> {
  if (!checkGitAvailable()) {
    process.exitCode = 1;
    return;
  }
  try {
    const name = options?.name ?? deriveRepoName(gitUrl);
    validateRepoName(name);
    if (options?.ref !== undefined) assertPinnedRef(options.ref);
    const previous = await currentServer(name);
    const env = { ...(previous?.env ?? {}), ...gitServerEnv(options?.envPairs ?? []) };
    if (!(await envVarsReady(name, { args: [], env }, options?.nonInteractive === true))) return;
    const source = isLocalRepoPath(gitUrl) ? resolve(gitUrl) : gitUrl;
    const unattended = isUnattended(options?.nonInteractive);
    console.log(chalk.bold(`\nInstalling MCP server from git: ${chalk.cyan(sourceForDisplay(gitUrl))}\n`));
    const candidate = await prepareCandidate({
      source,
      name,
      ref: options?.ref,
      previous,
      freshRuntime: options?.freshRuntime === true,
      unattended,
    });
    const desired: McpServer = {
      name,
      command: candidate.entrypoint.command,
      args: candidate.entrypoint.args,
      env,
      source: previous?.source ?? "user",
      gitUrl: stripUrlCredentials(source),
      gitRef: options?.ref ?? candidate.receipt.commit,
    };
    const outcome = await publishCandidate(candidate, previous, desired, false, unattended);
    if (outcome !== "verified") {
      publicationFailed(outcome);
      return;
    }
    console.log(`  ${ICON_SUCCESS} ${name} installed from git (${desired.gitRef})`);
    console.log(chalk.dim(`    Runtime retained at: ${candidate.root}\n`));
  } catch (error) {
    reportMissingRuntimeHint(error);
    console.error(
      chalk.red(
        error instanceof CandidateRefusal
          ? error.message
          : "  MCP git installation refused. Existing runtime files are preserved. Check source/ref, entrypoint and directory ownership.",
      ),
    );
    process.exitCode = 1;
  }
}

/** Resolve the saved branch into a fresh candidate. Never pull the running checkout. */
export async function updateMcpFromGit(
  name: string,
  options?: Pick<GitInstallOptions, "freshRuntime">,
): Promise<GitPublicationOutcome> {
  if (!checkGitAvailable()) {
    process.exitCode = 1;
    return "refused-before-publication";
  }
  try {
    validateRepoName(name);
    const previous = await currentServer(name);
    if (!previous) throw new CandidateRefusal("The requested MCP server was not found in state.");
    if (!previous.gitUrl) {
      console.log("This MCP server was not installed from git. Use its original installation source to update it.");
      process.exitCode = 1;
      return "refused-before-publication";
    }
    const unattended = isUnattended();
    const oldRoot = registeredRuntime(previous, join(GIT_CACHE_DIR, name), name);
    if (!oldRoot)
      throw new CandidateRefusal(
        "The registered runtime is missing. Review saved configuration and install under another name with explicit --git and --ref. No source was contacted.",
        "missing-runtime",
      );
    const metadata = inspectRuntime(oldRoot, previous.gitUrl, unattended);
    if (!metadata.branch) throw pinnedRefRequired();
    const candidate = await prepareCandidate({
      source: metadata.origin,
      name,
      ref: `refs/heads/${metadata.branch}`,
      previous,
      freshRuntime: options?.freshRuntime === true,
      unattended,
    });
    const desired: McpServer = {
      ...previous,
      command: candidate.entrypoint.command,
      args: candidate.entrypoint.args,
      gitRef: candidate.receipt.commit,
    };
    const outcome = await publishCandidate(candidate, previous, desired, true, unattended);
    if (outcome !== "verified") {
      publicationFailed(outcome);
      return outcome;
    }
    console.log(`  ${ICON_SUCCESS} ${name} updated to ${desired.gitRef}\n`);
    return "verified";
  } catch (error) {
    reportMissingRuntimeHint(error);
    console.error(
      chalk.red(
        error instanceof CandidateRefusal
          ? error.message
          : "  MCP git update refused. Existing runtime files are preserved. Check saved branch/source identity.",
      ),
    );
    process.exitCode = 1;
    return "refused-before-publication";
  }
}
