import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runMcpHealCycle } from "./heal-cycle.js";
import { buildMcpHealthSnapshot, type McpHealthSnapshot } from "./health-snapshot.js";
import type { ProbeResult } from "./probe.js";

function result(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    name: "github",
    agent: "cursor",
    status: "ok",
    latencyMs: 5,
    ...overrides,
  };
}

function makeRecordingServer(logPath: string): string {
  const tools = [{ name: "probe_tool", description: "Probe", inputSchema: { type: "object", properties: {} } }];
  return `
    const { appendFileSync } = require('node:fs');
    const logPath = ${JSON.stringify(logPath)};
    process.stdin.setEncoding('utf8');
    let buf = '';
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        appendFileSync(logPath, msg.method + '\\n');
        if (msg.method === 'initialize') {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{protocolVersion:'2024-11-05',capabilities:{},serverInfo:{name:'fake',version:'1.0'}}}) + '\\n');
        } else if (msg.method === 'tools/list') {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{tools:${JSON.stringify(tools)}}}) + '\\n');
        } else if (msg.method === 'tools/call') {
          process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{content:[{type:'text',text:'ok'}],isError:false}}) + '\\n');
        }
      }
    });
  `;
}

function readMethods(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf-8").trim().split("\n").filter(Boolean) : [];
}

