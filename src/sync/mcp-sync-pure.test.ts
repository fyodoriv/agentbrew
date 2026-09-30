import { describe, expect, it, vi } from "vitest";
import { JsonAdapter } from "../mcp/adapters.js";
import type { McpServer } from "../types.js";
import {
  collectUnresolvedEnvVars,
  computeDiffWithAdapter,
  computeServerList,
  filterServersForLiteralAgent,
  formatSecretWarnings,
  warnHardcodedSecrets,
} from "./mcp-sync.js";

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: "test-server",
    command: "npx",
    args: ["-y", "@test/mcp"],
    env: {},
    source: "user",
    ...overrides,
  };
}

describe("computeServerList (pure, zero mocks)", () => {
  it("returns user servers verbatim", () => {
    const result = computeServerList({
      userServers: [makeServer({ name: "a" }), makeServer({ name: "b" })],
    });
    expect(result.map((s) => s.name).sort()).toEqual(["a", "b"]);
  });

  it("does not deduplicate within the user-state list (state is the single source of truth)", () => {
    // If the same name appears twice in state, that's a state-shape bug, not the merger's job to fix.
    const dup = [makeServer({ name: "shared", command: "first" }), makeServer({ name: "shared", command: "second" })];
    const result = computeServerList({ userServers: dup });
    expect(result).toHaveLength(2);
    expect(result[0].command).toBe("first");
    expect(result[1].command).toBe("second");
  });
});

describe("computeDiffWithAdapter + JsonAdapter (pure, zero mocks)", () => {
  const json = new JsonAdapter();

  it("detects new servers to add", () => {
    const diff = computeDiffWithAdapter("cursor", [makeServer({ name: "new-server" })], {}, json);
    expect(diff.added).toBe(1);
    expect(diff.updated).toBe(0);
    expect(diff.pruned).toBe(0);
    expect(diff.actions).toHaveLength(1);
    expect(diff.actions[0].type).toBe("add");
    expect(diff.actions[0].serverName).toBe("new-server");
  });

  it("detects updated servers", () => {
    const diff = computeDiffWithAdapter(
      "cursor",
      [makeServer({ name: "existing", command: "new-cmd" })],
      { existing: { command: "old-cmd" } },
      json,
    );
    expect(diff.added).toBe(0);
    expect(diff.updated).toBe(1);
    expect(diff.actions[0].type).toBe("update");
  });

  it("detects no changes when entries match", () => {
    // Inlined entry equivalent to what makeServer({ name: "same" }) produces
    // (command: "npx", args: ["-y", "@test/mcp"], no env). Same shape as the
    // canonical JSON adapter's writeEntries output for a stdio server.
    const entry = { command: "npx", args: ["-y", "@test/mcp"] };
    const diff = computeDiffWithAdapter("cursor", [makeServer({ name: "same" })], { same: entry }, json);
    expect(diff.actions).toHaveLength(0);
    expect(diff.added).toBe(0);
    expect(diff.updated).toBe(0);
  });

  it("prunes extra servers when prune enabled", () => {
    const diff = computeDiffWithAdapter(
      "cursor",
      [makeServer({ name: "keep" })],
      { keep: { command: "npx" }, stale: { command: "old" } },
      json,
      { prune: true },
    );
    expect(diff.pruned).toBe(1);
    expect(diff.actions.find((a: { type: string }) => a.type === "prune")?.serverName).toBe("stale");
  });

  it("prune preserves user-added servers not in managedNames", () => {
    const diff = computeDiffWithAdapter(
      "cursor",
      [makeServer({ name: "keep" })],
      { keep: { command: "npx" }, "user-server": { command: "custom" }, stale: { command: "old" } },
      json,
      { prune: true, managedNames: new Set(["keep", "stale"]) },
    );
    // "stale" should be pruned (it's in managedNames but not in desired)
    expect(
      diff.actions.find((a: { type: string; serverName: string }) => a.type === "prune" && a.serverName === "stale"),
    ).toBeDefined();
    // "user-server" should NOT be pruned (it's not in managedNames)
    expect(
      diff.actions.find(
        (a: { type: string; serverName: string }) => a.type === "prune" && a.serverName === "user-server",
      ),
    ).toBeUndefined();
    expect(diff.pruned).toBe(1);
  });

  it("does not prune when prune disabled", () => {
    const diff = computeDiffWithAdapter("cursor", [], { stale: { command: "old" } }, json);
    expect(diff.pruned).toBe(0);
  });

  it("does NOT force-prune entries in forcePruneNames when prune is false", () => {
    const diff = computeDiffWithAdapter(
      "devin",
      [],
      { "example-mcp-e2e": { url: "https://example.com" }, other: { command: "npx" } },
      json,
      { prune: false, forcePruneNames: new Set(["example-mcp-e2e"]) },
    );
    expect(diff.pruned).toBe(0);
    expect(diff.actions).toHaveLength(0);
  });

  it("force-prunes entries in forcePruneNames when prune is true", () => {
    const diff = computeDiffWithAdapter(
      "devin",
      [],
      { "example-mcp-e2e": { url: "https://example.com" }, other: { command: "npx" } },
      json,
      { prune: true, forcePruneNames: new Set(["example-mcp-e2e"]) },
    );
    expect(diff.pruned).toBe(2);
    expect(diff.actions.find((a: { type: string }) => a.type === "prune")?.serverName).toBe("example-mcp-e2e");
  });

  it("force-prunes only entries that exist in the config", () => {
    const diff = computeDiffWithAdapter("devin", [], { other: { command: "npx" } }, json, {
      forcePruneNames: new Set(["nonexistent"]),
    });
    expect(diff.pruned).toBe(0);
  });

  it("handles mixed add/update/prune", () => {
    // Inlined entry equivalent to what makeServer({ name: "unchanged" }) produces.
    const existingEntry = { command: "npx", args: ["-y", "@test/mcp"] };
    const diff = computeDiffWithAdapter(
      "cursor",
      [
        makeServer({ name: "new-one" }),
        makeServer({ name: "changed", command: "new-cmd" }),
        makeServer({ name: "unchanged" }),
      ],
      {
        changed: { command: "old-cmd" },
        unchanged: existingEntry,
        remove_me: { command: "bye" },
      },
      json,
      { prune: true },
    );
    expect(diff.added).toBe(1);
    expect(diff.updated).toBe(1);
    expect(diff.pruned).toBe(1);
    expect(diff.actions).toHaveLength(3);
  });

  it("returns correct agentName", () => {
    const diff = computeDiffWithAdapter("windsurf", [], {}, json);
    expect(diff.agentName).toBe("windsurf");
  });
});

