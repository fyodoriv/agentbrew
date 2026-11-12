import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { getLogDir } from "../sync/scheduler-paths.js";
import { type AgentbrewEvent, EVENT_NAMES, eventsFilePath, sanitizeEvent } from "./events.js";
import { logSkipped } from "./logger.js";
import {
  deliver,
  dryRunBody,
  type ErrorCursors,
  errorLogEnds,
  errorObjects,
  hecEvents,
  isOrgSink,
  readErrorLines,
  readSinkPolicy,
  resolveToken,
  type SinkPolicy,
  type SinkRead,
  type SinkStatus,
  sinkDestination,
  sinkFingerprint,
  sinkStatus,
} from "./telemetry-sink.js";

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
/** The installer's question: Enter counts as yes. */
export const QUESTION = "Share anonymous performance numbers? [Y/n] ";
/** The question after a normal command: only a typed y or n counts. */
export const QUESTION_EXPLICIT = "Share anonymous performance numbers? [y/n] ";
const CHANGE = "Change it any time: agentbrew telemetry on | off";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The automatic send may add at most this much time to a command, over all its requests. */
export const AUTO_TIMEOUT_MS = 3_000;
const MANUAL_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 1_000;
export const BATCH_SIZE = 500;
/** A send skips events older than the newest BACKLOG_EVENTS or BACKLOG_DAYS, so no old history is uploaded. */
export const BACKLOG_EVENTS = 2_000;
export const BACKLOG_DAYS = 30;

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const INSTALL_ID = /^[0-9a-f]{32}$/;
/** A PostHog project key. A key from any source that does not match is no key. */
const KEY = /^phc_[A-Za-z0-9]+$/;
/** A send lock older than this was left by a dead process. */
const LOCK_STALE_MS = 60_000;
/**
 * The question lock is stale after this long. Longer than the send lock: a
 * person may take a while to answer. Shorter than the daily ask limit, so a
 * lock that a crash left never hides the question for a day.
 */
const QUESTION_LOCK_STALE_MS = 10 * 60 * 1000;
/** After a command starts the detached daily send, no command starts a second one for this long. */
const AUTO_START_GAP_MS = 60_000;
/** A log line is far shorter than this; a longer mark in the state file is dropped. */
const MARK_MAX = 4_000;
/** A released package version. A local suffix (a commit, a word) does not match, so it is never sent. */
const VERSION = /^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d{1,3})?$/;
/** Outside the installer the question shows at most this many times; then only `agentbrew telemetry ask` shows it. */
export const MAX_ASKS = 3;
/** Commands that never show the question: their output is read by a program. */
const QUIET_COMMANDS: ReadonlySet<string> = new Set(["telemetry", "completions", "hook"]);
const QUIET_FLAGS: ReadonlySet<string> = new Set(["--json", "--version", "-V", "--help", "-h"]);

export type Consent = "yes" | "no";

