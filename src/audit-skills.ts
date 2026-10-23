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

const normalize = (name: string) => name.toLowerCase().replace(/[\s_.]+/g, "-");

/** `short` is a whole-segment prefix of `long` and specific (two or more segments). */
function specificPrefix(short: string, long: string): boolean {
  return short.split("-").length >= 2 && long.startsWith(`${short}-`);
}

export function auditLocalItems(local: LocalItem[], index: IndexItem[], adoptTarget: string): AuditRow[] {
  const byKey = new Map<string, AuditRow>();
  for (const item of local) {
    const key = `${item.kind}\u0000${item.name}`;
    const row = byKey.get(key);
    if (row) {
      if (!row.agents.includes(item.agent)) row.agents.push(item.agent);
      continue;
    }
    const sameKind = index.filter((i) => i.kind === item.kind);
    const exact = sameKind.find((i) => i.name === item.name);
    const n = normalize(item.name);
    const near =
      exact ??
      sameKind.find((i) => normalize(i.name) === n) ??
      sameKind.find((i) => specificPrefix(n, normalize(i.name)) || specificPrefix(normalize(i.name), n));
    byKey.set(key, {
      kind: item.kind,
      name: item.name,
      action: exact ? "merge" : near ? "merge?" : "adopt",
      target: near ? near.source : adoptTarget,
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
  for (const d of checkUserCreatedSkills()) {
    const name = d.detail.replace(/^user-created skill: /, "");
    items.push({ kind: "skill", name, agent: d.agent });
  }
  for (const d of checkUserCreatedCommands()) {
    const name = d.detail.replace(/^user-created command: /, "").replace(/\.[^.]+$/, "");
    items.push({ kind: "command", name, agent: d.agent });
  }
  return items;
}

function sourceIndex(): IndexItem[] {
  const index: IndexItem[] = [];
  for (const source of getSkillSources()) {
    for (const path of source.scanner(source.path))
      index.push({ kind: "skill", name: basename(path), source: source.label });
  }
  for (const source of loadState()?.sources ?? []) {
    for (const item of source.availableItems ?? []) {
      if (item.type === "skill" || item.type === "command")
        index.push({ kind: item.type, name: item.name, source: source.url });
    }
  }
  for (const skill of loadCatalog().skills)
    index.push({ kind: "skill", name: skill.name, source: String(skill.source) });
  for (const dir of getAllCommandSourceDirs()) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".md")) index.push({ kind: "command", name: file.slice(0, -3), source: dir });
    }
  }
  return index;
}

/** The adopt target when `--into` is not given. */
export const DEFAULT_ADOPT_TARGET = "the repo that should own it (name it with --into <repo>)";

/** `agentbrew audit-skills [--json] [--into <repo>]`. */
export function showSkillAudit(options: { json?: boolean; into?: string } = {}): void {
  const rows = auditLocalItems(localItems(), sourceIndex(), options.into?.trim() || DEFAULT_ADOPT_TARGET);
  console.log(options.json ? JSON.stringify(rows, null, 2) : formatAudit(rows));
}
