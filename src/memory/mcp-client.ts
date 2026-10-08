import { MCP_INTERSECTION_AGENTS } from "../core/mcp-agent-map.js";
import type { AgentBrewState } from "../types.js";
import {
  MEMORY_MANAGED_SERVER_NAME,
  MEMORY_MANAGED_SOURCE,
  MEMORY_MCP_HOST,
  MEMORY_MCP_PORT,
  MEMORY_MCP_URL,
} from "./constants.js";

export interface MemoryMcpMemoryRow {
  id: string;
  content: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryIngestOptions {
  directoryPath: string;
  fileExtensions: string[];
  recursive: boolean;
  memoryType: string;
  chunkSize: number;
  tags: string[];
}

export interface MemoryIngestResult {
  chunksStored: number;
}

export interface MemoryMcpClient {
  initialize(): Promise<boolean>;
  bootstrapProfileEnabled(): Promise<boolean>;
  tagMatch(tags: string[], matchAll?: boolean): Promise<MemoryMcpMemoryRow[]>;
  memorySearch(query: string, mode?: "semantic" | "exact" | "hybrid" | "ranked"): Promise<MemoryMcpMemoryRow[]>;
  memoryIngest(options: MemoryIngestOptions): Promise<MemoryIngestResult>;
  memoryStore(content: string, tags: string[], conversationId?: string): Promise<string | undefined>;
  memoryUpdate(
    id: string,
    content: string,
    tags: string[],
    options?: { versioned?: boolean },
  ): Promise<string | undefined>;
  memoryDelete(id: string): Promise<boolean>;
}

export interface FetchMemoryMcpClientOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export type StreamableHttpHandshakeStage = "initialize" | "notifications/initialized" | "tools/list";

export type StreamableHttpErrorKind = "timeout" | "http" | "rpc" | "empty" | "invalid_response";

export interface McpJsonRpcError {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface McpJsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: McpJsonRpcError;
}

export class StreamableHttpError extends Error {
  constructor(
    message: string,
    readonly stage: StreamableHttpHandshakeStage,
    readonly kind: StreamableHttpErrorKind,
    readonly status?: number,
    /** Socket error code behind a failed fetch, e.g. `ECONNREFUSED`. */
    readonly networkCode?: string,
  ) {
    super(message);
    this.name = "StreamableHttpError";
  }
}

/** `fetch` hides the socket error in `cause`; surface its code when present. */
export function networkErrorCode(error: unknown): string | undefined {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined;
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : undefined;
}

export interface StreamableHttpHandshakeOptions {
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  protocolVersion?: string;
  clientName?: string;
  clientVersion?: string;
  headers?: Record<string, string>;
}

export interface StreamableHttpHandshakeResult {
  initialize: McpJsonRpcResponse;
  tools: unknown[];
  sessionId?: string;
}

const DEFAULT_MCP_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_CLIENT_NAME = "agentbrew";
const DEFAULT_CLIENT_VERSION = "1.0.0";
const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const DEFAULT_MEMORY_OPERATION_TIMEOUT_MS = 120_000;
const PRIMARY_MEMORY_AGENTS = ["claude-code", "cursor", "codex"] as const;

type PrimaryMemoryAgent = (typeof PRIMARY_MEMORY_AGENTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parse a Streamable HTTP response body. MCP servers may return one JSON-RPC
 * response as application/json or wrap it in a text/event-stream `data:`
 * frame. Ignore SSE comments/metadata and return the first valid JSON-RPC
 * object.
 */
export function parseMcpResponseBody(body: string): McpJsonRpcResponse | undefined {
  const trimmed = body.trim();
  if (!trimmed) return undefined;

  const parseCandidate = (candidate: string): McpJsonRpcResponse | undefined => {
    if (!candidate || candidate === "[DONE]") return undefined;
    try {
      const parsed: unknown = JSON.parse(candidate);
      return isRecord(parsed) ? (parsed as McpJsonRpcResponse) : undefined;
    } catch {
      return undefined;
    }
  };

  const direct = parseCandidate(trimmed);
  if (direct) return direct;

  for (const event of trimmed.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""))
      .join("\n")
      .trim();
    const parsed = parseCandidate(data);
    if (parsed) return parsed;
  }

  return undefined;
}

function responseSessionId(response: Response): string | undefined {
  return response.headers.get("MCP-Session-Id") ?? response.headers.get("Mcp-Session-Id") ?? undefined;
}