// Slice 4a follow-up of `delegate-mcp-to-mcpm`: the goose and codex diff cases
// were removed with their adapters. The diff / prune / merge logic is covered
// by JsonAdapter + overlayDesktopAdapter cases below — same
// `computeDiffWithAdapter` core, different adapter shape.

describe("filterServersForLiteralAgent", () => {
  it("returns all servers unchanged for standard-format agents", () => {
    const servers = [makeServer({ name: "a" }), makeServer({ name: "b" })];
    const result = filterServersForLiteralAgent(servers, "cursor", vi.fn());
    expect(result).toHaveLength(2);
  });

  it("keeps servers with no env var placeholders for literal agents", () => {
    const server = makeServer({
      name: "ok",
      url: "https://example.com",
      headers: { Authorization: "Bearer token123" },
    });
    const result = filterServersForLiteralAgent([server], "devin", vi.fn());
    expect(result).toHaveLength(1);
  });

  it("filters out servers with unresolved header placeholders for literal agents", () => {
    delete process.env.FSLA_MISSING_SECRET;
    const server = makeServer({
      name: "broken",
      url: "https://example.com",
      headers: { Authorization: "Bearer ${FSLA_MISSING_SECRET}" },
    });
    const result = filterServersForLiteralAgent([server], "devin", vi.fn());
    expect(result).toHaveLength(0);
  });

  it("filters out servers with unresolved env placeholders for literal agents", () => {
    delete process.env.FSLA_MISSING_TOKEN;
    const server = makeServer({ name: "broken", env: { TOKEN: "${FSLA_MISSING_TOKEN}" } });
    const result = filterServersForLiteralAgent([server], "devin", vi.fn());
    expect(result).toHaveLength(0);
  });

  it("logs a warning for each skipped server", () => {
    delete process.env.FSLA_MISSING_WARN;
    const server = makeServer({
      name: "warn-server",
      headers: { Authorization: "${FSLA_MISSING_WARN}" },
    });
    const log = vi.fn();
    filterServersForLiteralAgent([server], "devin", log);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain("warn-server");
  });

  it("keeps servers whose vars are resolved and skips those that are not", () => {
    process.env.FSLA_RESOLVED_VAR = "real-value";
    delete process.env.FSLA_MISSING_VAR;
    const good = makeServer({ name: "good", env: { KEY: "${FSLA_RESOLVED_VAR}" } });
    const bad = makeServer({ name: "bad", env: { KEY: "${FSLA_MISSING_VAR}" } });
    const result = filterServersForLiteralAgent([good, bad], "devin", vi.fn());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("good");
    delete process.env.FSLA_RESOLVED_VAR;
  });
});

