import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../types.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("write-file-atomic", () => ({
  sync: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { sync as writeFileSync } from "write-file-atomic";
import type { GooseConfig, TomlConfig } from "./mcp.js";
import {
  discoverMcpServers,
  extractServersFromGoose,
  extractServersFromJson,
  extractServersFromToml,
  getServers,
  readGooseYaml,
  readMcpJson,
  readToml,
  setServers,
  writeMcpJson,
} from "./mcp.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

beforeEach(() => {
  vi.resetAllMocks();
});

describe("extractServersFromJson", () => {
  it("returns empty array for undefined config", () => {
    expect(extractServersFromJson(undefined)).toEqual([]);
  });

  it("returns empty array when no mcpServers key", () => {
    expect(extractServersFromJson({})).toEqual([]);
  });

  it("extracts servers from config", () => {
    const config = {
      mcpServers: {
        github: { command: "npx", args: ["-y", "@mcp/github"], env: { TOKEN: "x" } },
        playwright: { command: "npx" },
      },
    };
    const servers = extractServersFromJson(config);
    expect(servers).toHaveLength(2);
    expect(servers[0].name).toBe("github");
    expect(servers[0].command).toBe("npx");
    expect(servers[0].args).toEqual(["-y", "@mcp/github"]);
    expect(servers[0].env).toEqual({ TOKEN: "x" });
    expect(servers[1].name).toBe("playwright");
    expect(servers[1].command).toBe("npx");
    expect(servers[1].args).toEqual([]);
  });

  it("defaults command to empty string when missing", () => {
    const config = { mcpServers: { test: {} } };
    const servers = extractServersFromJson(config);
    expect(servers[0].command).toBe("");
  });

  it("extracts servers using custom mcpKey", () => {
    const config = { mcp: { pg: { command: "npx", args: ["-y", "pg"] } } };
    const servers = extractServersFromJson(config, "mcp");
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("pg");
    expect(servers[0].command).toBe("npx");
  });

  it("extracts servers using dotted mcpKey", () => {
    const config = { "amp.mcpServers": { gh: { command: "gh-mcp" } } };
    const servers = extractServersFromJson(config, "amp.mcpServers");
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("gh");
  });

  it("returns empty when custom key is missing", () => {
    const config = { mcpServers: { a: { command: "x" } } };
    expect(extractServersFromJson(config, "mcp")).toEqual([]);
  });

  it("extracts URL-based server with headers", () => {
    const config = {
      mcpServers: {
        remote: {
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer ${TOKEN}" },
        },
      },
    };
    const servers = extractServersFromJson(config);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("remote");
    expect(servers[0].url).toBe("https://api.example.com/mcp");
    expect(servers[0].headers).toEqual({ Authorization: "Bearer ${TOKEN}" });
    expect(servers[0].command).toBe("");
  });

  it("extracts mixed stdio and URL-based servers", () => {
    const config = {
      mcpServers: {
        local: { command: "npx", args: ["-y", "@my/mcp"] },
        remote: { url: "https://example.com/mcp" },
      },
    };
    const servers = extractServersFromJson(config);
    expect(servers).toHaveLength(2);
    expect(servers[0].url).toBeUndefined();
    expect(servers[1].url).toBe("https://example.com/mcp");
    expect(servers[1].headers).toBeUndefined();
  });
});

describe("getServers", () => {
  it("reads mcpServers by default", () => {
    const config = { mcpServers: { a: { command: "x" } } };
    const servers = getServers(config);
    expect(servers.a?.command).toBe("x");
  });

  it("reads custom key", () => {
    const config = { mcp: { b: { command: "y" } } };
    const servers = getServers(config, "mcp");
    expect(servers.b?.command).toBe("y");
  });

  it("returns empty record when key is absent", () => {
    expect(getServers({}, "mcp")).toEqual({});
  });
});

describe("setServers", () => {
  it("sets mcpServers by default", () => {
    const config: Record<string, unknown> = {};
    setServers(config, { a: { command: "x" } }, "mcpServers");
    expect(config.mcpServers).toEqual({ a: { command: "x" } });
  });

  it("sets custom key", () => {
    const config: Record<string, unknown> = { existingKey: true };
    setServers(config, { b: { command: "y" } }, "mcp");
    expect(config.mcp).toEqual({ b: { command: "y" } });
    expect(config.existingKey).toBe(true);
  });

  it("preserves other keys in the config", () => {
    const config: Record<string, unknown> = { "amp.mcpServers": {}, theme: "dark" };
    setServers(config, { c: { command: "z" } }, "amp.mcpServers");
    expect(config["amp.mcpServers"]).toEqual({ c: { command: "z" } });
    expect(config.theme).toBe("dark");
  });
});

describe("readMcpJson", () => {
  it("returns empty object when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readMcpJson("/no/file")).toEqual({});
  });

  it("parses valid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{"a":{"command":"x"}}}');
    const result = readMcpJson("/some/file");
    expect(result.mcpServers?.a?.command).toBe("x");
  });

  it("returns empty object on parse error", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not json");
    expect(readMcpJson("/bad")).toEqual({});
  });
});

