import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { getLogDir } from "../sync/scheduler-paths.js";
import { type AgentbrewEvent, EVENT_NAMES, eventsFilePath, sanitizeEvent } from "./events.js";
import { logSkipped } from "./logger.js";

/**
 * Field telemetry: sends the content-free event log (core/events.ts) to
 * PostHog EU as anonymous performance numbers (decided 2026-11-09, VISION.md);
 * docs/observability.md § Field telemetry is the privacy doc.
 *
 * The installer asks a loud consent question. Nothing is sent unless the
 * stored answer is "yes", a key is present, and no off switch is set
 * (DO_NOT_TRACK, CI, AGENTBREW_TELEMETRY=0). Only fields events.ts allow-lists
 * leave the machine, under a random install id; person profiles and GeoIP are off.
 *
 * Lifecycle: the install id, cursor (log lines already handled), and the
 * consent answer live in one file beside the event log (telemetry.json, mode
 * 600, owned by the user's home). It survives updates and re-installs. Delete
 * it to reset; the answer is then unset and nothing is sent.
 */

export const DEFAULT_URL = "https://eu.i.posthog.com/batch/";
const PRIVACY_DOC = "https://github.com/fyodoriv/agentbrew/blob/main/docs/observability.md#field-telemetry";
export const QUESTION = "Share anonymous performance numbers? [Y/n] ";
const CHANGE = "Change it any time: agentbrew telemetry on | off";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The automatic send may add at most this much time to a command, over all its requests. */
export const AUTO_TIMEOUT_MS = 3_000;
const MANUAL_TIMEOUT_MS = 10_000;
export const BATCH_SIZE = 500;
/** A send skips events older than the newest BACKLOG_EVENTS or BACKLOG_DAYS, so no old history is uploaded. */
export const BACKLOG_EVENTS = 2_000;
export const BACKLOG_DAYS = 30;

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const DEFAULT_KEY = /^phc_[A-Za-z0-9]+$/;
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]{1,20})?$/;

export type Consent = "yes" | "no";

interface TelemetryState {
  installId: string;
  /** Event log lines already sent or skipped. */
  sent: number;
  /** The answer to the consent question. Absent means unset: nothing is sent. */
  consent?: Consent;
  /** When the answer was given. */
  consentAt?: string;
  /** When a normal command showed the question; it shows only once outside the installer. */
  askedAt?: string;
  lastSend?: string;
  /** Last send attempt, failed or not; the daily gate reads it so a dead network costs one try a day. */
  lastAttempt?: string;
}

export type KeySource = "env" | "keychain" | "default" | "none";

/** Seams for tests; production code passes none. */
export interface TelemetryDeps {
  /** Reads the owner's Keychain override. Tests pass a fake so no test reads the real Keychain. */
  keychain?: () => string;
  defaultKeyFile?: string;
  /** True when a person can answer. Default: stdin, stdout, and stderr are all terminals. */
  interactive?: boolean;
  /** Where the question goes. Default: stderr. */
  write?: (text: string) => void;
  /** Reads one answer line; undefined at end of input. Default: readline on stdin. */
  ask?: (prompt: string) => Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  now?: number;
}

export function statePath(): string {
  return process.env.AGENTBREW_TELEMETRY_STATE || join(getLogDir(), "telemetry.json");
}

/** The committed default key file. It sits beside this module in `src/core/` and beside `cli.js` in `dist/`. */
export function defaultKeyFile(): string {
  return join(import.meta.dirname, "telemetry-default-key.txt");
}

