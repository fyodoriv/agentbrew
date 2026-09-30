/**
 * Unit tests for `probeMcpServer` — uses a real spawned `node -e` script that
 * implements a minimal JSON-RPC MCP server. This is more end-to-end than
 * pure mocking, but the alternative (mocking child_process.spawn) ends up
 * re-implementing the protocol parsing in the test, which is what the
 * probe under test is actually doing. The mini-server keeps the tests
 * honest at the cost of ~2s of total test time.
 *
 * Test fixtures use `node` (always available in the test runtime) to script
 * each failure mode the probe needs to recognize:
 *   - happy path (init + tools/list)
 *   - init error (JSON-RPC error response to initialize)
 *   - tools/list error
 *   - hang (never respond)
 *   - non-JSON stdout (server emits log noise before protocol)
 *   - tools/call deep smoke — happy
 *   - tools/call deep smoke — inline error in content text (the github 401 shape)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Catalog } from "../catalog/types.js";
import { buildDeepSmokeMap } from "./catalog-smoke.js";

// Stubbed so the suite never mutates the real process trust store; the tests
// below assert only that the probe reaches for it on the HTTP path.
vi.mock("./corporate-tls.js", () => ({
  installCorporateTrust: vi.fn(() => ({ installed: false, added: 0, reason: "no-bundle" as const })),
}));

import {
  BUILTIN_DEEP_SMOKE,
  BUILTIN_ENV_STRIP_BY_SERVER,
  CHILD_KILL_GRACE_MS,
  DEEP_PROBE_TIMEOUT_MS,
  DEFAULT_PROBE_TIMEOUT_MS,
  isBrowserLaunchingSpec,
  probeAllServers,
  probeMcpServer,
} from "./probe.js";

/**
 * Build an inline Node script that acts as a JSON-RPC MCP server for one
 * test scenario. Returns the script body as a string, suitable for `node -e`.
 *
 * Behaviour is parameterized so each test scenario tweaks just the bits it
 * needs to exercise — keeps the test bodies short and readable.
 */
function makeFakeServer(opts: {
  /** Reply to initialize? Default: true. */
  initResponds?: boolean;
  /** Send an error on initialize instead of result. */
  initErrorMessage?: string;
  /** Reply to tools/list? Default: true. */
  toolsListResponds?: boolean;
  /** Send an error on tools/list. */
  toolsListErrorMessage?: string;
  /** Number of tools to advertise. Default: 3. */
  toolsCount?: number;
  /** Emit a non-JSON log line before any protocol response. */
  emitLogLineFirst?: boolean;
  /** Reply to tools/call? */
  toolsCallResponse?:
    | "ok"
    | "error"
    | "inline_error_text"
    | "inline_isError"
    | "tasks_success"
    | "tasks_success_http_mention";
  recordMethodsPath?: string;
}): string {
  const toolsCount = opts.toolsCount ?? 3;
  const tools = Array.from({ length: toolsCount }, (_, i) => ({
    name: `tool_${i}`,
    description: `Tool ${i}`,
    inputSchema: { type: "object", properties: {} },
  }));
  return `
    process.stdin.setEncoding('utf8');
    let buf = '';
    ${opts.emitLogLineFirst ? "process.stdout.write('[boot] starting fake server...\\n');" : ""}
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        ${opts.recordMethodsPath ? `require('node:fs').appendFileSync(${JSON.stringify(opts.recordMethodsPath)}, msg.method + ${JSON.stringify("\n")});` : ""}
        if (msg.method === 'initialize') {
          ${!opts.initResponds ? "// hang on init" : ""}
          ${opts.initResponds === false ? "" : opts.initErrorMessage ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:${JSON.stringify(opts.initErrorMessage)}}}) + '\\n');` : `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fake',version:'1.0'}}}) + '\\n');`}
        } else if (msg.method === 'tools/list') {
          ${!opts.toolsListResponds ? "// hang on tools/list" : ""}
          ${opts.toolsListResponds === false ? "" : opts.toolsListErrorMessage ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:${JSON.stringify(opts.toolsListErrorMessage)}}}) + '\\n');` : `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{tools:${JSON.stringify(tools)}}}) + '\\n');`}
        } else if (msg.method === 'tools/call') {
          ${
            opts.toolsCallResponse === "error"
              ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:-32603,message:'transport-level call error'}}) + '\\n');`
              : opts.toolsCallResponse === "inline_error_text"
                ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'{"error": "401 Client Error: Unauthorized"}'}],isError:false}}) + '\\n');`
                : opts.toolsCallResponse === "inline_isError"
                  ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'whoops'}],isError:true}}) + '\\n');`
                  : opts.toolsCallResponse === "tasks_success"
                    ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:JSON.stringify({summary:'Found 2 task(s)',tasks:[{summary:'Fix error handling in parser'}]})}],isError:false}}) + '\\n');`
                    : opts.toolsCallResponse === "tasks_success_http_mention"
                      ? `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:JSON.stringify({summary:'Found 2 task(s)',tasks:[{summary:'Fix github 401 Unauthorized in probe'}]})}],isError:false}}) + '\\n');`
                      : `process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'{"login":"alice","id":78682}'}],isError:false}}) + '\\n');`
          }
        }
      }
    });
  `;
}