interface TelemetryState {
  installId: string;
  /** Event log lines already sent or skipped. */
  sent: number;
  /** The text of the last handled line. It finds the cursor again after the log is trimmed. */
  mark?: string;
  /** The answer to the consent question. Absent means unset: nothing is sent. */
  consent?: Consent;
  /** When the answer was given. */
  consentAt?: string;
  /** When a normal command last showed the question; it shows at most once a day outside the installer. */
  askedAt?: string;
  /** How many times a normal command showed the question; it stops at MAX_ASKS. */
  askCount?: number;
  /** When the Keychain last had no key; it is not asked again for a day. */
  keychainMissAt?: string;
  lastSend?: string;
  /** Last send attempt, failed or not; the daily gate reads it so a dead network costs one try a day. */
  lastAttempt?: string;
  /** When a command last started the detached daily send. That send writes `lastAttempt` when it ends. */
  autoStartAt?: string;
  /** The destination the cursor belongs to (telemetry-sink.ts `sinkFingerprint`); absent means the public default. */
  sinkFp?: string;
  /** Error log forwarding: byte offset per file. Absent until the first send with `error_logs` on. */
  errCursors?: ErrorCursors;
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
  /** Throws away input typed before the question. Default: drainInput on stdin (nothing when `ask` is a fake). */
  drain?: () => Promise<void>;
  fetchImpl?: typeof fetch;
  now?: number;
  /** Internal: the due check of the command that starts the send (claimDailySend). */
  claim?: boolean;
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

/** The cursor as state fields: how many lines are handled, and the text of the last one. */
function cursorAt(lines: string[], sent: number): Pick<TelemetryState, "sent" | "mark"> {
  return { sent, mark: sent > 0 ? lines[sent - 1] : undefined };
}

function lineTime(line: string): number {
  try {
    return Date.parse(String((JSON.parse(line) as { ts?: unknown }).ts));
  } catch {
    return Number.NaN;
  }
}

/**
 * How many lines of the log, as it is now, are handled. events.ts trims old
 * lines from the start of the log, so the stored count can be too high. The
 * mark finds the place again: the same line, or, when the trim removed it,
 * the first line with a later time. A state with no mark keeps the count.
 * A mark that has no readable time gives no place to start from: all of the
 * log counts as handled, so some events are skipped and none is sent twice.
 */
function handled(lines: string[], state: TelemetryState): number {
  const sent = Math.min(state.sent, lines.length);
  if (state.mark === undefined || lines[state.sent - 1] === state.mark) return sent;
  const at = lines.lastIndexOf(state.mark);
  if (at >= 0) return at + 1;
  const markTime = lineTime(state.mark);
  if (!Number.isFinite(markTime)) return lines.length;
  const next = lines.findIndex((line) => lineTime(line) > markTime);
  return next < 0 ? lines.length : next;
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
 * Re-read the state, change some fields, save it. Code that runs for a while
 * (a send, the question) writes only through this, so it never writes back a
 * consent answer that another process changed in the meantime.
 */
function patchState(patch: Partial<TelemetryState>): TelemetryState {
  const next = { ...loadState(), ...patch };
  saveState(next);
  return next;
}

/** True when the ISO time is less than a day from now. */
function withinDay(ts: string | undefined, now: number): boolean {
  const t = Date.parse(ts ?? "");
  return Number.isFinite(t) && Math.abs(now - t) < DAY_MS;
}

/**
 * Read the state. No file: a new install, with the cursor at the end of the
 * log. A file that cannot be read as a state: the answer is unset (never
 * "yes"; a readable "no" is kept), and the cursor starts at the end of the
 * log too, so nothing old is sent. A state from before the consent question
 * has no answer and is unset.
 */
export function loadState(): TelemetryState {
  let raw: string;
  try {
    raw = readFileSync(statePath(), "utf-8");
  } catch {
    const lines = readLines();
    return { installId: randomUUID().replace(/-/g, ""), ...cursorAt(lines, lines.length) };
  }
  let saidNo = false;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // `enabled: false` is the old spelling of "no" (`telemetry off` before the consent question).
    saidNo = parsed.consent === "no" || (parsed.consent === undefined && parsed.enabled === false);
    const state = readState(parsed, saidNo);
    if (state) return state;
  } catch (e) {
    logSkipped("core/telemetry/loadState", e);
  }
  const lines = readLines();
  const fresh: TelemetryState = {
    installId: randomUUID().replace(/-/g, ""),
    ...cursorAt(lines, lines.length),
    consent: saidNo ? "no" : undefined,
  };
  try {
    saveState(fresh);
  } catch (e) {
    logSkipped("core/telemetry/resetState", e);
  }
  return fresh;
}

/** The parsed file as a state, or undefined when its id or cursor is not valid. */
function readState(parsed: Record<string, unknown>, saidNo: boolean): TelemetryState | undefined {
  const { installId, sent, askCount, mark } = parsed;
  if (typeof installId !== "string" || !INSTALL_ID.test(installId)) return undefined;
  if (typeof sent !== "number" || !Number.isInteger(sent) || sent < 0) return undefined;
  const consent: Consent | undefined = saidNo ? "no" : parsed.consent === "yes" ? "yes" : undefined;
  return {
    installId,
    sent,
    mark: typeof mark === "string" && mark.length <= MARK_MAX ? mark : undefined,
    consent,
    consentAt: consent ? isoOrUndefined(parsed.consentAt) : undefined,
    askedAt: isoOrUndefined(parsed.askedAt),
    askCount: typeof askCount === "number" && Number.isInteger(askCount) && askCount >= 0 ? askCount : undefined,
    lastSend: isoOrUndefined(parsed.lastSend),
    lastAttempt: isoOrUndefined(parsed.lastAttempt),
    autoStartAt: isoOrUndefined(parsed.autoStartAt),
    keychainMissAt: isoOrUndefined(parsed.keychainMissAt),
    sinkFp: typeof parsed.sinkFp === "string" && parsed.sinkFp.length <= MARK_MAX ? parsed.sinkFp : undefined,
    errCursors: readCursors(parsed.errCursors),
  };
}

function readCursors(raw: unknown): ErrorCursors | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: ErrorCursors = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  return out;
}

/**
 * The owner's Keychain item; "" when there is none. `bin` is a seam for tests.
 */
export function keychainKey(bin = "security"): string {
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync(bin, ["find-generic-password", "-s", "agentbrew", "-a", "posthog_key", "-w"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      // A lookup that hangs (a locked Keychain) is cut off. The throw below makes it "no key".
      timeout: KEYCHAIN_TIMEOUT_MS,
    }).trim();
  } catch {
    return "";
  }
}

/** The committed default key; "" when the file is empty, missing, or not one `phc_` key. */
export function defaultKey(file = defaultKeyFile()): string {
  try {
    const text = readFileSync(file, "utf-8").replace(/\r?\n$/, "");
    return KEY.test(text) ? text : "";
  } catch {
    return "";
  }
}

/**
 * The project key and where it came from: AGENTBREW_POSTHOG_KEY, then the
 * owner's Keychain item (service "agentbrew", account "posthog_key"), then the
 * committed default file. Each source must hold one `phc_` key; anything else
 * is no key. A set env var stops the lookup, so an empty one means "no key";
 * tests use that.
 */
export function resolveKey(deps: TelemetryDeps = {}): { key: string; source: KeySource } {
  const fromEnv = process.env.AGENTBREW_POSTHOG_KEY;
  if (fromEnv !== undefined) return KEY.test(fromEnv) ? { key: fromEnv, source: "env" } : { key: "", source: "none" };
  const fromKeychain = (deps.keychain ?? keychainKey)();
  if (KEY.test(fromKeychain)) return { key: fromKeychain, source: "keychain" };
  const fromFile = defaultKey(deps.defaultKeyFile);
  return { key: fromFile, source: fromFile ? "default" : "none" };
}

