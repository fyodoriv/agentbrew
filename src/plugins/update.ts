/**
 * `agentbrew plugin update` (issue #208, step 11).
 *
 * Stages and verifies the new signed ref, prints a semantic diff of rules,
 * skills, MCP servers, hooks, and capabilities, and applies nothing until
 * the user confirms. A capability change always needs its own approval,
 * even with `--yes`. The replaced entry is kept as `previous`, so
 * `plugin rollback` can return to it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { type PluginLockEntry, readLock, writeLock } from "../lock.js";
import { hookEvents } from "./capabilities.js";
import { type PluginManifest, readManifest } from "./manifest.js";
import { readPluginMcpServers } from "./mcp-launcher.js";
import { pluginDir, type Staged, stage } from "./store.js";

export interface UpdatePlan {
  name: string;
  entry: PluginLockEntry;
  diff: string;
  capabilitiesChanged: boolean;
  /** Delete the staged checkout without applying. */
  discard(): void;
  staged: Staged;
}

function contributed(dir: string, manifest: PluginManifest, key: string): string | undefined {
  const rel = manifest.contributes?.[key];
  if (typeof rel !== "string") return undefined;
  const path = join(dir, rel).replace(/\/+$/, "");
  return existsSync(path) ? path : undefined;
}

function list(dir: string | undefined, filter: (name: string, path: string) => boolean): string[] {
  if (!dir || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((n) => filter(n, join(dir, n)))
    .sort();
}

function setDiff(label: string, before: string[], after: string[], changed: string[] = []): string[] {
  const lines = [
    ...after.filter((x) => !before.includes(x)).map((x) => `${label}: + ${x}`),
    ...before.filter((x) => !after.includes(x)).map((x) => `${label}: - ${x}`),
    ...changed.map((x) => `${label}: ~ ${x}`),
  ];
  return lines.length ? lines : [`${label}: (no change)`];
}

function textDiff(a: string, b: string): string {
  const r = spawnSync("diff", ["-u", a, b], { encoding: "utf-8" });
  return (r.stdout ?? "").split("\n").slice(2).join("\n").trimEnd();
}

function rulesDiff(oldDir: string, oldM: PluginManifest, newDir: string, newM: PluginManifest): string[] {
  const o = contributed(oldDir, oldM, "rules");
  const n = contributed(newDir, newM, "rules");
  const md = (name: string) => name.endsWith(".md");
  const before = list(o, md);
  const after = list(n, md);
  const changed = after.filter(
    (f) =>
      before.includes(f) && readFileSync(join(o as string, f), "utf-8") !== readFileSync(join(n as string, f), "utf-8"),
  );
  const out = setDiff("rules", before, after, changed);
  for (const f of changed) out.push(textDiff(join(o as string, f), join(n as string, f)));
  return out;
}

function capabilityLines(oldM: PluginManifest, newM: PluginManifest): string[] {
  const o = (oldM.capabilities ?? {}) as Record<string, unknown>;
  const n = (newM.capabilities ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])].sort();
  const lines = keys
    .filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => `capabilities: ~ ${k}: ${JSON.stringify(o[k] ?? null)} -> ${JSON.stringify(n[k] ?? null)}`);
  return lines.length ? lines : ["capabilities: (no change)"];
}

/** Stage `ref` for an installed plugin and describe what would change. */
export function planUpdate(name: string, ref: string): UpdatePlan {
  const current = readLock().plugins?.find((p) => p.name === name);
  if (!current) throw new Error(`Plugin "${name}" is not installed.`);
  const staged = stage(current.source, ref);
  const discard = () => rmSync(staged.dir, { recursive: true, force: true });
  try {
    if (staged.manifest.name !== name)
      throw new Error(`Ref ${ref} is plugin "${staged.manifest.name}", not "${name}".`);
    const oldDir = pluginDir(name);
    const oldM = readManifest(oldDir);
    const newM = staged.manifest;
    const isDir = (_n: string, p: string) => statSync(p).isDirectory();
    const hooks = (dir: string, m: PluginManifest) => {
      const f = contributed(dir, m, "hooks");
      return f ? hookEvents(f).sort() : [];
    };
    const mcp = (dir: string, m: PluginManifest) => readPluginMcpServers(dir, m);
    const oldServers = mcp(oldDir, oldM);
    const newServers = mcp(staged.dir, newM);
    const changedServers = newServers
      .filter((s) => {
        const prev = oldServers.find((p) => p.name === s.name);
        return prev && JSON.stringify(prev) !== JSON.stringify(s);
      })
      .map((s) => s.name);
    const lines = [
      `Plugin ${name}: ${current.ref} (${current.commit.slice(0, 8)}) -> ${ref} (${staged.entry.commit.slice(0, 8)})`,
      ...rulesDiff(oldDir, oldM, staged.dir, newM),
      ...setDiff(
        "skills",
        list(contributed(oldDir, oldM, "skills"), isDir),
        list(contributed(staged.dir, newM, "skills"), isDir),
      ),
      ...setDiff(
        "mcp_servers",
        oldServers.map((s) => s.name),
        newServers.map((s) => s.name),
        changedServers,
      ),
      ...setDiff("hooks", hooks(oldDir, oldM), hooks(staged.dir, newM)),
      ...capabilityLines(oldM, newM),
    ];
    return {
      name,
      entry: staged.entry,
      diff: lines.join("\n"),
      capabilitiesChanged: staged.entry.capabilitiesHash !== current.capabilitiesHash,
      discard,
      staged,
    };
  } catch (e) {
    discard();
    throw e;
  }
}

export interface UpdateOptions {
  /** The user confirmed the diff. */
  yes: boolean;
  /** The user approved a capability change (never implied by `yes`). */
  capabilityApproved: boolean;
}

/** Apply a plan: swap the checkout and lock entry; keep the old entry as `previous`. */
export function applyUpdate(plan: UpdatePlan, options: UpdateOptions): PluginLockEntry {
  try {
    if (!options.yes) throw new Error("Update not applied: confirm the diff (or pass --yes).");
    if (plan.capabilitiesChanged && !options.capabilityApproved) {
      throw new Error("Update not applied: the capabilities changed and need your explicit approval at the terminal.");
    }
    const lock = readLock();
    const current = lock.plugins?.find((p) => p.name === plan.name) as PluginLockEntry;
    const entry: PluginLockEntry = { ...plan.entry, previous: { ...current, previous: undefined } };
    rmSync(pluginDir(plan.name), { recursive: true, force: true });
    renameSync(plan.staged.dir, pluginDir(plan.name));
    lock.plugins = (lock.plugins ?? []).map((p) => (p.name === plan.name ? entry : p));
    writeLock(lock);
    return entry;
  } finally {
    plan.discard();
  }
}

export function updatePlugin(name: string, ref: string, options: UpdateOptions): PluginLockEntry {
  return applyUpdate(planUpdate(name, ref), options);
}