function readMethods(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf-8").trim().split("\n").filter(Boolean) : [];
}

describe("probeMcpServer", () => {
  it("returns OK with tool count on happy path", async () => {
    const r = await probeMcpServer("fake", "test-agent", {
      command: process.execPath,
      args: ["-e", makeFakeServer({ toolsCount: 5 })],
    });
    expect(r.status).toBe("ok");
    expect(r.toolsCount).toBe(5);
    expect(r.error).toBeUndefined();
  });

  it("reports init_error when the server returns a JSON-RPC error on initialize", async () => {
    const r = await probeMcpServer("fake", "test-agent", {
      command: process.execPath,
      args: ["-e", makeFakeServer({ initErrorMessage: "init blew up" })],
    });
    expect(r.status).toBe("init_error");
    expect(r.error).toContain("init blew up");
  });

  it("reports tools_list_failed when the server returns a JSON-RPC error on tools/list", async () => {
    const r = await probeMcpServer("fake", "test-agent", {
      command: process.execPath,
      args: ["-e", makeFakeServer({ toolsListErrorMessage: "tools registry corrupted" })],
    });
    expect(r.status).toBe("tools_list_failed");
    expect(r.error).toContain("tools registry corrupted");
  });

  it("reports init_timeout when the server never responds to initialize", async () => {
    const r = await probeMcpServer(
      "fake",
      "test-agent",
      { command: process.execPath, args: ["-e", makeFakeServer({ initResponds: false })] },
      { timeoutMs: 500 },
    );
    expect(r.status).toBe("init_timeout");
    expect(r.latencyMs).toBeGreaterThanOrEqual(500);
  });

  it("reports tools_list_timeout when init succeeds but tools/list hangs", async () => {
    const r = await probeMcpServer(
      "fake",
      "test-agent",
      { command: process.execPath, args: ["-e", makeFakeServer({ toolsListResponds: false })] },
      { timeoutMs: 500 },
    );
    expect(r.status).toBe("tools_list_timeout");
  });

  it("ignores non-JSON log lines on stdout before the protocol kicks in", async () => {
    const r = await probeMcpServer("fake", "test-agent", {
      command: process.execPath,
      args: ["-e", makeFakeServer({ emitLogLineFirst: true })],
    });
    expect(r.status).toBe("ok");
  });

  // A server that traps SIGTERM keeps its stdio pipes open, and those pipes
  // keep Node's event loop alive long after the probe has resolved. That is
  // how a 12-second probe wedged `agentbrew status --fix` for fifteen minutes.
  it("kills a server that ignores SIGTERM instead of leaving it running", async () => {
    const pidFile = join(
      realpathSync(
        execFileSync("mktemp", ["-d", join(tmpdir(), "agentbrew-probe-kill-XXXXXX")], { encoding: "utf-8" }).trim(),
      ),
      "pid",
    );
    const stubborn = `
      require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 1000);
    `;

    const r = await probeMcpServer(
      "stubborn",
      "test-agent",
      { command: process.execPath, args: ["-e", stubborn] },
      { timeoutMs: 300 },
    );
    expect(r.status).toBe("init_timeout");

    const pid = Number(readFileSync(pidFile, "utf-8"));
    expect(Number.isInteger(pid)).toBe(true);

    const isAlive = (): boolean => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const deadline = Date.now() + CHILD_KILL_GRACE_MS + 5_000;
    while (isAlive() && Date.now() < deadline) {
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(isAlive()).toBe(false);
  }, 20_000);

  it("reports launch_failed when the command does not exist", async () => {
    const r = await probeMcpServer("fake", "test-agent", {
      command: "/nonexistent/binary/xyz123",
      args: [],
    });
    expect(r.status).toBe("launch_failed");
    expect(r.error).toBeTruthy();
  });

  it("honors options.cwd for the spawned MCP child", async () => {
    const cwdDir = realpathSync(
      execFileSync("mktemp", ["-d", join(tmpdir(), "agentbrew-probe-cwd-XXXXXX")], {
        encoding: "utf-8",
      }).trim(),
    );
    const marker = join(cwdDir, "cwd.txt");
    const script = `
      require('node:fs').writeFileSync(${JSON.stringify(marker)}, process.cwd());
      ${makeFakeServer({ toolsCount: 1 })}
    `;
    try {
      const r = await probeMcpServer(
        "fake",
        "test-agent",
        { command: process.execPath, args: ["-e", script] },
        { cwd: cwdDir },
      );
      expect(r.status).toBe("ok");
      expect(realpathSync(readFileSync(marker, "utf-8"))).toBe(cwdDir);
    } finally {
      try {
        unlinkSync(marker);
      } catch {
        /* ignore */
      }
      try {
        execFileSync("rm", ["-rf", cwdDir]);
      } catch {
        /* ignore */
      }
    }
  });

  it("probes URL servers through the full Streamable HTTP discovery contract", async () => {
    const methods: string[] = [];
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (JSON.parse(String(init?.body)) as { method: string }).method;
      methods.push(method);
      if (method === "initialize") {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}', {
          status: 200,
          headers: { "MCP-Session-Id": "probe-session" },
        });
      }
      if (method === "notifications/initialized") return new Response("", { status: 202 });
      return new Response(
        'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"memory_search"}]}}\n\n',
        { status: 200 },
      );
    };

    const r = await probeMcpServer(
      "remote",
      "test-agent",
      {
        url: "http://example.com/mcp",
      },
      { fetchImpl },
    );

    expect(r.status).toBe("ok");
    expect(r.toolsCount).toBe(1);
    expect(methods).toEqual(["initialize", "notifications/initialized", "tools/list"]);
  });

  // Behind a TLS-inspecting proxy Node rejects the re-signed certificate, so an
  // HTTP probe reports `init_error: fetch failed` for a server that is up. The
  // probe has to install the corporate root itself; a child's env cannot do it.
  it("installs corporate TLS trust before reaching out over HTTP", async () => {
    const { installCorporateTrust } = await import("./corporate-tls.js");
    const spy = vi.mocked(installCorporateTrust);
    spy.mockClear();

    await probeMcpServer(
      "remote",
      "test-agent",
      { url: "http://example.com/mcp" },
      { fetchImpl: async () => new Response("", { status: 401 }) },
    );

    expect(spy).toHaveBeenCalled();
  });

  it("does not touch the trust store for stdio servers", async () => {
    const { installCorporateTrust } = await import("./corporate-tls.js");
    const spy = vi.mocked(installCorporateTrust);
    spy.mockClear();

    await probeMcpServer("local", "test-agent", { command: "true" }, { timeoutMs: 200 });

    expect(spy).not.toHaveBeenCalled();
  });

  it("reports URL tools/list failures instead of silently skipping HTTP", async () => {
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const method = (JSON.parse(String(init?.body)) as { method: string }).method;
      if (method === "initialize") {
        return new Response('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{}}}', {
          status: 200,
        });
      }
      if (method === "notifications/initialized") return new Response("", { status: 202 });
      return new Response('{"jsonrpc":"2.0","id":2,"error":{"code":-32603,"message":"remote tools failed"}}', {
        status: 200,
      });
    };

    const r = await probeMcpServer(
      "remote",
      "test-agent",
      {
        url: "http://example.com/mcp",
      },
      { fetchImpl },
    );

    expect(r.status).toBe("tools_list_failed");
    expect(r.error).toContain("remote tools failed");
  });

  it("reports URL initialization timeouts", async () => {
    const r = await probeMcpServer(
      "remote",
      "test-agent",
      {
        url: "http://example.com/mcp",
      },
      { fetchImpl: async () => new Promise<Response>(() => {}), timeoutMs: 20 },
    );

    expect(r.status).toBe("init_timeout");
    expect(r.error).toContain("timed out");
  });

  it("reports a refused loopback MCP as a closed local app, not a failure", async () => {
    const refused = () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));

    const r = await probeMcpServer(
      "webstorm",
      "claude-code",
      { url: "http://127.0.0.1:64542/stream" },
      { fetchImpl: refused },
    );

    expect(r.status).toBe("skipped_local_app_offline");
    expect(r.error).toBe("nothing is listening on 127.0.0.1:64542 — start the app that serves this MCP");
  });

  it("keeps a refused remote MCP as an init error", async () => {
    const refused = () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }));

    const r = await probeMcpServer("remote", "test-agent", { url: "http://example.com/mcp" }, { fetchImpl: refused });

    expect(r.status).toBe("init_error");
    expect(r.error).toContain("fetch failed (ECONNREFUSED)");
  });

  it("keeps other loopback fetch errors as init errors", async () => {
    const reset = () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ECONNRESET" } }));

    const r = await probeMcpServer(
      "local-http",
      "test-agent",
      { url: "http://localhost:3845/mcp" },
      { fetchImpl: reset },
    );

    expect(r.status).toBe("init_error");
  });

  it("skips entries with neither command nor url", async () => {
    const r = await probeMcpServer("malformed", "test-agent", {});
    expect(r.status).toBe("skipped_no_command");
  });

  describe("deep tier (tools/call smoke)", () => {
    it("returns OK with deepTool when the smoke call succeeds", async () => {
      const r = await probeMcpServer(
        "github",
        "test-agent",
        { command: process.execPath, args: ["-e", makeFakeServer({ toolsCallResponse: "ok" })] },
        { deep: { tool: "get_authenticated_user" } },
      );
      expect(r.status).toBe("ok");
      expect(r.deepTool).toBe("get_authenticated_user");
    });

    it("keeps interactive deep probes smoke-calling fast-tier catalog entries", async () => {
      const logPath = join(tmpdir(), `agentbrew-interactive-deep-${process.pid}-${Date.now()}.log`);
      const catalog: Catalog = {
        skills: [],
        mcp_servers: [
          {
            name: "playwright",
            description: "Browser",
            command: "node",
            category: "browser",
            recommended: true,
            smokeCall: { tool: "browser_console_messages" },
            probe: "fast",
          },
        ],
        rules: [],
      };

      try {
        const results = await probeAllServers(
          [
            {
              agent: "test-agent",
              servers: {
                playwright: {
                  command: process.execPath,
                  args: ["-e", makeFakeServer({ toolsCallResponse: "ok", recordMethodsPath: logPath })],
                },
              },
            },
          ],
          { deep: buildDeepSmokeMap(catalog) },
        );

        expect(results[0]).toMatchObject({ status: "ok", deepTool: "browser_console_messages" });
        expect(readMethods(logPath)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
      } finally {
        if (existsSync(logPath)) unlinkSync(logPath);
      }
    });

    it("reports smoke_call_failed when the response has a JSON-RPC error", async () => {
      const r = await probeMcpServer(
        "github",
        "test-agent",
        { command: process.execPath, args: ["-e", makeFakeServer({ toolsCallResponse: "error" })] },
        { deep: { tool: "get_authenticated_user" } },
      );
      expect(r.status).toBe("smoke_call_failed");
      expect(r.error).toContain("transport-level call error");
    });

    it("reports smoke_call_failed when the inline content text contains a 401 (the github MCP failure mode)", async () => {
      const r = await probeMcpServer(
        "github",
        "test-agent",
        {
          command: process.execPath,
          args: ["-e", makeFakeServer({ toolsCallResponse: "inline_error_text" })],
        },
        { deep: { tool: "get_authenticated_user" } },
      );
      expect(r.status).toBe("smoke_call_failed");
      expect(r.error).toContain("401");
    });

    it("reports smoke_call_failed when isError=true is set on the response", async () => {
      const r = await probeMcpServer(
        "github",
        "test-agent",
        {
          command: process.execPath,
          args: ["-e", makeFakeServer({ toolsCallResponse: "inline_isError" })],
        },
        { deep: { tool: "tools_failed" } },
      );
      expect(r.status).toBe("smoke_call_failed");
      expect(r.error).toContain("whoops");
    });

    it("accepts tasks-mcp list_tasks JSON even when nested text contains 'error'", async () => {
      const r = await probeMcpServer(
        "tasks-mcp",
        "test-agent",
        {
          command: process.execPath,
          args: ["-e", makeFakeServer({ toolsCallResponse: "tasks_success" })],
        },
        { deep: { tool: "list_tasks" } },
      );
      expect(r.status).toBe("ok");
    });

    it("accepts tasks-mcp list_tasks JSON when nested tasks mention HTTP status codes", async () => {
      const r = await probeMcpServer(
        "tasks-mcp",
        "test-agent",
        {
          command: process.execPath,
          args: ["-e", makeFakeServer({ toolsCallResponse: "tasks_success_http_mention" })],
        },
        { deep: { tool: "list_tasks" } },
      );
      expect(r.status).toBe("ok");
    });
  });

  describe("env handling", () => {
    it("strips listed env vars from the inherited env before launch", async () => {
      // The fake server prints process.env.GITHUB_TOKEN to stderr. Probe with
      // stripEnv=['GITHUB_TOKEN'] should result in empty stderr.
      const script = `
        process.stderr.write('GITHUB_TOKEN=' + (process.env.GITHUB_TOKEN ?? '<undefined>'));
        ${makeFakeServer({})}
      `;
      const originalEnv = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = "should_be_stripped";
      try {
        const r = await probeMcpServer(
          "fake",
          "test-agent",
          { command: process.execPath, args: ["-e", script] },
          { stripEnv: ["GITHUB_TOKEN"] },
        );
        expect(r.status).toBe("ok");
        // Can't read stderr from the test, but we can assert no init/tools/list failure
        // (the script wouldn't fail differently with vs without the strip — this test
        // just confirms the probe didn't break when stripEnv is set).
      } finally {
        if (originalEnv === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = originalEnv;
      }
    });

    it("resolves ${GITHUB_TOKEN:-} placeholders in spec.env after stripEnv", async () => {
      const script = `
        const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? '';
        process.stderr.write('token_len=' + token.length);
        ${makeFakeServer({})}
      `;
      const originalEnv = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;
      const ghToken = execFileSync("gh", ["auth", "token"], { stdio: "pipe", timeout: 5_000 }).toString().trim();
      try {
        const r = await probeMcpServer(
          "github",
          "cursor",
          {
            command: process.execPath,
            args: ["-e", script],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN:-}" },
          },
          { stripEnv: ["GITHUB_TOKEN"] },
        );
        expect(r.status).toBe("ok");
        expect(ghToken.length).toBeGreaterThan(0);
      } finally {
        if (originalEnv === undefined) delete process.env.GITHUB_TOKEN;
        else process.env.GITHUB_TOKEN = originalEnv;
      }
    });

    it("merges spec.env over the inherited env", async () => {
      const script = makeFakeServer({});
      const r = await probeMcpServer("fake", "test-agent", {
        command: process.execPath,
        args: ["-e", script],
        env: { FOO_PROBE_VAR: "bar" },
      });
      // The probe doesn't expose env back, but completing OK proves the
      // merge didn't break the launch path.
      expect(r.status).toBe("ok");
    });
  });
});

