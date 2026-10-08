import { describe, expect, it } from "vitest";

function successResponse(text: string): Response {
  return new Response(
    `event: message\ndata: ${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { content: [{ type: "text", text }] },
    })}\n\n`,
    { status: 200 },
  );
}

describe("memory MCP client response parsing", () => {
  it("parses memory_store hash success responses", async () => {
    const { createFetchMemoryMcpClient } = await import("./mcp-client.js");
    const client = createFetchMemoryMcpClient({
      fetchImpl: async () => successResponse("Memory stored successfully (hash: abcdef0123456789)"),
    });
    const id = await client.memoryStore("hello", ["pack:test"]);
    expect(id).toBe("abcdef0123456789");
  });

  it("uses the mcp-memory-service 11.7 request schemas", async () => {
    const { createFetchMemoryMcpClient } = await import("./mcp-client.js");
    const payloads: Array<Record<string, unknown>> = [];
    const client = createFetchMemoryMcpClient({
      fetchImpl: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return successResponse("Memory stored successfully (hash: abcdef0123456789)");
      },
    });

    await client.tagMatch(["repo-docs", "repo:example"], true);
    await client.memoryIngest({
      directoryPath: "/tmp/claude-project/memory",
      fileExtensions: ["md"],
      recursive: false,
      memoryType: "reference",
      chunkSize: 2_000,
      tags: ["claude-project-memory", "project:example"],
    });
    await client.memoryStore("hello", ["pack:test"], "conversation-1");
    await client.memoryUpdate("old-hash", "updated", ["pack:test"]);
    await client.memoryDelete("old-hash");

    expect(payloads.map((payload) => payload.params)).toEqual([
      {
        name: "memory_list",
        arguments: {
          tags: ["repo-docs", "repo:example"],
          tag_match: "all",
          page_size: 100,
        },
      },
      {
        name: "memory_ingest",
        arguments: {
          directory_path: "/tmp/claude-project/memory",
          file_extensions: ["md"],
          recursive: false,
          memory_type: "reference",
          chunk_size: 2_000,
          tags: ["claude-project-memory", "project:example"],
        },
      },
      {
        name: "memory_store",
        arguments: {
          content: "hello",
          conversation_id: "conversation-1",
          metadata: { tags: ["pack:test"], type: "reference" },
        },
      },
      {
        name: "memory_update",
        arguments: {
          content_hash: "old-hash",
          updates: { content: "updated", tags: ["pack:test"] },
          versioned: true,
        },
      },
      {
        name: "memory_delete",
        arguments: { content_hash: "old-hash" },
      },
    ]);
  });

  it("detects disabled bootstrap profiles", async () => {
    const { createFetchMemoryMcpClient } = await import("./mcp-client.js");
    const disabled = createFetchMemoryMcpClient({
      fetchImpl: async () => successResponse("Bootstrap disabled. Set MCP_BOOTSTRAP_ENABLED=true to enable."),
    });
    const enabled = createFetchMemoryMcpClient({
      fetchImpl: async () => successResponse("=== BEHAVIORAL PROFILE (v1) ===\nRelevant context"),
    });

    await expect(disabled.bootstrapProfileEnabled()).resolves.toBe(false);
    await expect(enabled.bootstrapProfileEnabled()).resolves.toBe(true);
  });

  it("supports in-place updates for pack reconciliation", async () => {
    const { createFetchMemoryMcpClient } = await import("./mcp-client.js");
    const payloads: Array<Record<string, unknown>> = [];
    const client = createFetchMemoryMcpClient({
      fetchImpl: async (_input, init) => {
        payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return successResponse("Memory updated successfully");
      },
    });

    await client.memoryUpdate("pack-memory", "updated", ["pack:test"], { versioned: false });

    expect(payloads[0]?.params).toEqual({
      name: "memory_update",
      arguments: {
        content_hash: "pack-memory",
        updates: { content: "updated", tags: ["pack:test"] },
        versioned: false,
      },
    });
  });

  it("reads structured and text memory_ingest chunk counts", async () => {
    const { parseMemoryIngestResult } = await import("./mcp-client.js");

    expect(parseMemoryIngestResult({ structuredContent: { chunks_stored: 7 } })).toEqual({ chunksStored: 7 });
    expect(
      parseMemoryIngestResult({
        content: [{ type: "text", text: "Files processed: 2/2; 3 new chunks" }],
      }),
    ).toEqual({ chunksStored: 3 });
    expect(parseMemoryIngestResult({ content: [{ type: "text", text: "Files processed: 1/1" }] })).toEqual({
      chunksStored: 0,
    });
  });
});