describe("writeMcpJson", () => {
  it("writes formatted JSON", () => {
    writeMcpJson("/out/mcp.json", { mcpServers: {} });
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const content = mockWriteFileSync.mock.calls[0][1] as string;
    expect(content).toContain("mcpServers");
  });
});

describe("discoverMcpServers", () => {
  it("returns empty array when no agents detected", () => {
    const agents: AgentConfig[] = [{ name: "cursor", detected: false, skillsDir: "x", mcpConfig: "y" }];
    expect(discoverMcpServers(agents)).toEqual([]);
  });

  it("skips agents without mcpConfig", () => {
    const agents: AgentConfig[] = [{ name: "augment", detected: true, skillsDir: "x" }];
    expect(discoverMcpServers(agents)).toEqual([]);
  });

  it("skips when config file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const agents: AgentConfig[] = [{ name: "cursor", detected: true, skillsDir: "x", mcpConfig: "/no/file.json" }];
    expect(discoverMcpServers(agents)).toEqual([]);
  });

  it("discovers servers from cursor config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{"pg":{"command":"npx","args":[]}}}');
    const agents: AgentConfig[] = [{ name: "cursor", detected: true, skillsDir: "x", mcpConfig: "/tmp/mcp.json" }];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("pg");
  });

  it("discovers servers from claude-code config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{"gh":{"command":"npx"}}}');
    const agents: AgentConfig[] = [
      { name: "claude-code", detected: true, skillsDir: "x", mcpConfig: "/tmp/.claude.json" },
    ];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("gh");
  });

  it("deduplicates servers across agents", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcpServers":{"shared":{"command":"npx"}}}');
    const agents: AgentConfig[] = [
      { name: "cursor", detected: true, skillsDir: "x", mcpConfig: "/a.json" },
      { name: "windsurf", detected: true, skillsDir: "y", mcpConfig: "/b.json" },
    ];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
  });

  it("handles invalid JSON gracefully", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not json");
    const agents: AgentConfig[] = [{ name: "cursor", detected: true, skillsDir: "x", mcpConfig: "/bad.json" }];
    const servers = discoverMcpServers(agents);
    expect(servers).toEqual([]);
  });

  it("discovers servers from agent with custom mcpKey", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"mcp":{"opencode-srv":{"command":"oc-mcp"}}}');
    const agents: AgentConfig[] = [
      { name: "opencode", detected: true, skillsDir: "x", mcpConfig: "/tmp/opencode.json", mcpKey: "mcp" },
    ];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("opencode-srv");
  });

  it("discovers servers from agent with dotted mcpKey", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"amp.mcpServers":{"amp-srv":{"command":"amp-mcp"}}}');
    const agents: AgentConfig[] = [
      { name: "amp", detected: true, skillsDir: "x", mcpConfig: "/tmp/settings.json", mcpKey: "amp.mcpServers" },
    ];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("amp-srv");
  });

  it("discovers servers from goose YAML config", () => {
    mockExistsSync.mockReturnValue(true);
    const yamlContent = [
      "extensions:",
      "  playwright:",
      "    type: stdio",
      "    cmd: npx @playwright/mcp@latest",
      "    enabled: true",
      "    timeout: 300",
      "  developer:",
      "    type: builtin",
      "    enabled: true",
    ].join("\n");
    mockReadFileSync.mockReturnValue(yamlContent);
    const agents: AgentConfig[] = [
      {
        name: "goose",
        detected: true,
        skillsDir: "x",
        mcpConfig: "/tmp/config.yaml",
        mcpKey: "extensions",
        mcpFormat: "yaml",
      },
    ];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("playwright");
    expect(servers[0].command).toBe("npx");
    expect(servers[0].args).toEqual(["@playwright/mcp@latest"]);
  });

  it("discovers servers from TOML config", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('[mcpServers.toml-srv]\ncommand = "node"\nargs = ["server.js"]\n');
    const agents: AgentConfig[] = [
      { name: "zed", detected: true, skillsDir: "x", mcpConfig: "/tmp/settings.toml", mcpFormat: "toml" },
    ];
    const servers = discoverMcpServers(agents);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("toml-srv");
    expect(servers[0].command).toBe("node");
  });
});

