import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { expandHome } from "../utils.js";
import { logSkipped } from "./logger.js";
import { redactUrlCredentials } from "./redact-url.js";

/**
 * Org log sink: an org overlay drops one settings file and agentbrew sends its
 * telemetry events (and, when the file says so, its own error log lines) to
 * the org's log system instead of the public PostHog default.
 * Contract for overlay authors: docs/observability.md § Org log sink.
 *
 * This module reads and checks the file, and writes events to the sink. It
 * holds no state of its own: the policy is read from disk at each call, and
 * the cursors live in the telemetry state file (telemetry.ts).
 * Not tested against a real Splunk server: the tests follow Splunk's public
 * HEC format.
 */

const TOOL = "agentbrew";
const TOKEN_MAX = 512;
const LINE_MAX = 2_000;
export const ERROR_LINES_PER_SEND = 200;
/** One read of an error log is cut at this size, so a huge file costs one bounded read. */
const READ_MAX = 1_048_576;
/** A sink file over this size is renamed to `<path>.1` and a new file starts. */
export const FILE_ROTATE_BYTES = 10 * 1024 * 1024;
const NAME = /^[A-Za-z0-9_:.-]{1,64}$/;
const KEYS = new Set([
  "version",
  "kind",
  "consent",
  "error_logs",
  "url",
  "token",
  "index",
  "sourcetype",
  "source",
  "path",
]);

/**
 * The error log files agentbrew itself writes (scheduler stderr, set in the
 * launchd plists it generates). Fixed list: no other file is ever read.
 */
export const ERROR_LOG_FILES: readonly string[] = [
  "launchagent.err",
  "mcp-memory.err.log",
  "mcp-memory-maintain.err.log",
];

export type SinkKind = "posthog" | "splunk-hec" | "file" | "off";
export type TokenRef =
  | { source: "keychain"; service: string; account: string }
  | { source: "file"; file: string }
  | { source: "env"; name: string };

export interface SinkPolicy {
  kind: SinkKind;
  consent: "ask" | "managed";
  errorLogs: boolean;
  url?: string;
  host?: string;
  token?: TokenRef;
  index?: string;
  sourcetype: string;
  source: string;
  /** The file sink's absolute path. */
  path?: string;
}

export type SinkRead =
  | { status: "none" }
  | { status: "invalid"; reason: string }
  | { status: "ok"; policy: SinkPolicy };

export interface SinkStatus {
  kind: SinkKind;
  /** The host (splunk-hec) or the path with `~` (file). */
  target?: string;
  consentSource: "ask" | "managed";
  errorLogs: boolean;
  tokenSource?: "keychain" | "file" | "env";
}

export function sinkPolicyPath(): string {
  return process.env.AGENTBREW_TELEMETRY_SINK_FILE || expandHome("~/.config/agentbrew/telemetry-sink.json");
}

/** True for a kind that sends to an org destination. */
export function isOrgSink(policy: SinkPolicy): boolean {
  return policy.kind === "splunk-hec" || policy.kind === "file";
}

function invalid(reason: string): SinkRead {
  return { status: "invalid", reason };
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The token reference, or a short reason code. Exactly one source key. */
function parseToken(raw: unknown): TokenRef | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "bad-token";
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) return "bad-token";
  if (keys[0] === "env") return str(obj.env) ? { source: "env", name: obj.env as string } : "bad-token";
  if (keys[0] === "file") return str(obj.file) ? { source: "file", file: obj.file as string } : "bad-token";
  return keys[0] === "keychain" ? parseKeychainToken(obj.keychain) : "bad-token";
}

/** A Keychain reference: exactly a service and an account. */
function parseKeychainToken(raw: unknown): TokenRef | string {
  const k = raw as Record<string, unknown> | null;
  if (!k || typeof k !== "object" || Object.keys(k).length !== 2) return "bad-token";
  const [service, account] = [str(k.service), str(k.account)];
  return service && account ? { source: "keychain", service, account } : "bad-token";
}

/** The file path inside the user's home, or a reason code. The file itself must not be a symlink. */
function parsePath(raw: unknown): string | { reason: string } {
  const text = str(raw);
  if (!text || !(text.startsWith("/") || text.startsWith("~/"))) return { reason: "bad-path" };
  const home = resolve(homedir());
  const full = resolve(expandHome(text));
  if (!full.startsWith(home + sep)) return { reason: "path-outside-home" };
  try {
    if (lstatSync(full).isSymbolicLink()) return { reason: "path-symlink" };
  } catch {
    // A file that does not exist yet is fine.
  }
  return full;
}

