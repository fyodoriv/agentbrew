/**
 * Command and agent name clashes between sources (the same rule as skills,
 * #425): when two sources ship a file with the same name, the source listed
 * later wins. Built-in commands and the user's own command and agent folders
 * are not sources here; they keep their own documented precedence.
 */
import { existsSync, readdirSync } from "node:fs";
import { pluginCommandDirs } from "../plugins/contributions.js";
import type { AgentBrewState } from "../types.js";
import { expandHome } from "../utils.js";

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

/** Command names that two or more command source dirs (Agentfile dirs, then plugins) ship. */
export function commandNameClashes(state: AgentBrewState | undefined): NameClash[] {
  const sources = (state?.commandSourceDirs ?? []).map((d) => ({
    label: d.label,
    names: markdownNames(expandHome(d.path)),
  }));
  for (const dir of pluginCommandDirs()) sources.push({ label: dir, names: markdownNames(dir) });
  return nameClashes(sources);
}

/** Agent names that two or more agent source dirs ship. */
export function agentNameClashes(state: AgentBrewState | undefined): NameClash[] {
  return nameClashes(
    (state?.agentSourceDirs ?? []).map((d) => ({ label: d.label, names: markdownNames(expandHome(d.path)) })),
  );
}

/** One status or sync line for a clash, for example: `command review from b; skipped from a`. */
export function formatNameClash(kind: "command" | "agent", clash: NameClash): string {
  return `${kind} ${clash.name} from ${clash.owner}; skipped from ${clash.skipped.join(", ")} (the source listed later wins)`;
}
