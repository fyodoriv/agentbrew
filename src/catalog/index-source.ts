import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import chalk from "chalk";
import { gitExec } from "../core/git-retry.js";
import { realignDivergedCache } from "./cache-realign.js";

/** Detects GitHub Enterprise URLs — any github-like host that isn't github.com. */
function isGitHubEnterprise(url: string): boolean {
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    return hostname !== "github.com" && hostname.includes("github");
  } catch (e) {
    logSkipped("catalog/index-source/includes", e);
    return url.includes("github") && !url.includes("github.com/");
  }
}

import yaml from "js-yaml";
import { errorMessage } from "../core/errors.js";
import { logSkipped } from "../core/logger.js";
import { resolveGitCloneUrl } from "../git-source-url.js";
import type { Source, SourceItem } from "../types.js";
import { ICON_SUCCESS } from "../ui/output.js";
import { checkGitAvailable } from "../utils.js";

const CACHE_DIR = join(homedir(), ".cache", "agentbrew", "sources");
const SOURCE_MANIFEST_FILES = [
  "agentbrew-source.yaml",
  "agentbrew-source.yml",
  "source.yaml",
  "source.yml",
  join(".agentbrew", "source.yaml"),
  join(".agentbrew", "source.yml"),
] as const;

/** In-process cache: tracks source URLs already cloned/pulled in this session. */
const sessionFetched = new Set<string>();

/** In-process cache: tracks source URLs that failed clone in this session (skip retries). Value is the user-facing hint. */
const sessionFailed = new Map<string, string>();

/** Check whether a source URL failed clone/pull in this process (callers can suppress duplicate errors). */
export function isSourceFailed(url: string): boolean {
  return sessionFailed.has(url);
}

const AUTH_ERROR_PATTERNS = [
  /could not read Username/i,
  /Authentication failed/i,
  /Repository not found/i,
  /Permission denied \(publickey\)/i,
  /could not read from remote repository/i,
];

/**
 * Classify a git clone/pull error and return a user-facing hint.
 * Distinguishes auth failures (private repos, SSH issues) from network errors.
 */
export function classifyGitError(stderr: string, url?: string): string {
  if (url && isGitHubEnterprise(url)) {
    return "Check GHE authentication (VPN, SSH keys, or token).";
  }
  if (/Permission denied \(publickey\)/i.test(stderr)) {
    return "This looks like a private repo. SSH key not accepted — run `ssh-add` or check your SSH config.";
  }
  if (AUTH_ERROR_PATTERNS.some((pattern) => pattern.test(stderr))) {
    return "This looks like a private repo. Run `gh auth login` or add a GitHub token.";
  }
  return "Check your internet connection and that the URL is correct.";
}

/** Reset the in-process clone cache (for testing). */
export function resetSessionCache(): void {
  sessionFetched.clear();
  sessionFailed.clear();
}

function collectMultilineValue(lines: string[], startIndex: number): { value: string; endIndex: number } {
  const parts: string[] = [];
  let index = startIndex;
  while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
    index++;
    parts.push(lines[index].trim());
  }
  return { value: parts.join(" "), endIndex: index };
}

function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const lines = match[1].split("\n");
  const result: { name?: string; description?: string } = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      result.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      continue;
    }

    const descMatch = line.match(/^description:\s*(.*)$/);
    if (descMatch) {
      const value = descMatch[1].trim();
      if (value === ">" || value === "|") {
        const multiline = collectMultilineValue(lines, i);
        result.description = multiline.value;
        i = multiline.endIndex;
      } else {
        result.description = value.replace(/^["']|["']$/g, "");
      }
    }
  }

  return result;
}

/** Resolve the skill definition file for a directory — SKILL.md preferred, skill.md and DESIGN.md as fallbacks. */
function resolveDefinitionFile(dirPath: string, entryName: string): string | undefined {
  const candidates = [
    join(dirPath, entryName, "SKILL.md"),
    join(dirPath, entryName, "skill.md"),
    join(dirPath, entryName, "DESIGN.md"),
  ];
  return candidates.find((c) => existsSync(c));
}

/**
 * Scans one directory level for skill folders containing SKILL.md or DESIGN.md.
 * SKILL.md takes priority; DESIGN.md is used as fallback (e.g. awesome-design-md repos).
 * Skips hidden directories (dot-prefixed) so .cursor/, .system/, etc. are ignored.
 */
