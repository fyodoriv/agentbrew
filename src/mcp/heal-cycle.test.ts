import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type ProbeSurface, runMcpHealCycle } from "./heal-cycle.js";
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

  // Regression: the sync heal always reported healed: true, so a pair that stayed
  // broken for days collected hundreds of "healed" records.
  it("re-probes only the failed servers and keeps the healthy result", async () => {
    const surfaces: ProbeSurface[] = [
      {
        agent: "cursor",
        servers: { good: { command: "good-mcp", args: [] }, bad: { command: "bad-mcp", args: [] } },
      },
      { agent: "claude-code", servers: { good: { command: "good-mcp", args: [] } } },
    ];
    const started: string[] = [];
    const probeAll = vi.fn(async (input: ProbeSurface[]) => {
      const out: ProbeResult[] = [];
      for (const surface of input) {
        for (const name of Object.keys(surface.servers)) {
          started.push(`${surface.agent}:${name}`);
          out.push(
            result({
              name,
              agent: surface.agent,
              status: name === "bad" ? "init_timeout" : "ok",
              ...(name === "bad" ? { error: "no response" } : {}),
            }),
          );
        }
      }
      return out;
    });
    const healAction = vi.fn(async () => ({ healed: true, action: "sync" }));
    const writeSnapshot = vi.fn();

    const cycle = await runMcpHealCycle({
      surfaces,
      probeAll,
      healActions: new Map([["sync", healAction]]),
      writeSnapshot,
      writeFollowups: vi.fn(),
      loadPerCore: () => 0,
      now: () => new Date("2026-06-04T12:00:00.000Z"),
    });

    expect(started.filter((s) => s.endsWith(":good"))).toEqual(["cursor:good", "claude-code:good"]);
    expect(started.filter((s) => s.endsWith(":bad"))).toEqual(["cursor:bad", "cursor:bad"]);
    expect(cycle.final.map((r) => `${r.agent}:${r.name}:${r.status}`)).toEqual([
      "cursor:good:ok",
      "cursor:bad:init_timeout",
      "claude-code:good:ok",
    ]);
    expect(cycle.attempts[0].healed).toBe(false);
  });

  it("starts a suppressed failing server once per tick while another pair heals", async () => {
    const surfaces: ProbeSurface[] = [
      {
        agent: "cursor",
        servers: { known: { command: "known-mcp", args: [] }, broken: { command: "broken-mcp", args: [] } },
      },
      { agent: "claude-code", servers: { authy: { command: "authy-mcp", args: [] } } },
    ];
    const started: string[] = [];
    const statusOf: Record<string, ProbeResult["status"]> = {
      known: "init_timeout",
      broken: "launch_failed",
      authy: "smoke_call_failed",
    };
    const errorOf: Record<string, string> = { known: "no response", broken: "spawn ENOENT", authy: "401 Unauthorized" };
    const probeAll = vi.fn(async (input: ProbeSurface[]) =>
      input.flatMap((surface) =>
        Object.keys(surface.servers).map((name) => {
          started.push(`${surface.agent}:${name}`);
          return result({ name, agent: surface.agent, status: statusOf[name], error: errorOf[name] });
        }),
      ),
    );
    const suppressionByServer = new Map([
      [
        "known",
        {
          statuses: ["init_timeout"],
          reason: "upstream",
          retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
        },
      ],
    ]);
    const run = (healActions: Map<string, () => Promise<{ healed: boolean; action: string }>>) =>
      runMcpHealCycle({
        surfaces,
        probeAll,
        healActions: healActions as never,
        suppressionByServer: suppressionByServer as never,
        writeSnapshot: vi.fn(),
        writeFollowups: vi.fn(),
        loadPerCore: () => 0,
        now: () => new Date("2026-06-04T12:00:00.000Z"),
      });

    // A sync heal rewrites every server config, so every unsuppressed failure is re-probed.
    await run(new Map([["sync", async () => ({ healed: true, action: "agentbrew-sync-mcp" })]]));
    expect(started.filter((s) => s === "cursor:known")).toHaveLength(1);
    expect(started.filter((s) => s === "cursor:broken")).toHaveLength(2);
    expect(started.filter((s) => s === "claude-code:authy")).toHaveLength(2);

    // Without a sync heal, only the attempted pair is re-probed.
    started.length = 0;
    await run(new Map([["auth", async () => ({ healed: true, action: "gh-auth-token" })]]));
    expect(started.filter((s) => s === "cursor:known")).toHaveLength(1);
    expect(started.filter((s) => s === "cursor:broken")).toHaveLength(1);
    expect(started.filter((s) => s === "claude-code:authy")).toHaveLength(2);
  });

  it("records healed: false when the pair still fails the re-probe", async () => {
    const surfaces = [{ agent: "cursor", servers: { github: { command: "github-mcp", args: [] } } }];
    const failed = result({ status: "launch_failed", error: "spawn github-mcp ENOENT" });
    const probeAll = vi.fn().mockResolvedValue([failed]);
    const healAction = vi.fn(async () => ({ healed: true, action: "agentbrew-sync-mcp" }));
    const writeSnapshot = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => {});

    const cycle = await runMcpHealCycle({
      surfaces,
      probeAll,
      healActions: new Map([["sync", healAction]]),
      writeSnapshot,
      writeFollowups: vi.fn(),
      now: () => new Date("2026-06-04T12:00:00.000Z"),
    });

    expect(cycle.attempts).toEqual([expect.objectContaining({ action: "agentbrew-sync-mcp", healed: false })]);
    expect(writeSnapshot).toHaveBeenCalledWith(
      [expect.objectContaining({ status: "launch_failed" })],
      [expect.objectContaining({ healed: false })],
      "2026-06-04T12:00:00.000Z",
    );
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

  describe("load-aware heal deferral", () => {
    const surfaces = [{ agent: "cursor", servers: { remote: { url: "https://example.invalid/mcp" } } }];
    const run = async (failed: ProbeResult, loadPerCore: number) => {
      const probeAll = vi.fn().mockResolvedValue([failed]);
      const healAction = vi.fn(async () => ({ healed: false, action: "agentbrew-sync-mcp" }));
      const writeSnapshot = vi.fn();
      const writeFollowups = vi.fn();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const cycle = await runMcpHealCycle({
          surfaces,
          probeAll,
          healActions: new Map([["sync", healAction]]),
          writeSnapshot,
          writeFollowups,
          loadPerCore: () => loadPerCore,
          now: () => new Date("2026-06-04T12:00:00.000Z"),
        });
        return { cycle, probeAll, healAction, writeSnapshot, writeFollowups, logged: log.mock.calls.flat().join("\n") };
      } finally {
        log.mockRestore();
      }
    };

    it.each([
      "init_timeout",
      "tools_list_timeout",
    ] as const)("defers the heal for %s under high load but still snapshots it", async (status) => {
      const failed = result({ name: "remote", status, error: "timed out" });
      const out = await run(failed, 2);

      expect(out.healAction).not.toHaveBeenCalled();
      expect(out.writeFollowups).not.toHaveBeenCalled();
      expect(out.cycle.attempts).toEqual([]);
      expect(out.writeSnapshot).toHaveBeenCalledWith(
        [{ ...failed, healDeferred: { at: "2026-06-04T12:00:00.000Z", reason: "load per core 2.00 is above 1" } }],
        [],
        "2026-06-04T12:00:00.000Z",
      );
      expect(out.logged).toContain("deferred");
      expect(out.logged).toContain("load");
    });

    it("still heals timeout failures under normal load", async () => {
      const out = await run(result({ name: "remote", status: "init_timeout" }), 0.5);
      expect(out.healAction).toHaveBeenCalledTimes(1);
      expect(out.writeSnapshot.mock.calls[0][0][0]).not.toHaveProperty("healDeferred");
    });

    it("still heals non-timeout failures under high load", async () => {
      const out = await run(result({ name: "remote", status: "tools_list_failed" }), 3);
      expect(out.healAction).toHaveBeenCalledTimes(1);
      expect(out.probeAll).toHaveBeenCalledTimes(2);
    });
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
        loadPerCore: () => 0,
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
  it("runs the sync heal at most once per cycle, however many pairs need it (#279)", async () => {
    const names = ["a", "b", "c", "d"];
    const surfaces: ProbeSurface[] = [
      { agent: "cursor", servers: Object.fromEntries(names.map((n) => [n, { command: `${n}-mcp`, args: [] }])) },
    ];
    const probeAll = vi.fn(async (input: ProbeSurface[]) =>
      input.flatMap((surface) =>
        Object.keys(surface.servers).map((name) =>
          result({ name, agent: surface.agent, status: "launch_failed", error: "spawn ENOENT" }),
        ),
      ),
    );
    const syncHeal = vi.fn(async () => ({ healed: true, action: "agentbrew-sync-mcp" }));

    const cycle = await runMcpHealCycle({
      surfaces,
      probeAll,
      healActions: new Map([["sync", syncHeal]]),
      writeSnapshot: vi.fn(),
      writeFollowups: vi.fn(),
      loadPerCore: () => 0,
      now: () => new Date("2026-10-20T12:00:00.000Z"),
    });

    expect(syncHeal).toHaveBeenCalledTimes(1);
    expect(cycle.attempts.map((a) => a.name)).toEqual(names);
    expect(cycle.attempts.every((a) => a.action === "agentbrew-sync-mcp")).toBe(true);
  });
});
