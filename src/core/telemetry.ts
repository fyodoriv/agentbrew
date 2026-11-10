import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
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
/** The installer's question: Enter counts as yes. */
export const QUESTION = "Share anonymous performance numbers? [Y/n] ";
/** The question after a normal command: only a typed y or n counts. */
export const QUESTION_EXPLICIT = "Share anonymous performance numbers? [y/n] ";
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
/** A PostHog project key. A key from any source that does not match is no key. */
const KEY = /^phc_[A-Za-z0-9]+$/;
/** A send lock older than this was left by a dead process. */
const LOCK_STALE_MS = 60_000;
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
    return { installId: randomUUID().replace(/-/g, ""), sent: readLines().length };
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

/** The parsed file as a state, or undefined when its id or cursor is not valid. */
function readState(parsed: Record<string, unknown>, saidNo: boolean): TelemetryState | undefined {
  const { installId, sent, askCount } = parsed;
  if (typeof installId !== "string" || !INSTALL_ID.test(installId)) return undefined;
  if (typeof sent !== "number" || !Number.isInteger(sent) || sent < 0) return undefined;
  const consent: Consent | undefined = saidNo ? "no" : parsed.consent === "yes" ? "yes" : undefined;
  return {
    installId,
    sent,
    consent,
    consentAt: consent ? isoOrUndefined(parsed.consentAt) : undefined,
    askedAt: isoOrUndefined(parsed.askedAt),
    askCount: typeof askCount === "number" && Number.isInteger(askCount) && askCount >= 0 ? askCount : undefined,
    lastSend: isoOrUndefined(parsed.lastSend),
    lastAttempt: isoOrUndefined(parsed.lastAttempt),
    keychainMissAt: isoOrUndefined(parsed.keychainMissAt),
  };
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

/**
 * Record the answer. `telemetry on` and `telemetry off` call this; so does the
 * question. A new "yes" covers only what happens after it: the cursor moves to
 * the end of the log, so no event from before the yes is sent.
 */
export function setConsent(consent: Consent, now = Date.now()): void {
  const state = loadState();
  const sent = consent === "yes" && state.consent !== "yes" ? readLines().length : state.sent;
  saveState({ ...state, sent, consent, consentAt: new Date(now).toISOString() });
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
  write(`${consentText(version, deps)}\n`);
  // Outside the installer the question shows at most once a day, and at most MAX_ASKS times.
  if (!deps.install) {
    patchState({ askedAt: new Date(deps.now ?? Date.now()).toISOString(), askCount: (loadState().askCount ?? 0) + 1 });
  }
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
  try {
    // The installer turns this path off (AGENTBREW_TELEMETRY_ASK): it asks the question itself, last.
    if (!canAsk(deps) || envOff() || process.env.AGENTBREW_TELEMETRY_ASK === "0") return;
    if (quietCommand(deps.command, deps.argv)) return;
    const state = loadState();
    const now = deps.now ?? Date.now();
    if (state.consent || withinDay(state.askedAt, now) || (state.askCount ?? 0) >= MAX_ASKS) return;
    if (!hasKey(deps, state, now)) return;
    const result = await askConsent(version, deps);
    if (result.line) (deps.write ?? ((text: string) => process.stderr.write(text)))(`${result.line}\n`);
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
 * One send at a time on a machine: a lock file beside the state. Returns the
 * release function, or undefined when another send holds a fresh lock.
 */
function acquireLock(): (() => void) | undefined {
  const file = `${statePath()}.lock`;
  for (let tries = 0; tries < 2; tries += 1) {
    try {
      mkdirSync(dirname(file), { recursive: true });
      closeSync(openSync(file, "wx", 0o600));
      return () => rmSync(file, { force: true });
    } catch {
      try {
        if (Date.now() - statSync(file).mtimeMs < LOCK_STALE_MS) return undefined;
        rmSync(file, { force: true });
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
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
  let release: (() => void) | undefined;
  const now = options.now ?? Date.now();
  try {
    const state = loadState();
    const lines = readLines();
    const cursor = startCursor(lines, state.sent, now);
    if (options.dryRun) {
      const body = buildBatch(lines.slice(cursor, cursor + BATCH_SIZE), "<posthog_key>", state.installId, version);
      return { sent: 0, pending: lines.length - cursor, body };
    }
    const st = statusOf(state, lines.length, options);
    if (!st.on) return { sent: 0, skipped: st.reason };
    release = acquireLock();
    if (!release) return { sent: 0, skipped: "another send is running" };
    patchState({ sent: cursor });
    if (cursor >= lines.length) return { sent: 0, skipped: "nothing new" };
    return await postBatches(lines, cursor, { key: st.key, installId: state.installId, version }, options);
  } catch (e) {
    logSkipped("core/telemetry/send", e);
    return { sent: 0, skipped: "error" };
  } finally {
    if (release) finishAttempt(release, now);
  }
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

/**
 * Post the lines from the cursor on, one batch per request. Before each
 * request the stored answer is read again: `telemetry off` in another process
 * stops the send. After each 2xx only the cursor and the send time are merged
 * into the state on disk, so that answer is never written back.
 */
async function postBatches(
  lines: string[],
  start: number,
  id: { key: string; installId: string; version: string },
  options: TelemetryDeps & { auto?: boolean },
): Promise<SendResult> {
  const autoBudget = options.auto ? AbortSignal.timeout(AUTO_TIMEOUT_MS) : undefined;
  let cursor = start;
  let sent = 0;
  while (cursor < lines.length) {
    if (loadState().consent !== "yes") return { sent, skipped: "consent changed" };
    const chunk = lines.slice(cursor, cursor + BATCH_SIZE);
    const body = buildBatch(chunk, id.key, id.installId, id.version);
    const count = (body.batch as unknown[]).length;
    let lastSend: string | undefined;
    if (count > 0) {
      const failed = await postOne(body, autoBudget ?? AbortSignal.timeout(MANUAL_TIMEOUT_MS), options.fetchImpl);
      if (failed) return { sent, skipped: failed };
      lastSend = new Date().toISOString();
    }
    sent += count;
    cursor += chunk.length;
    const fresh = loadState();
    saveState({ ...fresh, sent: Math.max(fresh.sent, cursor), lastSend: lastSend ?? fresh.lastSend });
  }
  return { sent };
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
    if (withinDay(state.lastAttempt ?? state.lastSend, now)) return;
    // No key: stop here, so a sync does not start a Keychain lookup each time.
    if (!hasKey(deps, state, now)) return;
    await send(version, { ...deps, auto: true });
  } catch (e) {
    logSkipped("core/telemetry/sendDaily", e);
  }
}
