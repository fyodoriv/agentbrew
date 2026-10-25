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
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { getConfigServers } from "../agentfile.js";
import { detectItemTypes } from "../clean.js";
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

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function claudePluginDir(name: string): string {
  if (!SAFE_NAME.test(name) || name.includes("..")) throw new Error(`invalid name "${name}"`);
  return join(expandHome(CLAUDE_PLUGINS_DIR), name);
}

/** Delete `dir` only when it sits inside the plugins folder. */
function removeOwnDir(dir: string): void {
  const base = resolve(expandHome(CLAUDE_PLUGINS_DIR));
  if (!resolve(dir).startsWith(base + sep)) throw new Error(`refusing to delete ${dir}: outside ${base}`);
  rmSync(dir, { recursive: true, force: true });
}

function repoUrl(repo: string): string {
  return /^[\w.-]+\/[\w.-]+$/.test(repo) ? `https://github.com/${repo}.git` : repo;
}

/** Reject values that could act as an option, or a git transport that runs commands. */
function validate(entry: CatalogClaudePlugin): void {
  claudePluginDir(entry.name);
  if (entry.repo.startsWith("-") || /^(ext|fd)::/.test(entry.repo)) throw new Error(`invalid repo "${entry.repo}"`);
  for (const field of ["plugin", "marketplace"] as const) {
    if (!SAFE_NAME.test(entry[field])) throw new Error(`invalid ${field} "${entry[field]}"`);
  }
  if (!FULL_SHA.test(entry.commit)) {
    throw new Error(`${entry.name}: commit must be a full 40-character SHA (got "${entry.commit}")`);
  }
}

/** Fail early, with a plain message, when the `claude` CLI cannot run. */
function requireClaude(): void {
  try {
    execFileSync(claudeBin(), ["--version"], { stdio: "pipe" });
  } catch {
    throw new Error(`Claude Code CLI not found (${claudeBin()}); install it, or set AGENTBREW_CLAUDE_BIN`);
  }
}

export function readClaudePluginRecords(): ClaudePluginRecord[] {
  const path = expandHome(CLAUDE_PLUGINS_PATH);
  if (!existsSync(path)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is ClaudePluginRecord =>
        typeof r === "object" &&
        r !== null &&
        ["name", "commit", "dir", "key", "marketplace"].every((k) => typeof r[k] === "string"),
    );
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
  if (existsSync(join(dir, ".git")) && originOf(dir) !== url) removeOwnDir(dir);
  if (!existsSync(join(dir, ".git"))) {
    removeOwnDir(dir);
    mkdirSync(dirname(dir), { recursive: true });
    execFileSync("git", ["-c", "protocol.ext.allow=never", "clone", "--quiet", "--", url, dir], { stdio: "pipe" });
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

/** True when both paths name the same folder, through symlinks too. */
function samePath(a: string | undefined, b: string): boolean {
  if (a === undefined) return false;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

/** The marketplace of this name in settings, when one exists that agentbrew did not register at `dir`. */
function foreignMarketplace(marketplace: string, dir: string): boolean {
  const markets = claudeSettings().extraKnownMarketplaces as Record<string, { source?: { path?: string } }> | undefined;
  const existing = markets?.[marketplace];
  return existing !== undefined && !samePath(existing.source?.path, dir);
}

/** Clone at the pinned commit, register the directory marketplace, enable the plugin, and record it. */
export function installClaudePlugin(entry: CatalogClaudePlugin): ClaudePluginRecord {
  validate(entry);
  const clash =
    detectItemTypes(entry.name)[0] ??
    (getConfigServers().some((s) => s.name === entry.name) ? "MCP server" : undefined);
  if (clash) throw new Error(`${entry.name} already names a ${clash}; \`agentbrew remove\` could not tell them apart`);
  const dir = claudePluginDir(entry.name);
  if (foreignMarketplace(entry.marketplace, dir)) {
    throw new Error(`marketplace ${entry.marketplace} already exists and is not managed by agentbrew; remove it first`);
  }
  requireClaude();
  checkoutPinned(entry, dir);
  const key = `${entry.plugin}@${entry.marketplace}`;
  const record = { name: entry.name, commit: entry.commit, dir, key, marketplace: entry.marketplace };
  // Record first, so `agentbrew remove` can clean up after a failed step.
  writeRecords([...readClaudePluginRecords().filter((r) => r.name !== entry.name), record]);
  claude(["plugin", "marketplace", "remove", entry.marketplace], { allowFail: true });
  claude(["plugin", "marketplace", "add", dir, "--scope", "user"]);
  claude(["plugin", "install", key, "--scope", "user"]);
  return record;
}

/** Uninstall a plugin agentbrew installed. Returns false when agentbrew has no record of it. */
export function removeClaudePlugin(name: string): boolean {
  const records = readClaudePluginRecords();
  const record = records.find((r) => r.name === name);
  if (!record) return false;
  const dir = claudePluginDir(record.name);
  requireClaude();
  try {
    claude(["plugin", "uninstall", record.key, "--scope", "user"]);
  } catch (error) {
    const enabled = (claudeSettings().enabledPlugins as Record<string, unknown> | undefined)?.[record.key];
    if (enabled !== undefined) throw new Error(`could not uninstall ${record.key}: ${String(error)}`);
  }
  if (!foreignMarketplace(record.marketplace, dir)) {
    claude(["plugin", "marketplace", "remove", record.marketplace], { allowFail: true });
  }
  removeOwnDir(dir);
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
  if (!samePath(markets?.[record.marketplace]?.source?.path, record.dir)) {
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
