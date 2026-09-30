import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { SYNC_ERRORS_PATH } from "../paths.js";
import { expandHome } from "../utils.js";
import { logSkipped } from "./logger.js";

/** Base error for all agentbrew operations. */
export class AgentBrewError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentBrewError";
    this.code = code;
  }
}

/** Error during sync operations (MCP, rules, commands, skills, instructions). */
export class SyncError extends AgentBrewError {
  readonly module: string;
  readonly agent?: string;

  constructor(module: string, message: string, options?: { agent?: string; cause?: unknown }) {
    super("SYNC_ERROR", `[${module}] ${message}`, { cause: options?.cause });
    this.name = "SyncError";
    this.module = module;
    this.agent = options?.agent;
  }
}

/** Error reading or writing config files (state.yaml, MCP configs, etc.). */
export class ConfigError extends AgentBrewError {
  readonly filePath: string;

  constructor(filePath: string, message: string, options?: { cause?: unknown }) {
    super("CONFIG_ERROR", `${filePath}: ${message}`, { cause: options?.cause });
    this.name = "ConfigError";
    this.filePath = filePath;
  }
}

/** Error in agent adapter operations (read/write MCP config in various formats). */
export class AdapterError extends AgentBrewError {
  readonly agent: string;
  readonly format: string;

  constructor(agent: string, format: string, message: string, options?: { cause?: unknown }) {
    super("ADAPTER_ERROR", `[${agent}/${format}] ${message}`, { cause: options?.cause });
    this.name = "AdapterError";
    this.agent = agent;
    this.format = format;
  }
}

/** Collects errors during a sync run without aborting. */
export class SyncErrorCollector {
  readonly errors: AgentBrewError[] = [];

  add(error: AgentBrewError): void {
    this.errors.push(error);
  }

  get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  get count(): number {
    return this.errors.length;
  }

  /** Format errors for display. */
  summary(): string {
    if (this.errors.length === 0) return "No errors";
    return this.errors.map((error) => `  • ${error.message}`).join("\n");
  }
}

/** Extract a useful message from an unknown caught value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

// ---------------------------------------------------------------------------
// Sync error log — persists last sync errors to disk
// ---------------------------------------------------------------------------

interface SyncErrorEntry {
  timestamp: string;
  code: string;
  message: string;
  module?: string;
  agent?: string;
}

interface SyncErrorLog {
  lastSyncAt: string;
  errors: SyncErrorEntry[];
}

function getErrorLogPath(): string {
  return expandHome(SYNC_ERRORS_PATH);
}

/** Best-effort write of a sync error log to disk. */
function writeSyncErrorLog(log: SyncErrorLog): void {
  const logPath = getErrorLogPath();
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    writeFileAtomicSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  } catch (e) {
    logSkipped("core/errors/writeFileAtomicSync", e);
    // Best effort — don't fail sync because of error logging
  }
}

export function saveSyncErrors(collector: SyncErrorCollector): void {
  writeSyncErrorLog({
    lastSyncAt: new Date().toISOString(),
    errors: collector.errors.map((error) => ({
      timestamp: new Date().toISOString(),
      code: error.code,
      message: error.message,
      module: error instanceof SyncError ? error.module : undefined,
      agent: error instanceof SyncError ? error.agent : undefined,
    })),
  });
}

export function clearSyncErrors(): void {
  writeSyncErrorLog({
    lastSyncAt: new Date().toISOString(),
    errors: [],
  });
}

export function loadSyncErrors(): SyncErrorLog | undefined {
  const logPath = getErrorLogPath();
  if (!existsSync(logPath)) return undefined;

  try {
    const content = readFileSync(logPath, "utf-8");
    return JSON.parse(content) as SyncErrorLog;
  } catch (e) {
    logSkipped("core/errors/parse", e);
    return undefined;
  }
}
