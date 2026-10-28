import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ExitPromptError } from "@inquirer/core";
import { confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import { getStateServers } from "../agentfile.js";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { redactUrlCredentials, stripUrlCredentials } from "../core/redact-url.js";
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

/** An unattended run: `--yes`, or no terminal on stdin or stdout (an agent or a script). Nothing may prompt. */
function isUnattended(nonInteractive = false): boolean {
  return nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY;
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
    throw new Error(`Failed to update repo: ${message}`);
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
  if (existsSync(repoDir)) updateCachedRepo(repoDir, gitUrl, gitRef, unattended);
  else cloneFresh(gitUrl, repoDir, gitRef, unattended);
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
  /**
   * Paths (relative to the cache) that the builds of HEAD wrote, from the
   * record plus this build. The entrypoint is chosen from these first.
   */
  outputs: string[];
  /** Set while a successful build waits for the caller to accept or refuse it. */
  pending?: PendingBuild;
}

/** Build output the cache holds for one commit: the files its build wrote, never a user file. */
interface BuildRecord {
  commit: string;
  paths: string[];
}

/** An unfinished build: the old commit's output moved aside, and the files this build created. */
interface PendingBuild {
  /** `[original, aside]` absolute paths of the previous commit's recorded output. */
  moved: Array<[string, string]>;
  /** Paths this build created (new untracked or ignored files), relative to the cache. */
  created: string[];
  /** Paths to record for HEAD if the build is accepted. */
  record: BuildRecord;
}

/** File in the cache's `.git` that lists the files the last accepted build wrote. */
const BUILD_RECORD_FILE = "agentbrew-build-outputs";

/** Folder in the cache's `.git` where the previous commit's output waits during a build. */
const BUILD_ASIDE_DIR = "agentbrew-build-aside";

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

/** Read the build record, or undefined when the cache has none (a cache from an older agentbrew) or it is malformed. */
function readBuildRecord(repoDir: string): BuildRecord | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(repoDir, ".git", BUILD_RECORD_FILE), "utf-8")) as Partial<BuildRecord>;
    if (typeof parsed.commit !== "string" || !Array.isArray(parsed.paths)) return undefined;
    return { commit: parsed.commit, paths: parsed.paths.filter((p): p is string => typeof p === "string") };
  } catch {
    return undefined;
  }
}

function writeBuildRecord(repoDir: string, record: BuildRecord): void {
  try {
    writeFileSync(join(repoDir, ".git", BUILD_RECORD_FILE), `${JSON.stringify(record)}\n`);
  } catch (e) {
    logSkipped("mcp/mcp-git/writeBuildRecord", e);
  }
}

/** The files the build of the checked-out commit wrote, per the record; empty when the record is for another commit. */
function recordedOutputs(repoDir: string): string[] {
  const record = readBuildRecord(repoDir);
  return record && record.commit === headCommit(repoDir) ? record.paths : [];
}

/**
 * Every untracked file in the cache, ignored ones too, except under `node_modules`.
 * Compared before and after a build, the difference is what that build wrote.
 * Undefined when git cannot list them.
 */
function listUntracked(repoDir: string, unattended: boolean): Set<string> | undefined {
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--others", "--exclude=node_modules"], {
      cwd: repoDir,
      env: cacheGitEnv({ unattended }),
      stdio: "pipe",
      timeout: GIT_FAST_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
    }).toString();
    return new Set(out.split("\0").filter((p) => p !== ""));
  } catch (e) {
    logSkipped("mcp/mcp-git/listUntracked", e);
    return undefined;
  }
}

/** True when `rel` is a plain relative path whose parent folder resolves inside the cache (no `..`, no symlinked folder out of it). */
function isInsideCache(repoDir: string, rel: string): boolean {
  if (rel === "" || isAbsolute(rel) || rel.split(/[\\/]/).includes("..") || rel.startsWith(".git/")) return false;
  try {
    const parent = realpathSync(dirname(join(repoDir, rel)));
    const base = realpathSync(repoDir);
    return parent === base || parent.startsWith(`${base}${sep}`);
  } catch {
    return false;
  }
}

