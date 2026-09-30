import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import chalk from "chalk";
import yaml from "js-yaml";
import { sync as writeFileSync } from "write-file-atomic";
import { getStateServers, getStateSources } from "./agentfile.js";
import { errorMessage } from "./core/errors.js";
import { logSkipped } from "./core/logger.js";
import { loadState, requireState, saveState } from "./state.js";
import { getCommandsDir } from "./sync/command-sync.js";
import { getSharedRulesPath } from "./sync/rules-sync.js";
import type { AgentBrewState, McpServer, SkillSourceDir, Source } from "./types.js";
import { ICON_SUCCESS, ICON_WARNING } from "./ui/output.js";
import { expandHome } from "./utils.js";

export interface ExportBundle {
  version: "1";
  exportedAt: string;
  mcpServers: McpServer[];
  sources: Pick<Source, "url" | "type" | "skillsInstalled">[];
  skillSourceDirs?: SkillSourceDir[];
  sharedRules?: string;
  commands?: Record<string, string>;
}

interface ExportOptions {
  output?: string;
  json?: boolean;
}

interface ImportOptions {
  file: string;
  merge?: boolean;
  dryRun?: boolean;
}

interface ImportResult {
  mcpServersAdded: string[];
  mcpServersSkipped: string[];
  sourcesAdded: string[];
  sourcesSkipped: string[];
  skillSourceDirsAdded: string[];
  skillSourceDirsSkipped: string[];
  rulesWritten: boolean;
  rulesSkipped: boolean;
  commandsWritten: string[];
  commandsSkipped: string[];
}

/** Read shared rules content, or undefined if not present. */
function readSharedRulesForExport(): string | undefined {
  const sharedRulesPath = getSharedRulesPath();
  if (!existsSync(sharedRulesPath)) return undefined;
  try {
    const content = readFileSync(sharedRulesPath, "utf-8").trim();
    return content || undefined;
  } catch (e) {
    logSkipped("portable/readSharedRulesForExport", e);
    return undefined;
  }
}

/** Read command files from the commands directory, or undefined if none. */
function readCommandsForExport(): Record<string, string> | undefined {
  const commandsDir = getCommandsDir();
  if (!existsSync(commandsDir)) return undefined;
  const files = readdirSync(commandsDir).filter((f) => f.endsWith(".md"));
  if (files.length === 0) return undefined;
  const commands: Record<string, string> = {};
  for (const file of files) {
    try {
      commands[basename(file, ".md")] = readFileSync(join(commandsDir, file), "utf-8");
    } catch (e) {
      logSkipped("portable/basename", e);
      // Skip files that can't be read (deleted mid-export, permission issues).
    }
  }
  return commands;
}

export function buildExportBundle(): ExportBundle {
  const state = requireState();
  if (!state) {
    throw new Error("agentbrew not initialized. Run `agentbrew init` first.");
  }

  const bundle: ExportBundle = {
    version: "1",
    exportedAt: new Date().toISOString(),
    mcpServers: getStateServers(state).map((server) => ({
      name: server.name,
      command: server.command,
      args: server.args,
      env: server.env,
      source: server.source,
      url: server.url,
      headers: server.headers,
    })),
    sources: getStateSources(state).map((source) => ({
      url: source.url,
      type: source.type,
      skillsInstalled: source.skillsInstalled,
    })),
  };

  if (state.skillSourceDirs?.length) {
    bundle.skillSourceDirs = state.skillSourceDirs;
  }

  bundle.sharedRules = readSharedRulesForExport();
  bundle.commands = readCommandsForExport();

  return bundle;
}

export async function exportConfig(options?: ExportOptions): Promise<void> {
  const bundle = buildExportBundle();

  if (options?.json) {
    console.log(JSON.stringify(bundle, undefined, 2));
    return;
  }

  const content = yaml.dump(bundle, { lineWidth: 120, noRefs: true, sortKeys: false });

  if (options?.output) {
    writeFileSync(options.output, content, "utf-8");
    console.log(`${ICON_SUCCESS} Exported to: ${options.output}`);
  } else {
    const defaultPath = "agentbrew-export.yaml";
    writeFileSync(defaultPath, content, "utf-8");
    console.log(`${ICON_SUCCESS} Exported to: ${defaultPath}`);
  }

  console.log(chalk.dim(`  ${bundle.mcpServers.length} MCP servers, ${bundle.sources.length} sources`));
  if (bundle.skillSourceDirs?.length)
    console.log(chalk.dim(`  ${bundle.skillSourceDirs.length} skill source dir(s) included`));
  if (bundle.sharedRules) console.log(chalk.dim("  Shared rules included"));
  if (bundle.commands) console.log(chalk.dim(`  ${Object.keys(bundle.commands).length} commands included`));
}