describe("runMcpHealCycle", () => {
  it("deep-probes MCPs, runs a heal action for failures, re-probes, and snapshots final results", async () => {
    const surfaces = [{ agent: "cursor", servers: { github: { command: "github-mcp", args: [] } } }];
    const probeAll = vi
      .fn()
      .mockResolvedValueOnce([result({ status: "smoke_call_failed", error: "401 Unauthorized" })])
      .mockResolvedValueOnce([result({ status: "ok" })]);
    const healAction = vi.fn(async () => ({ healed: true, action: "gh-auth-token" }));
    const writeSnapshot = vi.fn();

    const cycle = await runMcpHealCycle({
      surfaces,
      probeAll,
      healActions: new Map([["auth", healAction]]),
      writeSnapshot,
      now: () => new Date("2026-06-04T12:00:00.000Z"),
    });

    expect(probeAll).toHaveBeenCalledTimes(2);
    expect(probeAll.mock.calls[0][1].deep?.has("github")).toBe(true);
    expect(healAction).toHaveBeenCalledWith(expect.objectContaining({ status: "smoke_call_failed" }));
    expect(writeSnapshot).toHaveBeenCalledWith(
      [expect.objectContaining({ status: "ok" })],
      [expect.objectContaining({ action: "gh-auth-token", healed: true })],
      "2026-06-04T12:00:00.000Z",
    );
    expect(cycle.final[0].status).toBe("ok");
  });

  it("snapshots URL failures and attempts the registered sync heal action", async () => {
    const surfaces = [{ agent: "cursor", servers: { remote: { url: "https://example.invalid/mcp" } } }];
    const failed = result({ name: "remote", status: "tools_list_failed", error: "remote tools unavailable" });
    const probeAll = vi.fn().mockResolvedValue([failed]);
    const healAction = vi.fn(async () => ({ healed: false, action: "agentbrew-sync-mcp" }));
    const writeSnapshot = vi.fn();
    const writeFollowups = vi.fn();

    await runMcpHealCycle({
      surfaces,
      probeAll,
      healActions: new Map([["sync", healAction]]),
      writeSnapshot,
      writeFollowups,
      now: () => new Date("2026-06-04T12:00:00.000Z"),
    });

    expect(probeAll).toHaveBeenCalledTimes(2);
    expect(healAction).toHaveBeenCalledWith(failed);
    expect(writeSnapshot).toHaveBeenCalledWith(
      [expect.objectContaining({ status: "tools_list_failed" })],
      [expect.objectContaining({ status: "tools_list_failed", healed: false })],
      "2026-06-04T12:00:00.000Z",
    );
  });

  it("writes follow-up tasks for failures that remain after healing", async () => {
    const surfaces = [{ agent: "cursor", servers: { github: { command: "github-mcp", args: [] } } }];
    const failed = result({ status: "smoke_call_failed", error: "401 Unauthorized" });
    const probeAll = vi.fn().mockResolvedValue([failed]);
    const writeSnapshot = vi.fn();
    const writeFollowups = vi.fn();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await runMcpHealCycle({
        surfaces,
        probeAll,
        healActions: new Map([["auth", vi.fn(async () => ({ healed: false, action: "gh-auth-token" }))]]),
        writeSnapshot,
        writeFollowups,
        now: () => new Date("2026-06-04T12:00:00.000Z"),
      });
    } finally {
      log.mockRestore();
    }

    expect(writeFollowups).toHaveBeenCalledWith([failed], [expect.objectContaining({ action: "gh-auth-token" })]);
  });

  it("suppresses known catalog failures without growing heal history across ticks", async () => {
    const surfaces = [
      { agent: "cursor", servers: { "ask-human": { command: "pipx", args: ["run", "ask-human-mcp"] } } },
    ];
    const failed = result({ name: "ask-human", status: "init_timeout", error: "no response within 12000ms" });
    const probeAll = vi.fn().mockResolvedValue([failed]);
    const healAction = vi.fn(async () => ({ healed: true, action: "agentbrew-sync-mcp" }));
    const writeFollowups = vi.fn();
    let snapshot: McpHealthSnapshot | undefined;
    const writeSnapshot = vi.fn((results, attempts, generatedAt, suppressions) => {
      snapshot = buildMcpHealthSnapshot(snapshot, results, attempts, generatedAt, suppressions);
      return snapshot;
    });

    for (const attemptedAt of ["2026-06-10T12:00:00.000Z", "2026-06-10T12:30:00.000Z"]) {
      await runMcpHealCycle({
        surfaces,
        probeAll,
        healActions: new Map([["sync", healAction]]),
        suppressionByServer: new Map([
          [
            "ask-human",
            {
              statuses: ["init_timeout"],
              reason: "upstream stdio launcher currently fails before initialize",
              retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
            },
          ],
        ]),
        writeSnapshot,
        writeFollowups,
        now: () => new Date(attemptedAt),
      });
    }

    expect(probeAll).toHaveBeenCalledTimes(2);
    expect(healAction).not.toHaveBeenCalled();
    expect(snapshot?.servers[0].healHistory).toHaveLength(0);
    expect(snapshot?.servers[0].suppression).toEqual({
      reason: "upstream stdio launcher currently fails before initialize",
      retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
    });
    expect(writeFollowups).toHaveBeenCalledTimes(2);
  });

  it("scheduler fast-tier browser MCP probes send initialize and tools/list only", async () => {
    const logPath = join(tmpdir(), `agentbrew-fast-tier-${process.pid}-${Date.now()}.log`);
    try {
      await runMcpHealCycle({
        surfaces: [
          {
            agent: "codex",
            servers: { playwright: { command: process.execPath, args: ["-e", makeRecordingServer(logPath)] } },
          },
        ],
        writeSnapshot: vi.fn(),
        now: () => new Date("2026-06-10T12:00:00.000Z"),
      });

      expect(readMethods(logPath)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });

  it("scheduler probes never call a tool on a browser-launching server, whatever its name", async () => {
    // A browser MCP under a deep-tier name (here `context7`) must still get
    // initialize + tools/list only: a tools/call would open a visible Chrome.
    const logPath = join(tmpdir(), `agentbrew-browser-by-command-${process.pid}-${Date.now()}.log`);
    try {
      await runMcpHealCycle({
        surfaces: [
          {
            agent: "codex",
            servers: {
              context7: {
                command: process.execPath,
                args: ["-e", makeRecordingServer(logPath), "chrome-devtools-mcp@latest"],
              },
            },
          },
        ],
        writeSnapshot: vi.fn(),
        now: () => new Date("2026-06-10T12:00:00.000Z"),
      });

      expect(readMethods(logPath)).toEqual(["initialize", "notifications/initialized", "tools/list"]);
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });

  it("scheduler deep-tier MCP probes still send tools/call", async () => {
    const logPath = join(tmpdir(), `agentbrew-deep-tier-${process.pid}-${Date.now()}.log`);
    try {
      await runMcpHealCycle({
        surfaces: [
          {
            agent: "codex",
            servers: { context7: { command: process.execPath, args: ["-e", makeRecordingServer(logPath)] } },
          },
        ],
        writeSnapshot: vi.fn(),
        now: () => new Date("2026-06-10T12:00:00.000Z"),
      });

      expect(readMethods(logPath)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    } finally {
      if (existsSync(logPath)) unlinkSync(logPath);
    }
  });
});
