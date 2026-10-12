import { describe, expect, it } from "vitest";
import {
  buildMcpHealthSnapshot,
  checkMcpStaleDrift,
  MAX_HEAL_HISTORY,
  type McpHealthEntry,
  type McpHealthSnapshot,
  mcpLoginCommand,
  needsLoginMcpEntries,
  staleMcpEntries,
  unhealthyMcpEntries,
} from "./health-snapshot.js";
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

describe("buildMcpHealthSnapshot", () => {
  it("records successful probe results with lastOkAt", () => {
    const snapshot = buildMcpHealthSnapshot(undefined, [result({ status: "ok" })], [], "2026-06-04T10:00:00.000Z");

    expect(snapshot.servers).toEqual([
      expect.objectContaining({
        name: "github",
        agent: "cursor",
        status: "ok",
        lastOkAt: "2026-06-04T10:00:00.000Z",
      }),
    ]);
  });

  it("preserves lastOkAt and records heal attempts after a later failure", () => {
    const existing = buildMcpHealthSnapshot(undefined, [result({ status: "ok" })], [], "2026-06-04T10:00:00.000Z");
    const snapshot = buildMcpHealthSnapshot(
      existing,
      [result({ status: "smoke_call_failed", error: "401 Unauthorized" })],
      [
        {
          name: "github",
          agent: "cursor",
          status: "smoke_call_failed",
          category: "auth",
          action: "gh-auth-token",
          healed: false,
          attemptedAt: "2026-06-04T11:00:00.000Z",
        },
      ],
      "2026-06-04T11:00:00.000Z",
    );

    expect(snapshot.servers[0]).toEqual(
      expect.objectContaining({
        status: "smoke_call_failed",
        lastOkAt: "2026-06-04T10:00:00.000Z",
        lastError: "401 Unauthorized",
      }),
    );
    expect(snapshot.servers[0].healHistory).toHaveLength(1);
  });

  it("keeps only the last attempts per pair and counts every attempt", () => {
    const attemptAt = (i: number) => ({
      name: "github",
      agent: "cursor",
      status: "smoke_call_failed" as const,
      category: "auth" as const,
      action: `try-${i}`,
      healed: false,
      attemptedAt: `2026-06-04T11:${String(i % 60).padStart(2, "0")}:00.000Z`,
    });
    let snapshot: McpHealthSnapshot | undefined;
    for (let i = 0; i < MAX_HEAL_HISTORY + 15; i++) {
      snapshot = buildMcpHealthSnapshot(
        snapshot,
        [result({ status: "smoke_call_failed", error: "boom" })],
        [attemptAt(i)],
        "2026-06-04T12:00:00.000Z",
      );
    }
    const entry = snapshot?.servers[0];
    expect(entry?.healHistory).toHaveLength(MAX_HEAL_HISTORY);
    expect(entry?.healHistory.at(-1)?.action).toBe(`try-${MAX_HEAL_HISTORY + 14}`);
    expect(entry?.healHistory[0].action).toBe("try-15");
    expect(entry?.healAttemptCount).toBe(MAX_HEAL_HISTORY + 15);
  });

  it("counts a legacy uncapped history as its length", () => {
    const old = Array.from({ length: 50 }, (_, i) => ({
      name: "github",
      agent: "cursor",
      status: "smoke_call_failed" as const,
      category: "auth" as const,
      action: `old-${i}`,
      healed: false,
      attemptedAt: "2026-06-04T11:00:00.000Z",
    }));
    const previous: McpHealthSnapshot = {
      generatedAt: "2026-06-04T11:00:00.000Z",
      servers: [entry({ name: "github", agent: "cursor", status: "smoke_call_failed", healHistory: old })],
    };
    const snapshot = buildMcpHealthSnapshot(previous, [result({ status: "ok" })], [], "2026-06-04T12:00:00.000Z");
    expect(snapshot.servers[0].healHistory).toHaveLength(MAX_HEAL_HISTORY);
    expect(snapshot.servers[0].healAttemptCount).toBe(50);
  });

  it("records suppression metadata separately from heal history", () => {
    const snapshot = buildMcpHealthSnapshot(
      undefined,
      [result({ name: "ask-human", status: "init_timeout", error: "no response" })],
      [],
      "2026-06-10T12:00:00.000Z",
      new Map([
        [
          "cursor:ask-human",
          {
            reason: "upstream stdio launcher currently fails before initialize",
            retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
          },
        ],
      ]),
    );

    expect(snapshot.servers[0]).toEqual(
      expect.objectContaining({
        name: "ask-human",
        status: "init_timeout",
        suppression: {
          reason: "upstream stdio launcher currently fails before initialize",
          retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
        },
      }),
    );
    expect(snapshot.servers[0].healHistory).toHaveLength(0);
  });

  it("clears prior suppression metadata when the server recovers", () => {
    const existing = buildMcpHealthSnapshot(
      undefined,
      [result({ name: "ask-human", status: "init_timeout", error: "no response" })],
      [],
      "2026-06-10T12:00:00.000Z",
      new Map([
        [
          "cursor:ask-human",
          {
            reason: "upstream stdio launcher currently fails before initialize",
            retryPolicy: "probe-every-tick-no-heal-until-catalog-change",
          },
        ],
      ]),
    );
    const snapshot = buildMcpHealthSnapshot(
      existing,
      [result({ name: "ask-human", status: "ok" })],
      [],
      "2026-06-10T12:30:00.000Z",
    );

    expect(snapshot.servers[0].suppression).toBeUndefined();
  });
});