function stageForMethod(method: string): StreamableHttpHandshakeStage {
  if (method === "initialize") return "initialize";
  if (method === "notifications/initialized") return "notifications/initialized";
  return "tools/list";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class McpRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpRequestTimeoutError";
  }
}

async function withMcpRequestTimeout<T>(
  timeoutMs: number,
  message: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new McpRequestTimeoutError(message));
      }, timeoutMs);
      operation(controller.signal).then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildRpcPayload(method: string, params?: Record<string, unknown>, id?: number): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    method,
    ...(params === undefined ? {} : { params }),
  };
}

function buildRpcHeaders(base: Record<string, string>, sessionId?: string): Record<string, string> {
  return {
    ...base,
    ...(sessionId ? { "MCP-Session-Id": sessionId } : {}),
  };
}

async function sendMcpRequest(options: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string>;
  payload: Record<string, unknown>;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<{ response: Response; body: string }> {
  return withMcpRequestTimeout(options.timeoutMs, options.timeoutMessage, async (signal) => {
    const response = await options.fetchImpl(options.url, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.payload),
      signal,
    });
    return { response, body: await response.text() };
  });
}

function parseStreamableResponse(
  method: StreamableHttpHandshakeStage,
  response: Response,
  body: string,
): McpJsonRpcResponse | undefined {
  const stage = stageForMethod(method);
  if (!response.ok) {
    throw new StreamableHttpError(
      `MCP ${method} returned HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      stage,
      "http",
      response.status,
    );
  }
  // JSON-RPC notifications carry no response payload. Servers legitimately answer
  // with 202 + empty body, `null`, or `{}` (JetBrains IDEs send `null`), so any
  // non-error HTTP status ends this stage successfully.
  if (method === "notifications/initialized") return undefined;
  const parsed = parseMcpResponseBody(body);
  if (!parsed) {
    throw new StreamableHttpError(
      `MCP ${method} returned an empty or invalid JSON/SSE response`,
      stage,
      "invalid_response",
      response.status,
    );
  }
  if (parsed.error) {
    throw new StreamableHttpError(parsed.error.message ?? JSON.stringify(parsed.error), stage, "rpc", response.status);
  }
  return parsed;
}

function parseMcpResult(response: Response, body: string): unknown {
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  if (!body.trim()) return undefined;
  const frame = parseMcpResponseBody(body);
  if (!frame) throw new Error("empty MCP response");
  if (frame.error) throw new Error(frame.error.message ?? "MCP error");
  return frame.result;
}

/**
 * Execute the MCP Streamable HTTP discovery contract:
 * initialize → notifications/initialized → tools/list.
 *
 * The returned session ID is automatically copied to every request after
 * initialize. The function intentionally does not restart services or mutate
 * agent configuration; it is a read-only readiness probe.
 */
export async function performStreamableHttpHandshake(
  options: StreamableHttpHandshakeOptions = {},
): Promise<StreamableHttpHandshakeResult> {
  const url = options.url ?? MEMORY_MCP_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const protocolVersion = options.protocolVersion ?? DEFAULT_MCP_PROTOCOL_VERSION;
  const clientName = options.clientName ?? DEFAULT_CLIENT_NAME;
  const clientVersion = options.clientVersion ?? DEFAULT_CLIENT_VERSION;
  let sessionId: string | undefined;
  let requestId = 0;

  const request = async (
    method: StreamableHttpHandshakeStage,
    params?: Record<string, unknown>,
    id?: number,
  ): Promise<McpJsonRpcResponse | undefined> => {
    const payload = buildRpcPayload(method, params, id);
    const headers = buildRpcHeaders(
      {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
      sessionId,
    );

    try {
      const { response, body } = await sendMcpRequest({
        fetchImpl,
        url,
        headers,
        payload,
        timeoutMs,
        timeoutMessage: `MCP ${method} timed out after ${timeoutMs}ms`,
      });
      const responseSession = responseSessionId(response);
      if (responseSession) sessionId = responseSession;
      return parseStreamableResponse(method, response, body);
    } catch (error) {
      if (error instanceof StreamableHttpError) throw error;
      if (error instanceof McpRequestTimeoutError) {
        throw new StreamableHttpError(
          `MCP ${method} timed out after ${timeoutMs}ms`,
          stageForMethod(method),
          "timeout",
        );
      }
      const code = networkErrorCode(error);
      throw new StreamableHttpError(
        `MCP ${method} request failed: ${errorMessage(error)}${code ? ` (${code})` : ""}`,
        stageForMethod(method),
        "http",
        undefined,
        code,
      );
    }
  };

  const initialize = await request(
    "initialize",
    {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    },
    ++requestId,
  );
  if (!initialize?.result || !isRecord(initialize.result)) {
    throw new StreamableHttpError("MCP initialize returned no result", "initialize", "invalid_response");
  }

  await request("notifications/initialized");
  const toolsResponse = await request("tools/list", undefined, ++requestId);
  const toolsResult = toolsResponse?.result;
  const tools = isRecord(toolsResult) ? toolsResult.tools : undefined;
  if (!Array.isArray(tools)) {
    throw new StreamableHttpError("MCP tools/list returned no tools array", "tools/list", "invalid_response");
  }
  if (tools.length === 0) {
    throw new StreamableHttpError("MCP tools/list returned an empty tool set", "tools/list", "empty");
  }

  return { initialize, tools, sessionId };
}

export interface MemoryTransportProbe {
  ok: boolean;
  detail: string;
  elapsedMs: number;
  stage?: StreamableHttpHandshakeStage;
  kind?: StreamableHttpErrorKind;
  httpStatus?: number;
}

export interface MemoryOriginTransportReport {
  invalidOrigin: MemoryTransportProbe;
  policy: "enforced" | "permissive" | "unknown";
}

export interface PrimaryMemoryAgentTransport {
  agent: PrimaryMemoryAgent;
  detected: boolean;
  delivery: "mcpm" | "native";
  managedRegistration: boolean;
  endpoint: string | null;
  currentEndpointSupported: boolean;
  migrationEvidence: string;
}

export interface MemoryTransportReport {
  schema: "agentbrew.memory.transport-report/v1";
  requestedProtocolVersion: string;
  endpoint: {
    url: string;
    host: string | null;
    port: number | null;
    loopbackOnly: boolean;
    expectedHost: string;
    expectedPort: number;
  };
  availability: MemoryTransportProbe;
  session: {
    serverProtocolVersion: string | null;
    sessionIdObserved: boolean;
    detail: string;
  };
  origin: MemoryOriginTransportReport;
  unauthenticatedAccess: {
    accepted: boolean;
    detail: string;
  };
  timeoutAndCancellation: {
    discoveryTimeoutMs: number;
    operationTimeoutMs: number;
    cancellation: "AbortSignal";
  };
  primaryAgents: PrimaryMemoryAgentTransport[];
  hardeningGate: {
    ready: false;
    blockers: string[];
  };
}

export interface BuildMemoryTransportReportOptions {
  url?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  state?: Pick<AgentBrewState, "agents" | "mcpServers">;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

function describeProbeError(error: unknown, elapsedMs: number): MemoryTransportProbe {
  if (error instanceof StreamableHttpError) {
    return {
      ok: false,
      detail: error.message,
      elapsedMs,
      stage: error.stage,
      kind: error.kind,
      ...(error.status === undefined ? {} : { httpStatus: error.status }),
    };
  }
  return { ok: false, detail: errorMessage(error), elapsedMs, kind: "http" };
}

async function handshakeProbe(
  options: StreamableHttpHandshakeOptions,
): Promise<{ probe: MemoryTransportProbe; handshake?: StreamableHttpHandshakeResult }> {
  const startedAt = Date.now();
  try {
    const handshake = await performStreamableHttpHandshake(options);
    return {
      probe: {
        ok: true,
        detail: `discovered ${handshake.tools.length} tools`,
        elapsedMs: Date.now() - startedAt,
      },
      handshake,
    };
  } catch (error) {
    return { probe: describeProbeError(error, Date.now() - startedAt) };
  }
}

function serverProtocolVersion(handshake: StreamableHttpHandshakeResult | undefined): string | null {
  const result = handshake?.initialize.result;
  if (!isRecord(result) || typeof result.protocolVersion !== "string") return null;
  return result.protocolVersion;
}

function managedRegistration(state: BuildMemoryTransportReportOptions["state"], endpoint: string): boolean {
  const memory = state?.mcpServers?.find((server) => server.name === MEMORY_MANAGED_SERVER_NAME);
  return (
    memory !== undefined &&
    memory.source === MEMORY_MANAGED_SOURCE &&
    memory.command === "" &&
    Array.isArray(memory.args) &&
    memory.args.length === 0 &&
    memory.url === endpoint &&
    memory.headers === undefined
  );
}

export function buildPrimaryMemoryAgentTransport(
  state: BuildMemoryTransportReportOptions["state"],
  endpoint = MEMORY_MCP_URL,
): PrimaryMemoryAgentTransport[] {
  const registered = managedRegistration(state, endpoint);
  return PRIMARY_MEMORY_AGENTS.map((agent) => {
    const detected = state?.agents.find((candidate) => candidate.name === agent)?.detected ?? false;
    const delivery = MCP_INTERSECTION_AGENTS.has(agent) ? "mcpm" : "native";
    return {
      agent,
      detected,
      delivery,
      managedRegistration: registered,
      endpoint: registered ? endpoint : null,
      currentEndpointSupported: registered,
      migrationEvidence:
        "Current loopback endpoint is state-managed; client-specific sessionless/auth support is not yet proven.",
    };
  });
}

/**
 * Produce read-only evidence for a future transport/authentication migration.
 * It intentionally preserves the installed 2025-06-18 session handshake and
 * never sends memory tool calls, credentials, or configuration writes.
 */
export async function buildMemoryTransportReport(
  options: BuildMemoryTransportReportOptions = {},
): Promise<MemoryTransportReport> {
  const url = options.url ?? MEMORY_MCP_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(url);
  } catch {
    // The availability probe below gives the operator the concrete failure.
  }
  const endpoint = {
    url,
    host: parsedUrl?.hostname ?? null,
    port: parsedUrl?.port ? Number(parsedUrl.port) : null,
    loopbackOnly: parsedUrl ? isLoopbackHost(parsedUrl.hostname) : false,
    expectedHost: MEMORY_MCP_HOST,
    expectedPort: MEMORY_MCP_PORT,
  };
  const baseOptions: StreamableHttpHandshakeOptions = {
    url,
    fetchImpl,
    timeoutMs,
    protocolVersion: DEFAULT_MCP_PROTOCOL_VERSION,
    clientName: "agentbrew-transport-report",
    clientVersion: "1",
  };
  const baseline = await handshakeProbe(baseOptions);
  const invalidOrigin = await handshakeProbe({
    ...baseOptions,
    headers: { Origin: "https://agentbrew.invalid" },
  });
  const originPolicy = invalidOrigin.probe.ok
    ? "permissive"
    : invalidOrigin.probe.httpStatus === 403
      ? "enforced"
      : "unknown";
  const reportedProtocol = serverProtocolVersion(baseline.handshake);
  const sessionIdObserved = Boolean(baseline.handshake?.sessionId);
  const blockers = [
    !endpoint.loopbackOnly ? "Endpoint is not loopback-only." : "",
    !baseline.probe.ok ? "The current session-based discovery handshake is unavailable." : "",
    originPolicy !== "enforced" ? "Origin validation has not been proven for an invalid web origin." : "",
    "Every primary client still needs a client-specific sessionless/auth compatibility probe.",
  ].filter(Boolean);

  return {
    schema: "agentbrew.memory.transport-report/v1",
    requestedProtocolVersion: DEFAULT_MCP_PROTOCOL_VERSION,
    endpoint,
    availability: baseline.probe,
    session: {
      serverProtocolVersion: reportedProtocol,
      sessionIdObserved,
      detail: sessionIdObserved
        ? "The server issued an MCP-Session-Id for the legacy session-based handshake."
        : "No MCP-Session-Id was observed; AgentBrew still preserves the legacy header when issued.",
    },
    origin: { invalidOrigin: invalidOrigin.probe, policy: originPolicy },
    unauthenticatedAccess: {
      accepted: baseline.probe.ok,
      detail: baseline.probe.ok
        ? "The managed endpoint accepted discovery without an Authorization header."
        : "Unauthenticated access could not be established because discovery failed.",
    },
    timeoutAndCancellation: {
      discoveryTimeoutMs: timeoutMs,
      operationTimeoutMs: DEFAULT_MEMORY_OPERATION_TIMEOUT_MS,
      cancellation: "AbortSignal",
    },
    primaryAgents: buildPrimaryMemoryAgentTransport(options.state, url),
    hardeningGate: { ready: false, blockers },
  };
}

function rowFromMemoryEntry(entry: unknown): MemoryMcpMemoryRow | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const row = entry as Record<string, unknown>;
  const id = String(row.id ?? row.memory_id ?? row.content_hash ?? "");
  const content = String(row.content ?? row.text ?? "");
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  if (!id) return undefined;
  const parsed: MemoryMcpMemoryRow = { id, content, tags };
  if (row.metadata && typeof row.metadata === "object") {
    parsed.metadata = row.metadata as Record<string, unknown>;
  }
  return parsed;
}

function extractMemories(result: unknown): MemoryMcpMemoryRow[] {
  if (!result || typeof result !== "object") return [];
  const obj = result as Record<string, unknown>;
  const raw = obj.memories ?? obj.results ?? obj.items ?? obj.content;
  if (!Array.isArray(raw)) return [];
  const rows: MemoryMcpMemoryRow[] = [];
  for (const entry of raw) {
    const parsed = rowFromMemoryEntry(entry);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

function memoryIdFromContentBlock(block: unknown): string | undefined {
  if (!block || typeof block !== "object") return undefined;
  const text = (block as { text?: string }).text;
  if (typeof text !== "string") return undefined;
  const stored = text.match(/Memory stored successfully \(hash: ([a-f0-9]+)\)/i);
  if (stored?.[1]) return stored[1];
  const duplicate = text.match(/similar to ([a-f0-9]+)/i);
  if (duplicate?.[1]) return duplicate[1];
  const genericHash = text.match(/\bhash(?:\s+is|:)?\s*([a-f0-9]{16,})\b/i);
  if (genericHash?.[1]) return genericHash[1];
  try {
    const parsed = JSON.parse(text) as { id?: string };
    return parsed.id;
  } catch {
    return undefined;
  }
}

function parseMemorySearchResults(text: string): MemoryMcpMemoryRow[] {
  const rows: MemoryMcpMemoryRow[] = [];
  const blocks = text.includes("=== Memory ")
    ? text.split(/=== Memory \d+ ===/).slice(1)
    : text.split(/\n\d+\. /).slice(1);
  for (const block of blocks) {
    const hashMatch = block.match(/Hash: ([a-f0-9]+)/i);
    if (!hashMatch) continue;
    const tagLine = block.match(/\nTags:\s*(.+)$/m) ?? block.match(/\n\s*\[(.+?)\]\s*$/m);
    const tags = tagLine?.[1]
      ? tagLine[1]
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];
    const contentMatch = block.match(/Content:\s*([\s\S]*?)\nHash:/);
    const content = contentMatch?.[1]?.trim() ?? block.split(/\n\s*Hash:/)[0]?.trim() ?? "";
    rows.push({ id: hashMatch[1], content, tags });
  }
  return rows;
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((block) => block.text ?? "").join("\n");
}

function chunkCountFromValue(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["chunks_stored", "chunksStored", "stored_chunks"]) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) return candidate;
  }
  return undefined;
}

export function parseMemoryIngestResult(result: unknown): MemoryIngestResult {
  const root = result as { structuredContent?: unknown } | undefined;
  const structured = chunkCountFromValue(root?.structuredContent) ?? chunkCountFromValue(result);
  if (structured !== undefined) return { chunksStored: structured };

  const text = toolResultText(result);
  const match =
    text.match(/\bchunks?\s+stored\s*:\s*(\d+)\b/i) ??
    text.match(/\bstored\s+(\d+)\s+chunks?\b/i) ??
    text.match(/\b(\d+)\s+new\s+chunks?\b/i);
  return { chunksStored: match ? Number.parseInt(match[1], 10) : 0 };
}

function extractMemoryId(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const obj = result as Record<string, unknown>;
  if (typeof obj.id === "string") return obj.id;
  if (typeof obj.memory_id === "string") return obj.memory_id;
  if (Array.isArray(obj.content)) {
    for (const block of obj.content) {
      const id = memoryIdFromContentBlock(block);
      if (id) return id;
    }
  }
  return undefined;
}

export function createFetchMemoryMcpClient(options: FetchMemoryMcpClientOptions = {}): MemoryMcpClient {
  const url = options.url ?? MEMORY_MCP_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_MEMORY_OPERATION_TIMEOUT_MS;
  let requestId = 0;
  let sessionId: string | undefined;

  async function post(method: string, params?: Record<string, unknown>, requestIdOverride?: number): Promise<unknown> {
    const id = requestIdOverride ?? (method === "notifications/initialized" ? undefined : ++requestId);
    const headers = buildRpcHeaders(
      {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      sessionId,
    );
    try {
      const { response, body } = await sendMcpRequest({
        fetchImpl,
        url,
        headers,
        payload: buildRpcPayload(method, params, id),
        timeoutMs,
        timeoutMessage: `MCP request timed out after ${timeoutMs}ms`,
      });
      const responseSession = responseSessionId(response);
      if (responseSession) sessionId = responseSession;
      return parseMcpResult(response, body);
    } catch (error) {
      if (error instanceof McpRequestTimeoutError) throw new Error(`MCP request timed out after ${timeoutMs}ms`);
      throw error;
    }
  }

  return {
    async initialize() {
      try {
        await post("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "agentbrew-memory", version: "1" },
        });
        await post("notifications/initialized");
        return true;
      } catch {
        return false;
      }
    },
    async bootstrapProfileEnabled() {
      try {
        const result = await post("tools/call", {
          name: "get_bootstrap_profile",
          arguments: {
            agent_ids: ["agentbrew"],
            project_id: "agentbrew-memory-doctor",
            task_summary: "Verify behavioral bootstrap availability",
            max_tokens: 256,
          },
        });
        const text = toolResultText(result);
        return text.length > 0 && !/bootstrap disabled/i.test(text);
      } catch {
        return false;
      }
    },
    async tagMatch(tags, matchAll = true) {
      const result = await post("tools/call", {
        name: "memory_list",
        arguments: { tags, tag_match: matchAll ? "all" : "any", page_size: 100 },
      });
      const toolResult = result as { content?: Array<{ text?: string }>; structuredContent?: unknown };
      if (toolResult.structuredContent) {
        return extractMemories(toolResult.structuredContent);
      }
      for (const block of toolResult.content ?? []) {
        if (!block?.text) continue;
        try {
          return extractMemories(JSON.parse(block.text));
        } catch {
          // try next block
        }
      }
      return extractMemories(result);
    },
    async memorySearch(query, mode = "exact") {
      const result = await post("tools/call", {
        name: "memory_search",
        arguments: { query, mode, limit: 5 },
      });
      return parseMemorySearchResults(toolResultText(result));
    },
    async memoryIngest(options) {
      const result = await post("tools/call", {
        name: "memory_ingest",
        arguments: {
          directory_path: options.directoryPath,
          file_extensions: options.fileExtensions,
          recursive: options.recursive,
          memory_type: options.memoryType,
          chunk_size: options.chunkSize,
          tags: options.tags,
        },
      });
      return parseMemoryIngestResult(result);
    },
    async memoryStore(content, tags, conversationId) {
      const argumentsPayload: Record<string, unknown> = {
        content,
        metadata: { tags, type: "reference" },
      };
      if (conversationId) argumentsPayload.conversation_id = conversationId;
      const result = await post("tools/call", {
        name: "memory_store",
        arguments: argumentsPayload,
      });
      const memoryId = extractMemoryId(result);
      if (memoryId) return memoryId;
      const text = toolResultText(result);
      if (/duplicate content detected/i.test(text)) {
        const rows = await this.memorySearch(content.slice(0, 180), "exact");
        const exact = rows.find((row) => row.content.trim() === content.trim()) ?? rows[0];
        if (exact?.id) {
          await this.memoryUpdate(exact.id, content, tags, { versioned: false });
          return exact.id;
        }
      }
      return undefined;
    },
    async memoryUpdate(id, content, tags, options = {}) {
      const result = await post("tools/call", {
        name: "memory_update",
        arguments: {
          content_hash: id,
          updates: { content, tags },
          versioned: options.versioned ?? true,
        },
      });
      return extractMemoryId(result) ?? id;
    },
    async memoryDelete(id) {
      await post("tools/call", {
        name: "memory_delete",
        arguments: { content_hash: id },
      });
      return true;
    },
  };
}

export async function mcpInitializeHealthy(options: FetchMemoryMcpClientOptions = {}): Promise<boolean> {
  const client = createFetchMemoryMcpClient(options);
  return client.initialize();
}

export async function mcpToolsListHealthy(options: FetchMemoryMcpClientOptions = {}): Promise<boolean> {
  try {
    await performStreamableHttpHandshake({
      url: options.url,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      protocolVersion: "2025-06-18",
      clientName: "agentbrew-memory",
      clientVersion: "1",
    });
    return true;
  } catch {
    return false;
  }
}

export async function mcpBootstrapProfileHealthy(options: FetchMemoryMcpClientOptions = {}): Promise<boolean> {
  const client = createFetchMemoryMcpClient(options);
  if (!(await client.initialize())) return false;
  return client.bootstrapProfileEnabled();
}

export async function waitForMemoryMcpHealthy(
  options: { timeoutMs?: number; pollIntervalMs?: number; probeTimeoutMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const probeTimeoutMs = options.probeTimeoutMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  do {
    if (await mcpToolsListHealthy({ timeoutMs: probeTimeoutMs })) return true;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() < deadline);
  return false;
}
