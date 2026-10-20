/**
 * One refresh path (issue #208, step 6).
 *
 * Rules, skills, and commands from v2 plugins are derived from the locked
 * plugin checkout on every sync. Nothing is copied into `shared-rules.md`
 * or `state.yaml`, nothing depends on the current directory, and a plugin
 * that drifted from its lock or breaks its capabilities contributes nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PluginLockEntry } from "../lock.js";
import { readLock } from "../lock.js";
import { frontMatter } from "./capabilities.js";
import { type PluginManifest, readManifest } from "./manifest.js";
import { pluginDir, pluginDrift } from "./store.js";

export interface ActivePlugin {
  entry: PluginLockEntry;
  dir: string;
  manifest: PluginManifest;
}

/** Locked plugins whose checkout still matches the lock. */
export function activePlugins(): ActivePlugin[] {
  const active: ActivePlugin[] = [];
  for (const entry of readLock().plugins ?? []) {
    if (pluginDrift(entry)) continue;
    const dir = pluginDir(entry.name);
    active.push({ entry, dir, manifest: readManifest(dir) });
  }
  return active;
}

function contributedDir(plugin: ActivePlugin, key: string): string | undefined {
  const rel = plugin.manifest.contributes?.[key];
  if (typeof rel !== "string") return undefined;
  const dir = join(plugin.dir, rel).replace(/\/+$/, "");
  return existsSync(dir) && statSync(dir).isDirectory() ? dir : undefined;
}

/** `claude` in capabilities matches agent `claude` and `claude-code`. */
function agentMatches(declared: string, agentName: string): boolean {
  return agentName === declared || agentName.startsWith(`${declared}-`);
}

function stripFrontMatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

/**
 * The rules block for one agent: each plugin's rules in a fenced section.
 * A rule goes to the agents in its front matter `agents:`, or to every
 * agent in `capabilities.agents` when it names none. Empty when nothing applies.
 */
export function pluginRulesFor(agentName: string): string {
  const blocks: string[] = [];
  for (const plugin of activePlugins()) {
    const rulesDir = contributedDir(plugin, "rules");
    if (!rulesDir) continue;
    const declared = plugin.manifest.capabilities?.agents ?? [];
    const rules: string[] = [];
    for (const file of readdirSync(rulesDir)
      .filter((f) => f.endsWith(".md"))
      .sort()) {
      const text = readFileSync(join(rulesDir, file), "utf-8");
      const own = frontMatter(text).agents;
      const targets = Array.isArray(own) ? own.map(String) : declared;
      if (targets.some((a) => declared.includes(a) && agentMatches(a, agentName))) rules.push(stripFrontMatter(text));
    }
    if (rules.length === 0) continue;
    const name = plugin.entry.name;
    blocks.push(`<!-- plugin: ${name} ${plugin.entry.version} -->\n${rules.join("\n\n")}\n<!-- /plugin: ${name} -->`);
  }
  return blocks.join("\n\n");
}

/** Skill dirs of active plugins; every skill in them deploys. */
export function pluginSkillDirs(): Array<{ label: string; path: string }> {
  return activePlugins().flatMap((p) => {
    const dir = contributedDir(p, "skills");
    return dir ? [{ label: `plugin-${p.entry.name}`, path: dir }] : [];
  });
}

/** Command dirs of active plugins. */
export function pluginCommandDirs(): string[] {
  return activePlugins().flatMap((p) => {
    const dir = contributedDir(p, "commands");
    return dir ? [dir] : [];
  });
}
