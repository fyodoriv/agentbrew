import { describe, expect, it } from "vitest";
import { buildMcpHealthSnapshot } from "./health-snapshot.js";
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