function scanSkillsInDir(dirPath: string): SourceItem[] {
  const items: SourceItem[] = [];

  if (!existsSync(dirPath)) return items;

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    const definitionFile = resolveDefinitionFile(dirPath, entry.name);
    if (!definitionFile) continue;

    try {
      const content = readFileSync(definitionFile, "utf-8");
      const { name, description } = parseFrontmatter(content);
      items.push({
        name: name ?? entry.name,
        description: description ?? "",
        type: "skill",
      });
    } catch (e) {
      logSkipped("catalog/index-source/push", e);
      items.push({
        name: entry.name,
        description: "",
        type: "skill",
      });
    }
  }

  return items;
}

/** If dir/entry contains a SKILL.md or DESIGN.md, parse and add to items (deduped by name). */
function collectSkillIfPresent(parentDir: string, entryName: string, seen: Set<string>, items: SourceItem[]): void {
  const defFile = resolveDefinitionFile(parentDir, entryName);
  if (!defFile) return;
  const item = parseSkillFromFile(defFile, entryName);
  if (seen.has(item.name)) return;
  seen.add(item.name);
  items.push(item);
}

/** Parse a SKILL.md/DESIGN.md file into a SourceItem. */
function parseSkillFromFile(filePath: string, fallbackName: string): SourceItem {
  try {
    const content = readFileSync(filePath, "utf-8");
    const { name, description } = parseFrontmatter(content);
    return { name: name ?? fallbackName, description: description ?? "", type: "skill" };
  } catch (e) {
    logSkipped("catalog/index-source/parseFrontmatter", e);
    return { name: fallbackName, description: "", type: "skill" };
  }
}

/**
 * Recursively find all directories containing SKILL.md or DESIGN.md anywhere in the tree.
 * Skips node_modules, .git, and hidden directories. Used as a fallback when standard
 * skill locations (root, skills/) find nothing — handles repos like obs-as-code where
 * skills live at non-standard paths (e.g. src/scaffold/cursor/skills/).
 */