/**
 * True when some key is set. The question path uses it after most commands,
 * so it reads the env var and the default file first. It asks the Keychain
 * (a `security` process) only when both are empty, and then at most once a day.
 */
function hasKey(deps: TelemetryDeps, state: TelemetryState, now: number): boolean {
  // An org sink needs no PostHog key and never reads one; `ask` asks about the org destination.
  const sink = readSinkPolicy();
  if (sink.status === "invalid") return false;
  if (sink.status === "ok" && (sink.policy.kind === "off" || isOrgSink(sink.policy))) {
    return isOrgSink(sink.policy) && sink.policy.consent === "ask";
  }
  const fromEnv = process.env.AGENTBREW_POSTHOG_KEY;
  if (fromEnv !== undefined) return KEY.test(fromEnv);
  if (defaultKey(deps.defaultKeyFile)) return true;
  if (withinDay(state.keychainMissAt, now)) return false;
  if (KEY.test((deps.keychain ?? keychainKey)())) return true;
  patchState({ keychainMissAt: new Date(now).toISOString() });
  return false;
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
  /** Present only with an org sink policy (telemetry-sink.ts). */
  sink?: SinkStatus;
}

/** True when the stored answer lets a send go: a yes, or, under a managed org sink, anything but a no. */
function consentOk(state: TelemetryState, sink: SinkRead): boolean {
  if (sink.status === "ok" && isOrgSink(sink.policy) && sink.policy.consent === "managed")
    return state.consent !== "no";
  return state.consent === "yes";
}

function statusOf(state: TelemetryState, lines: string[], deps: TelemetryDeps): TelemetryStatus & { key: string } {
  const sink = readSinkPolicy();
  const base = {
    key: "",
    consent: state.consent ?? ("unset" as const),
    consentAt: state.consentAt,
    keySource: "none" as KeySource,
    pending: lines.length - handled(lines, state),
    lastSend: state.lastSend,
  };
  const stopped = stoppedReason(sink);
  if (stopped) return { ...base, on: false, reason: stopped };
  const off = envOff();
  const org = orgOf(sink);
  if (org) return { ...base, sink: sinkStatus(org), ...orgAnswer(state, org.consent, off) };
  const { key, source } = resolveKey(deps);
  return { ...base, key, keySource: source, ...publicAnswer(state, key, off) };
}

/** Why a policy stops every send, or undefined. */
function stoppedReason(sink: SinkRead): string | undefined {
  if (sink.status === "invalid") return `sink policy invalid: ${sink.reason}`;
  return sink.status === "ok" && sink.policy.kind === "off" ? "off by org policy" : undefined;
}

/** On or off for an org sink. A managed sink needs no stored yes; a stored no still stops it. */
function orgAnswer(
  state: TelemetryState,
  consent: "ask" | "managed",
  off: string | undefined,
): { on: boolean; reason: string } {
  if (off) return { on: false, reason: off };
  if (state.consent === "no") return { on: false, reason: "you said no" };
  if (consent === "managed") return { on: true, reason: "managed by org policy" };
  if (state.consent !== "yes") return { on: false, reason: "not answered yet" };
  return { on: true, reason: "on" };
}

/** On or off for the public default: it needs a stored yes and a key. */
function publicAnswer(state: TelemetryState, key: string, off: string | undefined): { on: boolean; reason: string } {
  if (off) return { on: false, reason: off };
  if (state.consent === "no") return { on: false, reason: "you said no" };
  if (state.consent !== "yes") return { on: false, reason: "not answered yet" };
  if (!key) return { on: false, reason: "no key" };
  return { on: true, reason: "on" };
}

/** On or off, why, the consent answer, where the key comes from (never its value), pending events, last send. */
export function status(deps: TelemetryDeps = {}): TelemetryStatus {
  const { key: _key, ...rest } = statusOf(loadState(), readLines(), deps);
  return rest;
}

/**
 * Record the answer. `telemetry on` and `telemetry off` call this; so does the
 * question. A new "yes" covers only what happens after it: the cursor moves to
 * the end of the log, so no event from before the yes is sent.
 */
export function setConsent(consent: Consent, now = Date.now()): void {
  const state = loadState();
  const lines = consent === "yes" && state.consent !== "yes" ? readLines() : undefined;
  const cursor = lines ? cursorAt(lines, lines.length) : {};
  saveState({ ...state, ...cursor, consent, consentAt: new Date(now).toISOString() });
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
    // The log keeps `ms`; the request names it `duration_ms`, the name the
    // other tools on the same dashboard send. `secondsSaved` becomes `seconds_saved` the same way.
    const { ts: _now, event, ms, secondsSaved, ...rest } = sanitizeEvent(e as unknown as AgentbrewEvent);
    batch.push({
      event: `agentbrew.${String(event)}`,
      distinct_id: installId,
      timestamp: isoOrUndefined(e.ts),
      properties: {
        ...rest,
        ...(ms === undefined ? {} : { duration_ms: ms }),
        ...(secondsSaved === undefined ? {} : { seconds_saved: secondsSaved }),
        ...machine(version),
        $geoip_disable: true,
        $process_person_profile: false,
      },
    });
  }
  return { api_key: key, batch };
}

/** One example event in the exact shape that is sent (the same builder makes it), for the consent question. */
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

