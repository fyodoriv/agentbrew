import { existsSync, readFileSync } from "node:fs";
import semver from "semver";
import { sync as writeFileSync } from "write-file-atomic";
import { type CatalogMcpServer, loadCatalog } from "../catalog/types.js";
import { logSkipped } from "../core/logger.js";
import { AGENT_DEFINITIONS, type AgentConfig } from "../types.js";
import { expandHome } from "../utils.js";
import { readGooseYaml, readMcpJson, readToml, writeGooseYaml, writeMcpJson } from "./mcp.js";

/** `pkg@1.2.3` or `@scope/pkg@1.2.3-rc.1`: an npm package pinned to an exact version. */
const EXACT_VERSION_ARG = /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i;

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
  /** The exact version the catalog pins, for example 0.10.2. */
  version: string;
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
  return pinsFromCatalog(catalog.mcp_servers);
}

/**
 * The pin policy is catalog data: a stdio server whose catalog args name an
 * npm package at an exact version (`tasks-mcp@0.10.2`) is pinned, and the
 * sweep rewrites floating copies (`tasks-mcp`, `tasks-mcp@latest`) and exact
 * pins older than the catalog's to it. Newer exact pins, ranges (`^0.5.0`),
 * and tags (`@next`) are left alone on purpose.
 */
export function pinsFromCatalog(servers: CatalogMcpServer[]): CatalogPin[] {
  return servers.flatMap((server) => {
    if (!server.command || !server.args) return [];
    const pinned = server.args.map((arg) => EXACT_VERSION_ARG.exec(arg)).find((match) => match !== null);
    return pinned
      ? [
          {
            serverName: server.name,
            command: server.command,
            args: server.args,
            packageName: pinned[1],
            version: pinned[0].slice(pinned[1].length + 1),
          },
        ]
      : [];
  });
}

/**
 * True when `arg` runs the pinned package at a version the sweep must raise:
 * floating (`tasks-mcp`, `tasks-mcp@latest`) or an exact version older than
 * the catalog's. A newer exact version is the user's choice and stays.
 */
function argNeedsPin(arg: string, pin: CatalogPin): boolean {
  if (arg === pin.packageName || arg === `${pin.packageName}@latest`) return true;
  if (!arg.startsWith(`${pin.packageName}@`)) return false;
  const version = arg.slice(pin.packageName.length + 1);
  return semver.valid(version) !== null && semver.lt(version, pin.version);
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
  return shape.command === pin.command && shape.args.some((arg) => argNeedsPin(arg, pin));
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
      new RegExp(`"(${escapeRegExp(pin.packageName)}(?:@[^"]*)?)"`, "g"),
      (quoted: string, arg: string) => (argNeedsPin(arg, pin) ? `"${pin.args.at(-1) ?? pin.packageName}"` : quoted),
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