function deepScanForSkills(dirPath: string, maxDepth = 6): SourceItem[] {
  const seen = new Set<string>();
  const items: SourceItem[] = [];
  const queue: { dir: string; depth: number }[] = [{ dir: dirPath, depth: 0 }];

  for (let current = queue.shift(); current; current = queue.shift()) {
    if (current.depth > maxDepth) continue;
    for (const entry of readDirEntries(current.dir)) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
      collectSkillIfPresent(current.dir, entry.name, seen, items);
      queue.push({ dir: join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }
  return items;
}

function hasSkillDefinition(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md")) || existsSync(join(dir, "skill.md")) || existsSync(join(dir, "DESIGN.md"));
}

function resolveSkillDefinitionFile(dir: string): string | undefined {
  const candidates = [join(dir, "SKILL.md"), join(dir, "skill.md"), join(dir, "DESIGN.md")];
  return candidates.find((candidate) => existsSync(candidate));
}

function skillDirMatchesName(dir: string, entryName: string, skillName: string): boolean {
  if (entryName === skillName) return true;
  const definitionFile = resolveSkillDefinitionFile(dir);
  if (!definitionFile) return false;
  try {
    const content = readFileSync(definitionFile, "utf-8");
    const { name } = parseFrontmatter(content);
    return name === skillName;
  } catch (e) {
    logSkipped("catalog/index-source/skillDirMatchesName", e);
    return false;
  }
}

/**
 * Locate a skill directory inside a cached source repo.
 * Checks flat layouts first, then recursively searches nested plugin trees
 * (e.g. anthropics/claude-plugins-official plugin skill directories).
 */
function findDirectSkillDir(cachePath: string, skillName: string): string | undefined {
  for (const candidate of [join(cachePath, skillName), join(cachePath, "skills", skillName)]) {
    if (hasSkillDefinition(candidate)) return candidate;
  }

  if (hasSkillDefinition(cachePath) && skillDirMatchesName(cachePath, basename(cachePath), skillName)) {
    return cachePath;
  }

  return undefined;
}

function isSearchableSkillDirectory(entry: { isDirectory(): boolean; name: string }): boolean {
  return (
    entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && entry.name !== "__pycache__"
  );
}

function findNestedSkillDir(cachePath: string, skillName: string, maxDepth: number): string | undefined {
  const queue: { dir: string; depth: number }[] = [{ dir: cachePath, depth: 0 }];
  for (let current = queue.shift(); current; current = queue.shift()) {
    if (current.depth > maxDepth) continue;
    for (const entry of readDirEntries(current.dir)) {
      if (!isSearchableSkillDirectory(entry)) continue;
      const child = join(current.dir, entry.name);
      if (hasSkillDefinition(child) && skillDirMatchesName(child, entry.name, skillName)) {
        return child;
      }
      queue.push({ dir: child, depth: current.depth + 1 });
    }
  }

  return undefined;
}

function findSkillDirInCache(cachePath: string, skillName: string, maxDepth = 8): string | undefined {
  if (!existsSync(cachePath)) return undefined;
  return findDirectSkillDir(cachePath, skillName) ?? findNestedSkillDir(cachePath, skillName, maxDepth);
}

/** Read directory entries safely — returns [] on any error (missing dir, permission denied, etc.). */
function readDirEntries(dir: string): { isDirectory(): boolean; name: string }[] {
  try {
    return readdirSync(dir, { withFileTypes: true }) ?? [];
  } catch (e) {
    logSkipped("catalog/index-source/readdirSync", e);
    return [];
  }
}

/**
 * Scans a repo root for skills. Most repos store skills under a skills/ subdirectory
 * (e.g. vercel-labs/agent-skills, obra/superpowers) — we check both the root and
 * the skills/ subdirectory so both layouts are supported without separate source entries.
 * Also handles single-skill repos where SKILL.md lives at the repo root itself
 * (e.g. currents-dev/playwright-best-practices-skill), falling back to this only when
 * no named subdirectory skills are found.
 */
function scanDirectoryForSkills(dirPath: string): SourceItem[] {
  const rootItems = scanSkillsInDir(dirPath);
  const skillsSubdirItems = scanSkillsInDir(join(dirPath, "skills"));

  // Deduplicate by name: prefer the root-level entry if both exist
  const seen = new Set<string>(rootItems.map((item) => item.name));
  const deduped = skillsSubdirItems.filter((item) => !seen.has(item.name));
  const combined = [...rootItems, ...deduped];

  // Single-skill repo fallback: SKILL.md or DESIGN.md at the repo root with no subdirectory skills
  if (combined.length === 0) {
    const rootFile = existsSync(join(dirPath, "SKILL.md"))
      ? join(dirPath, "SKILL.md")
      : existsSync(join(dirPath, "DESIGN.md"))
        ? join(dirPath, "DESIGN.md")
        : undefined;
    if (rootFile) return [parseSkillFromFile(rootFile, basename(dirPath))];
  }

  // Deep scan fallback: recursively search the entire tree for SKILL.md files
  // (e.g. obs-as-code with skills at src/scaffold/cursor/skills/)
  if (combined.length === 0) {
    const deepItems = deepScanForSkills(dirPath);
    if (deepItems.length > 0) return deepItems;
  }

  return combined;
}

function scanDirectoryForMcpServers(dirPath: string): SourceItem[] {
  const mcpFile = join(dirPath, "mcp-servers.yaml");
  if (!existsSync(mcpFile)) return [];

  try {
    const content = readFileSync(mcpFile, "utf-8");
    const data = yaml.load(content) as Record<string, unknown> | undefined;
    if (!data || typeof data !== "object") return [];

    return Object.keys(data).map((name) => {
      const entry = data[name] as Record<string, unknown> | undefined;
      return {
        name,
        description: (entry?.description as string) ?? "",
        type: "mcp" as const,
      };
    });
  } catch (e) {
    logSkipped("catalog/index-source/keys", e);
    return [];
  }
}

function scanDirectoryForRules(dirPath: string): SourceItem[] {
  const rulesDir = join(dirPath, "rules");
  if (!existsSync(rulesDir)) return [];

  try {
    return readdirSync(rulesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const name = basename(f, ".md");
        const content = readFileSync(join(rulesDir, f), "utf-8");
        const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
        const description = firstLine.replace(/^#+\s*/, "").slice(0, 80);
        return { name, description, type: "rule" as const };
      });
  } catch (e) {
    logSkipped("catalog/index-source/replace", e);
    return [];
  }
}

function scanDirectoryForCommands(dirPath: string): SourceItem[] {
  const commandsDir = join(dirPath, "commands");
  if (!existsSync(commandsDir)) return [];

  try {
    return readdirSync(commandsDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => {
        const name = basename(f, ".md");
        const content = readFileSync(join(commandsDir, f), "utf-8");
        const firstLine = content.split("\n").find((line) => line.trim().length > 0) ?? "";
        const description = firstLine
          .replace(/^#+\s*/, "")
          .replace(/^---\s*$/, "")
          .slice(0, 80);
        return { name, description, type: "command" as const };
      });
  } catch (e) {
    logSkipped("catalog/index-source/slice", e);
    return [];
  }
}

function scanDirectoryForAllTypes(dirPath: string): SourceItem[] {
  return [
    ...scanDirectoryForSkills(dirPath),
    ...scanDirectoryForMcpServers(dirPath),
    ...scanDirectoryForRules(dirPath),
    ...scanDirectoryForCommands(dirPath),
  ];
}

function parseBootstrapScript(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!("script" in raw)) return undefined;
  return typeof raw.script === "string" ? raw.script : undefined;
}

export function readSourceManifest(dirPath: string): { bootstrapScript?: string } {
  for (const name of SOURCE_MANIFEST_FILES) {
    const manifestPath = join(dirPath, name);
    if (!existsSync(manifestPath)) continue;
    try {
      const content = readFileSync(manifestPath, "utf-8");
      const data = yaml.load(content);
      const bootstrap = typeof data === "object" && data !== null && "bootstrap" in data ? data.bootstrap : undefined;
      const bootstrapScript = parseBootstrapScript(bootstrap);
      return bootstrapScript ? { bootstrapScript } : {};
    } catch (e) {
      logSkipped("catalog/index-source/readSourceManifest", e);
      return {};
    }
  }
  return {};
}

function applySourceManifest(source: Source, dirPath: string): void {
  const manifest = readSourceManifest(dirPath);
  if (manifest.bootstrapScript) {
    source.bootstrapScript = manifest.bootstrapScript;
    return;
  }
  delete source.bootstrapScript;
}

function resolveLocalPath(url: string): string {
  return url.replace(/^~/, homedir());
}

function toGitUrl(source: Source): string {
  return resolveGitCloneUrl(source.url, source.type);
}

/** Return the local cache directory for a source (without cloning). */
export function getSourceCacheDir(source: Source): string {
  const safeName = source.url.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(CACHE_DIR, safeName);
}

/** Checks out a specific SHA in the given repo directory, ignoring failures. */
function checkoutSha(cachePath: string, sha: string): void {
  try {
    execFileSync("git", ["checkout", sha, "--quiet"], {
      cwd: cachePath,
      stdio: "pipe",
      timeout: 10_000,
    });
  } catch (e) {
    logSkipped("catalog/index-source/execFileSync", e);
    // Already on the right commit or SHA unavailable
  }
}

/** Fetches from origin and checks out a target SHA. Returns true on success. */
function fetchAndCheckoutSha(cachePath: string, sha: string): boolean {
  try {
    gitExec(["fetch", "origin", "--quiet"], {
      cwd: cachePath,
      timeout: 30_000,
      network: true,
    });
    execFileSync("git", ["checkout", sha, "--quiet"], {
      cwd: cachePath,
      stdio: "pipe",
      timeout: 10_000,
    });
    return true;
  } catch (e) {
    logSkipped("catalog/index-source/execFileSync", e);
    return false;
  }
}

/** Pulls latest changes with fast-forward only. Warns and continues on failure. */
function pullLatest(cachePath: string, sourceUrl: string, cacheKey: string): void {
  try {
    gitExec(["pull", "--ff-only", "--quiet"], {
      cwd: cachePath,
      timeout: 30_000,
      network: true,
    });
    sessionFetched.add(cacheKey);
  } catch (err) {
    // A failed fast-forward usually means upstream rewrote history. The cache
    // is disposable: realign it instead of deploying stale skills.
    const realigned = realignDivergedCache(cachePath);
    if (realigned.status === "realigned") {
      const kept = realigned.salvageBranch
        ? ` Kept ${realigned.kept} local commit(s) on ${realigned.salvageBranch}.`
        : "";
      console.warn(`  ⚠ Realigned diverged cache for ${sourceUrl} to ${realigned.upstream}.${kept}`);
    } else {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.warn(`  ⚠ Could not refresh ${sourceUrl} — using cached data. (${message})`);
    }
    sessionFetched.add(cacheKey);
  }
}

/** Clones a new repository and optionally checks out a specific SHA. */
function cloneNew(source: Source, cachePath: string, targetSha: string | undefined, cacheKey: string): string {
  const gitUrl = toGitUrl(source);
  gitExec(["clone", "--depth", "1", "--quiet", gitUrl, cachePath], {
    timeout: 60_000,
    network: true,
  });

  // If a specific SHA is requested, unshallow and checkout
  if (targetSha) {
    try {
      execFileSync("git", ["fetch", "--unshallow", "--quiet"], {
        cwd: cachePath,
        stdio: "pipe",
        timeout: 60_000,
      });
      execFileSync("git", ["checkout", targetSha, "--quiet"], {
        cwd: cachePath,
        stdio: "pipe",
        timeout: 10_000,
      });
    } catch (e) {
      logSkipped("catalog/index-source/execFileSync", e);
      // Use HEAD if SHA checkout fails
    }
  }

  sessionFetched.add(cacheKey);
  return cachePath;
}

function cloneOrPull(source: Source, options?: { sha?: string }): string | undefined {
  const cachePath = getSourceCacheDir(source);
  const targetSha = options?.sha;
  const cacheKey = `${source.url}:${targetSha ?? "HEAD"}`;

  if (existsSync(join(cachePath, ".git"))) {
    // Already fetched in this process — skip network round-trip and log
    if (sessionFetched.has(cacheKey)) {
      if (targetSha) {
        checkoutSha(cachePath, targetSha);
      }
      return cachePath;
    }

    // Actual fetch — log once, before the network round-trip
    console.log(chalk.dim(`  Fetching ${source.url}...`));

    // If a specific SHA is requested, fetch and checkout that commit
    if (targetSha && fetchAndCheckoutSha(cachePath, targetSha)) {
      return cachePath;
    }

    pullLatest(cachePath, source.url, cacheKey);
    return cachePath;
  }

  // Fresh clone — log once, before the network round-trip
  console.log(chalk.dim(`  Fetching ${source.url}...`));
  mkdirSync(CACHE_DIR, { recursive: true });

  try {
    return cloneNew(source, cachePath, targetSha, cacheKey);
  } catch (error) {
    const stderr = errorMessage(error);
    const hint = classifyGitError(stderr, source.url);
    sessionFailed.set(source.url, hint);
    throw new Error(`git clone failed for ${source.url}: ${stderr.split("\n")[0]}. ${hint}`);
  }
}

/** Clone/pull the source repo and return the local cache path, or undefined on failure. */
export function getSourceCachePath(source: Source, options?: { sha?: string }): string | undefined {
  if (source.type === "local") {
    const localPath = resolveLocalPath(source.url);
    return existsSync(localPath) ? localPath : undefined;
  }
  if (!checkGitAvailable()) return undefined;
  if (sessionFailed.has(source.url)) {
    return undefined;
  }
  try {
    return cloneOrPull(source, options);
  } catch (e) {
    logSkipped("catalog/index-source/cloneOrPull", e);
    return undefined;
  }
}

export function indexSource(source: Source, options?: { sha?: string }): SourceItem[] {
  if (source.type === "local") {
    const localPath = resolveLocalPath(source.url);
    applySourceManifest(source, localPath);
    return scanDirectoryForAllTypes(localPath);
  }

  if (!checkGitAvailable()) return [];
  const cachePath = cloneOrPull(source, options);
  if (cachePath) {
    applySourceManifest(source, cachePath);
  }
  return cachePath ? scanDirectoryForAllTypes(cachePath) : [];
}

export function formatItemCounts(items: SourceItem[]): string {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  const parts: string[] = [];
  if (counts.skill) parts.push(`${counts.skill} skill${counts.skill > 1 ? "s" : ""}`);
  if (counts.mcp) parts.push(`${counts.mcp} MCP server${counts.mcp > 1 ? "s" : ""}`);
  if (counts.rule) parts.push(`${counts.rule} rule${counts.rule > 1 ? "s" : ""}`);
  if (counts.command) parts.push(`${counts.command} command${counts.command > 1 ? "s" : ""}`);
  return parts.join(", ");
}

export async function indexAllSources(sources: Source[]): Promise<void> {
  for (const source of sources) {
    console.log(chalk.dim(`  Indexing ${source.url}...`));
    const items = indexSource(source);
    source.availableItems = items;
    source.indexedAt = new Date().toISOString();

    if (items.length > 0) {
      console.log(`  ${ICON_SUCCESS} ${source.url} — ${formatItemCounts(items)}`);
    } else {
      console.log(`  ${chalk.dim("○")} ${source.url} — no items found`);
    }
  }
}

export { findSkillDirInCache, parseFrontmatter, scanDirectoryForSkills };