describe("readGooseYaml", () => {
  it("returns empty object when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readGooseYaml("/no/file")).toEqual({});
  });

  it("parses valid YAML", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("extensions:\n  test:\n    type: stdio\n    cmd: npx test");
    const result = readGooseYaml("/some/file");
    expect(result.extensions?.test?.cmd).toBe("npx test");
  });

  it("returns empty object on parse error", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(":\n  invalid:\nyaml: [[[");
    expect(readGooseYaml("/bad")).toEqual({});
  });
});

describe("extractServersFromGoose", () => {
  it("returns empty array when no extensions", () => {
    expect(extractServersFromGoose({})).toEqual([]);
  });

  it("extracts only stdio extensions", () => {
    const config: GooseConfig = {
      extensions: {
        playwright: { type: "stdio", cmd: "npx @playwright/mcp@latest", enabled: true },
        developer: { type: "builtin", enabled: true },
        memory: { type: "builtin", enabled: true },
      },
    };
    const servers = extractServersFromGoose(config);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("playwright");
    expect(servers[0].command).toBe("npx");
    expect(servers[0].args).toEqual(["@playwright/mcp@latest"]);
  });

  it("extracts env vars from envs field", () => {
    const config: GooseConfig = {
      extensions: {
        github: { type: "stdio", cmd: "npx", args: ["-y", "@mcp/github"], envs: { TOKEN: "abc" } },
      },
    };
    const servers = extractServersFromGoose(config);
    expect(servers[0].env).toEqual({ TOKEN: "abc" });
  });

  it("splits cmd into command and args", () => {
    const config: GooseConfig = {
      extensions: {
        test: { type: "stdio", cmd: "uvx mcp-server-fetch" },
      },
    };
    const servers = extractServersFromGoose(config);
    expect(servers[0].command).toBe("uvx");
    expect(servers[0].args).toEqual(["mcp-server-fetch"]);
  });

  it("merges cmd args with args field", () => {
    const config: GooseConfig = {
      extensions: {
        test: { type: "stdio", cmd: "npx -y", args: ["@mcp/extra"] },
      },
    };
    const servers = extractServersFromGoose(config);
    expect(servers[0].command).toBe("npx");
    expect(servers[0].args).toEqual(["-y", "@mcp/extra"]);
  });

  it("skips extensions without cmd", () => {
    const config: GooseConfig = {
      extensions: {
        broken: { type: "stdio", enabled: true },
      },
    };
    expect(extractServersFromGoose(config)).toEqual([]);
  });
});

describe("readToml", () => {
  it("returns empty object for non-existent file", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readToml("/no/file.toml")).toEqual({});
  });

  it("parses valid TOML", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('[mcpServers.test]\ncommand = "node"\nargs = ["server.js"]\n');
    const result = readToml("/path/to/config.toml");
    expect(result.mcpServers).toBeDefined();
    const servers = result.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers.test.command).toBe("node");
    expect(servers.test.args).toEqual(["server.js"]);
  });

  it("returns empty object for invalid TOML", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{{invalid toml");
    expect(readToml("/bad.toml")).toEqual({});
  });
});

describe("extractServersFromToml", () => {
  it("extracts servers from TOML config", () => {
    const config: TomlConfig = {
      mcpServers: {
        test: { command: "node", args: ["server.js"], env: { KEY: "val" } },
      },
    };
    const servers = extractServersFromToml(config);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("test");
    expect(servers[0].command).toBe("node");
    expect(servers[0].args).toEqual(["server.js"]);
    expect(servers[0].env).toEqual({ KEY: "val" });
  });

  it("uses custom mcpKey", () => {
    const config: TomlConfig = {
      servers: {
        myServer: { command: "npx", args: ["-y", "my-server"] },
      },
    };
    const servers = extractServersFromToml(config, "servers");
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("myServer");
  });

  it("returns empty array when key is missing", () => {
    expect(extractServersFromToml({})).toEqual([]);
  });

  it("handles servers without optional fields", () => {
    const config: TomlConfig = {
      mcpServers: {
        minimal: { command: "node" },
      },
    };
    const servers = extractServersFromToml(config);
    expect(servers[0].args).toEqual([]);
    expect(servers[0].env).toEqual({});
  });
});

describe("readMcpJson with JSONC", () => {
  it("reads JSON with single-line comments", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`{
  // MCP config
  "mcpServers": {
    "test": { "command": "node" }
  }
}`);
    const result = readMcpJson("/path/config.json");
    expect(result.mcpServers?.test).toBeDefined();
  });

  it("reads JSON with block comments", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`{
  /* servers */
  "mcpServers": {
    "test": { "command": "node" }
  }
}`);
    const result = readMcpJson("/path/config.json");
    expect(result.mcpServers?.test).toBeDefined();
  });
});