function readLines(): string[] {
  try {
    return readFileSync(eventsFilePath(), "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function isoOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && ISO_TS.test(value) ? value : undefined;
}

function saveState(state: TelemetryState): void {
  mkdirSync(dirname(statePath()), { recursive: true });
  // Temp file plus rename: a crash cannot leave half a file.
  writeFileAtomicSync(statePath(), `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

/**
 * Read the state. No file: a new install. A file that cannot be read as a
 * state: the answer is unset (never "yes"; a readable "no" is kept), and the
 * cursor starts at the end of the log, so nothing old is resent. A state from
 * before the consent question has no answer and is unset too.
 */
export function loadState(): TelemetryState {
  let raw: string;
  try {
    raw = readFileSync(statePath(), "utf-8");
  } catch {
    return { installId: randomUUID().replace(/-/g, ""), sent: 0 };
  }
  let saidNo = false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // `enabled: false` is the old spelling of "no" (`telemetry off` before the consent question).
    saidNo = parsed.consent === "no" || (parsed.consent === undefined && parsed.enabled === false);
    if (
      typeof parsed.installId === "string" &&
      INSTALL_ID.test(parsed.installId) &&
      Number.isInteger(parsed.sent) &&
      (parsed.sent as number) >= 0
    ) {
      const consent: Consent | undefined = saidNo ? "no" : parsed.consent === "yes" ? "yes" : undefined;
      return {
        installId: parsed.installId,
        sent: parsed.sent as number,
        consent,
        consentAt: consent ? isoOrUndefined(parsed.consentAt) : undefined,
        askedAt: isoOrUndefined(parsed.askedAt),
        lastSend: isoOrUndefined(parsed.lastSend),
        lastAttempt: isoOrUndefined(parsed.lastAttempt),
      };
    }
  } catch (e) {
    logSkipped("core/telemetry/loadState", e);
  }
  const fresh: TelemetryState = {
    installId: randomUUID().replace(/-/g, ""),
    sent: readLines().length,
    consent: saidNo ? "no" : undefined,
  };
  try {
    saveState(fresh);
  } catch (e) {
    logSkipped("core/telemetry/resetState", e);
  }
  return fresh;
}

function keychainKey(): string {
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

/** The committed default key; "" when the file is empty, missing, or not one `phc_` key. */
export function defaultKey(file = defaultKeyFile()): string {
  try {
    const text = readFileSync(file, "utf-8").replace(/\r?\n$/, "");
    return DEFAULT_KEY.test(text) ? text : "";
  } catch {
    return "";
  }
}

/**
 * The project key and where it came from: AGENTBREW_POSTHOG_KEY, then the
 * owner's Keychain item (service "agentbrew", account "posthog_key"), then the
 * committed default file. A set but empty env var means "no key" and stops the
 * lookup; tests use that.
 */
export function resolveKey(deps: TelemetryDeps = {}): { key: string; source: KeySource } {
  const fromEnv = process.env.AGENTBREW_POSTHOG_KEY;
  if (fromEnv !== undefined) return { key: fromEnv, source: fromEnv ? "env" : "none" };
  const fromKeychain = (deps.keychain ?? keychainKey)();
  if (fromKeychain) return { key: fromKeychain, source: "keychain" };
  const fromFile = defaultKey(deps.defaultKeyFile);
  return { key: fromFile, source: fromFile ? "default" : "none" };
}

/** The env off switch that is set, if any. Each one blocks every send, whatever the stored answer is. */
function envOff(): "DO_NOT_TRACK" | "CI" | "AGENTBREW_TELEMETRY=0" | undefined {
  if (process.env.DO_NOT_TRACK && process.env.DO_NOT_TRACK !== "0") return "DO_NOT_TRACK";
  if (process.env.AGENTBREW_TELEMETRY === "0") return "AGENTBREW_TELEMETRY=0";
  if (process.env.CI) return "CI";
  return undefined;
}

export interface TelemetryStatus {
  on: boolean;
  reason: string;
  /** The stored answer to the consent question. */
  consent: Consent | "unset";
  consentAt?: string;
  keySource: KeySource;
  pending: number;
  lastSend?: string;
}

function statusOf(state: TelemetryState, lineCount: number, deps: TelemetryDeps): TelemetryStatus & { key: string } {
  const { key, source } = resolveKey(deps);
  const base = {
    key,
    consent: state.consent ?? ("unset" as const),
    consentAt: state.consentAt,
    keySource: source,
    pending: Math.max(0, lineCount - state.sent),
    lastSend: state.lastSend,
  };
  const off = envOff();
  if (off) return { ...base, on: false, reason: off };
  if (state.consent === "no") return { ...base, on: false, reason: "you said no" };
  if (state.consent !== "yes") return { ...base, on: false, reason: "not answered yet" };
  if (!key) return { ...base, on: false, reason: "no key" };
  return { ...base, on: true, reason: "on" };
}

/** On or off, why, the consent answer, where the key comes from (never its value), pending events, last send. */
export function status(deps: TelemetryDeps = {}): TelemetryStatus {
  const { key: _key, ...rest } = statusOf(loadState(), readLines().length, deps);
  return rest;
}

/** Record the answer. `telemetry on` and `telemetry off` call this; so does the question. */
export function setConsent(consent: Consent, now = Date.now()): void {
  saveState({ ...loadState(), consent, consentAt: new Date(now).toISOString() });
}

function machine(version: string): Record<string, unknown> {
  return {
    app_version: VERSION.test(version) ? version : "0.0.0",
    os: process.platform === "darwin" || process.platform === "linux" ? process.platform : "other",
    arch: process.arch === "arm64" || process.arch === "x64" ? process.arch : "other",
    runtime: "ts",
  };
}

/** Log lines as one PostHog batch body. Unparseable lines are skipped. */
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
    if (!e || !(EVENT_NAMES as readonly unknown[]).includes(e.event)) continue;
    const { ts: _now, event, ...rest } = sanitizeEvent(e as unknown as AgentbrewEvent);
    batch.push({
      event: `agentbrew.${String(event)}`,
      distinct_id: installId,
      timestamp: isoOrUndefined(e.ts),
      properties: { ...rest, ...machine(version), $geoip_disable: true, $process_person_profile: false },
    });
  }
  return { api_key: key, batch };
}

/** One real event, exactly as it is sent, for the consent question. */
export function exampleEvent(version: string, installId: string, now = Date.now()): Record<string, unknown> {
  const line = JSON.stringify({
    ts: new Date(now).toISOString(),
    event: "command",
    command: "sync",
    ok: true,
    ms: 1840,
  });
  return (buildBatch([line], "", installId, version).batch as Record<string, unknown>[])[0];
}

/** What is sent, one real example, and the privacy promise. The consent question shows it; so does `telemetry on`. */
export function consentText(version: string, deps: TelemetryDeps = {}): string {
  const bar = "=".repeat(68);
  return [
    "",
    bar,
    "  Help make agentbrew faster: share anonymous performance numbers?",
    bar,
    "",
    "What is sent: the command name, its duration, ok or error, counts,",
    "the agentbrew version, your OS and CPU type, and a random install id.",
    "",
    "One real event, exactly as it is sent:",
    "",
    JSON.stringify(exampleEvent(version, loadState().installId, deps.now), null, 2),
    "",
    "The privacy promise: never a path, file name, host name, user name,",
    "argument, message, or content. No IP-based location. No person profile.",
    "The code that enforces this is src/core/events.ts and src/core/telemetry.ts; see",
    PRIVACY_DOC,
    "",
    "Where the numbers go: PostHog EU, for a public speed dashboard.",
    "Change your answer any time: agentbrew telemetry off  /  agentbrew telemetry on",
    "",
  ].join("\n");
}

async function readAnswer(prompt: string): Promise<string | undefined> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const closed = new Promise<undefined>((resolve) => rl.once("close", () => resolve(undefined)));
    return await Promise.race([rl.question(prompt), closed]);
  } finally {
    rl.close();
  }
}

function canAsk(deps: TelemetryDeps): boolean {
  if (process.env.CI) return false;
  return deps.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY);
}

export interface AskResult {
  consent: Consent | "unset";
  /** True when the question was shown now. */
  asked: boolean;
  /** One line that says the result and how to change it. */
  line: string;
}

/**
 * The consent question. `install: true` is the installer (`agentbrew telemetry
 * ask`): an opt-out env var records "no" without a prompt. An answer that is
 * already stored is never asked again and never changed. With no terminal, or
 * with CI set, nothing is asked and the answer stays unset. Enter or y is
 * "yes"; n is "no"; end of input leaves it unset.
 */
export async function askConsent(
  version: string,
  deps: TelemetryDeps & { install?: boolean } = {},
): Promise<AskResult> {
  const state = loadState();
  if (state.consent) {
    const word = state.consent === "yes" ? "on (you said yes)" : "off (you said no)";
    return { consent: state.consent, asked: false, line: `Telemetry stays ${word}. ${CHANGE}` };
  }
  const off = envOff();
  if (off && off !== "CI") {
    if (deps.install) setConsent("no", deps.now);
    return {
      consent: deps.install ? "no" : "unset",
      asked: false,
      line: `Telemetry is off (${off}). Nothing is sent. ${CHANGE}`,
    };
  }
  if (!canAsk(deps)) {
    return {
      consent: "unset",
      asked: false,
      line: `Telemetry: not asked (no terminal). Nothing is sent until you say yes. ${CHANGE}`,
    };
  }
  const write = deps.write ?? ((text: string) => process.stderr.write(text));
  write(`${consentText(version, deps)}\n`);
  // Outside the installer the question shows once; an unanswered one is not repeated.
  if (!deps.install) saveState({ ...state, askedAt: new Date(deps.now ?? Date.now()).toISOString() });
  const answer = await readYesNo(deps, write);
  if (!answer) return { consent: "unset", asked: true, line: `No answer. Nothing is sent. ${CHANGE}` };
  setConsent(answer, deps.now);
  const line = answer === "yes" ? "Thank you. Telemetry is on." : "Telemetry is off. Nothing is sent.";
  return { consent: answer, asked: true, line: `${line} ${CHANGE}` };
}

/** Enter or y is "yes"; n is "no"; an unclear answer asks again; end of input is no answer. */
async function readYesNo(deps: TelemetryDeps, write: (text: string) => void): Promise<Consent | undefined> {
  for (let tries = 0; tries < 3; tries += 1) {
    const answer = (await (deps.ask ?? readAnswer)(QUESTION))?.trim().toLowerCase();
    if (answer === undefined) return undefined;
    if (["", "y", "yes"].includes(answer)) return "yes";
    if (["n", "no"].includes(answer)) return "no";
    write("Please answer y or n.\n");
  }
  return undefined;
}

/**
 * After a normal command: ask the consent question once, when it was never
 * answered or shown, a person is at the terminal, and telemetry could be on.
 * Silent in a pipe, hook, scheduler, or agent run. Never throws.
 */
export async function askOnFirstRun(version: string, deps: TelemetryDeps = {}): Promise<void> {
  try {
    // The installer turns this path off (AGENTBREW_TELEMETRY_ASK): it asks the question itself, last.
    if (!canAsk(deps) || envOff() || process.env.AGENTBREW_TELEMETRY_ASK === "0") return;
    const state = loadState();
    if (state.consent || state.askedAt || !resolveKey(deps).key) return;
    const result = await askConsent(version, deps);
    (deps.write ?? ((text: string) => process.stderr.write(text)))(`${result.line}\n`);
  } catch (e) {
    logSkipped("core/telemetry/askOnFirstRun", e);
  }
}

/** Where a send starts: past what was sent, past a truncated log's end, and past the backlog cap. */
function startCursor(lines: string[], sent: number, now: number): number {
  let cursor = Math.max(Math.min(sent, lines.length), lines.length - BACKLOG_EVENTS);
  const oldest = now - BACKLOG_DAYS * DAY_MS;
  for (; cursor < lines.length; cursor += 1) {
    let ts = Number.NaN;
    try {
      ts = Date.parse(String((JSON.parse(lines[cursor]) as { ts?: unknown }).ts));
    } catch {
      // An unreadable line is skipped like an old one.
    }
    if (Number.isFinite(ts) && ts >= oldest) break;
  }
  return cursor;
}

export interface SendResult {
  sent: number;
  skipped?: string;
  /** Dry run only: the exact body of the next request, with the key hidden. */
  body?: Record<string, unknown>;
  /** Dry run only: events waiting after the backlog cap. */
  pending?: number;
}

/**
 * Send what is pending, at most BATCH_SIZE events per request. The cursor
 * moves only after a 2xx answer. With dryRun, return the next body and send
 * nothing. `auto` is the after-sync path: one AUTO_TIMEOUT_MS budget for all
 * requests. Never throws.
 */
export async function send(
  version: string,
  options: TelemetryDeps & { dryRun?: boolean; auto?: boolean } = {},
): Promise<SendResult> {
  try {
    const now = options.now ?? Date.now();
    let state = loadState();
    const lines = readLines();
    const cursor = startCursor(lines, state.sent, now);
    if (options.dryRun) {
      const body = buildBatch(lines.slice(cursor, cursor + BATCH_SIZE), "<posthog_key>", state.installId, version);
      return { sent: 0, pending: lines.length - cursor, body };
    }
    const st = statusOf(state, lines.length, options);
    if (!st.on) return { sent: 0, skipped: st.reason };
    state = { ...state, sent: cursor, lastAttempt: new Date(now).toISOString() };
    saveState(state);
    if (cursor >= lines.length) return { sent: 0, skipped: "nothing new" };
    return await postBatches(lines, state, st.key, version, options);
  } catch (e) {
    logSkipped("core/telemetry/send", e);
    return { sent: 0, skipped: "error" };
  }
}

/** Post the lines from the cursor on, one batch per request; save the cursor after each 2xx. */
async function postBatches(
  lines: string[],
  start: TelemetryState,
  key: string,
  version: string,
  options: TelemetryDeps & { auto?: boolean },
): Promise<SendResult> {
  let state = start;
  const autoBudget = options.auto ? AbortSignal.timeout(AUTO_TIMEOUT_MS) : undefined;
  let sent = 0;
  while (state.sent < lines.length) {
    const chunk = lines.slice(state.sent, state.sent + BATCH_SIZE);
    const body = buildBatch(chunk, key, state.installId, version);
    const count = (body.batch as unknown[]).length;
    if (count > 0) {
      let res: Response;
      try {
        res = await (options.fetchImpl ?? fetch)(process.env.AGENTBREW_TELEMETRY_URL || DEFAULT_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: autoBudget ?? AbortSignal.timeout(MANUAL_TIMEOUT_MS),
        });
      } catch (e) {
        logSkipped("core/telemetry/send", e);
        return { sent, skipped: "network" };
      }
      if (!res.ok) return { sent, skipped: `http ${res.status}` };
      state = { ...state, lastSend: new Date().toISOString() };
    }
    sent += count;
    state = { ...state, sent: state.sent + chunk.length };
    saveState(state);
  }
  return { sent };
}

/**
 * The after-sync path: send at most once a day, and only after a "yes".
 * Never throws, and adds at most AUTO_TIMEOUT_MS to the command.
 */
export async function sendDaily(version: string, deps: TelemetryDeps = {}): Promise<void> {
  try {
    if (envOff()) return;
    const state = loadState();
    if (state.consent !== "yes") return;
    const now = deps.now ?? Date.now();
    const last = Date.parse(state.lastAttempt ?? state.lastSend ?? "");
    if (Number.isFinite(last) && Math.abs(now - last) < DAY_MS) return;
    await send(version, { ...deps, auto: true });
  } catch (e) {
    logSkipped("core/telemetry/sendDaily", e);
  }
}