function destinationLine(): string {
  const sink = readSinkPolicy();
  if (sink.status === "ok" && isOrgSink(sink.policy)) {
    return `Where the numbers go: ${sinkDestination(sink.policy)}, not the public dashboard.`;
  }
  return "Where the numbers go: PostHog EU. The maintainer reads the totals and averages.";
}

/** What is sent, one example event, and the privacy promise. The consent question shows it; so does `telemetry on`. */
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
    "A sync or repair also sends an estimate of the seconds it saved you.",
    "A finished install also sends how long it took to reach a clean check.",
    "",
    "One example event, in the exact shape that is sent:",
    "",
    JSON.stringify(exampleEvent(version, loadState().installId, deps.now), null, 2),
    "",
    "The privacy promise: never a path, file name, host name, user name,",
    "argument, message, or content. No IP-based location. No person profile.",
    "Like any web server, PostHog sees the IP address of the request; the",
    "location lookup is off and no location is stored.",
    "The code that enforces this is src/core/events.ts and src/core/telemetry.ts; see",
    PRIVACY_DOC,
    "",
    destinationLine(),
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
  /** One line that says the result and how to change it. Empty when there is no key: nothing to say. */
  line: string;
}

/**
 * Throw away input that was typed before the question showed, so a stray
 * Enter is not an answer. On a terminal, raw mode also releases a line that
 * was typed but not ended.
 */
export async function drainInput(
  input: NodeJS.ReadableStream & { isTTY?: boolean; setRawMode?: (raw: boolean) => unknown } = process.stdin,
  ms = 50,
): Promise<void> {
  const raw = Boolean(input.isTTY && input.setRawMode);
  const discard = (): void => {};
  try {
    if (raw) input.setRawMode?.(true);
    input.on("data", discard);
    input.resume();
    await new Promise((resolve) => setTimeout(resolve, ms));
  } finally {
    input.off("data", discard);
    input.pause();
    if (raw) input.setRawMode?.(false);
  }
}

/**
 * The result when the question is not shown: no key, an opt-out env var, a
 * stored answer, or no terminal. With no key nothing can be sent, so nothing
 * is asked and nothing is printed (the line is empty).
 */
function answerWithoutAsking(deps: TelemetryDeps & { install?: boolean }): AskResult | undefined {
  const state = loadState();
  const off = envOff();
  const optOut = off && off !== "CI" ? off : undefined;
  const key = hasKey(deps, state, deps.now ?? Date.now());
  const optOutLine = `Telemetry is off (${optOut}). Nothing is sent. ${CHANGE}`;
  if (optOut && deps.install) {
    if (state.consent !== "no") setConsent("no", deps.now);
    return { consent: "no", asked: false, line: key ? optOutLine : "" };
  }
  if (!key) return { consent: state.consent ?? "unset", asked: false, line: "" };
  if (state.consent) {
    const word = state.consent === "yes" ? "on (you said yes)" : "off (you said no)";
    return { consent: state.consent, asked: false, line: `Telemetry stays ${word}. ${CHANGE}` };
  }
  return unansweredWithoutAsking(optOut ? optOutLine : undefined, canAsk(deps));
}

/** No stored answer: an opt-out env var or a missing terminal ends it; otherwise the question shows (undefined). */
function unansweredWithoutAsking(optOutLine: string | undefined, terminal: boolean): AskResult | undefined {
  if (optOutLine) return { consent: "unset", asked: false, line: optOutLine };
  if (terminal) return undefined;
  return {
    consent: "unset",
    asked: false,
    line: `Telemetry: not asked (no terminal). Nothing is sent until you say yes. ${CHANGE}`,
  };
}

/**
 * The consent question. `install: true` is the installer (`agentbrew telemetry
 * ask`). There, an opt-out env var (`--no-telemetry`) records "no" without a
 * prompt, even over a stored yes: an explicit opt-out always wins. Apart from
 * that, a stored answer is never asked again and never changed. With no
 * terminal, or with CI set, nothing is asked and the answer stays unset.
 * In the installer, Enter or y is "yes" and n is "no". After a normal command
 * only a typed y or n counts. End of input leaves the answer unset.
 */
export async function askConsent(
  version: string,
  deps: TelemetryDeps & { install?: boolean } = {},
): Promise<AskResult> {
  const settled = answerWithoutAsking(deps);
  if (settled) return settled;
  const write = deps.write ?? ((text: string) => process.stderr.write(text));
  // Outside the installer the question shows at most once a day, and at most MAX_ASKS times.
  // The state is saved before the text shows, so the example event has the install id that is kept.
  patchState(
    deps.install
      ? {}
      : { askedAt: new Date(deps.now ?? Date.now()).toISOString(), askCount: (loadState().askCount ?? 0) + 1 },
  );
  write(`${consentText(version, deps)}\n`);
  await (deps.drain ?? (deps.ask ? async () => {} : drainInput))();
  const answer = await readYesNo(deps, write, !deps.install);
  if (!answer) return { consent: "unset", asked: true, line: `No answer. Nothing is sent. ${CHANGE}` };
  setConsent(answer, deps.now);
  const line = answer === "yes" ? "Thank you. Telemetry is on." : "Telemetry is off. Nothing is sent.";
  return { consent: answer, asked: true, line: `${line} ${CHANGE}` };
}

/**
 * y is "yes"; n is "no"; an unclear answer asks again; end of input is no
 * answer. Enter alone is "yes" in the installer and no answer when `explicit`.
 */
