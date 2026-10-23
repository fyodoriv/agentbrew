/**
 * Command and agent name clashes between sources (the same rule as skills,
 * #425): when two sources ship a file with the same name, the source listed
 * later wins. Built-in commands and the user's own command and agent folders
 * are not sources here; they keep their own documented precedence.
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import type { Logger } from "../core/logger.js";
import { AGENTS_DIR, COMMANDS_DIR } from "../paths.js";
import { pluginCommandDirs } from "../plugins/contributions.js";
import type { AgentBrewState } from "../types.js";
import { expandHome } from "../utils.js";
import { builtinCommandsDir } from "./builtin-commands.js";

/** One name that more than one source ships. */
export interface NameClash {
  name: string;
  /** The source whose file is used (listed last). */
  owner: string;
  /** Sources that also ship the name; their file is not used. */
  skipped: string[];
}

/** Clashing names across `sources` in listing order; the later source wins. */
export function nameClashes(sources: Array<{ label: string; names: string[] }>): NameClash[] {
  const shippers = new Map<string, string[]>();
  for (const { label, names } of sources) {
    for (const name of new Set(names)) shippers.set(name, [...(shippers.get(name) ?? []), label]);
  }
  return [...shippers.entries()]
    .filter(([, labels]) => labels.length > 1)
    .map(([name, labels]) => ({ name, owner: labels[labels.length - 1] as string, skipped: labels.slice(0, -1) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function markdownNames(dir: string): string[] {
  try {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.slice(0, -3));
  } catch {
    return [];
  }
}

/** `~/x` for a path under the home folder, so a clash line names each dir. */
function displayPath(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * Source dirs in collection order, each path once, minus `skip` (folders
 * with their own precedence). Labels are paths: two dirs from one
 * Agentfile share a state label.
 */
function dirSources(paths: string[], skip: Array<string | undefined>): Array<{ label: string; names: string[] }> {
  const seen = new Set(skip.filter((p): p is string => Boolean(p)));
  const sources: Array<{ label: string; names: string[] }> = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    sources.push({ label: displayPath(path), names: markdownNames(path) });
  }
  return sources;
}

/**
 * Command names that two or more command source dirs (Agentfile dirs, then
 * plugins) ship. The built-in commands and the global commands folder keep
 * their own precedence (the global folder also holds merged copies).
 */
export function commandNameClashes(state: AgentBrewState | undefined): NameClash[] {
  const paths = [...(state?.commandSourceDirs ?? []).map((d) => expandHome(d.path)), ...pluginCommandDirs()];
  return nameClashes(dirSources(paths, [builtinCommandsDir(), expandHome(COMMANDS_DIR)]));
}

/** Agent names that two or more Agentfile agent dirs ship. The built-in agents folder always wins. */
export function agentNameClashes(state: AgentBrewState | undefined): NameClash[] {
  const paths = (state?.agentSourceDirs ?? []).map((d) => expandHome(d.path));
  return nameClashes(dirSources(paths, [expandHome(AGENTS_DIR)]));
}

/** One status or sync line for a clash, for example: `command review from b; skipped from a`. */
export function formatNameClash(kind: "command" | "agent", clash: NameClash): string {
  return `${kind} ${clash.name} from ${clash.owner}; skipped from ${clash.skipped.join(", ")} (the source listed later wins)`;
}

/** Warn once per clash on a sync that is not quiet. */
export function warnNameClashes(kind: "command" | "agent", clashes: NameClash[], quiet: boolean, log: Logger): void {
  if (quiet) return;
  for (const clash of clashes) log.warn(`  ⚠ Name clash: ${formatNameClash(kind, clash)}`);
}
