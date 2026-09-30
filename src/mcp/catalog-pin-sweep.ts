import { existsSync, readFileSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import { loadCatalog } from "../catalog/types.js";
import { logSkipped } from "../core/logger.js";
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";
import { readGooseYaml, readMcpJson, readToml, writeGooseYaml, writeMcpJson } from "./mcp.js";

const PINNED_CATALOG_PACKAGES = new Map([["tasks-mcp", "tasks-mcp"]]);

export interface CatalogPinFinding {
  path: string;
}

export interface CatalogPinFileResult {
  path: string;
  agentName: string;
  fixedCount: number;
  findings: CatalogPinFinding[];
}

export interface CatalogPinSweepOptions {
  dryRun?: boolean;
  detected?: AgentConfig[];
}

interface CatalogPin {
  serverName: string;
  command: string;
  args: string[];
  packageName: string;
}

interface CatalogPinSlice {
  basePath: string;
  pin: CatalogPin;
  replaceArgs(args: string[]): void;
}

interface CatalogCommandShape {
  command: string;
  args: string[];
  replaceArgs(args: string[]): void;
}

interface CatalogPinFormatHandler<T extends Record<string, unknown>> {
  read(path: string): T;
  write(path: string, config: T): void;
  logTag: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function getCatalogPins(): CatalogPin[] {
  const catalog = (() => {
    try {
      return loadCatalog();
    } catch (e) {
      logSkipped("mcp/catalog-pin-sweep/catalog", e);
      return undefined;
    }
  })();
  if (!catalog || !Array.isArray(catalog.mcp_servers)) return [];
  const pins: CatalogPin[] = [];
  for (const [serverName, packageName] of PINNED_CATALOG_PACKAGES) {
    const server = catalog.mcp_servers.find((entry) => entry.name === serverName);
    if (!server?.command || !server.args) continue;
    pins.push({ serverName, command: server.command, args: server.args, packageName });
  }
  return pins;
}

function isFloatingPackageArg(arg: string, packageName: string): boolean {
  return arg === packageName || arg === `${packageName}@latest`;
}

function getCommandShape(entry: Record<string, unknown>): CatalogCommandShape | undefined {
  if (typeof entry.command === "string" && isStringArray(entry.args)) {
    return { command: entry.command, args: entry.args, replaceArgs: (args) => (entry.args = args) };
  }
  if (typeof entry.cmd === "string" && isStringArray(entry.args)) {
    return { command: entry.cmd, args: entry.args, replaceArgs: (args) => (entry.args = args) };
  }
  const command = entry.command;
  if (isStringArray(command) && command.length > 0) {
    return {
      command: command[0],
      args: command.slice(1),
      replaceArgs: (args) => (entry.command = [command[0], ...args]),
    };
  }
  return undefined;
}

function shapeNeedsPin(shape: CatalogCommandShape, pin: CatalogPin): boolean {
  return shape.command === pin.command && shape.args.some((arg) => isFloatingPackageArg(arg, pin.packageName));
}

function matchingPin(
  serverName: string,
  entry: unknown,
  pins: CatalogPin[],
): { pin: CatalogPin; shape: CatalogCommandShape } | undefined {
  if (!isRecord(entry)) return undefined;
  const shape = getCommandShape(entry);
  if (!shape) return undefined;
  const pin = pins.find(
    (candidate) =>
      (serverName === candidate.serverName || shapeNeedsPin(shape, candidate)) && shapeNeedsPin(shape, candidate),
  );
  return pin ? { pin, shape } : undefined;
}

function collectServerSlices(servers: unknown, basePath: string, pins: CatalogPin[], slices: CatalogPinSlice[]): void {
  if (!isRecord(servers)) return;
  for (const [serverName, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue;
    const match = matchingPin(serverName, entry, pins);
    if (match)
      slices.push({ basePath: `${basePath}.${serverName}`, pin: match.pin, replaceArgs: match.shape.replaceArgs });
  }
}

function collectCatalogPinSlices(
  config: Record<string, unknown>,
  mcpKey: string,
  pins: CatalogPin[],
): CatalogPinSlice[] {
  const slices: CatalogPinSlice[] = [];
  collectServerSlices(config[mcpKey], mcpKey, pins, slices);
  const projects = config.projects;
  if (!isRecord(projects)) return slices;
  for (const [projectPath, projectConfig] of Object.entries(projects)) {
    if (!isRecord(projectConfig)) continue;
    collectServerSlices(projectConfig[mcpKey], `projects.${projectPath}.${mcpKey}`, pins, slices);
  }
  return slices;
}

export function sweepOneJsonConfigForCatalogPins(
  path: string,
  mcpKey: string,
  dryRun: boolean,
): { fixedCount: number; findings: CatalogPinFinding[] } {
  return sweepOneObjectConfigForCatalogPins(path, mcpKey, dryRun, JSON_HANDLER);
}

export function sweepOneYamlConfigForCatalogPins(
  path: string,
  mcpKey: string,
  dryRun: boolean,
): { fixedCount: number; findings: CatalogPinFinding[] } {
  return sweepOneObjectConfigForCatalogPins(path, mcpKey, dryRun, YAML_HANDLER);
}

function sweepOneObjectConfigForCatalogPins<T extends Record<string, unknown>>(
  path: string,
  mcpKey: string,
  dryRun: boolean,
  handler: CatalogPinFormatHandler<T>,
): { fixedCount: number; findings: CatalogPinFinding[] } {
  if (!existsSync(path)) return { fixedCount: 0, findings: [] };
  const pins = getCatalogPins();
  if (pins.length === 0) return { fixedCount: 0, findings: [] };
  let config: T;
  try {
    config = handler.read(path);
  } catch (e) {
    logSkipped(`${handler.logTag}/read`, e);
    return { fixedCount: 0, findings: [] };
  }
  const slices = collectCatalogPinSlices(config, mcpKey, pins);
  const findings = slices.map((slice) => ({ path: slice.basePath }));
  if (findings.length === 0 || dryRun) return { fixedCount: 0, findings };

  for (const slice of slices) {
    slice.replaceArgs([...slice.pin.args]);
  }
  try {
    handler.write(path, config);
    return { fixedCount: findings.length, findings };
  } catch (e) {
    logSkipped(`${handler.logTag}/write`, e);
    return { fixedCount: 0, findings };
  }
}

const JSON_HANDLER: CatalogPinFormatHandler<Record<string, unknown>> = {
  read: (path) => ({ ...readMcpJson(path) }),
  write: writeMcpJson,
  logTag: "mcp/catalog-pin-sweep/json",
};

const YAML_HANDLER: CatalogPinFormatHandler<Record<string, unknown>> = {
  read: (path) => ({ ...readGooseYaml(path) }),
  write: writeGooseYaml,
  logTag: "mcp/catalog-pin-sweep/yaml",
};

export function sweepOneTomlConfigForCatalogPins(
  path: string,
  mcpKey: string,
  dryRun: boolean,
): { fixedCount: number; findings: CatalogPinFinding[] } {
  if (!existsSync(path)) return { fixedCount: 0, findings: [] };
  const pins = getCatalogPins();
  const pin = pins.find((entry) => entry.serverName === "tasks-mcp");
  if (!pin) return { fixedCount: 0, findings: [] };
  const parsed = readToml(path);
  const slices = collectCatalogPinSlices(parsed, mcpKey, [pin]);
  const findings = slices.map((slice) => ({ path: slice.basePath }));
  if (findings.length === 0 || dryRun) return { fixedCount: 0, findings };
  try {
    const before = readFileSync(path, "utf-8");
    const after = replaceTomlServerArg(before, mcpKey, pin);
    if (after === before) return { fixedCount: 0, findings };
    writeFileSync(path, after, "utf-8");
    return { fixedCount: findings.length, findings };
  } catch (e) {
    logSkipped("mcp/catalog-pin-sweep/toml/write", e);
    return { fixedCount: 0, findings };
  }
}

function replaceTomlServerArg(content: string, mcpKey: string, pin: CatalogPin): string {
  const blockPattern = new RegExp(
    `(^\\[${escapeRegExp(mcpKey)}\\.(?:"${escapeRegExp(pin.serverName)}"|${escapeRegExp(pin.serverName)})\\]\\s*$)([\\s\\S]*?)(?=^\\[|(?![\\s\\S]))`,
    "m",
  );
  return content.replace(blockPattern, (_match, header: string, body: string) => {
    if (!new RegExp(`^command\\s*=\\s*"${escapeRegExp(pin.command)}"\\s*$`, "m").test(body)) return `${header}${body}`;
    const nextBody = body.replace(
      new RegExp(`"(${escapeRegExp(pin.packageName)}(?:@latest)?)"`, "g"),
      `"${pin.args.at(-1) ?? pin.packageName}"`,
    );
    return `${header}${nextBody}`;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sweepCatalogPins(options: CatalogPinSweepOptions = {}): CatalogPinFileResult[] {
  const { dryRun = false, detected } = options;
  const detectedNames = detected
    ? new Set(detected.filter((agent) => agent.detected).map((agent) => agent.name))
    : undefined;
  const results: CatalogPinFileResult[] = [];
  for (const agent of AGENT_DEFINITIONS) {
    if (!agent.mcpConfig) continue;
    if (detectedNames && !detectedNames.has(agent.name)) continue;
    const path = expandHome(agent.mcpConfig);
    const mcpKey = agent.mcpKey ?? "mcpServers";
    const sweepFn = pickCatalogPinSweepFn(agent.mcpFormat);
    if (!sweepFn) continue;
    const { fixedCount, findings } = sweepFn(path, mcpKey, dryRun);
    if (findings.length === 0) continue;
    results.push({ path, agentName: agent.name, fixedCount, findings });
  }
  return results;
}

function pickCatalogPinSweepFn(
  format: AgentConfig["mcpFormat"],
):
  | ((path: string, mcpKey: string, dryRun: boolean) => { fixedCount: number; findings: CatalogPinFinding[] })
  | undefined {
  switch (format ?? "json") {
    case "yaml":
      return sweepOneYamlConfigForCatalogPins;
    case "toml":
      return sweepOneTomlConfigForCatalogPins;
    default:
      return sweepOneJsonConfigForCatalogPins;
  }
}