async function readYesNo(
  deps: TelemetryDeps,
  write: (text: string) => void,
  explicit: boolean,
): Promise<Consent | undefined> {
  for (let tries = 0; tries < 3; tries += 1) {
    const answer = (await (deps.ask ?? readAnswer)(explicit ? QUESTION_EXPLICIT : QUESTION))?.trim().toLowerCase();
    if (answer === undefined || (answer === "" && explicit)) return undefined;
    if (["", "y", "yes"].includes(answer)) return "yes";
    if (["n", "no"].includes(answer)) return "no";
    write("Please answer y or n.\n");
  }
  return undefined;
}

/** True when a command must stay silent: its output is machine-readable, or it is help, a version, or completion. */
export function quietCommand(command: string | undefined, argv: readonly string[] = []): boolean {
  if (command !== undefined && QUIET_COMMANDS.has(command)) return true;
  return argv.some((arg) => QUIET_FLAGS.has(arg) || arg.startsWith("--json="));
}

/**
 * After a normal command: ask the consent question when it was never
 * answered, a key is set, a person is at the terminal, and the command is not
 * a quiet one. An unanswered question backs off: at most once a day, at most
 * MAX_ASKS times, then silence until `agentbrew telemetry ask`. Silent in a
 * pipe, hook, scheduler, or agent run. Never throws.
 */
export async function askOnFirstRun(
  version: string,
  deps: TelemetryDeps & { command?: string; argv?: readonly string[] } = {},
): Promise<void> {
  let release: SendLock | undefined;
  try {
    // The installer turns this path off (AGENTBREW_TELEMETRY_ASK): it asks the question itself, last.
    if (!canAsk(deps) || envOff() || process.env.AGENTBREW_TELEMETRY_ASK === "0") return;
    if (quietCommand(deps.command, deps.argv)) return;
    const now = deps.now ?? Date.now();
    const state = loadState();
    if (!questionDue(state, now) || !hasKey(deps, state, now)) return;
    // One question at a time on a machine: two commands that end together in two terminals show it once.
    release = acquireLock(`${statePath()}.ask.lock`, QUESTION_LOCK_STALE_MS);
    // Under the lock the state is read again: another process may have asked a moment ago.
    if (!release || !questionDue(loadState(), now)) return;
    const result = await askConsent(version, deps);
    if (result.line) (deps.write ?? ((text: string) => process.stderr.write(text)))(`${result.line}\n`);
  } catch (e) {
    logSkipped("core/telemetry/askOnFirstRun", e);
  } finally {
    release?.();
  }
}

/** True when a normal command may show the question: no answer yet, not asked in the last day, and asks left. */
function questionDue(state: TelemetryState, now: number): boolean {
  return !state.consent && !withinDay(state.askedAt, now) && (state.askCount ?? 0) < MAX_ASKS;
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
  /** Error log lines forwarded to an org sink in this send. */
  errorLines?: number;
}

/** The release function of a held send lock; `holds` says whether the lock is still this owner's. */
export type SendLock = (() => void) & { holds: () => boolean };

