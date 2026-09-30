import { describe, expect, it } from "vitest";
import type { McpServer } from "../types.js";
import { formatQuarantineNotice, isQuarantined, partitionQuarantined, quarantinedEntryKeys } from "./quarantine.js";

function server(name: string, quarantine?: McpServer["quarantine"]): McpServer {
  return { name, command: "npx", args: [], env: {}, source: "agentfile", quarantine };
}

const BLOCKED = {
  reason: "upstream gateway returns 403 for an authenticated user",
  since: "2020-01-01T00:00:00.000Z",
  owner: "platform-gateway",
  evidence: "trace 1-abc",
};

describe("isQuarantined", () => {
  it("is false for a plain server", () => {
    expect(isQuarantined(server("github"))).toBe(false);
  });

  it("is true once a reason is recorded", () => {
    expect(isQuarantined(server("blocked", BLOCKED))).toBe(true);
  });

  // An entry with a `quarantine` block but no reason carries no information a
  // user could act on, so it must not silently remove the server.
  it("is false when the block has no reason", () => {
    expect(isQuarantined(server("blocked", { reason: "", since: "2020-01-01T00:00:00.000Z" }))).toBe(false);
  });
});

describe("partitionQuarantined", () => {
  it("splits deployable servers from held-back ones and preserves order", () => {
    const servers = [server("a"), server("blocked", BLOCKED), server("b")];
    const { active, quarantined } = partitionQuarantined(servers);
    expect(active.map((s) => s.name)).toEqual(["a", "b"]);
    expect(quarantined.map((s) => s.name)).toEqual(["blocked"]);
  });

  it("returns empty lists for empty input", () => {
    expect(partitionQuarantined([])).toEqual({ active: [], quarantined: [] });
  });
});

describe("quarantinedEntryKeys", () => {
  // Intersection agents get their entries through mcpm under a prefixed key.
  // Missing the prefix would leave those agents connecting to the dead endpoint.
  it("covers both the bare name and the mcpm-prefixed key", () => {
    expect(quarantinedEntryKeys([server("Portal MCP Remote", BLOCKED)])).toEqual(
      new Set(["Portal MCP Remote", "mcpm_Portal MCP Remote"]),
    );
  });

  it("ignores healthy servers", () => {
    expect(quarantinedEntryKeys([server("github")]).size).toBe(0);
  });
});

describe("formatQuarantineNotice", () => {
  it("names the server, the reason, and the owner who can lift it", () => {
    const [notice] = formatQuarantineNotice([server("blocked", BLOCKED)]);
    expect(notice).toContain("blocked");
    expect(notice).toContain("403");
    expect(notice).toContain("platform-gateway");
  });

  it("omits the owner clause when no owner is recorded", () => {
    const [notice] = formatQuarantineNotice([
      server("blocked", { reason: "host decommissioned", since: "2020-01-01T00:00:00.000Z" }),
    ]);
    expect(notice).toBe("blocked: host decommissioned");
  });

  it("returns nothing when no server is quarantined", () => {
    expect(formatQuarantineNotice([server("github")])).toEqual([]);
  });
});
