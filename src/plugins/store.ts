import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import chalk from "chalk";
import { type PluginLockEntry, readLock, writeLock } from "../lock.js";
import { capabilitiesHash, type PluginManifest, readManifest } from "./manifest.js";

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
  /** The user approved the capabilities shown. Without it, add refuses. */
  yes: boolean;
}

/** Describe the capabilities the user is asked to approve. */
export function describeCapabilities(manifest: PluginManifest): string {
  const caps = manifest.capabilities ?? {};
  const lines = Object.entries(caps).map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`);
  return lines.length ? lines.join("\n") : "  (none declared)";
}

/**
 * Clone `<url>@<ref>` into a staging dir, validate its manifest, and only then
 * move it into place and lock commit, tree hash, and capabilities hash.
 * Runs no plugin code.
 */
export function addPlugin(spec: string, options: AddPluginOptions): PluginLockEntry {
  const { url, ref } = parsePluginSpec(spec);
  mkdirSync(pluginsRoot(), { recursive: true });
  const staging = join(pluginsRoot(), `.staging-${process.pid}-${Date.now()}`);
  try {
    git(pluginsRoot(), "clone", "--quiet", "--depth", "1", "--branch", ref, url, staging);
    const manifest = readManifest(staging);
    const lock = readLock();
    if (existsSync(pluginDir(manifest.name)) || lock.plugins?.some((p) => p.name === manifest.name)) {
      throw new Error(`Plugin "${manifest.name}" is already installed. Remove it first.`);
    }
    console.log(chalk.bold(`Plugin ${manifest.name} ${manifest.version} (${url}@${ref}) asks for:`));
    console.log(describeCapabilities(manifest));
    if (!options.yes) throw new Error("Plugin capabilities need approval: re-run with --yes to approve them.");

    const entry: PluginLockEntry = {
      name: manifest.name,
      version: manifest.version,
      source: url,
      ref,
      commit: git(staging, "rev-parse", "HEAD"),
      tree: git(staging, "rev-parse", "HEAD^{tree}"),
      capabilitiesHash: capabilitiesHash(manifest.capabilities),
      artifacts: [],
      lockedAt: new Date().toISOString(),
    };
    renameSync(staging, pluginDir(manifest.name));
    lock.plugins = [...(lock.plugins ?? []), entry];
    writeLock(lock);
    return entry;
  } finally {
    rmSync(staging, { recursive: true, force: true });
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
  try {
    if (git(dir, "rev-parse", "HEAD") !== entry.commit) return git(dir, "rev-parse", "HEAD");
    if (git(dir, "rev-parse", "HEAD^{tree}") !== entry.tree) return "tree changed";
    if (git(dir, "status", "--porcelain", "--untracked-files=all") !== "") return "modified";
  } catch {
    return "unreadable";
  }
  return undefined;
}
