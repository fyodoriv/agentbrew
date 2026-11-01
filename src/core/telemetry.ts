import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getLogDir } from "../sync/scheduler-paths.js";
import { type AgentbrewEvent, eventsFilePath, sanitizeEvent } from "./events.js";
import { logSkipped } from "./logger.js";

/**
 * Field telemetry: sends the content-free event log (core/events.ts) to
 * PostHog EU as anonymous usage counts, so the README Proof section can show
 * real use. Same contract as careerbrew's adapter (careerbrew PR #219).
 *
 * Sends nothing unless a project key is set (AGENTBREW_POSTHOG_KEY, or the
 * macOS Keychain item service "agentbrew", account "posthog_key"), telemetry
 * is on, and DO_NOT_TRACK is unset. Only fields events.ts already allow-lists
 * leave the machine, under a random install id; person profiles and GeoIP are off.
 *
 * Lifecycle: the install id, cursor (lines already sent), and on/off flag live
 * in one file beside the event log (telemetry.json); delete it to reset.
 */

export const DEFAULT_URL = "https://eu.i.posthog.com/batch/";
const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_NAME = /^[a-z][a-z_]{0,31}$/;
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

interface TelemetryState {
  installId: string;
  sent: number;
  enabled: boolean;
  lastSend?: string;
}

export function statePath(): string {
  return process.env.AGENTBREW_TELEMETRY_STATE || join(getLogDir(), "telemetry.json");
}

export function loadState(): TelemetryState {
  try {
    return { enabled: true, sent: 0, ...JSON.parse(readFileSync(statePath(), "utf-8")) } as TelemetryState;
  } catch {
    return { installId: randomUUID().replace(/-/g, ""), sent: 0, enabled: true };
  }
}

function saveState(state: TelemetryState): void {
  mkdirSync(join(statePath(), ".."), { recursive: true });
  writeFileSync(statePath(), `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

/** The project key; "" when none is set. Tests set AGENTBREW_POSTHOG_KEY="" to skip the Keychain. */
export function projectKey(): string {
  if (process.env.AGENTBREW_POSTHOG_KEY !== undefined) return process.env.AGENTBREW_POSTHOG_KEY;
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync("security", ["find-generic-password", "-s", "agentbrew", "-a", "posthog_key", "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function status(): { on: boolean; reason: string; pending: number } {
  const state = loadState();
  const pending = Math.max(0, readLines().length - state.sent);
  if (process.env.DO_NOT_TRACK && process.env.DO_NOT_TRACK !== "0")
    return { on: false, reason: "DO_NOT_TRACK", pending };
  if (!state.enabled) return { on: false, reason: "turned off", pending };
  if (!projectKey()) return { on: false, reason: "no key", pending };
  return { on: true, reason: "on", pending };
}

export function setEnabled(enabled: boolean): void {
  saveState({ ...loadState(), enabled });
}

function readLines(): string[] {
  const file = eventsFilePath();
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

/** Events since the cursor, as a PostHog batch body. Unparseable lines are skipped. */
export function buildBatch(lines: string[], key: string, installId: string, version: string): Record<string, unknown> {
  const batch = [];
  for (const line of lines) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    // Re-apply the event allowlist: a line written by an older or edited log
    // must not carry a path, name, or other content off the machine.
    if (typeof e.event !== "string" || !EVENT_NAME.test(e.event)) continue;
    const { ts: _now, event, ...rest } = sanitizeEvent(e as unknown as AgentbrewEvent);
    const ts = typeof e.ts === "string" && ISO_TS.test(e.ts) ? e.ts : undefined;
    batch.push({
      event: `agentbrew.${String(event)}`,
      distinct_id: installId,
      timestamp: ts,
      properties: { ...rest, app_version: version, $geoip_disable: true, $process_person_profile: false },
    });
  }
  return { api_key: key, batch };
}

export interface SendResult {
  sent: number;
  skipped?: string;
  body?: Record<string, unknown>;
}

/** Send what is pending. With dryRun, return the body and send nothing. Never throws. */
export async function send(
  version: string,
  options: { dryRun?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<SendResult> {
  const st = status();
  const state = loadState();
  const lines = readLines().slice(state.sent);
  const body = buildBatch(lines, options.dryRun ? "<posthog_key>" : projectKey(), state.installId, version);
  if (options.dryRun) return { sent: 0, body };
  if (!st.on) return { sent: 0, skipped: st.reason };
  if (lines.length === 0) return { sent: 0, skipped: "nothing new" };
  try {
    const res = await (options.fetchImpl ?? fetch)(process.env.AGENTBREW_TELEMETRY_URL || DEFAULT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { sent: 0, skipped: `http ${res.status}` };
  } catch (e) {
    logSkipped("core/telemetry/send", e);
    return { sent: 0, skipped: "network" };
  }
  saveState({ ...state, sent: state.sent + lines.length, lastSend: new Date().toISOString() });
  return { sent: lines.length };
}

/** Send at most once a day; for the sync path. Never throws. */
export async function sendDaily(version: string, now = Date.now()): Promise<void> {
  const last = Date.parse(loadState().lastSend ?? "");
  if (Number.isFinite(last) && now - last < DAY_MS) return;
  try {
    await send(version);
  } catch (e) {
    logSkipped("core/telemetry/sendDaily", e);
  }
}
