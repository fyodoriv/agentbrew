import { appendFileSync, closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { getLogDir } from "../sync/scheduler-paths.js";
import { logSkipped } from "./logger.js";

/**
 * Content-free event log: one JSON line per command, sync, scheduled repair, or error.
 * docs/observability.md lists every event and field; scripts/metrics.sh reads it.
 *
 * Privacy: only allow-listed fields are written. A string field is kept only
 * when its value is in a fixed list of known names, so no path, server name,
 * message, or other free text can reach the file. core/telemetry.ts sends these lines as anonymous
 * performance numbers, only after the user said yes to the consent question.
 *
 * Lifecycle: the file is append-only, owned by the user's home
 * (~/.local/share/agentbrew/logs/events.jsonl, or AGENTBREW_EVENTS_FILE).
 * AGENTBREW_EVENTS=0 turns it off; vitest.config.ts sets that for every test.
 */

/** Event names. Add one here and in docs/observability.md together. */
export const EVENT_NAMES = ["sync", "repair", "error", "command"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export interface AgentbrewEvent {
  event: EventName;
  /** User story the event proves or breaks, such as "US06". A `command` event may have none. */
  story?: string;
  /** Top-level command name, from COMMAND_NAMES. Never an argument. */
  command?: string;
  ok: boolean;
  ms?: number;
  /** Drift items found before a repair. */
  driftBefore?: number;
  /** Drift items a repair cleared. */
  repaired?: number;
  /** Drift items left after a repair. */
  remaining?: number;
  /** Drift types left after a repair (enum names from DriftItem["type"]). */
  types?: string[];
  /** Error code, such as "SYNC_ERROR". */
  code?: string;
  /** Sync module that failed, such as "mcp". */
  module?: string;
}

const STORY = /^US\d{2}$/;
const NUMBER_FIELDS = ["ms", "driftBefore", "repaired", "remaining"] as const;

/**
 * Story that each sync module serves (the error-to-story map in docs/observability.md).
 * Its keys are every sync module name; a `module` is kept only when it is one of them.
 */
const MODULE_STORY: Readonly<Record<string, string>> = {
  mcp: "US03",
  rules: "US04",
  instructions: "US04",
  commands: "US05",
  skills: "US02",
  agents: "US20",
  hooks: "US21",
  models: "US16",
};

/**
 * Story that each top-level command serves. `sync` and `fix` log their own
 * events, and commands without a story (for example `metrics`) log nothing.
 */
const COMMAND_STORY: Readonly<Record<string, string>> = {
  init: "US01",
  install: "US02",
  mcp: "US03",
  setup: "US03",
  rules: "US04",
  commands: "US05",
  "auto-sync": "US06",
  upgrade: "US08",
  import: "US11",
  remove: "US12",
  skills: "US13",
  agentfile: "US16",
  lint: "US18",
  export: "US19",
  agents: "US20",
  completions: "US21",
  hooks: "US21",
  hook: "US21",
  lock: "US22",
  catalog: "US24",
  status: "US25",
  team: "US27",
  memory: "US29",
};

/**
 * Every top-level command, plus "agentbrew" for the bare start command. A
 * `command` event keeps its name only when it is in this list, so no typed
 * word can reach the log. src/action-parity.test.ts fails when a command is missing.
 */
export const COMMAND_NAMES: ReadonlySet<string> = new Set([
  "agentbrew",
  "actions",
  "agentfile",
  "agents",
  "audit-skills",
  "auto-sync",
  "bootstrap",
  "catalog",
  "checkup-run",
  "classify",
  "commands",
  "completions",
  "config",
  "contribute",
  "env",
  "export",
  "fix",
  "hook",
  "hooks",
  "import",
  "init",
  "install",
  "lint",
  "lock",
  "mcp",
  "measure",
  "memory",
  "metrics",
  "plugin",
  "remove",
  "report",
  "rules",
  "setup",
  "skills",
  "status",
  "sync",
  "team",
  "telemetry",
  "upgrade",
]);

/**
 * Every drift type (DriftItem["type"] in src/drift-checks/types.ts). A `types`
 * entry is kept only when it is in this list. src/core/events.test.ts fails
 * when the two lists differ.
 */
export const DRIFT_TYPES: ReadonlySet<string> = new Set([
  "agents",
  "claude-desktop-mcp",
  "claude-plugin",
  "retired-mod",
  "cli-build",
  "env-hygiene",
  "organization-overlay",
  "mcp",
  "mcp-bare-placeholder",
  "mcp-catalog-pin",
  "mcp-env-vars",
  "mcp-playwright-isolated",
  "mcp-stale",
  "mcp-permissions",
  "mcp-user-added",
  "models",
  "rules",
  "rules-source",
  "skills",
  "skills-user-added",
  "statusline-user-added",
  "skill-validity",
  "commands",
  "commands-user-added",
  "hooks",
  "instructions",
  "launchagent",
  "memory-launchagent",
]);

/** Every error code the CLI records. A `code` is kept only when it is in this list. */
export const ERROR_CODES: ReadonlySet<string> = new Set([
  "SYNC_ERROR",
  "CONFIG_ERROR",
  "ADAPTER_ERROR",
  "INVALID_MCP",
  "UNEXPECTED",
]);

const MODULE_NAMES: ReadonlySet<string> = new Set(Object.keys(MODULE_STORY));

export function storyForCommand(command: string): string | undefined {
  return COMMAND_STORY[command];
}

export function storyForModule(module: string | undefined): string {
  return (module && MODULE_STORY[module]) || "US08";
}

export function eventsEnabled(): boolean {
  return process.env.AGENTBREW_EVENTS !== "0";
}

export function eventsFilePath(): string {
  return process.env.AGENTBREW_EVENTS_FILE || join(getLogDir(), "events.jsonl");
}

/** Keep only allow-listed fields with safe values. Exported for tests. */
export function sanitizeEvent(input: AgentbrewEvent): Record<string, unknown> {
  const out: Record<string, unknown> = { ts: new Date().toISOString(), event: input.event };
  const story = typeof input.story === "string" && STORY.test(input.story) ? input.story : undefined;
  // Only a `command` event may have no story: most commands serve none.
  if (story || input.event !== "command") out.story = story ?? "US08";
  out.ok = input.ok === true;
  if (typeof input.command === "string" && COMMAND_NAMES.has(input.command)) out.command = input.command;
  for (const key of NUMBER_FIELDS) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  }
  // Names come from fixed lists, never from a pattern: an edited log line cannot send a word of its own.
  const known = (v: unknown, names: { has(name: string): boolean }): v is string =>
    typeof v === "string" && names.has(v);
  if (Array.isArray(input.types)) out.types = [...new Set(input.types.filter((t) => known(t, DRIFT_TYPES)))].sort();
  if (known(input.code, ERROR_CODES)) out.code = input.code;
  if (known(input.module, MODULE_NAMES)) out.module = input.module;
  return out;
}

/**
 * The log's size cap. A log over MAX_LOG_BYTES is cut to the whole lines in
 * its newest KEEP_LOG_BYTES, so it never grows without limit. The kept part
 * holds more than a week of normal use and more than one telemetry backlog.
 */
export const MAX_LOG_BYTES = 2 * 1024 * 1024;
export const KEEP_LOG_BYTES = 1024 * 1024;

/** Cut a log that passed the cap. Reads only the tail; a temp file plus rename replaces the log whole. */
function trimLog(file: string): void {
  const { size } = statSync(file);
  if (size <= MAX_LOG_BYTES) return;
  const tail = Buffer.alloc(KEEP_LOG_BYTES);
  const fd = openSync(file, "r");
  let read = 0;
  try {
    read = readSync(fd, tail, 0, KEEP_LOG_BYTES, size - KEEP_LOG_BYTES);
  } finally {
    closeSync(fd);
  }
  const text = tail.toString("utf-8", 0, read);
  // The first line is cut in the middle: drop it.
  writeFileAtomicSync(file, text.slice(text.indexOf("\n") + 1));
}

/** Append one event, then trim a log that passed the cap. Never throws: a log failure must not break a sync. */
export function recordEvent(input: AgentbrewEvent): void {
  if (!eventsEnabled()) return;
  const file = eventsFilePath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(sanitizeEvent(input))}\n`, "utf-8");
    trimLog(file);
  } catch (e) {
    logSkipped("core/events/appendFileSync", e);
  }
}