function parseUrl(raw: unknown): { url: string; host: string } | string {
  const text = str(raw);
  if (!text) return "missing-url";
  try {
    const u = new URL(text);
    if (u.protocol !== "https:") return "url-not-https";
    if (u.username || u.password) return "url-userinfo";
    return { url: text, host: u.host };
  } catch {
    return "bad-url";
  }
}

/**
 * Read and check the policy file. No file: `none`. Anything wrong with it:
 * `invalid` with a short reason code (never the file content), and callers
 * send nothing at all. Unknown keys are invalid, so a typo cannot change behavior.
 */
export function readSinkPolicy(file = sinkPolicyPath()): SinkRead {
  let mode: number;
  try {
    const st = statSync(file);
    if (!st.isFile()) return invalid("not-a-file");
    mode = st.mode;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? { status: "none" } : invalid("unreadable");
  }
  if (mode & 0o022) return invalid("writable-by-others");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf-8"));
  } catch {
    return invalid("bad-json");
  }
  return checkPolicy(raw);
}

function checkPolicy(raw: unknown): SinkRead {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid("bad-json");
  const o = raw as Record<string, unknown>;
  const base = checkCommon(o);
  if (typeof base === "string") return invalid(base);
  const reason = addHecFields(base, o) ?? addFileFields(base, o);
  return reason ? invalid(reason) : { status: "ok", policy: base };
}

function isKind(value: unknown): value is SinkKind {
  return value === "posthog" || value === "splunk-hec" || value === "file" || value === "off";
}

/** The first of index, sourcetype, and source that is set and is not a plain name. */
function badName(o: Record<string, unknown>): string | undefined {
  return (["index", "sourcetype", "source"] as const).find(
    (name) => o[name] !== undefined && !(typeof o[name] === "string" && NAME.test(o[name] as string)),
  );
}

/** `managed` and `error_logs` are for org sinks only. Returns a reason code, or undefined. */
function orgOnlyReason(kind: SinkKind, consent: "ask" | "managed", errorLogs: boolean): string | undefined {
  if (kind === "splunk-hec" || kind === "file") return undefined;
  if (consent === "managed") return "managed-needs-org-sink";
  return errorLogs ? "error-logs-need-org-sink" : undefined;
}

/** The fields every kind shares, or a reason code. */
function checkCommon(o: Record<string, unknown>): SinkPolicy | string {
  if (Object.keys(o).some((k) => !KEYS.has(k))) return "unknown-key";
  if (o.version !== 1) return "bad-version";
  const kind = o.kind;
  if (!isKind(kind)) return "bad-kind";
  const consent = o.consent ?? "ask";
  if (consent !== "ask" && consent !== "managed") return "bad-consent";
  const errorLogs = o.error_logs ?? false;
  if (typeof errorLogs !== "boolean") return "bad-error-logs";
  const orgOnly = orgOnlyReason(kind, consent, errorLogs);
  if (orgOnly) return orgOnly;
  const bad = badName(o);
  if (bad) return `bad-${bad}`;
  return {
    kind,
    consent,
    errorLogs,
    index: o.index as string | undefined,
    sourcetype: (o.sourcetype as string | undefined) ?? `${TOOL}:telemetry`,
    source: (o.source as string | undefined) ?? TOOL,
  };
}

/** splunk-hec needs a URL and a token; no other kind may carry them. Returns a reason code, or undefined. */
function addHecFields(policy: SinkPolicy, o: Record<string, unknown>): string | undefined {
  if (policy.kind !== "splunk-hec") {
    return o.url !== undefined || o.token !== undefined ? "field-not-for-kind" : undefined;
  }
  const u = parseUrl(o.url);
  if (typeof u === "string") return u;
  const token = o.token === undefined ? "missing-token" : parseToken(o.token);
  if (typeof token === "string") return token;
  Object.assign(policy, { url: u.url, host: u.host, token });
  return undefined;
}

/** file needs a path; no other kind may carry one. Returns a reason code, or undefined. */
function addFileFields(policy: SinkPolicy, o: Record<string, unknown>): string | undefined {
  if (policy.kind !== "file") return o.path !== undefined ? "field-not-for-kind" : undefined;
  const p = parsePath(o.path);
  if (typeof p !== "string") return p.reason;
  policy.path = p;
  return undefined;
}

/** `~` for the home folder, so a status line or event never shows the user name. */
export function tildePath(text: string): string {
  const home = resolve(homedir());
  return home ? text.split(home).join("~") : text;
}