/** Move the files an earlier build recorded into `.git`, so this build cannot leave them behind as its own. Only recorded files move. */
function moveOutputsAside(repoDir: string, paths: string[]): Array<[string, string]> {
  const moved: Array<[string, string]> = [];
  const asideRoot = join(repoDir, ".git", BUILD_ASIDE_DIR);
  rmSync(asideRoot, { recursive: true, force: true });
  for (const [index, rel] of paths.entries()) {
    const from = join(repoDir, rel);
    const stat = lstatSync(from, { throwIfNoEntry: false });
    if (!stat || stat.isDirectory() || !isInsideCache(repoDir, rel)) continue;
    const to = join(asideRoot, String(index));
    try {
      mkdirSync(asideRoot, { recursive: true });
      renameSync(from, to);
      moved.push([from, to]);
    } catch (e) {
      logSkipped("mcp/mcp-git/moveOutputsAside", e);
    }
  }
  return moved;
}

/** Put moved files back where they were. */
function restoreMoved(moved: Array<[string, string]>): void {
  for (const [from, to] of moved) {
    try {
      mkdirSync(dirname(from), { recursive: true });
      renameSync(to, from);
    } catch (e) {
      logSkipped("mcp/mcp-git/restoreMoved", e);
    }
  }
}

/**
 * Settle a build once the caller knows whether its output is usable. Accepted:
 * write the record for HEAD and drop the old commit's moved files. Refused:
 * put the old files back and remove the files this build created, so the cache
 * again holds what the registered server runs. A user file is never touched.
 */
export function finishBuild(repoDir: string, build: BuildOutcome, accepted: boolean): void {
  const pending = build.pending;
  if (!pending) return;
  build.pending = undefined;
  if (accepted) {
    writeBuildRecord(repoDir, pending.record);
    rmSync(join(repoDir, ".git", BUILD_ASIDE_DIR), { recursive: true, force: true });
    return;
  }
  for (const rel of pending.created) {
    if (!isInsideCache(repoDir, rel)) continue;
    try {
      const target = join(repoDir, rel);
      if (lstatSync(target, { throwIfNoEntry: false })?.isDirectory()) continue;
      unlinkSync(target);
    } catch (e) {
      logSkipped("mcp/mcp-git/finishBuild", e);
    }
  }
  restoreMoved(pending.moved);
  rmSync(join(repoDir, ".git", BUILD_ASIDE_DIR), { recursive: true, force: true });
}

/**
 * What a successful build wrote: the untracked files that appeared since
 * `before`, added to the earlier record of the same commit. Undefined when git
 * could not list files, so no record is made and the old rules decide.
 */
function pendingBuild(
  repoDir: string,
  ctx: {
    before: Set<string> | undefined;
    prior: BuildRecord | undefined;
    head: string;
    moved: Array<[string, string]>;
    unattended: boolean;
  },
): PendingBuild | undefined {
  const after = listUntracked(repoDir, ctx.unattended);
  if (!ctx.before || !after) return undefined;
  const created = [...after].filter((p) => !ctx.before?.has(p));
  const kept = ctx.prior && ctx.prior.commit === ctx.head ? ctx.prior.paths : [];
  return { moved: ctx.moved, created, record: { commit: ctx.head, paths: [...new Set([...kept, ...created])] } };
}

/**
 * Run `npm install` + `npm run build` for a Node.js repo if a build script is
 * present. A failure is a warning here; the callers decide with
 * {@link assertBuildUsable} whether pre-built files may run. No build output or user file is deleted.
 * The record names the commit the cache's build output comes from: written
 * after a successful build, and after any build of a fresh clone, whose files
 * all come from HEAD.
 */
