import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getLogDir } from "../sync/scheduler-paths.js";
import { logSkipped } from "./logger.js";

/**
 * Content-free event log: one JSON line per sync, scheduled repair, or error.
 * docs/observability.md lists every event and field; scripts/metrics.sh reads it.
 *
 * Privacy: only allow-listed fields are written. String fields must match a
 * strict enum-like pattern, so no path, server name, message, or other free
 * text can reach the file. Nothing leaves the machine (no telemetry).
 *
 * Lifecycle: the file is append-only, owned by the user's home
 * (~/.local/share/agentbrew/logs/events.jsonl, or AGENTBREW_EVENTS_FILE).
 * AGENTBREW_EVENTS=0 turns it off; vitest.config.ts sets that for every test.
 */

/** Event names. Add one here and in docs/observability.md together. */
export type EventName = "sync" | "repair" | "error";

export interface AgentbrewEvent {
  event: EventName;
  /** User story the event proves or breaks, such as "US06". */
  story: string;
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
const ENUM = /^[a-z][a-z0-9-]{0,40}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,40}$/;
const NUMBER_FIELDS = ["ms", "driftBefore", "repaired", "remaining"] as const;

/** Story that each sync module serves (the error-to-story map in docs/observability.md). */
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
  const out: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event: input.event,
    story: STORY.test(input.story) ? input.story : "US08",
    ok: input.ok === true,
  };
  for (const key of NUMBER_FIELDS) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = Math.round(value);
  }
  if (input.types) out.types = [...new Set(input.types.filter((t) => ENUM.test(t)))].sort();
  if (input.code && CODE.test(input.code)) out.code = input.code;
  if (input.module && ENUM.test(input.module)) out.module = input.module;
  return out;
}

/** Append one event. Never throws: a log failure must not break a sync. */
export function recordEvent(input: AgentbrewEvent): void {
  if (!eventsEnabled()) return;
  const file = eventsFilePath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(sanitizeEvent(input))}\n`, "utf-8");
  } catch (e) {
    logSkipped("core/events/appendFileSync", e);
  }
}
