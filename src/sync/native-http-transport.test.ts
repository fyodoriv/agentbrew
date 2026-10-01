/**
 * Which MCP servers must bypass mcpm.
 *
 * mcpm proxies a remote MCP from Python and cannot own the client's OAuth
 * token, so a remote HTTPS server routed through `mcpm run <name>` fails twice
 * over: `CERTIFICATE_VERIFY_FAILED` behind a TLS-inspecting proxy under Python
 * 3.13 strict verification, and no path to authorization even when TLS works.
 * Loopback bridges are the opposite case and must keep flowing through mcpm.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "@iarna/toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAdapter } from "../mcp/adapters.js";
import type { AgentConfig, McpServer } from "../types.js";
import {
  getNativeHttpTargetAgents,
  pruneManagedRemoteEntries,
  requiresNativeHttpTransport,
  syncWithAdapter,
} from "./mcp-sync.js";

function server(url?: string, extra: Record<string, unknown> = {}) {
  return { name: "s", ...(url ? { url } : {}), ...extra } as Parameters<typeof requiresNativeHttpTransport>[0];
}

describe("requiresNativeHttpTransport", () => {
  it("carves out a remote HTTPS MCP", () => {
    expect(requiresNativeHttpTransport(server("https://mcp.figma.com/mcp"))).toBe(true);
  });

  it("leaves the loopback memory bridge on the mcpm path", () => {
    expect(requiresNativeHttpTransport(server("http://127.0.0.1:18765/mcp"))).toBe(false);
  });

  it("leaves a localhost proxy on the mcpm path", () => {
    expect(requiresNativeHttpTransport(server("http://localhost:8098/some%20proxy"))).toBe(false);
  });

  // A loopback listener with a self-signed cert is still a local bridge, and
  // mcpm reaches it without crossing the intercepting proxy.
  it("does not carve out HTTPS on loopback", () => {
    expect(requiresNativeHttpTransport(server("https://127.0.0.1:9000/mcp"))).toBe(false);
    expect(requiresNativeHttpTransport(server("https://localhost:9000/mcp"))).toBe(false);
  });

  it("leaves stdio servers alone", () => {
    expect(requiresNativeHttpTransport(server(undefined, { command: "npx", args: ["-y", "pkg"] }))).toBe(false);
  });

  it("treats an unparseable url as not carved out rather than throwing", () => {
    expect(requiresNativeHttpTransport(server("not a url"))).toBe(false);
  });

  it("carves out any remote host, not just figma", () => {
    expect(requiresNativeHttpTransport(server("https://connect.composio.dev/mcp"))).toBe(true);
  });
});

// The carve-out writes to every intersection client, codex included. Codex
// reads `[mcp_servers.<name>]`; mcpm owns the `mcpm_*` tables in the same file.
describe("remote HTTPS carve-out for codex", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "codex-carveout-"));
    configPath = join(tmp, "config.toml");
    writeFileSync(
      configPath,
      [
        'model = "gpt-5.5"',
        "",
        "[mcp_servers.mcpm_context7]",
        'command = "mcpm"',
        'args = ["run", "context7"]',
        "",
      ].join("\n"),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("adds the remote server next to mcpm entries and keeps other settings", () => {
    const figma: McpServer = {
      name: "figma",
      command: "",
      args: [],
      env: {},
      url: "https://mcp.figma.com/mcp",
      source: "user",
    };
    const result = syncWithAdapter(getAdapter({ name: "codex", mcpFormat: "toml" }), configPath, [figma], "codex", {
      mcpKey: "mcp_servers",
      prune: false,
    });

    expect(result.error).toBeUndefined();
    expect(result.added).toBe(1);
    const config = parseToml(readFileSync(configPath, "utf-8")) as Record<string, Record<string, unknown>>;
    expect(config.model).toBe("gpt-5.5");
    expect(config.mcp_servers.figma).toEqual({ url: "https://mcp.figma.com/mcp" });
    expect(config.mcp_servers.mcpm_context7).toEqual({ command: "mcpm", args: ["run", "context7"] });
  });
});

// Claude Desktop's claude_desktop_config.json accepts stdio servers only. It
// rejects `{ type: "http", url }` ("Skipped invalid MCP server config
// entries") and shows a startup error. It takes remote MCPs through
// Connectors or plugins instead.
describe("stdio-only client (claude-desktop)", () => {
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "desktop-stdio-only-"));
    configPath = join(tmp, "claude_desktop_config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          figma: { type: "http", url: "https://mcp.figma.com/mcp" },
          "user-remote": { type: "http", url: "https://example.com/mcp" },
          context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
        },
        preferences: { menuBarEnabled: true },
      }),
    );
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is not a target for native remote HTTPS writes", () => {
    const agents = [
      { name: "claude-desktop", detected: true },
      { name: "codex", detected: true },
    ] as AgentConfig[];
    const names = getNativeHttpTargetAgents(agents).map((agent) => agent.name);

    expect(names).toContain("codex");
    expect(names).not.toContain("claude-desktop");
  });

  it("skips clients whose MCP config adapter cannot write", () => {
    const agents = [
      { name: "goose", detected: true },
      { name: "codex", detected: true },
    ] as AgentConfig[];
    const names = getNativeHttpTargetAgents(agents).map((agent) => agent.name);

    expect(names).toContain("codex");
    expect(names).not.toContain("goose");
  });

  it("prunes remote entries agentbrew wrote and keeps stdio, user, and other settings", () => {
    const agent = { name: "claude-desktop", mcpConfig: configPath } as AgentConfig;
    const removed = pruneManagedRemoteEntries(agent, new Set(["figma", "context7"]), false);

    expect(removed).toEqual(["figma"]);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.mcpServers.figma).toBeUndefined();
    expect(config.mcpServers["user-remote"]).toEqual({ type: "http", url: "https://example.com/mcp" });
    expect(config.mcpServers.context7).toEqual({ command: "npx", args: ["-y", "@upstash/context7-mcp"] });
    expect(config.preferences).toEqual({ menuBarEnabled: true });
  });

  it("reports but does not write on dry run", () => {
    const before = readFileSync(configPath, "utf-8");
    const agent = { name: "claude-desktop", mcpConfig: configPath } as AgentConfig;

    expect(pruneManagedRemoteEntries(agent, new Set(["figma"]), true)).toEqual(["figma"]);
    expect(readFileSync(configPath, "utf-8")).toBe(before);
  });
});
