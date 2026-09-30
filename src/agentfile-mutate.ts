import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { AGENTFILE_NAMES, loadAgentfile } from "./agentfile.js";
import { loadCatalog } from "./catalog/types.js";
import { logSkipped } from "./core/logger.js";
import type { McpServer } from "./types.js";
import { ICON_SUCCESS } from "./ui/output.js";
import { expandHome } from "./utils.js";

/** Safely parse YAML from a file path. Returns empty object on parse error. */
function safeLoadYaml(filePath: string): Record<string, unknown> {
  try {
    return (yaml.load(readFileSync(filePath, "utf-8")) as Record<string, unknown> | undefined) ?? {};
  } catch (e) {
    logSkipped("agentfile-mutate/yaml.load", e);
    return {};
  }
}

/** The directory where the global Agentfile lives. */
export function globalAgentfileDir(): string {
  return expandHome("~/.config/agentbrew");
}

/** Find the path to the Agentfile in a directory, or undefined if none exists. */
function findAgentfilePath(directory: string): string | undefined {
  for (const name of AGENTFILE_NAMES) {
    const path = join(directory, name);
    if (existsSync(path)) return path;
  }
  return undefined;
}

/** Write an Agentfile to the specified directory. Uses .yaml extension for tooling compatibility. */
export function writeAgentfile(directory: string, content: string): string {
  const path = join(directory, "Agentfile.yaml");
  writeFileAtomicSync(path, content, "utf-8");
  return path;
}

/** Ensure an Agentfile exists in the directory. Creates Agentfile.yaml if none found. */
export function ensureAgentfile(directory: string): string {
  const existing = findAgentfilePath(directory);
  if (existing) return existing;
  const newPath = join(directory, "Agentfile.yaml");
  mkdirSync(directory, { recursive: true });
  writeFileAtomicSync(newPath, "# Agentfile — declarative agent configuration manifest\n", "utf-8");
  return newPath;
}

/** Build a full MCP spec entry for non-catalog servers. */
function buildFullSpec(server: McpServer): Record<string, unknown> {
  const entry: Record<string, unknown> = { name: server.name, command: server.command };
  if (server.args.length > 0) entry.args = server.args;
  if (Object.keys(server.env).length > 0) entry.env = server.env;
  if (server.url) entry.url = server.url;
  return entry;
}

/** Add an MCP server to the Agentfile. Creates the file if `create` is true. */
export function addToAgentfile(directory: string, server: McpServer, options?: { create?: boolean }): boolean {
  let filePath = findAgentfilePath(directory);
  if (!filePath) {
    if (options?.create) {
      filePath = ensureAgentfile(directory);
    } else {
      return false;
    }
  }

  const agentfile = loadAgentfile(directory);
  if (!agentfile) return false;

  // Check if already present
  const existing = agentfile.mcp ?? [];
  const alreadyPresent = existing.some((entry) => {
    if (typeof entry === "string") return entry === server.name;
    return entry.name === server.name;
  });
  if (alreadyPresent) return false;

  // Determine entry format: catalog shorthand or full spec
  const catalog = loadCatalog();
  const isCatalogItem = catalog.mcp_servers.some((s) => s.name === server.name);

  const newEntry = isCatalogItem ? server.name : buildFullSpec(server);

  // Parse, modify, serialize
  const raw = safeLoadYaml(filePath);
  const mcpList = Array.isArray(raw.mcp) ? [...raw.mcp, newEntry] : [newEntry];
  raw.mcp = mcpList;
  writeFileAtomicSync(filePath, yaml.dump(raw, { lineWidth: 120, quotingType: '"', forceQuotes: false }), "utf-8");
  return true;
}