/** Make the file with the token. False when it exists: "wx" lets only one process make it. */
function createOnce(file: string, token: string): boolean {
  try {
    writeFileSync(file, token, { flag: "wx", mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** True when the file is older than `staleMs`, or dated that far in the future (the clock was set back). */
function staleFile(file: string, staleMs = LOCK_STALE_MS): boolean {
  return Math.abs(Date.now() - statSync(file).mtimeMs) >= staleMs;
}

/** The text of the file, or undefined when it is gone. */
function readOrUndefined(file: string): string | undefined {
  try {
    return readFileSync(file, "utf-8");
  } catch {
    return undefined;
  }
}

/**
 * Remove a guard that a dead takeover left. A check of its age and then a
 * delete would be two steps: between them another process can remove the old
 * guard and a third one can make a new one, which the delete would then
 * remove. So the guard is moved away in one step (a rename; only one process
 * gets the file), and the age of what was moved is checked. A fresh one
 * belongs to a live takeover and goes back.
 */
function removeStaleGuard(guard: string, token: string): void {
  const moved = `${guard}.${token.replace(" ", ".")}`;
  try {
    renameSync(guard, moved);
  } catch {
    return;
  }
  try {
    // A hard link puts a live guard back; it fails when a newer guard is there, and that one stays.
    if (!staleFile(moved)) linkSync(moved, guard);
  } catch {
    // The newer guard stays.
  } finally {
    rmSync(moved, { force: true });
  }
}

/** How long an owner reads a lock that is gone again before the lock counts as lost, and the step. */
const LOCK_GONE_WAIT_MS = 2000;
const LOCK_GONE_STEP_MS = 2;

/** A test seam of the lock takeover; the argument names the point it runs at. */
type LockSeam = (at: "stale-guard" | "guard-held" | "lock-moved") => void;

/**
 * Replace a stale lock. Only one process at a time may do this: the one that
 * makes the guard file. Under the guard it checks again that the lock is the
 * same dead one, so it never replaces a lock that another process took over a
 * moment before. The swap itself checks that too: the lock is moved away (one
 * step), compared with the dead one, and the new lock is made with a hard
 * link, which fails when another lock is there. `seam` is for tests: it runs
 * between the sight of a stale guard and its removal ("stale-guard"), and
 * right after this process made the guard ("guard-held"), and right after it
 * moved the lock away ("lock-moved").
 */
function takeOverStale(file: string, token: string, staleMs: number, seam?: LockSeam): boolean {
  if (!staleFile(file, staleMs)) return false;
  const dead = readFileSync(file, "utf-8");
  const guard = `${file}.steal`;
  if (!createOnce(guard, token)) {
    // A guard left by a dead process is removed. This send stops; the next one tries again.
    if (staleFile(guard)) {
      seam?.("stale-guard");
      removeStaleGuard(guard, token);
    }
    return false;
  }
  const mine = `${file}.${token.replace(" ", ".")}`;
  const moved = `${mine}.old`;
  try {
    seam?.("guard-held");
    if (!staleFile(file, staleMs) || readOrUndefined(file) !== dead) return false;
    writeFileSync(mine, token, { mode: 0o600 });
    renameSync(file, moved);
    seam?.("lock-moved");
    if (readOrUndefined(moved) !== dead) {
      // Not the dead lock: another send made it a moment ago. It goes back.
      linkSync(moved, file);
      return false;
    }
    linkSync(mine, file);
    return true;
  } finally {
    rmSync(mine, { force: true });
    rmSync(moved, { force: true });
    if (readOrUndefined(guard) === token) rmSync(guard, { force: true });
  }
}

/**
 * One send at a time on a machine: a lock file beside the state. It holds the
 * owner's pid and a random nonce. Returns the release function, or undefined
 * when another send holds a fresh lock. A lock older than LOCK_STALE_MS was
 * left by a dead process; takeOverStale replaces it. Release removes the lock
 * only when it still holds this owner's token. The consent question uses the
 * same lock with its own file and a longer stale time.
 */
export function acquireLock(
  file = `${statePath()}.lock`,
  staleMs = LOCK_STALE_MS,
  seam?: LockSeam,
): SendLock | undefined {
  const token = `${process.pid} ${randomUUID().replace(/-/g, "")}`;
  // A takeover in another process moves the lock aside to compare it. A live lock goes back a
  // moment later, so a lock that is gone is read again for a short time before it counts as lost.
  // Without the wait, the owner would stop and its lock would belong to no process until it is stale.
  // A lost lock stays lost: later calls answer at once, with no second wait.
  let lost = false;
  const holds = (): boolean => {
    if (lost) return false;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (const until = Date.now() + LOCK_GONE_WAIT_MS; ; ) {
      const text = readOrUndefined(file);
      if (text !== undefined || Date.now() >= until) {
        lost = text !== token;
        return !lost;
      }
      Atomics.wait(pause, 0, 0, LOCK_GONE_STEP_MS);
    }
  };
  // Release never waits: a lock that is gone needs no removal.
  const release = (): void => {
    if (!lost && readOrUndefined(file) === token) rmSync(file, { force: true });
  };
  try {
    mkdirSync(dirname(file), { recursive: true });
    if (!createOnce(file, token) && !takeOverStale(file, token, staleMs, seam)) return undefined;
    return holds() ? Object.assign(release, { holds }) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Send what is pending, at most BATCH_SIZE events per request. The cursor
 * moves only after a 2xx answer. With dryRun, return the next body and send
 * nothing. `auto` is the daily send: one AUTO_TIMEOUT_MS budget for all
 * requests. Never throws.
 */
export async function send(
  version: string,
  options: TelemetryDeps & { dryRun?: boolean; auto?: boolean } = {},
): Promise<SendResult> {
  let release: SendLock | undefined;
  const now = options.now ?? Date.now();
  try {
    if (options.dryRun) return dryRun(version, now);
    const st = statusOf(loadState(), readLines(), options);
    if (!st.on) {
      noteStoppedSink(readSinkPolicy());
      return { sent: 0, skipped: st.reason };
    }
    release = acquireLock();
    if (!release) return { sent: 0, skipped: "another send is running" };
    // The state and the log are read under the lock: a send that ended a moment ago has moved the cursor.
    const state = loadState();
    const lines = readLines();
    const sinkRead = readSinkPolicy();
    const blocked = blockedUnderLock(state, lines, sinkRead);
    if (blocked) return { sent: 0, skipped: blocked };
    const org = orgOf(sinkRead);
    const token = org?.token ? resolveToken(org.token) : undefined;
    if (org?.token && token === undefined) return { sent: 0, skipped: "sink token unavailable" };
    const cursor = startCursor(lines, handled(lines, state), now);
    patchState(cursorAt(lines, cursor));
    const id = { key: st.key, installId: state.installId, version, holds: release.holds, sinkRead, token };
    const result: SendResult =
      cursor >= lines.length ? { sent: 0, skipped: "nothing new" } : await postBatches(lines, cursor, id, options);
    return await withErrorLogs(result, org, state, id, options);
  } catch (e) {
    logSkipped("core/telemetry/send", e);
    return { sent: 0, skipped: "error" };
  } finally {
    if (release) finishAttempt(release, now);
  }
}

/** The org policy of a read, or undefined for the public default. */
function orgOf(read: SinkRead): SinkPolicy | undefined {
  return read.status === "ok" && isOrgSink(read.policy) ? read.policy : undefined;
}

/** True for a policy that stops every send: `off`, or an invalid file. */
function sinkStops(read: SinkRead): boolean {
  return read.status === "invalid" || (read.status === "ok" && read.policy.kind === "off");
}

/**
 * Why a send that holds the lock must not start, or undefined. A changed
 * destination is noted here: events recorded for one destination never go to
 * another, so the cursor moves to the end of the log.
 */
function blockedUnderLock(state: TelemetryState, lines: string[], sinkRead: SinkRead): string | undefined {
  if (sinkStops(sinkRead)) {
    noteStoppedSink(sinkRead);
    return "sink policy changed";
  }
  if (!consentOk(state, sinkRead)) return "consent changed";
  const fp = sinkFingerprint(sinkRead);
  if ((state.sinkFp ?? "public") === fp) return undefined;
  const errCursors = orgOf(sinkRead)?.errorLogs ? errorLogEnds(getLogDir()) : undefined;
  patchState({ ...cursorAt(lines, lines.length), sinkFp: fp, errCursors });
  return "destination changed";
}

/** After the events: forward error log lines to an org sink that asks for them. */
async function withErrorLogs(
  result: SendResult,
  org: SinkPolicy | undefined,
  state: TelemetryState,
  id: SendId,
  options: TelemetryDeps & { auto?: boolean },
): Promise<SendResult> {
  if (!org) return result;
  if (!org.errorLogs) {
    if (state.errCursors) patchState({ errCursors: undefined });
    return result;
  }
  if (result.skipped !== undefined && result.skipped !== "nothing new") return result;
  const errorLines = await sendErrorLogs(org, id, options);
  return errorLines ? { ...result, errorLines } : result;
}

/**
 * A policy that stops every send (`off`, or an invalid file) is noted here:
 * the cursor moves to the end of the log and the fingerprint is stored. No
 * send does it, because none runs. Without this, events recorded while the
 * policy said off would go out once the file is removed. It never makes a
 * state file: with none there is no cursor to protect. Never throws.
 */
function noteStoppedSink(sink: SinkRead): void {
  try {
    const fp = sinkFingerprint(sink);
    if (!existsSync(statePath()) || (loadState().sinkFp ?? "public") === fp) return;
    const lines = readLines();
    patchState({ ...cursorAt(lines, lines.length), sinkFp: fp, errCursors: undefined });
  } catch (e) {
    logSkipped("core/telemetry/noteStoppedSink", e);
  }
}

/** The next request body with the key hidden, and how many events wait. Sends nothing and takes no lock. */
function dryRun(version: string, now: number): SendResult {
  const state = loadState();
  const lines = readLines();
  const sink = readSinkPolicy();
  if (sink.status === "invalid") return { sent: 0, skipped: `sink policy invalid: ${sink.reason}` };
  if (sink.status === "ok" && sink.policy.kind === "off") return { sent: 0, skipped: "off by org policy" };
  const changed = (state.sinkFp ?? "public") !== sinkFingerprint(sink);
  const cursor = changed ? lines.length : startCursor(lines, handled(lines, state), now);
  if (sink.status === "ok" && isOrgSink(sink.policy)) {
    const batch = buildBatch(lines.slice(cursor, cursor + BATCH_SIZE), "", state.installId, version).batch;
    const events = hecEvents(batch as Record<string, unknown>[], sink.policy, state.installId, version, now);
    return { sent: 0, pending: lines.length - cursor, body: dryRunBody(sink.policy, events) };
  }
  const body = buildBatch(lines.slice(cursor, cursor + BATCH_SIZE), "<posthog_key>", state.installId, version);
  return { sent: 0, pending: lines.length - cursor, body };
}

/**
 * End of a send that held the lock: record the attempt, then unlock. The
 * attempt time is written last, so a send that the system killed part-way
 * (a scheduler job that ended) is tried again on the next run, not a day later.
 */
function finishAttempt(release: () => void, now: number): void {
  try {
    patchState({ lastAttempt: new Date(now).toISOString() });
    release();
  } catch (e) {
    logSkipped("core/telemetry/finishAttempt", e);
  }
}

/** Why a send must stop before its next request, or undefined when it may go on. */
function stopBeforeRequest(holds: () => boolean, cursor: number, sink: SinkRead): string | undefined {
  if (!holds()) return "lock lost";
  const state = loadState();
  if (!consentOk(state, sink)) return "consent changed";
  // The lock can be away for a moment (see acquireLock). A send that ran in that gap has moved
  // the cursor on disk past this one: these lines are sent, so this send stops.
  return state.sent > cursor ? "lock lost" : undefined;
}

/** What one send needs for every request. */
interface SendId {
  key: string;
  installId: string;
  version: string;
  holds: () => boolean;
  sinkRead: SinkRead;
  token?: string;
}

/** One batch to the org sink, or to the public default. Returns why it failed, or undefined. */
function postChunk(
  body: Record<string, unknown>,
  id: SendId,
  signal: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  const sink = orgOf(id.sinkRead);
  if (!sink) return postOne(body, signal, fetchImpl);
  const now = Date.now();
  const events = hecEvents(body.batch as Record<string, unknown>[], sink, id.installId, id.version, now);
  return deliver(sink, events, { token: id.token, signal, fetchImpl, now });
}

/**
 * Post the lines from the cursor on, one batch per request. Before each
 * request the stored answer is read again: `telemetry off` in another process
 * stops the send. After each 2xx only the cursor and the send time are merged
 * into the state on disk, so that answer is never written back.
 */
async function postBatches(
  lines: string[],
  start: number,
  id: SendId,
  options: TelemetryDeps & { auto?: boolean },
): Promise<SendResult> {
  const autoBudget = options.auto ? AbortSignal.timeout(AUTO_TIMEOUT_MS) : undefined;
  let cursor = start;
  let sent = 0;
  while (cursor < lines.length) {
    // Checked before every request, the first one too: a send whose lock another process took over must stop.
    const stop = stopBeforeRequest(id.holds, cursor, id.sinkRead);
    if (stop) return { sent, skipped: stop };
    const chunk = lines.slice(cursor, cursor + BATCH_SIZE);
    const body = buildBatch(chunk, id.key, id.installId, id.version);
    const count = (body.batch as unknown[]).length;
    let lastSend: string | undefined;
    if (count > 0) {
      const failed = await postChunk(body, id, autoBudget ?? AbortSignal.timeout(MANUAL_TIMEOUT_MS), options.fetchImpl);
      if (failed) return { sent, skipped: failed };
      lastSend = new Date().toISOString();
    }
    sent += count;
    cursor += chunk.length;
    const fresh = loadState();
    const next = cursor >= fresh.sent ? cursorAt(lines, cursor) : {};
    saveState({ ...fresh, ...next, lastSend: lastSend ?? fresh.lastSend });
  }
  return { sent };
}

/**
 * Forward new lines of agentbrew's own error logs to the org sink. The first
 * send with `error_logs` on only records where each file ends. The cursors
 * move only after the sink took the lines. Returns how many lines were sent.
 */
async function sendErrorLogs(
  sink: SinkPolicy,
  id: { installId: string; version: string; sinkRead: SinkRead; token?: string },
  options: TelemetryDeps & { auto?: boolean },
): Promise<number> {
  const dir = getLogDir();
  const before = loadState();
  if (!before.errCursors) {
    patchState({ errCursors: errorLogEnds(dir) });
    return 0;
  }
  const { lines, cursors } = readErrorLines(dir, before.errCursors);
  if (lines.length === 0) {
    if (JSON.stringify(cursors) !== JSON.stringify(before.errCursors)) patchState({ errCursors: cursors });
    return 0;
  }
  if (!consentOk(loadState(), id.sinkRead)) return 0;
  const now = Date.now();
  const signal = options.auto ? AbortSignal.timeout(AUTO_TIMEOUT_MS) : AbortSignal.timeout(MANUAL_TIMEOUT_MS);
  const failed = await deliver(sink, errorObjects(lines, sink, id.installId, id.version, now), {
    token: id.token,
    signal,
    fetchImpl: options.fetchImpl,
    now,
  });
  if (failed) return 0;
  patchState({ errCursors: cursors });
  return lines.length;
}

/** One request. Returns why it failed, or undefined after a 2xx. */
async function postOne(
  body: Record<string, unknown>,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
  try {
    const res = await fetchImpl(process.env.AGENTBREW_TELEMETRY_URL || DEFAULT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    // The answer body is not needed. Cancel it, so a slow body cannot hold the process open.
    await res.body?.cancel().catch(() => {});
    return res.ok ? undefined : `http ${res.status}`;
  } catch (e) {
    // Only the error name is logged: a network error text must never carry the request body or the key.
    logSkipped("core/telemetry/send", e instanceof Error ? e.name : "error");
    return "network";
  }
}

/** The state when the daily send is due (see sendDailyDue), else undefined. */
function dueState(deps: TelemetryDeps): TelemetryState | undefined {
  const sink = readSinkPolicy();
  if (sinkStops(sink)) {
    noteStoppedSink(sink);
    return undefined;
  }
  if (envOff()) return undefined;
  const state = loadState();
  if (!consentOk(state, sink)) return undefined;
  const now = deps.now ?? Date.now();
  if (withinDay(state.lastAttempt ?? state.lastSend, now)) return undefined;
  // A command started the send a moment ago, and it has not ended yet.
  const started = Date.parse(state.autoStartAt ?? "");
  if (deps.claim && Number.isFinite(started) && Math.abs(now - started) < AUTO_START_GAP_MS) return undefined;
  // An org sink needs no PostHog key.
  if (sink.status === "ok" && isOrgSink(sink.policy)) return state;
  return hasKey(deps, state, now) ? state : undefined;
}

/**
 * True when the daily send is due: no off switch, a stored "yes", no attempt
 * in the last day, and a key. Cheap: no network, and no Keychain lookup on
 * each command when no key is set.
 */
export function sendDailyDue(deps: TelemetryDeps = {}): boolean {
  return dueState(deps) !== undefined;
}

/**
 * For the command that starts the detached send: true when the send is due
 * and no other command started it in the last minute. It then writes the
 * start time, so the next command starts no second process.
 */
export function claimDailySend(deps: TelemetryDeps = {}): boolean {
  if (!dueState({ ...deps, claim: true })) return false;
  patchState({ autoStartAt: new Date(deps.now ?? Date.now()).toISOString() });
  return true;
}

/**
 * The daily send: at most once a day, and only after a "yes". Never throws.
 * A sync does not run it in its own process: it starts a separate process for
 * it (telemetry-auto.ts) and does not wait.
 */
export async function sendDaily(version: string, deps: TelemetryDeps = {}): Promise<void> {
  try {
    if (sendDailyDue(deps)) await send(version, { ...deps, auto: true });
  } catch (e) {
    logSkipped("core/telemetry/sendDaily", e);
  }
}
