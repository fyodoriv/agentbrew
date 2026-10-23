import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { redactUrlCredentials } from "../core/redact-url.js";
import { type PluginLockEntry, readLock, writeLock } from "../lock.js";
import { assertCapabilities, checkCapabilities } from "./capabilities.js";
import { capabilitiesHash, MANIFEST_FILE, type PluginManifest, parseManifest, readManifest } from "./manifest.js";
import { assertMcpServers } from "./mcp-launcher.js";
import { assertTagName, normalizeKey, signersFor, tagObject, trustSigner, verifySignedTag } from "./signers.js";

/** Root of installed plugin checkouts: `~/.local/share/agentbrew/plugins/<name>`. */
export function pluginsRoot(): string {
  return join(homedir(), ".local", "share", "agentbrew", "plugins");
}

export function pluginDir(name: string): string {
  return join(pluginsRoot(), name);
}

/**
 * Split `<url>@<ref>`. The ref is the text after the last `@` that comes
 * after the last `/` or `:`, so `git@host:org/repo` alone has no ref.
 */
export function parsePluginSpec(spec: string): { url: string; ref: string } {
  const at = spec.lastIndexOf("@");
  const pathEnd = Math.max(spec.lastIndexOf("/"), spec.lastIndexOf(":"));
  if (at <= 0 || at < pathEnd || at === spec.length - 1) {
    throw new Error(`Plugin spec needs a pinned ref: <url>@<ref> (got "${redactUrlCredentials(spec)}")`);
  }
  return { url: spec.slice(0, at), ref: spec.slice(at + 1) };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe", timeout: 120_000 }).trim();
}

export interface AddPluginOptions {
  /** The user approved the capabilities (and new signer) shown. Without it, add refuses. */
  yes: boolean;
  /** SSH public key to trust for this plugin name, approved with the capabilities. */
  signer?: string;
}