/** Remove an MCP server from the Agentfile by name. */
export function removeFromAgentfile(directory: string, serverName: string): boolean {
  const filePath = findAgentfilePath(directory);
  if (!filePath) return false;

  const raw = safeLoadYaml(filePath);
  if (!raw || !Array.isArray(raw.mcp)) return false;

  const before = raw.mcp.length;
  const filtered = (raw.mcp as (string | Record<string, unknown>)[]).filter((entry) => {
    if (typeof entry === "string") return entry !== serverName;
    if (typeof entry === "object" && entry !== null && "name" in entry)
      return (entry as { name: string }).name !== serverName;
    return true;
  });

  if (filtered.length === before) return false;
  if (filtered.length === 0) delete raw.mcp;
  else raw.mcp = filtered;

  writeFileAtomicSync(filePath, yaml.dump(raw, { lineWidth: 120, quotingType: '"', forceQuotes: false }), "utf-8");
  return true;
}

/** Add a skill name to the Agentfile's `skills:` section. */
export function addSkillToAgentfile(directory: string, skillName: string): boolean {
  let filePath = findAgentfilePath(directory);
  if (!filePath) {
    filePath = ensureAgentfile(directory);
  }

  const raw = safeLoadYaml(filePath);
  const skills = Array.isArray(raw.skills) ? (raw.skills as string[]) : [];
  if (skills.includes(skillName)) return false;

  raw.skills = [...skills, skillName];
  writeFileAtomicSync(filePath, yaml.dump(raw, { lineWidth: 120, quotingType: '"', forceQuotes: false }), "utf-8");
  return true;
}

/** Add a source URL to the Agentfile. */
export function addSourceToAgentfile(directory: string, sourceUrl: string): boolean {
  const filePath = findAgentfilePath(directory);
  if (!filePath) return false;

  const raw = safeLoadYaml(filePath);
  const sources = Array.isArray(raw.sources) ? (raw.sources as string[]) : [];
  if (sources.includes(sourceUrl)) return false;

  raw.sources = [...sources, sourceUrl];
  writeFileAtomicSync(filePath, yaml.dump(raw, { lineWidth: 120, quotingType: '"', forceQuotes: false }), "utf-8");
  return true;
}

/**
 * Install an MCP server to the project Agentfile only (not global state).
 * Creates an Agentfile if none exists. Then syncs to per-project agent configs.
 */
export function installToProject(directory: string, server: McpServer): void {
  // Create Agentfile if it doesn't exist
  const existing = findAgentfilePath(directory);
  if (!existing) {
    writeFileAtomicSync(join(directory, "Agentfile.yaml"), "# Agentfile — project agent config\n", "utf-8");
  }

  addToAgentfile(directory, server);
  console.log(`  ${ICON_SUCCESS} Added ${server.name} to Agentfile`);
  console.log(chalk.dim("  Run `agentbrew sync` to deploy to per-project agent configs.\n"));
}

/**
 * Install a skill to the project directory (local scope).
 * Copies skill files to `.agentbrew/skills/<name>/` and adds to Agentfile `skills:`.
 */
export function installSkillToProject(directory: string, skillName: string, sourcePath: string): void {
  const projectSkillsDir = join(directory, ".agentbrew", "skills", skillName);

  // Remove stale copy before refresh
  if (existsSync(projectSkillsDir)) {
    rmSync(projectSkillsDir, { recursive: true, force: true });
  }

  mkdirSync(projectSkillsDir, { recursive: true });
  cpSync(sourcePath, projectSkillsDir, { recursive: true });

  addSkillToAgentfile(directory, skillName);
  console.log(`  ${ICON_SUCCESS} Skill '${skillName}' installed to ${join(".agentbrew", "skills", skillName)}`);
  console.log(`  ${ICON_SUCCESS} Added '${skillName}' to Agentfile skills`);
  console.log(chalk.dim("  Run `agentbrew sync` to deploy to per-project agent configs.\n"));
}

/**
 * Remove an MCP server from the project Agentfile only (not global state).
 */
export function removeFromProject(directory: string, serverName: string): boolean {
  const removed = removeFromAgentfile(directory, serverName);
  if (removed) {
    console.log(`  ${ICON_SUCCESS} Removed ${serverName} from Agentfile`);
  }
  return removed;
}
