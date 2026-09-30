import { describe, expect, it } from "vitest";
import { createTestContext } from "../core/context.js";
import type { AgentBrewState, McpServer } from "../types.js";
import { addMcpServer, removeMcpServer } from "./mcp-sync.js";

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

function makeState(overrides: Partial<AgentBrewState> = {}): AgentBrewState {
  return {
    agents: [],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    ...overrides,
  };
}

describe("mcp-sync with Context (zero mocks)", () => {
  describe("addMcpServer", () => {
    it("returns early when state is undefined", async () => {
      const ctx = createTestContext();
      await addMcpServer("new", "npx", [], {}, { ctx });
      expect(ctx.stateManager.current).toBeUndefined();
    });

    it("adds a new server to in-memory state", async () => {
      const ctx = createTestContext(makeState());
      await addMcpServer("new-server", "npx", ["-y", "@test/mcp"], { TOKEN: "abc" }, { ctx });

      const state = ctx.stateManager.current;
      expect(state?.mcpServers).toHaveLength(1);
      expect((state?.mcpServers ?? [])[0].name).toBe("new-server");
      expect((state?.mcpServers ?? [])[0].command).toBe("npx");
      expect((state?.mcpServers ?? [])[0].args).toEqual(["-y", "@test/mcp"]);
      expect((state?.mcpServers ?? [])[0].env).toEqual({ TOKEN: "abc" });
      expect((state?.mcpServers ?? [])[0].source).toBe("user");
    });

    it("updates existing server in-memory", async () => {
      const ctx = createTestContext(makeState({ mcpServers: [makeServer({ name: "existing" })] }));
      await addMcpServer("existing", "node", ["server.js"], {}, { ctx });

      const state = ctx.stateManager.current;
      expect(state?.mcpServers).toHaveLength(1);
      expect((state?.mcpServers ?? [])[0].command).toBe("node");
      expect((state?.mcpServers ?? [])[0].args).toEqual(["server.js"]);
    });
  });

  describe("removeMcpServer", () => {
    it("returns early when state is undefined", async () => {
      const ctx = createTestContext();
      await removeMcpServer("nonexistent", ctx);
      expect(ctx.stateManager.current).toBeUndefined();
    });

    it("does nothing when server not found", async () => {
      const ctx = createTestContext(makeState());
      await removeMcpServer("nonexistent", ctx);
      expect(ctx.stateManager.current?.mcpServers).toHaveLength(0);
    });

    it("removes server from in-memory state", async () => {
      const ctx = createTestContext(
        makeState({
          mcpServers: [makeServer({ name: "keep-me" }), makeServer({ name: "remove-me" })],
        }),
      );
      await removeMcpServer("remove-me", ctx);

      const state = ctx.stateManager.current;
      expect(state?.mcpServers).toHaveLength(1);
      expect((state?.mcpServers ?? [])[0].name).toBe("keep-me");
    });
  });
});