describe("Streamable HTTP MCP handshake", () => {
  it("parses JSON and SSE JSON-RPC responses", async () => {
    const { parseMcpResponseBody } = await import("./mcp-client.js");

    expect(parseMcpResponseBody('{"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"one"}]}}')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "one" }] },
    });
    expect(
      parseMcpResponseBody(
        'event: message\r\ndata: {"jsonrpc":"2.0","id":2,"result":{"protocolVersion":"2025-06-18"}}\r\n\r\n',
      ),
    ).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { protocolVersion: "2025-06-18" },
    });
  });

  it("orders initialization notification before tools/list and propagates the session header", async () => {
    const { performStreamableHttpHandshake } = await import("./mcp-client.js");
    const methods: string[] = [];
    const sessionHeaders: Array<string | null> = [];

    const result = await performStreamableHttpHandshake({
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as { method: string };
        methods.push(payload.method);
        sessionHeaders.push(new Headers(init?.headers).get("MCP-Session-Id"));
        if (payload.method === "initialize") {
          return new Response(
            'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}\n\n',
            { status: 200, headers: { "MCP-Session-Id": "session-123" } },
          );
        }
        if (payload.method === "notifications/initialized") return new Response("", { status: 202 });
        return new Response('{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"memory_search"}]}}', { status: 200 });
      },
    });

    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(sessionHeaders).toEqual([null, "session-123", "session-123"]);
    expect(result.tools).toHaveLength(1);
    expect(result.sessionId).toBe("session-123");
  });

  it("sends the initialized notification without a JSON-RPC id", async () => {
    const { mcpInitializeHealthy } = await import("./mcp-client.js");
    const payloads: Array<Record<string, unknown>> = [];
    const healthy = await mcpInitializeHealthy({
      timeoutMs: 100,
      fetchImpl: async (_input, init) => {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        payloads.push(payload);
        if (payload.method === "initialize") {
          return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}', {
            status: 200,
          });
        }
        return new Response("", { status: 202 });
      },
    });

    expect(healthy).toBe(true);
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual({ jsonrpc: "2.0", method: "notifications/initialized" });
  });

  // JetBrains IDE MCP servers (WebStorm, IntelliJ) answer the initialized
  // notification with `202` + a literal `null` body. Notifications have no
  // response payload, so every non-error status must complete this stage.
  it.each([
    ["a literal null body", "null", 202],
    ["an empty object body", "{}", 200],
    ["a non-JSON body", "accepted", 202],
    ["an empty body", "", 202],
  ])("accepts %s for the initialized notification", async (_label, body, status) => {
    const { performStreamableHttpHandshake } = await import("./mcp-client.js");
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (JSON.parse(String(init?.body)) as { method: string }).method;
      if (method === "initialize") {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{}}}', {
          status: 200,
        });
      }
      if (method === "notifications/initialized") return new Response(body, { status });
      return new Response('{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"get_file_text_by_path"}]}}', {
        status: 200,
      });
    };

    const result = await performStreamableHttpHandshake({ fetchImpl });
    expect(result.tools).toHaveLength(1);
  });

  it("still reports an HTTP error status on the initialized notification", async () => {
    const { performStreamableHttpHandshake } = await import("./mcp-client.js");
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (JSON.parse(String(init?.body)) as { method: string }).method;
      if (method === "initialize") {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{}}}', {
          status: 200,
        });
      }
      return new Response("forbidden", { status: 403 });
    };

    await expect(performStreamableHttpHandshake({ fetchImpl })).rejects.toMatchObject({
      stage: "notifications/initialized",
      kind: "http",
      status: 403,
    });
  });

  it.each([
    ["empty", new Response('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', { status: 200 }), "empty"],
    [
      "error",
      new Response('{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"tools unavailable"}}', { status: 200 }),
      "rpc",
    ],
  ])("rejects %s tools/list responses", async (_label, toolsResponse, expectedKind) => {
    const { performStreamableHttpHandshake, StreamableHttpError } = await import("./mcp-client.js");
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (JSON.parse(String(init?.body)) as { method: string }).method;
      if (method === "initialize") {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}', {
          status: 200,
        });
      }
      if (method === "notifications/initialized") return new Response("", { status: 202 });
      return toolsResponse;
    };

    await expect(performStreamableHttpHandshake({ fetchImpl })).rejects.toMatchObject({
      stage: "tools/list",
      kind: expectedKind as "empty" | "rpc",
    } satisfies Partial<InstanceType<typeof StreamableHttpError>>);
  });

  it("rejects a tools/list timeout", async () => {
    const { performStreamableHttpHandshake } = await import("./mcp-client.js");
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (JSON.parse(String(init?.body)) as { method: string }).method;
      if (method === "initialize") {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}', {
          status: 200,
        });
      }
      if (method === "notifications/initialized") return new Response("", { status: 202 });
      return new Promise<Response>(() => {});
    };

    await expect(performStreamableHttpHandshake({ fetchImpl, timeoutMs: 20 })).rejects.toMatchObject({
      stage: "tools/list",
      kind: "timeout",
    });
  });
});