export function buildRepoIfNeeded(repoDir: string, freshClone = false, unattended = isUnattended()): BuildOutcome {
  const headBuiltBefore = headWasBuilt(repoDir);
  const outcome: BuildOutcome = { ran: false, ok: false, headBuiltBefore, outputs: recordedOutputs(repoDir) };
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
  // Output of an earlier commit's build moves aside first, so whatever exists after
  // this build was written by it. Only files an earlier build recorded move.
  const prior = readBuildRecord(repoDir);
  const head = headCommit(repoDir);
  const priorIsStale = prior !== undefined && prior.commit !== head;
  const moved = priorIsStale ? moveOutputsAside(repoDir, prior.paths) : [];
  const before = listUntracked(repoDir, unattended);
  console.log(chalk.dim("  Running npm install + build..."));
  try {
    // cacheGitEnv: a build script that runs git (husky's prepare) must not act on a GIT_DIR repo,
    // and an unattended `npm install` of a private git dependency must not wait on a login.
    const env = cacheGitEnv({ unattended });
    execFileSync("npm", ["install", "--prefer-offline"], {
      cwd: repoDir,
      env,
      stdio: "pipe",
      timeout: NPM_BUILD_TIMEOUT_MS,
    });
    execFileSync("npm", ["run", "build"], { cwd: repoDir, env, stdio: "pipe", timeout: NPM_BUILD_TIMEOUT_MS });
    recordBuiltCommit(repoDir);
    const pending = pendingBuild(repoDir, { before, prior, head, moved, unattended });
    if (!pending) restoreMoved(moved);
    return { ...outcome, ran: true, ok: true, outputs: pending ? pending.record.paths : [], pending };
  } catch (error) {
    const message = errorMessage(error);
    console.log(chalk.yellow(`  ⚠ Build step failed: ${message}.`));
    if (freshClone) recordBuiltCommit(repoDir);
    // The build failed: the old commit's files go back, so a server registered from them still runs.
    restoreMoved(moved);
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
      `from another commit. Nothing was registered or saved, and the cache is put back at the commit it was at before ` +
      "this run, so a server registered from it earlier keeps running the same files. Fix the build, or pin a ref whose build works: " +
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
export function detectEntrypoint(repoDir: string, built: string[] = []): DetectedEntrypoint | undefined {
  // Files the build of this commit wrote come first: an older untracked file never outranks them.
  const wrote = new Set(built.map((p) => p.split(sep).join("/")));
  const ordered = [...ENTRYPOINT_CANDIDATES.filter((c) => wrote.has(c)), ...ENTRYPOINT_CANDIDATES];
  for (const candidate of ordered) {
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

// ── Refused re-pin ────────────────────────────────────────────────────────────

/** Where a cache stood before a run moved it: the commit, and the branch it followed (none when detached). */
interface CachePin {
  sha: string;
  branch?: string;
}

/** Read where the cache stands now, or undefined when there is no cache or git cannot say. */
function snapshotCachePin(repoDir: string): CachePin | undefined {
  if (!existsSync(repoDir)) return undefined;
  const sha = headCommit(repoDir);
  if (!sha) return undefined;
  try {
    const branch = execFileSync("git", ["symbolic-ref", "-q", "--short", "HEAD"], {
      cwd: repoDir,
      env: cacheGitEnv(),
      stdio: "pipe",
      timeout: GIT_FAST_TIMEOUT_MS,
    })
      .toString()
      .trim();
    return { sha, branch: branch || undefined };
  } catch {
    return { sha }; // symbolic-ref exits 1 on a detached HEAD
  }
}

/**
 * After a refused run, check the cache out at the commit it stood at before,
 * on the same branch if it followed one, and reinstall that commit's
 * dependencies when this run's `npm install` replaced them. A registered
 * server runs from the cache, so it must not be left on a refused commit.
 * A tracked file the build changed blocks a plain checkout: that is reported, not forced.
 */
function restoreCachePin(repoDir: string, pin: CachePin, installed: boolean, unattended: boolean): void {
  const env = cacheGitEnv({ unattended });
  try {
    const args = pin.branch ? ["checkout", "-q", "-B", pin.branch, pin.sha] : ["checkout", "-q", "--detach", pin.sha];
    execFileSync("git", args, { cwd: repoDir, env, stdio: "pipe", timeout: GIT_FAST_TIMEOUT_MS });
    console.log(chalk.dim(`  The cache is back at ${pin.sha.slice(0, 12)}, the commit it was at before this run.`));
  } catch (error) {
    console.error(
      chalk.yellow(
        `  ⚠ Could not put the cache back at ${pin.sha.slice(0, 12)}: ${errorMessage(error)}. ` +
          `Run \`git -C ${repoDir} checkout ${pin.sha}\` after you check the files it names.`,
      ),
    );
    return;
  }
  if (!installed) return;
  try {
    execFileSync("npm", ["install", "--prefer-offline"], {
      cwd: repoDir,
      env,
      stdio: "pipe",
      timeout: NPM_BUILD_TIMEOUT_MS,
    });
  } catch (error) {
    console.error(
      chalk.yellow(`  ⚠ Could not reinstall dependencies for ${pin.sha.slice(0, 12)}: ${errorMessage(error)}.`),
    );
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
  missingHint: string,
  run: { freshClone: boolean; unattended: boolean; previous?: CachePin },
): DetectedEntrypoint | undefined {
  const { freshClone, unattended, previous } = run;
  const build = buildRepoIfNeeded(repoDir, freshClone, unattended);
  try {
    assertBuildUsable(repoDir, build, freshClone, gitUrl);
    const entrypoint = detectEntrypoint(repoDir, build.outputs);
    if (!entrypoint) throw new Error(missingHint);
    assertEntrypointUsable(repoDir, entrypoint, build, freshClone);
    finishBuild(repoDir, build, true);
    return entrypoint;
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    process.exitCode = 1;
    finishBuild(repoDir, build, false);
    if (previous) restoreCachePin(repoDir, previous, build.ran, unattended);
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

  console.log(chalk.bold(`\nInstalling MCP server from git: ${chalk.cyan(redactUrlCredentials(gitUrl))}\n`));

  // 1. Every --env key needs a value before the clone and build start; then clone or update
  if (!(await envVarsReady(serverName, { args: [], env }, options?.nonInteractive === true))) return;
  const freshClone = !existsSync(repoDir);
  const previous = snapshotCachePin(repoDir);
  let clonedDir: string;
  try {
    clonedDir = cloneOrUpdateRepo(sourceUrl, serverName, options?.ref, {
      unattended: isUnattended(options?.nonInteractive),
    });
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    process.exitCode = 1;
    return;
  }

  // 2-3. Build if a build script is present, then detect an entrypoint from this commit
  const entrypoint = buildAndFindEntrypoint(
    clonedDir,
    sourceUrl,
    `Could not detect entrypoint in ${clonedDir}.\n` +
      `    Expected one of: ${ENTRYPOINT_CANDIDATES.join(", ")}\n` +
      `    Use 'agentbrew install ${serverName} -c <command> -a <args...>' to add manually.`,
    { freshClone, unattended: isUnattended(options?.nonInteractive), previous },
  );
  if (!entrypoint) return;

  console.log(chalk.dim(`  Detected entrypoint: ${entrypoint.command} ${entrypoint.args.join(" ")}`));

  // 5. Resolve pinned ref (use provided ref or current HEAD SHA)
  const sha = resolveHeadSha(clonedDir);
  const pinnedRef = options?.ref ?? sha;

  // 6. Register in state and sync to all agents
  const { addMcpServer } = await import("../sync/mcp-sync.js");
  await addMcpServer(serverName, entrypoint.command, entrypoint.args, env, {
    // State holds no URL credentials; the cache's own origin keeps them for fetching.
    gitUrl: stripUrlCredentials(sourceUrl),
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
  const previous = snapshotCachePin(repoDir);
  try {
    cloneOrUpdateRepo(server.gitUrl, serverName);
  } catch (error) {
    console.error(chalk.red(`  ✗ ${errorMessage(error)}`));
    // The saved URL has no token: a fresh clone needs a credential helper, or the URL again.
    if (freshClone) {
      console.log(
        chalk.dim(
          `  The saved URL keeps no credentials. Set up a git credential helper, or run \`agentbrew install ${serverName} --git <url>\` again with the full URL.`,
        ),
      );
    }
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
    "Could not detect entrypoint after update. Server config unchanged.",
    { freshClone, unattended: isUnattended(), previous },
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