describe("firstFailedAt", () => {
  it("records the first failure and carries it while the pair keeps failing", () => {
    const first = buildMcpHealthSnapshot(
      undefined,
      [result({ status: "init_timeout" })],
      [],
      "2026-06-04T10:00:00.000Z",
    );
    const second = buildMcpHealthSnapshot(first, [result({ status: "init_timeout" })], [], "2026-06-04T11:00:00.000Z");

    expect(first.servers[0].firstFailedAt).toBe("2026-06-04T10:00:00.000Z");
    expect(second.servers[0].firstFailedAt).toBe("2026-06-04T10:00:00.000Z");
  });

  it("clears firstFailedAt when the pair recovers", () => {
    const failing = buildMcpHealthSnapshot(
      undefined,
      [result({ status: "init_timeout" })],
      [],
      "2026-06-04T10:00:00.000Z",
    );
    const recovered = buildMcpHealthSnapshot(failing, [result({ status: "ok" })], [], "2026-06-04T11:00:00.000Z");

    expect(recovered.servers[0].firstFailedAt).toBeUndefined();
  });
});

function entry(overrides: Partial<McpHealthEntry>): McpHealthEntry {
  return {
    name: "playwright",
    agent: "copilot",
    status: "init_timeout",
    lastCheckedAt: "2026-06-05T12:00:00.000Z",
    healHistory: [],
    ...overrides,
  };
}

function snapshotOf(...servers: McpHealthEntry[]): McpHealthSnapshot {
  return { generatedAt: "2026-06-05T12:00:00.000Z", servers };
}

const NOW = new Date("2026-06-05T12:00:00.000Z");

describe("needs-login entries", () => {
  const loggedOut = entry({ name: "railway", agent: "claude-code", status: "init_error", lastError: "Not logged in" });
  const unauthorized = entry({ name: "github", status: "smoke_call_failed", lastError: "401 Unauthorized" });
  const timeout = entry({ lastError: "no response within 30000ms" });

  it("reports logged-out and rejected-credential pairs as needs-login", () => {
    expect(needsLoginMcpEntries(snapshotOf(loggedOut, unauthorized, timeout))).toEqual([loggedOut, unauthorized]);
  });

  it("does not count needs-login pairs as failing", () => {
    expect(unhealthyMcpEntries(snapshotOf(loggedOut, unauthorized, timeout))).toEqual([timeout]);
  });

  it("names the exact login command", () => {
    expect(mcpLoginCommand("github")).toBe("gh auth login");
    expect(mcpLoginCommand("railway")).toBe("agentbrew mcp setup railway");
  });
});

describe("stale MCP entries", () => {
  it("flags a pair with no ok probe for more than 24h", () => {
    const stale = entry({ lastOkAt: "2026-06-04T11:00:00.000Z", firstFailedAt: "2026-06-04T11:30:00.000Z" });
    expect(staleMcpEntries(snapshotOf(stale), NOW)).toEqual([stale]);
  });

  it("uses firstFailedAt when the pair never passed", () => {
    const neverOk = entry({ firstFailedAt: "2026-06-03T12:00:00.000Z" });
    expect(staleMcpEntries(snapshotOf(neverOk), NOW)).toEqual([neverOk]);
  });

  it("leaves short failures, needs-login, and suppressed pairs alone", () => {
    const recent = entry({ lastOkAt: "2026-06-05T10:00:00.000Z", firstFailedAt: "2026-06-05T11:00:00.000Z" });
    const login = entry({ lastError: "Not logged in", firstFailedAt: "2026-06-01T00:00:00.000Z" });
    const suppressed = entry({
      firstFailedAt: "2026-06-01T00:00:00.000Z",
      suppression: { reason: "per-client OAuth", retryPolicy: "probe-every-tick-no-heal-until-catalog-change" },
    });
    expect(staleMcpEntries(snapshotOf(recent, login, suppressed), NOW)).toEqual([]);
  });

  it("does not guess an age when the pair has no timestamps", () => {
    expect(staleMcpEntries(snapshotOf(entry({})), NOW)).toEqual([]);
  });

  it("turns each stale pair into an mcp-stale drift item", () => {
    const stale = entry({ firstFailedAt: "2026-06-02T12:00:00.000Z" });
    expect(checkMcpStaleDrift(snapshotOf(stale), NOW)).toEqual([
      {
        agent: "copilot",
        type: "mcp-stale",
        detail: "playwright has had no ok probe for 3d (init_timeout) — run `agentbrew mcp probe playwright --deep`",
      },
    ]);
  });

  it("reports nothing on a healthy snapshot", () => {
    expect(checkMcpStaleDrift(snapshotOf(entry({ status: "ok", lastOkAt: NOW.toISOString() })), NOW)).toEqual([]);
  });
});