export function parseBundle(filePath: string): ExportBundle {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}. Check the path and try again.`);
  }

  let bundle: ExportBundle;
  try {
    const content = readFileSync(filePath, "utf-8");
    bundle = (filePath.endsWith(".json") ? JSON.parse(content) : yaml.load(content)) as ExportBundle;
  } catch (error) {
    throw new Error(`Failed to parse bundle file: ${errorMessage(error)}. Ensure the file is valid YAML or JSON.`);
  }

  if (!bundle || typeof bundle !== "object") {
    throw new Error("Invalid bundle: expected an object. Use `agentbrew export` to create a valid bundle.");
  }

  if (bundle.version !== "1") {
    throw new Error(
      `Unsupported bundle version: ${bundle.version ?? "unknown"}. This agentbrew supports version "1". Upgrade agentbrew or re-export the bundle.`,
    );
  }

  if (!Array.isArray(bundle.mcpServers)) {
    throw new Error("Invalid bundle: mcpServers must be an array. Use `agentbrew export` to create a valid bundle.");
  }

  // Validate individual server entries.
  bundle.mcpServers = bundle.mcpServers.filter((server: unknown) => {
    if (!server || typeof server !== "object") return false;
    const s = server as Record<string, unknown>;
    return typeof s.name === "string" && s.name.trim().length > 0;
  });

  if (!Array.isArray(bundle.sources)) {
    throw new Error("Invalid bundle: sources must be an array. Use `agentbrew export` to create a valid bundle.");
  }

  return bundle;
}

function applyMcpServers(state: AgentBrewState, bundle: ExportBundle, merge: boolean, result: ImportResult): void {
  const servers = getStateServers(state);
  if (!state.mcpServers) state.mcpServers = [];
  const existingServerNames = new Set(servers.map((s) => s.name));
  for (const server of bundle.mcpServers) {
    if (existingServerNames.has(server.name)) {
      if (merge) {
        result.mcpServersSkipped.push(server.name);
      } else {
        const index = state.mcpServers.findIndex((s) => s.name === server.name);
        state.mcpServers[index] = server;
        result.mcpServersAdded.push(server.name);
      }
    } else {
      state.mcpServers.push(server);
      result.mcpServersAdded.push(server.name);
    }
  }
}

function applySources(state: AgentBrewState, bundle: ExportBundle, result: ImportResult): void {
  const existingSourceUrls = new Set(getStateSources(state).map((s) => s.url));
  if (!state.sources) state.sources = [];
  for (const source of bundle.sources) {
    if (existingSourceUrls.has(source.url)) {
      result.sourcesSkipped.push(source.url);
    } else {
      state.sources.push({
        url: source.url,
        type: source.type,
        skillsInstalled: source.skillsInstalled,
        availableItems: [],
        addedAt: new Date().toISOString(),
        origin: "user",
      });
      result.sourcesAdded.push(source.url);
    }
  }
}

function applySkillSourceDirs(state: AgentBrewState, bundle: ExportBundle, result: ImportResult): void {
  if (bundle.skillSourceDirs?.length) {
    const existingPaths = new Set((state.skillSourceDirs ?? []).map((d) => d.path));
    for (const dir of bundle.skillSourceDirs) {
      if (existingPaths.has(dir.path)) {
        result.skillSourceDirsSkipped.push(dir.label);
      } else {
        // Skip absolute local paths that don't exist on this machine
        const expanded = expandHome(dir.path);
        if (dir.path.startsWith("/") && !existsSync(expanded)) {
          result.skillSourceDirsSkipped.push(`${dir.label} (path not found: ${dir.path})`);
        } else {
          state.skillSourceDirs = state.skillSourceDirs ?? [];
          state.skillSourceDirs.push(dir);
          result.skillSourceDirsAdded.push(dir.label);
        }
      }
    }
  }
}

function applySharedRules(bundle: ExportBundle, merge: boolean, result: ImportResult): void {
  if (bundle.sharedRules) {
    const sharedRulesPath = getSharedRulesPath();
    try {
      mkdirSync(expandHome("~/.config/agentbrew"), { recursive: true });
      // Preserve existing user rules: only write if file doesn't exist or merge=false (force)
      if (existsSync(sharedRulesPath)) {
        const existing = readFileSync(sharedRulesPath, "utf-8");
        if (existing.trim() !== bundle.sharedRules.trim()) {
          if (merge) {
            result.rulesSkipped = true;
          } else {
            writeFileSync(sharedRulesPath, bundle.sharedRules, "utf-8");
            result.rulesWritten = true;
          }
        }
      } else {
        writeFileSync(sharedRulesPath, bundle.sharedRules, "utf-8");
        result.rulesWritten = true;
      }
    } catch (e) {
      logSkipped("portable/applySharedRules", e);
    }
  }
}

function shouldWriteCommand(filePath: string, content: string, merge: boolean): "write" | "skip" | "identical" {
  if (!existsSync(filePath)) return "write";
  try {
    const existing = readFileSync(filePath, "utf-8");
    if (existing === content) return "identical";
  } catch (e) {
    logSkipped("portable/shouldWriteCommand", e);
    // Cannot compare — fall through to write
  }
  return merge ? "skip" : "write";
}

function applyCommands(bundle: ExportBundle, merge: boolean, result: ImportResult): void {
  if (!bundle.commands) return;
  const commandsDir = getCommandsDir();
  mkdirSync(commandsDir, { recursive: true });
  for (const [name, content] of Object.entries(bundle.commands)) {
    const filePath = join(commandsDir, `${name}.md`);
    const action = shouldWriteCommand(filePath, content, merge);
    if (action === "skip") {
      result.commandsSkipped.push(name);
    } else if (action === "write") {
      writeFileSync(filePath, content, "utf-8");
      result.commandsWritten.push(name);
    }
  }
}

export function applyBundle(state: AgentBrewState, bundle: ExportBundle, merge: boolean): ImportResult {
  const result: ImportResult = {
    mcpServersAdded: [],
    mcpServersSkipped: [],
    sourcesAdded: [],
    sourcesSkipped: [],
    skillSourceDirsAdded: [],
    skillSourceDirsSkipped: [],
    rulesWritten: false,
    rulesSkipped: false,
    commandsWritten: [],
    commandsSkipped: [],
  };

  applyMcpServers(state, bundle, merge, result);
  applySources(state, bundle, result);
  applySkillSourceDirs(state, bundle, result);
  applySharedRules(bundle, merge, result);
  applyCommands(bundle, merge, result);

  return result;
}

export async function importConfig(options: ImportOptions): Promise<void> {
  const bundle = parseBundle(options.file);

  const state = loadState();
  if (!state) {
    throw new Error("agentbrew not initialized. Run `agentbrew init` first.");
  }

  if (options.dryRun) {
    console.log(chalk.bold("\nDry run — no changes will be applied\n"));
    const preview = applyBundle(structuredClone(state), bundle, options.merge ?? true);
    printResult(preview);
    return;
  }

  const result = applyBundle(state, bundle, options.merge ?? true);
  saveState(state);

  console.log(`${ICON_SUCCESS} Imported from: ${options.file}\n`);
  printResult(result);
  console.log(chalk.dim("Run `agentbrew sync` to deploy changes to all agents.\n"));
}

function printResult(result: ImportResult): void {
  if (result.mcpServersAdded.length > 0) {
    console.log(`  ${chalk.green("+")} MCP servers: ${result.mcpServersAdded.join(", ")}`);
  }
  if (result.mcpServersSkipped.length > 0) {
    console.log(`  ${chalk.dim("=")} MCP servers (skipped): ${result.mcpServersSkipped.join(", ")}`);
  }
  if (result.sourcesAdded.length > 0) {
    console.log(`  ${chalk.green("+")} Sources: ${result.sourcesAdded.join(", ")}`);
  }
  if (result.sourcesSkipped.length > 0) {
    console.log(`  ${chalk.dim("=")} Sources (skipped): ${result.sourcesSkipped.join(", ")}`);
  }
  if (result.skillSourceDirsAdded.length > 0) {
    console.log(`  ${chalk.green("+")} Skill source dirs: ${result.skillSourceDirsAdded.join(", ")}`);
  }
  if (result.skillSourceDirsSkipped.length > 0) {
    console.log(`  ${chalk.dim("=")} Skill source dirs (skipped): ${result.skillSourceDirsSkipped.join(", ")}`);
  }
  if (result.rulesWritten) {
    console.log(`  ${chalk.green("+")} Shared rules written`);
  }
  if (result.rulesSkipped) {
    console.error(`  ${ICON_WARNING} Shared rules skipped (existing file differs — use --no-merge to overwrite)`);
  }
  if (result.commandsWritten.length > 0) {
    console.log(`  ${chalk.green("+")} Commands: ${result.commandsWritten.join(", ")}`);
  }
  if (result.commandsSkipped.length > 0) {
    console.error(`  ${ICON_WARNING} Commands skipped (user-modified): ${result.commandsSkipped.join(", ")}`);
  }

  const totalAdded =
    result.mcpServersAdded.length +
    result.sourcesAdded.length +
    result.skillSourceDirsAdded.length +
    (result.rulesWritten ? 1 : 0) +
    result.commandsWritten.length;
  const totalSkipped =
    result.mcpServersSkipped.length +
    result.sourcesSkipped.length +
    result.skillSourceDirsSkipped.length +
    (result.rulesSkipped ? 1 : 0) +
    result.commandsSkipped.length;
  if (totalAdded === 0 && totalSkipped === 0) {
    console.log(chalk.dim("  No new items to import — everything already exists."));
  }
}