/** What `telemetry status` shows. Never the token, never the URL path. */
export function sinkStatus(policy: SinkPolicy): SinkStatus {
  return {
    kind: policy.kind,
    target: policy.kind === "file" && policy.path ? tildePath(policy.path) : policy.host,
    consentSource: policy.consent,
    errorLogs: policy.errorLogs,
    tokenSource: policy.token?.source,
  };
}

/** Identifies the destination (kind plus host or path; never the token). A change moves the send cursor. */
export function sinkFingerprint(read: SinkRead): string {
  // An invalid policy and `off` have their own value, so events recorded under them are never sent later.
  if (read.status === "invalid") return "invalid";
  if (read.status !== "ok") return "public";
  const { policy } = read;
  if (policy.kind === "off") return "off";
  if (policy.kind === "splunk-hec") return `splunk-hec:${policy.host}`;
  if (policy.kind === "file") return `file:${policy.path}`;
  return "public";
}

/** The destination for the consent question, in plain words. */
export function sinkDestination(policy: SinkPolicy): string {
  if (policy.kind === "splunk-hec") return `your organization's log system at ${policy.host}`;
  return `a local log file at ${tildePath(policy.path ?? "")}`;
}

function validToken(text: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects.
  return text.length >= 1 && text.length <= TOKEN_MAX && !/[\s\u0000-\u001f\u007f]/.test(text);
}

/** The token value, or undefined when it cannot be read or is not valid. Never throws and never logs the value. */
export function resolveToken(ref: TokenRef): string | undefined {
  try {
    let value: string;
    if (ref.source === "env") {
      value = process.env[ref.name] ?? "";
    } else if (ref.source === "file") {
      const file = resolve(expandHome(ref.file));
      const st = lstatSync(file);
      if (!st.isFile() || st.mode & 0o077) return undefined;
      value = readFileSync(file, "utf-8").replace(/\r?\n$/, "");
    } else {
      if (process.platform !== "darwin") return undefined;
      value = execFileSync("security", ["find-generic-password", "-s", ref.service, "-a", ref.account, "-w"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 1_000,
      }).replace(/\r?\n$/, "");
    }
    return validToken(value) ? value : undefined;
  } catch (e) {
    logSkipped("core/telemetry-sink/resolveToken", e instanceof Error ? e.name : "error");
    return undefined;
  }
}

/** The event object of one PostHog batch item: the same name and properties, plus the install id and version. */
function eventOf(item: Record<string, unknown>, installId: string, version: string): Record<string, unknown> {
  const props = (item.properties ?? {}) as Record<string, unknown>;
  const clean = Object.fromEntries(Object.entries(props).filter(([k]) => !k.startsWith("$")));
  return { event: item.event, ...clean, install_id: installId, version };
}

function epoch(iso: unknown, now: number): number {
  const t = Date.parse(String(iso));
  return (Number.isFinite(t) ? t : now) / 1000;
}

/** Splunk HEC objects for PostHog batch items. */
export function hecEvents(
  batch: Record<string, unknown>[],
  policy: SinkPolicy,
  installId: string,
  version: string,
  now: number,
): Record<string, unknown>[] {
  return batch.map((item) => ({
    time: epoch(item.timestamp, now),
    source: policy.source,
    sourcetype: policy.sourcetype,
    ...(policy.index ? { index: policy.index } : {}),
    event: eventOf(item, installId, version),
  }));
}

/** Error log lines as HEC objects: the event name `agentbrew.error_log` and sourcetype `agentbrew:error_log`. */
export function errorObjects(
  lines: { file: string; line: string }[],
  policy: SinkPolicy,
  installId: string,
  version: string,
  now: number,
): Record<string, unknown>[] {
  return lines.map(({ file, line }) => ({
    time: now / 1000,
    source: policy.source,
    sourcetype: `${TOOL}:error_log`,
    ...(policy.index ? { index: policy.index } : {}),
    event: { event: `${TOOL}.error_log`, file, line, install_id: installId, version },
  }));
}

function hecBody(objects: Record<string, unknown>[]): string {
  return objects.map((o) => JSON.stringify(o)).join("\n");
}

/** The request a dry run shows: the token is `<token>`. */
export function dryRunBody(policy: SinkPolicy, objects: Record<string, unknown>[]): Record<string, unknown> {
  if (policy.kind === "file") return { sink: "file", path: tildePath(policy.path ?? ""), events: objects };
  return {
    sink: "splunk-hec",
    url: policy.url,
    headers: { authorization: "Splunk <token>", "content-type": "application/json" },
    events: objects,
  };
}

