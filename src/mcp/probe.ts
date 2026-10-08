/**
 * MCP server smoke probe — spawn a server, send `initialize` + `tools/list`,
 * report status. Two tiers:
 *
 *   - **Fast tier** (default): init + tools/list. ~1–2s per server. Catches
 *     launcher failures, broken stdio protocol, missing binaries, unresolved
 *     env vars, and most auth-at-startup issues. Requires no per-MCP knowledge.
 *   - **Deep tier** (`--deep`): adds a per-MCP smoke `tools/call` against a
 *     known-safe read-only tool (e.g. github → `get_authenticated_user`,
 *     context7 → `resolve-library-id`). Catches token-scope issues, downstream
 *     API failures, and post-init auth gaps. Reads the per-MCP smoke spec from
 *     the catalog (`CatalogMcpServer.smokeCall`); MCPs without a smoke spec
 *     fall back to fast tier.
 *
 * **Why this exists**: a user incident where `github` MCP returned
 * 401 from every `get_pull_request` call even though `tools/list` worked.
 * Root cause: the `organization-github-mcp` launcher honoured a pre-existing
 * `GITHUB_TOKEN` env (set by `~/.zshenv.secrets` to the github.com token),
 * then sent that token to github.example.com → 401. A fast-tier probe would
 * have missed it; a deep-tier probe with `get_authenticated_user` catches it.
 *
 * **Output**: machine-readable `ProbeResult` array. The CLI (`agentbrew mcp
 * probe`) renders a table; the cron heal path (`fix`) consumes the raw
 * structure to decide which heal action to attempt per failure.
 *
 * **Process discipline**: every spawned child is SIGTERM'd before the probe
 * returns. Timeouts cap the total wait per server. The probe never modifies
 * agent config — it's strictly read-only.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { performStreamableHttpHandshake, StreamableHttpError } from "../memory/mcp-client.js";
import { installCorporateTrust } from "./corporate-tls.js";
import { fromCanonical } from "./env-vars.js";

/**
 * Minimal spec the probe needs from an MCP server config. Looser than
 * `McpServer` from `../types.ts` because (a) `command` / `args` / `env` can
 * be absent for HTTP-only entries, and (b) the probe doesn't care about
 * source / addedAt / git metadata. Keeping this type local avoids forcing
 * test fixtures to fill in irrelevant required fields.
 */