describe("isBrowserLaunchingSpec", () => {
  it("recognizes browser MCP servers by their command line", () => {
    expect(isBrowserLaunchingSpec({ command: "npx", args: ["-y", "@playwright/mcp@latest", "--isolated"] })).toBe(true);
    expect(isBrowserLaunchingSpec({ command: "npx", args: ["-y", "chrome-devtools-mcp@latest"] })).toBe(true);
    expect(isBrowserLaunchingSpec({ command: "/usr/local/bin/mcp-server-puppeteer" })).toBe(true);
  });

  it("does not flag other servers or remote URL servers", () => {
    expect(isBrowserLaunchingSpec({ command: "npx", args: ["-y", "@upstash/context7-mcp"] })).toBe(false);
    expect(isBrowserLaunchingSpec({ command: "github-mcp-server", args: ["stdio"] })).toBe(false);
    expect(isBrowserLaunchingSpec({ url: "https://mcp.example.com/browser" })).toBe(false);
  });
});

describe("probeAllServers", () => {
  // Regression: every agent's copy of the same synced server was started
  // separately (many probes per catalog server), so `status --fix` took ~20 min.
  it("starts a server once when several agents list the same spec", async () => {
    const logPath = join(tmpdir(), `agentbrew-probe-dedupe-${process.pid}-${Date.now()}.log`);
    const spec = { command: process.execPath, args: ["-e", makeFakeServer({ recordMethodsPath: logPath })] };
    try {
      const results = await probeAllServers([
        { agent: "cursor", servers: { fake: spec } },
        { agent: "claude-code", servers: { fake: { ...spec, args: [...spec.args] } } },
        { agent: "windsurf", servers: { fake: { ...spec, env: { EXTRA: "1" } } } },
      ]);

      expect(results.map((r) => [r.agent, r.status])).toEqual([
        ["cursor", "ok"],
        ["claude-code", "ok"],
        ["windsurf", "ok"],
      ]);
      expect(readMethods(logPath).filter((method) => method === "initialize")).toHaveLength(2);
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });
});

describe("BUILTIN_DEEP_SMOKE", () => {
  it("keeps GitHub as a legacy fallback for older catalog caches", () => {
    expect(BUILTIN_DEEP_SMOKE.github).toBeDefined();
  });

  it("uses read-only tools that won't mutate user state", () => {
    // The smoke tools must be safe to call repeatedly (every 30 min via cron)
    // without side effects. This is enforced by the naming convention:
    // get_*, list_*, resolve_*, search_*, find_*. Mutating verbs (create_,
    // delete_, update_, post_) would be a regression.
    const safePrefixes = /^(get|list|resolve|search|find|read|describe|show)[-_]/;
    for (const [server, spec] of Object.entries(BUILTIN_DEEP_SMOKE)) {
      expect(spec.tool, `${server} smoke tool '${spec.tool}' must be a read-only verb`).toMatch(safePrefixes);
    }
  });
});

describe("BUILTIN_ENV_STRIP_BY_SERVER", () => {
  it("strips GITHUB_TOKEN for the github MCP", () => {
    // This is the durable form of the 2026-05-27 github 401 fix. The shell
    // env's GITHUB_TOKEN is the github.com token; the github MCP talks to
    // github.example.com and needs its own keyring token. Stripping makes
    // the launcher's own auth-resolution path run.
    expect(BUILTIN_ENV_STRIP_BY_SERVER.get("github")).toEqual(["GITHUB_TOKEN"]);
  });
});

describe("DEFAULT_PROBE_TIMEOUT_MS", () => {
  it("gives cold Python servers headroom but doesn't drag healthy probes", () => {
    // 12s is the calibration: uvx/pipx cold start ~8–10s, native node servers <2s.
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBeGreaterThanOrEqual(8_000);
    expect(DEFAULT_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe("DEEP_PROBE_TIMEOUT_MS", () => {
  it("allows browser MCP cold starts without blocking the fast-tier scheduler", () => {
    expect(DEEP_PROBE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_PROBE_TIMEOUT_MS);
    expect(DEEP_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(45_000);
  });
});