describe("collectUnresolvedEnvVars (pure)", () => {
  it("returns empty array when all env vars resolve", () => {
    process.env.CUE_RESOLVED = "value";
    const servers = [makeServer({ name: "s1", env: { KEY: "${CUE_RESOLVED}" } })];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toEqual([]);
    delete process.env.CUE_RESOLVED;
  });

  it("returns empty array when servers have no env var placeholders", () => {
    const servers = [makeServer({ name: "s1", env: { KEY: "plain-value" } })];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty server list", () => {
    const result = collectUnresolvedEnvVars([]);
    expect(result).toEqual([]);
  });

  it("collects unresolved env vars with server name and var name", () => {
    const servers = [makeServer({ name: "slack", env: { TOKEN: "${CUE_MISSING_TOKEN}" } })];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toHaveLength(1);
    expect(result[0].serverName).toBe("slack");
    expect(result[0].varName).toBe("CUE_MISSING_TOKEN");
  });

  it("collects unresolved vars from args too", () => {
    const servers = [makeServer({ name: "srv", args: ["--token", "${CUE_MISSING_ARG}"], env: {} })];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toHaveLength(1);
    expect(result[0].varName).toBe("CUE_MISSING_ARG");
  });

  it("collects from multiple servers", () => {
    const servers = [
      makeServer({ name: "a", env: { X: "${CUE_MISS_A}" } }),
      makeServer({ name: "b", env: { Y: "${CUE_MISS_B}" } }),
    ];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.serverName)).toEqual(["a", "b"]);
  });

  it("skips vars with defaults", () => {
    const servers = [makeServer({ name: "s1", env: { KEY: "${CUE_HAS_DEFAULT:-fallback}" } })];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toEqual([]);
  });

  it("collects from url field", () => {
    const servers = [
      makeServer({ name: "remote", command: "", url: "http://${CUE_MISSING_HOST}/sse", env: {}, args: [] }),
    ];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toHaveLength(1);
    expect(result[0].varName).toBe("CUE_MISSING_HOST");
  });

  it("collects from headers field", () => {
    const servers = [
      makeServer({
        name: "auth-srv",
        command: "",
        url: "http://localhost/sse",
        headers: { Authorization: "Bearer ${CUE_MISSING_HDR}" },
        env: {},
        args: [],
      }),
    ];
    const result = collectUnresolvedEnvVars(servers);
    expect(result).toHaveLength(1);
    expect(result[0].varName).toBe("CUE_MISSING_HDR");
  });
});

describe("formatSecretWarnings", () => {
  it("formats findings into warning lines", () => {
    const findings = [
      { location: "my-server", field: "env.API_KEY", pattern: "OpenAI API key", preview: "sk-proj1...ghij" },
    ];
    const lines = formatSecretWarnings(findings);
    expect(lines.some((l) => l.includes("Hardcoded secrets detected"))).toBe(true);
    expect(lines.some((l) => l.includes("my-server.env.API_KEY"))).toBe(true);
    expect(lines.some((l) => l.includes("OpenAI API key"))).toBe(true);
    expect(lines.some((l) => l.includes("${VAR}"))).toBe(true);
  });

  it("returns empty heading and instructions for empty findings", () => {
    const lines = formatSecretWarnings([]);
    expect(lines.some((l) => l.includes("Hardcoded secrets detected"))).toBe(true);
    expect(lines.filter((l) => l.trim().startsWith("my-")).length).toBe(0);
  });
});

describe("warnHardcodedSecrets", () => {
  it("logs warnings when servers contain hardcoded secrets", () => {
    const warnings: string[] = [];
    const log = { warn: (msg: string) => warnings.push(msg) } as never;
    const servers = [
      makeServer({
        name: "leaky",
        env: { GITHUB_TOKEN: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij" },
      }),
    ];
    warnHardcodedSecrets(servers, log);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes("leaky"))).toBe(true);
    expect(warnings.some((w) => w.includes("GitHub PAT"))).toBe(true);
  });

  it("does not log when no secrets are found", () => {
    const warnings: string[] = [];
    const log = { warn: (msg: string) => warnings.push(msg) } as never;
    const servers = [makeServer({ name: "clean", env: { API_KEY: "${MY_API_KEY}" } })];
    warnHardcodedSecrets(servers, log);
    expect(warnings).toHaveLength(0);
  });

  it("does not log for empty server list", () => {
    const warnings: string[] = [];
    const log = { warn: (msg: string) => warnings.push(msg) } as never;
    warnHardcodedSecrets([], log);
    expect(warnings).toHaveLength(0);
  });
});