/** Describe the capabilities the user is asked to approve. */
export function describeCapabilities(manifest: PluginManifest): string {
  const caps = manifest.capabilities ?? {};
  const lines = Object.entries(caps).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`);
  return lines.length ? lines.join("\n") : "  (none declared)";
}

export interface Staged {
  dir: string;
  manifest: PluginManifest;
  entry: PluginLockEntry;
}

/**
 * Delete staging dirs left by an agentbrew run that died, for example one
 * killed at the approval prompt. A dir is stale only when no process has the
 * pid in its name; live runs, this one included, keep theirs.
 */
function removeStaleStaging(): void {
  for (const name of readdirSync(pluginsRoot())) {
    const pid = Number(name.match(/^\.staging-(\d+)-\d+$/)?.[1]);
    if (!pid || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") continue;
      // Best effort: a dir this user cannot delete must not block installs.
      try {
        rmSync(join(pluginsRoot(), name), { recursive: true, force: true });
      } catch {}
    }
  }
}

/**
 * Fetch exactly `refs/tags/<ref>` from `url` to a staging dir, verify that
 * tag object's signature, then check out its commit by ID and validate the
 * manifest. A branch with the tag's name never wins, and a name that git
 * could read as an object ID is refused. Nothing is checked out before the
 * signature passes. Runs no plugin code.
 */
export function stage(url: string, ref: string, extraSigner?: string): Staged {
  assertTagName(ref);
  mkdirSync(pluginsRoot(), { recursive: true });
  removeStaleStaging();
  const dir = join(pluginsRoot(), `.staging-${process.pid}-${Date.now()}`);
  try {
    const tagRef = `refs/tags/${ref}`;
    // ls-remote matches name tails, so keep only the exact ref. Its object ID
    // length tells the staging repo's format (SHA-1 or SHA-256).
    const listed = git(pluginsRoot(), "ls-remote", "--end-of-options", url, tagRef)
      .split("\n")
      .map((line) => line.split("\t"))
      .find(([, name]) => name === tagRef)?.[0];
    if (!listed) throw new Error(`"${ref}" is not a tag in ${redactUrlCredentials(url)}.`);
    // GIT_DEFAULT_HASH, not --object-format, so git before 2.29 still inits SHA-1.
    execFileSync("git", ["init", "--quiet", dir], {
      cwd: pluginsRoot(),
      stdio: "pipe",
      timeout: 120_000,
      env: { ...process.env, GIT_DEFAULT_HASH: listed.length === 64 ? "sha256" : "sha1" },
    });
    // Run from pluginsRoot, like ls-remote, so a relative source resolves the same way.
    const gitDir = join(dir, ".git");
    git(
      pluginsRoot(),
      "--git-dir",
      gitDir,
      "fetch",
      "--quiet",
      "--no-tags",
      "--depth",
      "1",
      "--end-of-options",
      url,
      `${tagRef}:${tagRef}`,
    );
    const tag = tagObject(dir, ref);
    if (tag !== listed)
      throw new Error(`Tag "${ref}" changed on ${redactUrlCredentials(url)} while it was fetched. Try again.`);
    const commit = git(dir, "rev-parse", "--verify", `${tag}^{commit}`);
    let text: string;
    try {
      text = git(dir, "cat-file", "blob", `${commit}:${MANIFEST_FILE}`);
    } catch {
      throw new Error(`Cannot read plugin manifest ${MANIFEST_FILE} at "${ref}".`);
    }
    const manifest = parseManifest(text);
    const keys = [...signersFor(manifest.name)];
    if (extraSigner && !keys.includes(extraSigner)) keys.push(extraSigner);
    const signer = verifySignedTag(dir, ref, tag, manifest.name, keys);
    git(dir, "-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit);
    if (git(dir, "rev-parse", "HEAD") !== commit) {
      throw new Error(`The checkout of "${ref}" is not the commit of its signed tag.`);
    }
    if (JSON.stringify(readManifest(dir)) !== JSON.stringify(manifest)) {
      throw new Error(`The checkout of "${ref}" does not match its signed manifest.`);
    }
    assertCapabilities(dir, manifest);
    assertMcpServers(dir, manifest);
    const entry: PluginLockEntry = {
      name: manifest.name,
      version: manifest.version,
      source: url,
      ref,
      commit,
      tree: git(dir, "rev-parse", `${commit}^{tree}`),
      capabilitiesHash: capabilitiesHash(manifest.capabilities),
      signer,
      artifacts: [],
      lockedAt: new Date().toISOString(),
    };
    return { dir, manifest, entry };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

function assertNotInstalled(name: string, lock: ReturnType<typeof readLock>): void {
  if (existsSync(pluginDir(name)) || lock.plugins?.some((p) => p.name === name)) {
    throw new Error(`Plugin "${name}" is already installed. Remove it first.`);
  }
}

/** A staged and verified plugin that waits for approval. */
export interface AddPlan {
  staged: Staged;
  /** The `--signer` key, normalized; trusted on install when it signed the tag. */
  newSigner?: string;
  /** Delete the staged checkout without installing. */
  discard(): void;
}

/**
 * Stage and verify `<url>@<signed-tag>` once, then show the capabilities and
 * the signer for approval. Nothing is installed: {@link applyAdd} installs
 * this exact staged checkout, so a tag that moves while the user reads the
 * prompt cannot change what gets installed.
 */
export function planAdd(spec: string, options: { signer?: string }): AddPlan {
  const { url, ref } = parsePluginSpec(spec);
  const newSigner = options.signer ? normalizeKey(options.signer) : undefined;
  const staged = stage(url, ref, newSigner);
  const discard = () => rmSync(staged.dir, { recursive: true, force: true });
  try {
    const { manifest, entry } = staged;
    assertNotInstalled(manifest.name, readLock());
    console.log(
      chalk.bold(`Plugin ${manifest.name} ${manifest.version} (${redactUrlCredentials(url)}@${ref}) asks for:`),
    );
    console.log(describeCapabilities(manifest));
    console.log(
      `  signed by: ${entry.signer}${signersFor(manifest.name).includes(entry.signer) ? "" : " (new signer)"}`,
    );
    return { staged, newSigner, discard };
  } catch (e) {
    discard();
    throw e;
  }
}

/**
 * Install a plan the user approved: move its staged checkout into place and
 * lock commit, tree hash, capabilities hash, and signer. Without approval it
 * installs nothing. The staged checkout is deleted either way.
 */
export function applyAdd(plan: AddPlan, options: { yes: boolean }): PluginLockEntry {
  try {
    if (!options.yes) throw new Error("Plugin capabilities need approval: re-run with --yes to approve them.");
    const { manifest, entry } = plan.staged;
    const lock = readLock();
    assertNotInstalled(manifest.name, lock);
    // Read the signers again: one may have been revoked while the user answered.
    const approvedNew = plan.newSigner !== undefined && entry.signer === plan.newSigner;
    if (!approvedNew && !signersFor(manifest.name).includes(entry.signer)) {
      throw new Error(`The signer of "${manifest.name}" is no longer trusted. Nothing was installed.`);
    }
    if (approvedNew) trustSigner(manifest.name, entry.signer);
    renameSync(plan.staged.dir, pluginDir(manifest.name));
    lock.plugins = [...(lock.plugins ?? []), entry];
    writeLock(lock);
    return entry;
  } finally {
    plan.discard();
  }
}

/** Install `<url>@<signed-tag>` in one step: {@link planAdd}, then {@link applyAdd}. */
export function addPlugin(spec: string, options: AddPluginOptions): PluginLockEntry {
  return applyAdd(planAdd(spec, options), options);
}

/** Re-pin the previous lock entry after verifying it again. The current entry becomes the previous one. */
export function rollbackPlugin(name: string): PluginLockEntry {
  const lock = readLock();
  const current = lock.plugins?.find((p) => p.name === name);
  if (!current) throw new Error(`Plugin "${name}" is not installed.`);
  const target = current.previous;
  if (!target) throw new Error(`Plugin "${name}" has no previous lock entry to roll back to.`);
  const staged = stage(target.source, target.ref);
  try {
    if (staged.entry.commit !== target.commit || staged.entry.tree !== target.tree) {
      throw new Error(`Tag ${target.ref} of "${name}" moved since it was locked. Refusing to roll back.`);
    }
    const entry: PluginLockEntry = { ...staged.entry, previous: { ...current, previous: undefined } };
    rmSync(pluginDir(name), { recursive: true, force: true });
    renameSync(staged.dir, pluginDir(name));
    lock.plugins = (lock.plugins ?? []).map((p) => (p.name === name ? entry : p));
    writeLock(lock);
    return entry;
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
}

export function listPlugins(): PluginLockEntry[] {
  return readLock().plugins ?? [];
}

/** Delete the checkout and every artifact listed in the lock entry. */
export function removePlugin(name: string): void {
  const lock = readLock();
  const entry = lock.plugins?.find((p) => p.name === name);
  if (!entry) throw new Error(`Plugin "${name}" is not installed.`);
  for (const artifact of entry.artifacts) rmSync(artifact, { recursive: true, force: true });
  rmSync(pluginDir(name), { recursive: true, force: true });
  lock.plugins = (lock.plugins ?? []).filter((p) => p.name !== name);
  if (lock.plugins.length === 0) delete lock.plugins;
  writeLock(lock);
}

/**
 * Why a plugin checkout no longer matches its lock entry, or undefined when
 * it matches. Checks HEAD commit, HEAD tree, and uncommitted changes.
 */
export function pluginDrift(entry: PluginLockEntry): string | undefined {
  const dir = pluginDir(entry.name);
  if (!existsSync(dir)) return "missing";
  if (!signersFor(entry.name).includes(entry.signer)) return "signer revoked";
  try {
    if (git(dir, "rev-parse", "HEAD") !== entry.commit) return git(dir, "rev-parse", "HEAD");
    if (git(dir, "rev-parse", "HEAD^{tree}") !== entry.tree) return "tree changed";
    if (git(dir, "status", "--porcelain", "--untracked-files=all") !== "") return "modified";
    if (checkCapabilities(dir, readManifest(dir)).length > 0) return "capability not declared";
  } catch {
    return "unreadable";
  }
  return undefined;
}