export interface McpProbeSpec {
  command?: string;
  args?: readonly string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

/**
 * Stdio MCP servers that start a real browser on their first tool call.
 * Their browsers are not headless by default, so a tool call from an
 * unattended probe opens a visible Chrome window and steals focus.
 */
const BROWSER_LAUNCHING_COMMAND =
  /@playwright\/mcp|playwright-mcp|chrome-devtools-mcp|puppeteer|browser-use|browserbase|agent-browser|selenium/i;

/** True when this stdio spec runs a browser-launching MCP server. */
export function isBrowserLaunchingSpec(spec: McpProbeSpec): boolean {
  if (!spec.command) return false;
  return BROWSER_LAUNCHING_COMMAND.test([spec.command, ...(spec.args ?? [])].join(" "));
}

/**
 * Subset of a parsed JSON-RPC frame the probe actually inspects. The full
 * protocol shape is wider; we only narrow what's needed for routing inside
 * the frame handlers and to type-check `result` / `error` access.
 */
interface JsonRpcFrame {
  id?: number;
  error?: { message?: string };
  result?: { tools?: unknown[]; content?: Array<{ type?: string; text?: string }>; isError?: boolean };
}

/** Default total timeout per server probe. Cold Python servers (uvx, pipx) can
 *  legitimately take 8–10s on first run; 12s gives headroom without making
 *  the all-servers probe drag on a healthy machine. */
export const DEFAULT_PROBE_TIMEOUT_MS = 12_000;

/** Deep tier adds a tools/call after init + tools/list. Browser MCPs (playwright,
 *  chrome-devtools) cold-start Chromium on first launch and routinely exceed
 *  the fast-tier budget — 30s keeps interactive `mcp probe --deep` honest
 *  without blocking the 30-min scheduler (which uses fast tier only). */
export const DEEP_PROBE_TIMEOUT_MS = 30_000;

/** Default JSON-RPC ID values. Picked to avoid collision with any server's
 *  internal IDs. */
const INIT_ID = 1;
const TOOLS_LIST_ID = 2;
const SMOKE_CALL_ID = 3;

export type ProbeStatus =
  | "ok"
  | "ok_deep_failed"
  | "launch_failed"
  | "init_timeout"
  | "init_error"
  | "tools_list_failed"
  | "tools_list_empty"
  | "tools_list_timeout"
  | "smoke_call_failed"
  | "skipped_no_command"
  | "skipped_local_app_offline";

export interface DeepSmokeSpec {
  /** Tool name to call (must exist in the server's tools/list). */
  tool: string;
  /** Arguments to pass to the tool. Should be safe (read-only). */
  arguments?: Record<string, unknown>;
  /** Expected JSON-RPC outcome — `ok` means no `error` field on the response. */
  expect?: "no_error" | "result_truthy";
}

export interface ProbeOptions {
  /** Total wait budget for this probe (init + tools/list + optional deep). */
  timeoutMs?: number;
  /** When set, run a deep smoke call after tools/list succeeds. */
  deep?: DeepSmokeSpec;
  /** Override env passed to child. Defaults to process.env merged with spec.env. */
  extraEnv?: Record<string, string>;
  /** Env var names to STRIP from the inherited env before launching the child.
   *  Used for host-specific MCPs (e.g. github) where inheriting a
   *  cross-host token causes 401s. */
  stripEnv?: readonly string[];
  /**
   * Child process working directory. Defaults to the user home directory so
   * LaunchAgent probes (which otherwise inherit `/`) never hand MCP servers a
   * filesystem-root cwd. Override in tests when a fixture tree is required.
   */
  cwd?: string;
  /** Fetch implementation override for URL probes and deterministic tests. */
  fetchImpl?: typeof fetch;
}

export interface ProbeResult {
  /** Server name as registered in the agent config. */
  name: string;
  /** Agent label (`claude-code`, `cursor`, `codex`, …). */
  agent: string;
  status: ProbeStatus;
  /** Total elapsed milliseconds from spawn to result. */
  latencyMs: number;
  /** Count of tools advertised by the server (`tools/list` response). */
  toolsCount?: number;
  /** Tool name that was deep-probed (when `deep` was set). */
  deepTool?: string;
  /** Last error message captured (stderr tail or JSON-RPC error). */
  error?: string;
}

function httpProbeStatus(error: unknown): ProbeStatus {
  if (!(error instanceof StreamableHttpError)) return "init_error";
  if (error.kind === "timeout") {
    return error.stage === "tools/list" ? "tools_list_timeout" : "init_timeout";
  }
  if (error.stage === "tools/list") {
    return error.kind === "empty" ? "tools_list_empty" : "tools_list_failed";
  }
  return "init_error";
}

async function probeHttpMcpServer(
  name: string,
  agent: string,
  spec: McpProbeSpec,
  options: ProbeOptions,
  t0: number,
): Promise<ProbeResult> {
  // Behind a TLS-inspecting proxy an untrusted corporate root turns every
  // remote MCP into `fetch failed`, which is indistinguishable from an outage.
  installCorporateTrust();
  try {
    const handshake = await performStreamableHttpHandshake({
      url: spec.url,
      headers: spec.headers,
      timeoutMs: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
      clientName: "agentbrew-probe",
      clientVersion: "1.0.0",
      protocolVersion: "2025-06-18",
    });
    return {
      name,
      agent,
      status: "ok",
      latencyMs: Date.now() - t0,
      toolsCount: handshake.tools.length,
    };
  } catch (error) {
    const offline = localAppOfflineMessage(spec.url, error);
    return {
      name,
      agent,
      status: offline ? "skipped_local_app_offline" : httpProbeStatus(error),
      latencyMs: Date.now() - t0,
      error: offline ?? (error instanceof Error ? error.message : String(error)),
    };
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * IDE and desktop-app MCP servers (WebStorm, Figma desktop) listen on a
 * loopback port only while the app runs. A refused connection there means the
 * app is closed, not that the server is broken.
 */
export function localAppOfflineMessage(url: string | undefined, error: unknown): string | undefined {
  if (!url || !(error instanceof StreamableHttpError) || error.networkCode !== "ECONNREFUSED") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return undefined;
  return `nothing is listening on ${parsed.host} — start the app that serves this MCP`;
}

function buildProbeEnvironment(spec: McpProbeSpec, options: ProbeOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  for (const key of options.stripEnv ?? []) delete env[key];
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (typeof value !== "string") continue;
    const resolved = fromCanonical(value, "literal");
    if (resolved !== "") env[key] = resolved;
  }
  for (const [key, value] of Object.entries(options.extraEnv ?? {})) {
    env[key] = value;
  }
  return env;
}

/**
 * How long a probe child may take to honour SIGTERM before it is killed.
 *
 * Long enough for a server to close its transport cleanly, short enough that a
 * scheduled repair run does not visibly stall on it.
 */
export const CHILD_KILL_GRACE_MS = 2_000;

/**
 * Stop a probe child, escalating to SIGKILL if it ignores SIGTERM.
 *
 * Resolving the probe promise does not end the probe: the child's piped stdio
 * keeps Node's event loop alive, so a server that traps SIGTERM leaves the
 * whole command running long after every result is known. That is how a
 * 12-second probe wedged `agentbrew status --fix` for fifteen minutes — and
 * because that command runs from a LaunchAgent every 30 minutes, a wedged run
 * silently stops the auto-repair the user is relying on.
 *
 * The grace timer is unref'd so it never keeps the loop alive on its own; if
 * the child already exited, Node exits and the timer is simply never needed.
 */
function terminateChild(child: ChildProcess): void {
  const hasExited = (): boolean => child.exitCode !== null || child.signalCode !== null;
  try {
    child.kill("SIGTERM");
  } catch {
    return; // child may already be gone — non-fatal.
  }
  if (hasExited()) return;
  const grace = setTimeout(() => {
    if (hasExited()) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // raced with a normal exit — non-fatal.
    }
  }, CHILD_KILL_GRACE_MS);
  grace.unref();
}

/**
 * Probe a single MCP server. Returns a `ProbeResult` describing the outcome.
 *
 * The function spawns `spec.command` with `spec.args`, sends an `initialize`
 * frame, waits for the response, then sends `tools/list`. If `options.deep`
 * is provided, also issues `tools/call` against the named tool.
 *
 * **Never throws** — every error is captured into the returned `ProbeResult`.
 * **Always kills the child** before returning — SIGTERM first, then SIGKILL
 * after {@link CHILD_KILL_GRACE_MS} if the server ignores it.
 */
export async function probeMcpServer(
  name: string,
  agent: string,
  spec: McpProbeSpec,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const t0 = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  // URL transports use the same Streamable HTTP discovery contract as the
  // managed memory daemon. Keep them in the regular result stream so health,
  // heal, and snapshot reporting can see failures instead of treating them as
  // an unprobed configuration.
  if (spec.url && !spec.command) {
    return probeHttpMcpServer(name, agent, spec, options, t0);
  }

  if (!spec.command) {
    return {
      name,
      agent,
      status: "skipped_no_command",
      latencyMs: 0,
      error: "no command and no url",
    };
  }

  // Build the child env. Strip user-specified problem vars FIRST (so even if
  // the spec re-injects them they don't leak), then layer the spec's env and
  // any extras. Order: process.env → strip → spec.env → extraEnv.
  const env = buildProbeEnvironment(spec, options);

  return new Promise<ProbeResult>((resolve) => {
    let child: ChildProcess;
    try {
      // Never inherit LaunchAgent cwd `/` — MCP servers that scan from cwd
      // (tasks-mcp list_tasks) must not walk the whole filesystem.
      const cwd = options.cwd ?? homedir();
      child = spawn(spec.command as string, [...(spec.args ?? [])], {
        env,
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        name,
        agent,
        status: "launch_failed",
        latencyMs: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let stdoutBuf = "";
    let stderrTail = "";
    let initOk = false;
    let toolsCount = 0;
    let lastJsonRpcError = "";
    let resolved = false;

    const cleanup = (final: ProbeResult): void => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      terminateChild(child);
      resolve(final);
    };

    const timer = setTimeout(() => {
      cleanup({
        name,
        agent,
        status: initOk ? "tools_list_timeout" : "init_timeout",
        latencyMs: Date.now() - t0,
        toolsCount: initOk ? toolsCount : undefined,
        error: lastJsonRpcError || stderrTail || `no response within ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      cleanup({
        name,
        agent,
        status: "launch_failed",
        latencyMs: Date.now() - t0,
        error: err.message,
      });
    });

    child.stderr?.on("data", (d) => {
      // Keep the last 200 chars of stderr — enough for an error message snippet,
      // not so much that we hold a server's full log noise in memory.
      stderrTail = (stderrTail + d.toString()).slice(-200);
    });

    /** Parse a single JSON-RPC frame from the server. Returns the typed
     *  message, or undefined if the line is not valid JSON (servers
     *  routinely emit log lines on stdout before the protocol takes over). */
    const parseFrame = (line: string): JsonRpcFrame | undefined => {
      try {
        return JSON.parse(line) as JsonRpcFrame;
      } catch {
        return undefined;
      }
    };

    /** Handle the init response. Mutates `initOk` and `lastJsonRpcError`,
     *  cleans up on error, otherwise writes the tools/list request. */
    const handleInitFrame = (m: JsonRpcFrame): void => {
      if (m.error) {
        lastJsonRpcError = m.error.message ?? JSON.stringify(m.error);
        cleanup({ name, agent, status: "init_error", latencyMs: Date.now() - t0, error: lastJsonRpcError });
        return;
      }
      initOk = true;
      try {
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
        child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id: TOOLS_LIST_ID, method: "tools/list" })}\n`);
      } catch (err) {
        cleanup({
          name,
          agent,
          status: "tools_list_failed",
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    /** Issue the deep smoke `tools/call` request. Called from handleToolsListFrame. */
    const sendSmokeCall = (): void => {
      if (!options.deep) return;
      try {
        child.stdin?.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: SMOKE_CALL_ID,
            method: "tools/call",
            params: { name: options.deep.tool, arguments: options.deep.arguments ?? {} },
          })}\n`,
        );
      } catch (err) {
        cleanup({
          name,
          agent,
          status: "smoke_call_failed",
          latencyMs: Date.now() - t0,
          toolsCount,
          deepTool: options.deep.tool,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    };

    /** Handle the tools/list response. On success, either resolves with `ok`
     *  (fast tier) or issues the deep smoke call. On JSON-RPC error, cleans
     *  up with `tools_list_failed`. */
    const handleToolsListFrame = (m: JsonRpcFrame): void => {
      if (m.error) {
        cleanup({
          name,
          agent,
          status: "tools_list_failed",
          latencyMs: Date.now() - t0,
          toolsCount: 0,
          error: m.error.message ?? JSON.stringify(m.error),
        });
        return;
      }
      toolsCount = Array.isArray(m.result?.tools) ? m.result.tools.length : 0;
      if (!options.deep) {
        cleanup({ name, agent, status: "ok", latencyMs: Date.now() - t0, toolsCount });
        return;
      }
      sendSmokeCall();
    };

    /** Handle the deep smoke tools/call response. Catches both transport
     *  errors and inline content errors (the github 401 shape). */
    const handleSmokeCallFrame = (m: JsonRpcFrame): void => {
      // For tools/call, JSON-RPC `error` is transport-level; the tool's
      // own error often hides inside `result.content[0].text`.
      const callResult = m.result as
        | { isError?: boolean; content?: Array<{ type?: string; text?: string }> }
        | undefined;
      const errorText = m.error ? (m.error.message ?? JSON.stringify(m.error)) : detectInlineToolError(callResult);
      const status: ProbeStatus = errorText ? "smoke_call_failed" : "ok";
      const deepTool = options.deep?.tool;
      cleanup({
        name,
        agent,
        status,
        latencyMs: Date.now() - t0,
        toolsCount,
        deepTool,
        ...(errorText ? { error: errorText } : {}),
      });
    };

    /** Split the rolling stdout buffer into newline-terminated lines and
     *  return them along with the residual partial line. Pure — no I/O. */
    const drainLines = (buf: string): { lines: string[]; rest: string } => {
      const lines: string[] = [];
      let rest = buf;
      let nl = rest.indexOf("\n");
      while (nl >= 0) {
        const line = rest.slice(0, nl).trim();
        rest = rest.slice(nl + 1);
        if (line) lines.push(line);
        nl = rest.indexOf("\n");
      }
      return { lines, rest };
    };

    /** Dispatch a single parsed frame to the appropriate handler. */
    const dispatchFrame = (m: JsonRpcFrame): void => {
      if (m.id === INIT_ID) handleInitFrame(m);
      else if (m.id === TOOLS_LIST_ID) handleToolsListFrame(m);
      else if (m.id === SMOKE_CALL_ID && options.deep) handleSmokeCallFrame(m);
    };

    child.stdout?.on("data", (d) => {
      stdoutBuf += d.toString();
      const { lines, rest } = drainLines(stdoutBuf);
      stdoutBuf = rest;
      for (const line of lines) {
        const m = parseFrame(line);
        if (m) dispatchFrame(m);
      }
    });

    // Send the initialize frame after the child is fully spawned.
    setTimeout(() => {
      try {
        child.stdin?.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: INIT_ID,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "agentbrew-probe", version: "1.0.0" },
            },
          })}\n`,
        );
      } catch (err) {
        cleanup({
          name,
          agent,
          status: "launch_failed",
          latencyMs: Date.now() - t0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }, 50);
  });
}

/**
 * Inspect a `tools/call` response body for inline errors. Many MCP servers
 * return HTTP/API errors as text content with `isError: false` (the
 * organization-github-mcp 401 reproduction is a canonical example). Detect common
 * shapes so deep-tier smoke flags them as failures rather than passes.
 */
function isListTasksSuccessPayload(text: string): boolean {
  if (!text.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(text) as { summary?: unknown; tasks?: unknown };
    return typeof parsed.summary === "string" && Array.isArray(parsed.tasks);
  } catch {
    return /"summary"\s*:/.test(text.slice(0, 500)) && /"tasks"\s*:\s*\[/.test(text.slice(0, 2000));
  }
}

function detectInlineToolError(
  result: { isError?: boolean; content?: Array<{ type?: string; text?: string }> } | undefined,
): string | undefined {
  if (!result) return undefined;
  if (result.isError === true) {
    return result.content?.[0]?.text?.slice(0, 200) ?? "isError=true with no content";
  }
  const text = result.content?.[0]?.text;
  if (!text) return undefined;
  if (isListTasksSuccessPayload(text)) return undefined;
  // Detect JSON-shaped tool errors with a top-level `error` field only.
  // Do not treat arbitrary JSON payloads (e.g. tasks-mcp list_tasks) as errors
  // just because nested strings contain the substring "error".
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (parsed.error !== undefined && parsed.error !== null) {
        if (typeof parsed.error === "string") return parsed.error.slice(0, 200);
        return JSON.stringify(parsed.error).slice(0, 200);
      }
    } catch {
      // fall through to HTTP-status substring check
    }
  }
  // Detect common HTTP-status error strings
  if (/\b(401|403|404|500|502|503)\b.*Unauthorized|Unauthorized.*\b401\b|Forbidden.*\b403\b/i.test(text)) {
    return text.slice(0, 200);
  }
  return undefined;
}

/**
 * Probe every MCP server across the given agent surfaces. Returns flattened
 * `ProbeResult[]` with one entry per (server, agent) pair.
 *
 * `surfaces` is a list of `{ agent, servers }` objects — typically derived
 * from `readMcpConfig()` per agent. Reading each agent's config is the
 * caller's responsibility because the probe module stays I/O-free for the
 * config-file layer (easier to test, no circular dep on mcp.ts).
 */
export async function probeAllServers(
  surfaces: Array<{ agent: string; servers: Record<string, McpProbeSpec> }>,
  options: {
    deep?: ReadonlyMap<string, DeepSmokeSpec>;
    stripEnvByServer?: ReadonlyMap<string, readonly string[]>;
    /** Per-server timeout override (ms). When unset, deep probes use DEEP_PROBE_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Fetch implementation override for URL probes and deterministic tests. */
    fetchImpl?: typeof fetch;
    /**
     * Unattended runs (the scheduler) never send a tool call to a
     * browser-launching server, whatever its name: that call would open a
     * visible browser window. initialize + tools/list still run.
     */
    unattended?: boolean;
  } = {},
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  // The probe starts the server itself, so the agent only labels the result.
  // Agents share synced specs; each distinct (name, spec) is started once.
  const probed = new Map<string, ProbeResult>();
  for (const surface of surfaces) {
    for (const [name, spec] of Object.entries(surface.servers)) {
      const key = probeSpecKey(name, spec);
      const shared = probed.get(key);
      if (shared) {
        results.push({ ...shared, agent: surface.agent });
        continue;
      }
      const deep = options.unattended && isBrowserLaunchingSpec(spec) ? undefined : options.deep?.get(name);
      const stripEnv = options.stripEnvByServer?.get(name);
      const timeoutMs = options.timeoutMs ?? (deep ? DEEP_PROBE_TIMEOUT_MS : DEFAULT_PROBE_TIMEOUT_MS);
      const result = await probeMcpServer(name, surface.agent, spec, {
        deep,
        stripEnv,
        timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      probed.set(key, result);
      results.push(result);
    }
  }
  return results;
}

function sortedEntries(record: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b));
}

function probeSpecKey(name: string, spec: McpProbeSpec): string {
  return JSON.stringify([
    name,
    spec.command ?? null,
    spec.args ?? [],
    sortedEntries(spec.env),
    spec.url ?? null,
    sortedEntries(spec.headers),
  ]);
}

/**
 * Built-in deep smoke specs for the canonical catalog MCPs. Used when the
 * caller doesn't supply its own deep map. Each spec is intentionally
 * conservative — read-only, low-cost, and tolerant of empty/missing args.
 *
 * To add a new server: pick the cheapest read-only tool the server exposes
 * and supply args that don't depend on user state. `get_authenticated_user`
 * for github, `resolve-library-id` with a well-known library for context7,
 * etc.
 */
export const BUILTIN_DEEP_SMOKE: Readonly<Record<string, DeepSmokeSpec>> = Object.freeze({
  // Legacy fallback for users running with an older catalog cache.
  github: { tool: "search_repositories", arguments: { query: "organization-mcp" } },
});

/**
 * Servers that need specific env vars stripped from the inherited environment
 * before launch. This is the durable form of the github token fix:
 * the launcher resolves the right token from the gh keyring, but only if a
 * pre-existing GITHUB_TOKEN (from `~/.zshenv.secrets`) doesn't shadow it.
 *
 * Probe-time stripping replicates the in-launcher fix at the probe layer so
 * the probe sees the same env the launcher will actually use at agent-spawn
 * time, not a mocked-up "but with GITHUB_TOKEN unset" world that doesn't
 * match production. The two layers MUST agree on which env vars to strip,
 * or the probe will green-light a config that fails at runtime.
 */
export const BUILTIN_ENV_STRIP_BY_SERVER: ReadonlyMap<string, readonly string[]> = new Map([
  ["github", ["GITHUB_TOKEN"]],
]);
