import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { errorMessage } from "../core/errors.js";

/** Timeout for one git call on a pinned ref: ls-remote, fetch, checkout. */
const GIT_REF_TIMEOUT_MS = 30_000;

/** git reads a full 40- or 64-hex name as an object ID (SHA-1 or SHA-256). */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/** A full ref name the user may pass to pick a tag or a branch explicitly. */
const FULL_REF = /^refs\/(?:tags|heads)\//;

type Git = (...args: string[]) => string;

/** Env config (`git -c`, GIT_CONFIG_COUNT) that git itself keeps when it moves to another repo. */
const KEPT_CONFIG_ENV = new Set(["GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT"]);

/**
 * The caller's env without the variables that point git at another repo
 * (`git rev-parse --local-env-vars`: GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, and
 * more). git exports them to hooks, so an agentbrew run from a hook would
 * otherwise act on that repo instead of the MCP cache. Config set through the
 * env (an `insteadOf` rewrite or an auth header) is kept, as git does for submodules.
 */
export function cacheGitEnv(): NodeJS.ProcessEnv {
  const listed = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf-8", stdio: "pipe" }).stdout;
  // The fixed names cover a failed spawn (no git, or EAGAIN under load).
  const local = new Set([
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_COMMON_DIR",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    ...(listed ?? "").split("\n"),
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !local.has(key) || KEPT_CONFIG_ENV.has(key)));
}

function gitIn(repoDir: string, env: NodeJS.ProcessEnv): Git {
  return (...args) =>
    execFileSync("git", args, {
      cwd: repoDir,
      env,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: GIT_REF_TIMEOUT_MS,
    }).trim();
}

/**
 * Throw unless `gitRef` is safe to hand to git as a pinned ref: a full commit
 * ID, a full `refs/tags/<name>` or `refs/heads/<name>`, or a valid short name.
 * A ref or name that starts with `-` is refused, so git never reads it as an option.
 */
export function assertPinnedRef(gitRef: string): void {
  if (gitRef.startsWith("-") || gitRef.replace(FULL_REF, "").startsWith("-")) {
    throw new Error(`Git ref "${gitRef}" starts with "-". Pass a tag, a branch, or a full commit ID.`);
  }
  if (OBJECT_ID.test(gitRef)) return;
  const fullRef = FULL_REF.test(gitRef) ? gitRef : `refs/tags/${gitRef}`;
  if (spawnSync("git", ["check-ref-format", fullRef], { stdio: "pipe" }).status !== 0) {
    throw new Error(`"${gitRef}" is not a valid git ref name.`);
  }
}

/** The commit that object ID `oid` names locally, or undefined. `oid` is hex, never an option. */
function commitOf(git: Git, oid: string): string | undefined {
  try {
    return git("rev-parse", "--verify", "--quiet", `${oid}^{commit}`);
  } catch {
    return undefined;
  }
}

/** Detach HEAD at the commit that full object ID `oid` names; fetch it when it is missing. */
function checkoutObjectId(git: Git, oid: string): string {
  // git reads hex of another length as an abbreviation or a ref name, never as an ID.
  // Before git 2.29 rev-parse echoes the unknown flag, which means SHA-1.
  const hexLength = git("rev-parse", "--show-object-format") === "sha256" ? 64 : 40;
  if (oid.length !== hexLength) {
    throw new Error(`"${oid}" is not a full commit ID in this repo, which uses ${hexLength}-hex IDs.`);
  }
  let commit = commitOf(git, oid);
  if (!commit) {
    // Forced refspecs, not --tags, which fails on a tag the remote moved; --prune drops
    // refs the remote deleted, so a renamed branch (`a` to `a/b`) cannot block the fetch.
    git("fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*");
    commit = commitOf(git, oid);
  }
  let fetchError = "";
  if (!commit) {
    try {
      git("fetch", "--quiet", "--no-tags", "origin", "--end-of-options", oid);
    } catch (error) {
      // The server may refuse a fetch by object ID; the check below reports it.
      fetchError = errorMessage(error).trim().split("\n").at(-1) ?? "";
    }
    commit = commitOf(git, oid);
  }
  if (!commit) {
    throw new Error(`"${oid}" is not a commit in the remote repo.${fetchError ? ` git fetch: ${fetchError}` : ""}`);
  }
  git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit);
  return commit;
}

