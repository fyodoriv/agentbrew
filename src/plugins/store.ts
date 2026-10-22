import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { type PluginLockEntry, readLock, writeLock } from "../lock.js";
import { assertCapabilities, checkCapabilities } from "./capabilities.js";
import { capabilitiesHash, type PluginManifest, readManifest } from "./manifest.js";
import { assertMcpServers } from "./mcp-launcher.js";
import { normalizeKey, signersFor, trustSigner, verifySignedTag } from "./signers.js";

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
    throw new Error(`Plugin spec needs a pinned ref: <url>@<ref> (got "${spec}")`);
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

/** Clone `url@ref` to a staging dir, validate the manifest, verify the signed tag. Runs no plugin code. */
export function stage(url: string, ref: string, extraSigner?: string): Staged {
  mkdirSync(pluginsRoot(), { recursive: true });
  const dir = join(pluginsRoot(), `.staging-${process.pid}-${Date.now()}`);
  try {
    git(pluginsRoot(), "clone", "--quiet", "--depth", "1", "--branch", ref, url, dir);
    const manifest = readManifest(dir);
    assertCapabilities(dir, manifest);
    assertMcpServers(dir, manifest);
    const keys = [...signersFor(manifest.name)];
    if (extraSigner && !keys.includes(extraSigner)) keys.push(extraSigner);
    const signer = verifySignedTag(dir, ref, manifest.name, keys);
    const entry: PluginLockEntry = {
      name: manifest.name,
      version: manifest.version,
      source: url,
      ref,
      commit: git(dir, "rev-parse", "HEAD"),
      tree: git(dir, "rev-parse", "HEAD^{tree}"),
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

/**
 * Install `<url>@<signed-tag>`: stage and verify, show capabilities and the
 * signer, require approval, then move into place and lock commit, tree hash,
 * capabilities hash, and signer.
 */
export function addPlugin(spec: string, options: AddPluginOptions): PluginLockEntry {
  const { url, ref } = parsePluginSpec(spec);
  const newSigner = options.signer ? normalizeKey(options.signer) : undefined;
  const staged = stage(url, ref, newSigner);
  try {
    const { manifest, entry } = staged;
    const lock = readLock();
    if (existsSync(pluginDir(manifest.name)) || lock.plugins?.some((p) => p.name === manifest.name)) {
      throw new Error(`Plugin "${manifest.name}" is already installed. Remove it first.`);
    }
    console.log(chalk.bold(`Plugin ${manifest.name} ${manifest.version} (${url}@${ref}) asks for:`));
    console.log(describeCapabilities(manifest));
    console.log(
      `  signed by: ${entry.signer}${signersFor(manifest.name).includes(entry.signer) ? "" : " (new signer)"}`,
    );
    if (!options.yes) throw new Error("Plugin capabilities need approval: re-run with --yes to approve them.");

    if (newSigner && entry.signer === newSigner) trustSigner(manifest.name, newSigner);
    renameSync(staged.dir, pluginDir(manifest.name));
    lock.plugins = [...(lock.plugins ?? []), entry];
    writeLock(lock);
    return entry;
  } finally {
    rmSync(staged.dir, { recursive: true, force: true });
  }
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
