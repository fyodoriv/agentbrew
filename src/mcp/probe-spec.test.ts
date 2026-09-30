import { describe, expect, it } from "vitest";
import { normalizeMcpProbeServerMap, normalizeMcpProbeSpec } from "./probe-spec.js";

describe("normalizeMcpProbeSpec", () => {
  it("handles standard JSON stdio shape", () => {
    expect(
      normalizeMcpProbeSpec({
        command: "npx",
        args: ["-y", "tasks-mcp@0.10.2"],
        env: { TOKEN: "x" },
      }),
    ).toEqual({
      command: "npx",
      args: ["-y", "tasks-mcp@0.10.2"],
      env: { TOKEN: "x" },
    });
  });

  it("handles OpenCode local command arrays", () => {
    expect(
      normalizeMcpProbeSpec({
        type: "local",
        command: ["npx", "-y", "@upstash/context7-mcp@latest"],
      }),
    ).toEqual({
      command: "npx",
      args: ["-y", "@upstash/context7-mcp@latest"],
      env: undefined,
    });
  });

  it("handles HTTP-only entries", () => {
    expect(
      normalizeMcpProbeSpec({
        url: "http://127.0.0.1:8098/foo",
        headers: { Authorization: "Bearer token" },
      }),
    ).toEqual({
      url: "http://127.0.0.1:8098/foo",
      headers: { Authorization: "Bearer token" },
    });
  });
});

describe("normalizeMcpProbeServerMap", () => {
  it("drops invalid entries and keeps valid ones", () => {
    expect(
      normalizeMcpProbeServerMap({
        good: { command: "npx", args: [] },
        bad: { type: "local" },
      }),
    ).toEqual({
      good: { command: "npx", args: [] },
    });
  });
});