/** The first of `candidates` that `origin` lists, with its object ID. */
function listRemoteRef(git: Git, candidates: string[]): { remoteRef: string; oid: string } | undefined {
  // ls-remote matches name tails, so keep only the exact names asked for.
  const listed = new Map<string, string>();
  for (const line of git("ls-remote", "--end-of-options", "origin", ...candidates).split("\n")) {
    const [oid, name] = line.split("\t");
    if (oid && name && candidates.includes(name)) listed.set(name, oid);
  }
  const remoteRef = candidates.find((name) => listed.has(name));
  return remoteRef ? { remoteRef, oid: listed.get(remoteRef) ?? "" } : undefined;
}

/**
 * Fetch exactly the tag or branch that `gitRef` names on `origin` and check
 * out its commit: a tag detaches HEAD, a branch becomes a local branch that
 * tracks `origin`.
 */
function checkoutNamedRef(git: Git, gitRef: string): string {
  const candidates = FULL_REF.test(gitRef) ? [gitRef] : [`refs/tags/${gitRef}`, `refs/heads/${gitRef}`];
  const found = listRemoteRef(git, candidates);
  if (!found) throw new Error(`"${gitRef}" is not a tag, branch, or full commit ID in the remote repo.`);

  const isTag = found.remoteRef.startsWith("refs/tags/");
  const name = found.remoteRef.slice(isTag ? "refs/tags/".length : "refs/heads/".length);
  const localRef = isTag ? found.remoteRef : `refs/remotes/origin/${name}`;
  git("fetch", "--quiet", "--no-tags", "origin", "--end-of-options", `+${found.remoteRef}:${localRef}`);
  const fetched = git("show-ref", "--verify", "--hash", localRef);
  if (fetched !== found.oid) throw new Error(`"${gitRef}" changed on the remote while it was fetched. Try again.`);

  const commit = git("rev-parse", "--verify", `${fetched}^{commit}`);
  if (isTag) git("-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit);
  // -B resets a local branch of that name: the cache follows the remote, not local commits.
  else git("checkout", "--quiet", "-B", name, "--track", localRef);
  return commit;
}

/**
 * Throw unless `repoDir` is the top of its own git repo. A dir without `.git`
 * makes git use a repo that encloses it, and `checkout -B` would reset a branch there.
 */
export function assertOwnRepo(repoDir: string, env: NodeJS.ProcessEnv = cacheGitEnv()): void {
  let top = "";
  let reason = "";
  try {
    // .native returns the case on disk, like git, so a path typed in another case still matches.
    top = realpathSync.native(gitIn(repoDir, env)("rev-parse", "--show-toplevel"));
  } catch (error) {
    reason = ` git: ${errorMessage(error).trim().split("\n").at(-1) ?? ""}`;
  }
  if (top !== realpathSync.native(repoDir)) {
    throw new Error(`${repoDir} is not its own git clone.${reason} If it is a broken cache, delete it and retry.`);
  }
}

/**
 * Check out exactly the commit that `gitRef` names on the `origin` remote of
 * the repo at `repoDir`, and return that commit ID.
 *
 * - A full commit ID (40 or 64 hex) is a commit; HEAD is detached there.
 * - A short name is looked up as `refs/tags/<name>` first, then as
 *   `refs/heads/<name>`, so a tag wins over a branch with the same name.
 *   Pass `refs/heads/<name>` to pick such a branch.
 * - A tag detaches HEAD at its commit. A branch becomes a local branch at the
 *   fetched commit that tracks `origin`, so `mcp update` can pull it.
 *
 * Only that ref is fetched (a missing commit ID fetches all branches and tags),
 * user text reaches git only after `--end-of-options`, git runs only when
 * `repoDir` is its own repo, and HEAD is checked against the resolved commit.
 */
export function checkoutPinnedRef(repoDir: string, gitRef: string, env: NodeJS.ProcessEnv = cacheGitEnv()): string {
  assertPinnedRef(gitRef);
  assertOwnRepo(repoDir, env);
  const git = gitIn(repoDir, env);
  const commit = OBJECT_ID.test(gitRef) ? checkoutObjectId(git, gitRef) : checkoutNamedRef(git, gitRef);
  if (git("rev-parse", "HEAD") !== commit) {
    throw new Error(`The checkout of "${gitRef}" is not the commit it names.`);
  }
  return commit;
}