function appendJsonLines(path: string, objects: Record<string, unknown>[], now: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error("path-not-regular");
    if (st.size > FILE_ROTATE_BYTES) renameSync(path, `${path}.1`);
  }
  const iso = new Date(now).toISOString();
  const text = objects
    .map((o) => {
      const {
        time,
        source: _source,
        index: _index,
        event,
        ...rest
      } = o as Record<string, unknown> & { event: unknown };
      const ts = typeof time === "number" ? new Date(time * 1000).toISOString() : iso;
      return `${JSON.stringify({ ...(event as object), ...rest, time: ts })}\n`;
    })
    .join("");
  appendFileSync(path, text, { mode: 0o600 });
}

/**
 * Deliver event objects (see hecEvents) to the sink. Returns why it failed,
 * or undefined on success. The splunk-hec token is passed in, never stored.
 * The file kind makes no network request.
 */
export async function deliver(
  policy: SinkPolicy,
  objects: Record<string, unknown>[],
  ctx: { token?: string; signal: AbortSignal; fetchImpl?: typeof fetch; now: number },
): Promise<string | undefined> {
  if (policy.kind === "file") {
    try {
      appendJsonLines(policy.path as string, objects.map(withFileShape), ctx.now);
      return undefined;
    } catch (e) {
      logSkipped("core/telemetry-sink/file", e instanceof Error ? e.name : "error");
      return "file write failed";
    }
  }
  const fetchImpl = ctx.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl(policy.url as string, {
      method: "POST",
      headers: { authorization: `Splunk ${ctx.token}`, "content-type": "application/json" },
      body: hecBody(objects),
      signal: ctx.signal,
    });
    await res.body?.cancel().catch(() => {});
    return res.ok ? undefined : `http ${res.status}`;
  } catch (e) {
    // Only the error name is logged: an error text must never carry the token.
    logSkipped("core/telemetry-sink/send", e instanceof Error ? e.name : "error");
    return "network";
  }
}

/** The file line is the HEC event plus its time and sourcetype. */
function withFileShape(o: Record<string, unknown>): Record<string, unknown> {
  const { event, sourcetype, time } = o;
  return { time, event: { ...(event as object), sourcetype } };
}

export interface ErrorCursors {
  [file: string]: number;
}

/** Where each error log ends now (0 for a file that is not there). The cursors start here, so no old line is sent. */
export function errorLogEnds(dir: string): ErrorCursors {
  const out: ErrorCursors = {};
  for (const name of ERROR_LOG_FILES) {
    try {
      out[name] = statSync(`${dir}/${name}`).size;
    } catch {
      out[name] = 0;
    }
  }
  return out;
}

/** One error log line, ready to leave the machine: credentials hidden, home as `~`, cut at 2000 chars. */
export function cleanErrorLine(line: string): string {
  return tildePath(redactUrlCredentials(line)).slice(0, LINE_MAX);
}

/**
 * New lines from the fixed error log list, at most ERROR_LINES_PER_SEND in all.
 * `cursors` are byte offsets; a file that shrank starts again at 0. A line
 * that does not end in a newline yet is left for the next send.
 */
export function readErrorLines(
  dir: string,
  cursors: ErrorCursors,
): { lines: { file: string; line: string }[]; cursors: ErrorCursors } {
  const next: ErrorCursors = { ...cursors };
  const lines: { file: string; line: string }[] = [];
  for (const file of ERROR_LOG_FILES) {
    let size: number;
    try {
      size = statSync(`${dir}/${file}`).size;
    } catch {
      next[file] = 0;
      continue;
    }
    let offset = cursors[file] ?? 0;
    if (size < offset) offset = 0;
    next[file] = offset;
    const room = ERROR_LINES_PER_SEND - lines.length;
    if (room <= 0 || size === offset) continue;
    const chunk = readChunk(`${dir}/${file}`, offset, Math.min(size - offset, READ_MAX));
    const parts = chunk.toString("utf-8").split("\n");
    parts.pop();
    let used = 0;
    for (const part of parts.slice(0, room)) {
      used += Buffer.byteLength(part) + 1;
      const text = part.replace(/\r$/, "");
      if (text.trim()) lines.push({ file, line: cleanErrorLine(text) });
    }
    next[file] = offset + used;
  }
  return { lines, cursors: next };
}

function readChunk(file: string, offset: number, length: number): Buffer {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, offset);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}
