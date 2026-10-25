/**
 * Catalog item type `claude-plugin`: a third-party Claude Code plugin pinned to
 * one commit.
 *
 * Claude Code can pin a marketplace only to a branch or tag, and both can move.
 * So agentbrew clones the repo at the pinned SHA into its own folder, registers
 * that checkout as a directory marketplace, and enables the plugin, all through
 * the `claude` CLI. The records file lists what agentbrew installed, so remove
 * and drift touch only those plugins.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import type { DriftItem } from "../drift-checks/types.js";
import { CLAUDE_PLUGINS_DIR, CLAUDE_PLUGINS_PATH } from "../paths.js";
import { expandHome } from "../utils.js";
import { type CatalogClaudePlugin, loadCatalog } from "./types.js";

export interface ClaudePluginRecord {
  name: string;
  commit: string;
  dir: string;
  /** `plugin@marketplace`, the key in `enabledPlugins`. */
  key: string;
  marketplace: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/** The `claude` binary; tests point `AGENTBREW_CLAUDE_BIN` at a fake. */
function claudeBin(): string {
  return process.env.AGENTBREW_CLAUDE_BIN || "claude";
}

function claude(args: string[], options: { allowFail?: boolean } = {}): void {
  try {
    execFileSync(claudeBin(), args, { stdio: "pipe" });
  } catch (error) {
    if (!options.allowFail) throw error;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" }).trim();
}

export function claudePluginDir(name: string): string {
  return join(expandHome(CLAUDE_PLUGINS_DIR), name);
}

function repoUrl(repo: string): string {
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo;
}

export function readClaudePluginRecords(): ClaudePluginRecord[] {
  const path = expandHome(CLAUDE_PLUGINS_PATH);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return Array.isArray(parsed) ? (parsed as ClaudePluginRecord[]) : [];
  } catch {
    return [];
  }
}

function writeRecords(records: ClaudePluginRecord[]): void {
  const path = expandHome(CLAUDE_PLUGINS_PATH);
  mkdirSync(dirname(path), { recursive: true });
  writeFileAtomicSync(path, `${JSON.stringify(records, null, 2)}\n`, "utf-8");
}

function originOf(dir: string): string | undefined {
  try {
    return git(dir, ["remote", "get-url", "origin"]);
  } catch {
    return undefined;
  }
}

/** Check out exactly `commit` in `dir`, cloning first when needed. */
function checkoutPinned(entry: CatalogClaudePlugin, dir: string): void {
  const url = repoUrl(entry.repo);
  if (existsSync(join(dir, ".git")) && originOf(dir) !== url) rmSync(dir, { recursive: true, force: true });
  if (!existsSync(join(dir, ".git"))) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["clone", "--quiet", url, dir], { stdio: "pipe" });
  }
  try {
    git(dir, ["cat-file", "-e", `${entry.commit}^{commit}`]);
  } catch {
    git(dir, ["fetch", "--quiet", "origin"]);
  }
  git(dir, ["checkout", "--quiet", "--detach", entry.commit]);
  const head = git(dir, ["rev-parse", "HEAD"]);
  if (head !== entry.commit) throw new Error(`${entry.name}: checkout is at ${head}, not ${entry.commit}`);
}

/** Clone at the pinned commit, register the directory marketplace, enable the plugin, and record it. */
export function installClaudePlugin(entry: CatalogClaudePlugin): ClaudePluginRecord {
  if (!FULL_SHA.test(entry.commit)) {
    throw new Error(`${entry.name}: commit must be a full 40-character SHA (got "${entry.commit}")`);
  }
  const dir = claudePluginDir(entry.name);
  checkoutPinned(entry, dir);
  const key = `${entry.plugin}@${entry.marketplace}`;
  // A marketplace of the same name may point at an older checkout; replace it.
  claude(["plugin", "marketplace", "remove", entry.marketplace], { allowFail: true });
  claude(["plugin", "marketplace", "add", dir, "--scope", "user"]);
  claude(["plugin", "install", key, "--scope", "user"]);
  const record = { name: entry.name, commit: entry.commit, dir, key, marketplace: entry.marketplace };
  writeRecords([...readClaudePluginRecords().filter((r) => r.name !== entry.name), record]);
  return record;
}

/** Uninstall a plugin agentbrew installed. Returns false when agentbrew has no record of it. */
export function removeClaudePlugin(name: string): boolean {
  const records = readClaudePluginRecords();
  const record = records.find((r) => r.name === name);
  if (!record) return false;
  claude(["plugin", "uninstall", record.key, "--scope", "user"], { allowFail: true });
  claude(["plugin", "marketplace", "remove", record.marketplace], { allowFail: true });
  rmSync(record.dir, { recursive: true, force: true });
  writeRecords(records.filter((r) => r.name !== name));
  return true;
}

function claudeSettings(): Record<string, unknown> {
  const path = expandHome("~/.claude/settings.json");
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function headOf(dir: string): string | undefined {
  try {
    return git(dir, ["rev-parse", "HEAD"]);
  } catch {
    return undefined;
  }
}

/** The problems with one installed plugin, as plain sentences. */
function recordProblems(record: ClaudePluginRecord, entry: CatalogClaudePlugin | undefined): string[] {
  const problems: string[] = [];
  const head = headOf(record.dir);
  if (!head) problems.push(`checkout ${record.dir} is missing`);
  else if (head !== record.commit)
    problems.push(`checkout is at ${head.slice(0, 12)}, not the pinned ${record.commit.slice(0, 12)}`);
  if (entry && entry.commit !== record.commit) {
    problems.push(`catalog pin moved to ${entry.commit.slice(0, 12)}; run \`agentbrew install ${record.name}\``);
  }
  const settings = claudeSettings();
  const enabled = (settings.enabledPlugins as Record<string, unknown> | undefined)?.[record.key];
  if (enabled !== true) problems.push(`${record.key} is not enabled in ~/.claude/settings.json`);
  const markets = settings.extraKnownMarketplaces as Record<string, { source?: { path?: string } }> | undefined;
  if (markets?.[record.marketplace]?.source?.path !== record.dir) {
    problems.push(`marketplace ${record.marketplace} does not point at ${record.dir}`);
  }
  return problems;
}

/** Catalog entries for the drift check; a missing catalog means only local checks run. */
function catalogEntries(): CatalogClaudePlugin[] {
  try {
    return loadCatalog().claude_plugins ?? [];
  } catch {
    return [];
  }
}

/** Drift for every catalog Claude Code plugin agentbrew installed. */
export function checkClaudePluginDrift(entries?: CatalogClaudePlugin[]): DriftItem[] {
  const records = readClaudePluginRecords();
  if (records.length === 0) return [];
  const catalog = entries ?? catalogEntries();
  return records.flatMap((record) =>
    recordProblems(
      record,
      catalog.find((e) => e.name === record.name),
    ).map((problem) => ({
      agent: "claude-code",
      type: "claude-plugin" as const,
      detail: `${record.name}: ${problem}`,
    })),
  );
}
