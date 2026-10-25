/**
 * `agentbrew audit-skills` (#442): list every skill and command in the agent
 * folders that no tracked source owns, and say what to do with each:
 *
 * - `merge`: a source already ships this name; fold the local changes in.
 * - `merge?`: a near-duplicate of a source item (same name once spacing and
 *   case are ignored, or a whole-segment prefix of at least two segments, so
 *   `pr` never matches `pr-merge-chain`).
 * - `adopt`: no source has it; move it into the target repo.
 *
 * It reads local files only and changes nothing. The source index is built
 * in one pass.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";
import chalk from "chalk";
import { loadCatalog } from "./catalog/types.js";
import { checkUserCreatedCommands } from "./drift-checks/commands.js";
import { checkUserCreatedSkills } from "./drift-checks/skills.js";
import { loadState } from "./state.js";
import { getAllCommandSourceDirs } from "./sync/command-sync.js";
import { getSkillSources } from "./sync/skills-sync.js";

export type ItemKind = "skill" | "command";
export interface LocalItem {
  kind: ItemKind;
  name: string;
  agent: string;
}
export interface IndexItem {
  kind: ItemKind;
  name: string;
  source: string;
}
export interface AuditRow {
  kind: ItemKind;
  name: string;
  action: "merge" | "merge?" | "adopt";
  /** The source to merge into, or the repo to adopt into. */
  target: string;
  agents: string[];
}

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/[\s_.-]+/g, "-")
    .replace(/^-|-$/g, "");

/** `short` is a whole-segment prefix of `long` and specific (two or more segments). */
function specificPrefix(short: string, long: string): boolean {
  return short.split("-").length >= 2 && long.startsWith(`${short}-`);
}

interface IndexMaps {
  exact: Map<string, IndexItem>;
  normal: Map<string, IndexItem>;
}

const itemKey = (kind: ItemKind, name: string) => `${kind}\u0000${name}`;

/** One pass over the index: exact and normalized names in maps. */
function indexMaps(index: IndexItem[]): IndexMaps {
  const exact = new Map<string, IndexItem>();
  const normal = new Map<string, IndexItem>();
  for (const item of index) {
    if (!exact.has(itemKey(item.kind, item.name))) exact.set(itemKey(item.kind, item.name), item);
    if (!normal.has(itemKey(item.kind, normalize(item.name))))
      normal.set(itemKey(item.kind, normalize(item.name)), item);
  }
  return { exact, normal };
}

/** The source a local item duplicates or nearly duplicates, and whether exactly. */
function closestSource(item: LocalItem, maps: IndexMaps, index: IndexItem[]): { match?: IndexItem; exact: boolean } {
  const exact = maps.exact.get(itemKey(item.kind, item.name));
  if (exact) return { match: exact, exact: true };
  const n = normalize(item.name);
  const near =
    maps.normal.get(itemKey(item.kind, n)) ??
    index.find(
      (i) => i.kind === item.kind && (specificPrefix(n, normalize(i.name)) || specificPrefix(normalize(i.name), n)),
    );
  return { match: near, exact: false };
}

export function auditLocalItems(local: LocalItem[], index: IndexItem[], adoptTarget: string): AuditRow[] {
  const maps = indexMaps(index);
  const byKey = new Map<string, AuditRow>();
  for (const item of local) {
    const row = byKey.get(itemKey(item.kind, item.name));
    if (row) {
      if (!row.agents.includes(item.agent)) row.agents.push(item.agent);
      continue;
    }
    const { match, exact } = closestSource(item, maps, index);
    byKey.set(itemKey(item.kind, item.name), {
      kind: item.kind,
      name: item.name,
      action: exact ? "merge" : match ? "merge?" : "adopt",
      target: match ? match.source : adoptTarget,
      agents: [item.agent],
    });
  }
  const order = { merge: 0, "merge?": 1, adopt: 2 };
  return [...byKey.values()].sort((a, b) => order[a.action] - order[b.action] || a.name.localeCompare(b.name));
}

export function formatAudit(rows: AuditRow[]): string {
  if (rows.length === 0) return "Every skill and command in the agent folders comes from a tracked source.";
  const lines = [chalk.bold(`Local skills and commands no source owns: ${rows.length}`), ""];
  for (const row of rows) {
    const what = row.action === "adopt" ? `move it into ${row.target}` : `fold it into ${row.target}`;
    lines.push(
      `  ${row.action.padEnd(6)} ${row.kind} ${row.name} — ${what} ${chalk.dim(`(${row.agents.join(", ")})`)}`,
    );
  }
  lines.push("", chalk.dim("Nothing was changed. Ask the user before you adopt or merge anything."));
  return lines.join("\n");
}

function localItems(): LocalItem[] {
  const items: LocalItem[] = [];
  for (const d of checkUserCreatedSkills({ dedupe: false })) {
    const name = d.detail.replace(/^user-created skill: /, "");
    items.push({ kind: "skill", name, agent: d.agent });
  }
  for (const d of checkUserCreatedCommands({ dedupe: false })) {
    const name = d.detail.replace(/^user-created command: /, "").replace(/\.[^.]+$/, "");
    items.push({ kind: "command", name, agent: d.agent });
  }
  // Dot-folders such as .trash or .system are agent internals, not skills.
  return items.filter((item) => !item.name.startsWith("."));
}

function skillSourceItems(): IndexItem[] {
  return getSkillSources().flatMap((source) =>
    source.scanner(source.path).map((path) => ({ kind: "skill" as const, name: basename(path), source: source.label })),
  );
}

function stateSourceItems(): IndexItem[] {
  return (loadState()?.sources ?? []).flatMap((source) =>
    (source.availableItems ?? [])
      .filter((item) => item.type === "skill" || item.type === "command")
      .map((item) => ({ kind: item.type as ItemKind, name: item.name, source: source.url })),
  );
}

function commandDirItems(): IndexItem[] {
  return getAllCommandSourceDirs()
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".md"))
        .map((file) => ({ kind: "command" as const, name: file.slice(0, -3), source: dir })),
    );
}

function sourceIndex(): IndexItem[] {
  const catalog = loadCatalog().skills.map((skill) => ({
    kind: "skill" as const,
    name: skill.name,
    source: String(skill.source),
  }));
  return [...skillSourceItems(), ...stateSourceItems(), ...catalog, ...commandDirItems()];
}

/** The adopt target when `--into` is not given. */
export const DEFAULT_ADOPT_TARGET = "the repo that should own it (name it with --into <repo>)";

/** `agentbrew audit-skills [--json] [--into <repo>]`. */
export function showSkillAudit(options: { json?: boolean; into?: string } = {}): void {
  const rows = auditLocalItems(localItems(), sourceIndex(), options.into?.trim() || DEFAULT_ADOPT_TARGET);
  console.log(options.json ? JSON.stringify(rows, null, 2) : formatAudit(rows));
}