describe("memory transport report", () => {
  it("records legacy-session, Origin, unauthenticated, timeout, and primary-agent evidence without tool calls", async () => {
    const { buildMemoryTransportReport } = await import("./mcp-client.js");
    const methods: string[] = [];
    const report = await buildMemoryTransportReport({
      state: {
        agents: [
          { name: "claude-code", detected: true },
          { name: "cursor", detected: true },
          { name: "codex", detected: true },
        ],
        mcpServers: [
          {
            name: "memory",
            command: "",
            args: [],
            env: {},
            source: "agentbrew-memory",
            url: "http://127.0.0.1:18765/mcp",
            addedAt: "2026-09-24T12:00:00.000Z",
          },
        ],
      } as never,
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Origin") === "https://agentbrew.invalid") return new Response("forbidden", { status: 403 });
        const method = (JSON.parse(String(init?.body)) as { method: string }).method;
        methods.push(method);
        if (method === "initialize") {
          return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18"}}', {
            status: 200,
            headers: { "MCP-Session-Id": "session-123" },
          });
        }
        if (method === "notifications/initialized") return new Response("", { status: 202 });
        return new Response('{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"memory_search"}]}}', { status: 200 });
      },
    });

    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    expect(report.endpoint).toMatchObject({ loopbackOnly: true, host: "127.0.0.1", port: 18765 });
    expect(report.availability).toMatchObject({ ok: true });
    expect(report.session).toMatchObject({ serverProtocolVersion: "2025-06-18", sessionIdObserved: true });
    expect(report.origin).toMatchObject({ policy: "enforced", invalidOrigin: { ok: false, httpStatus: 403 } });
    expect(report.unauthenticatedAccess).toMatchObject({ accepted: true });
    expect(report.timeoutAndCancellation).toEqual({
      discoveryTimeoutMs: 5_000,
      operationTimeoutMs: 120_000,
      cancellation: "AbortSignal",
    });
    expect(report.primaryAgents.map((agent) => [agent.agent, agent.delivery, agent.currentEndpointSupported])).toEqual([
      ["claude-code", "mcpm", true],
      ["cursor", "native", true],
      ["codex", "mcpm", true],
    ]);
    expect(report.hardeningGate.ready).toBe(false);
  });

  it("reports unavailable discovery without changing memory or configuration", async () => {
    const { buildMemoryTransportReport } = await import("./mcp-client.js");
    const report = await buildMemoryTransportReport({
      fetchImpl: async () => {
        throw new Error("connection refused");
      },
    });

    expect(report.availability).toMatchObject({ ok: false, kind: "http" });
    expect(report.origin.policy).toBe("unknown");
    expect(report.hardeningGate.blockers).toContain("The current session-based discovery handshake is unavailable.");
  });
});
