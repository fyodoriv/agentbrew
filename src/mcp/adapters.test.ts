import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpServer } from "../types.js";
import { getAdapter, JsonAdapter, OpenCodeAdapter } from "./adapters.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "adapters-test-"));
}

function makeServer(overrides?: Partial<McpServer>): McpServer {
  return {
    name: "test-server",
    command: "npx",
    args: ["-y", "@test/server"],
    env: { API_KEY: "secret123" },
    source: "user",
    ...overrides,
  };
}

// ── JsonAdapter ─────────────────────────────────────────────────────────────

describe("JsonAdapter", () => {
  let tmp: string;
  let adapter: JsonAdapter;

  beforeEach(() => {
    tmp = makeTmpDir();
    adapter = new JsonAdapter();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("readEntries", () => {
    it("returns empty object for non-existent file", () => {
      const entries = adapter.readEntries(join(tmp, "missing.json"), "mcpServers");
      expect(entries).toEqual({});
    });

    it("reads servers from JSON file using mcpKey", () => {
      const config = {
        mcpServers: {
          myserver: { command: "node", args: ["server.js"] },
        },
      };
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify(config));

      const entries = adapter.readEntries(join(tmp, "mcp.json"), "mcpServers");
      expect(entries).toEqual({
        myserver: { command: "node", args: ["server.js"] },
      });
    });

    it("reads servers with custom mcpKey", () => {
      const config = {
        servers: {
          custom: { command: "deno", args: ["run", "server.ts"] },
        },
      };
      writeFileSync(join(tmp, "mcp.json"), JSON.stringify(config));

      const entries = adapter.readEntries(join(tmp, "mcp.json"), "servers");
      expect(entries).toEqual({
        custom: { command: "deno", args: ["run", "server.ts"] },
      });
    });
  });

  describe("writeEntries", () => {
    it("creates file and directories if needed", () => {
      const configPath = join(tmp, "sub", "dir", "mcp.json");
      adapter.writeEntries(configPath, { srv: { command: "node" } }, "mcpServers");

      const written = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(written.mcpServers).toEqual({ srv: { command: "node" } });
    });

    it("preserves existing config keys", () => {
      const configPath = join(tmp, "mcp.json");
      writeFileSync(configPath, JSON.stringify({ otherKey: "keep-me", mcpServers: {} }));

      adapter.writeEntries(configPath, { srv: { command: "node" } }, "mcpServers");

      const written = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(written.otherKey).toBe("keep-me");
      expect(written.mcpServers).toEqual({ srv: { command: "node" } });
    });
  });

  describe("toEntry", () => {
    it("creates entry with command, args, env", () => {
      const server = makeServer();
      const entry = adapter.toEntry(server, "cursor");
      const launcher = entry.command as string;
      if (launcher.endsWith("mcp-cursor-launch.sh")) {
        expect(entry.args).toEqual(["npx", "-y", "@test/server"]);
      } else {
        expect(entry).toEqual({
          command: "npx",
          args: ["-y", "@test/server"],
          env: { API_KEY: "secret123" },
        });
      }
      if (entry.env) {
        expect(entry.env).toEqual({ API_KEY: "secret123" });
      }
    });

    it("omits args when empty", () => {
      const server = makeServer({ args: [] });
      const entry = adapter.toEntry(server, "cursor");
      const command = entry.command as string;
      if (command.endsWith("mcp-cursor-launch.sh")) {
        expect(entry.args).toEqual(["npx"]);
      } else {
        expect(entry).not.toHaveProperty("args");
      }
    });

    it("omits env when empty", () => {
      const server = makeServer({ env: {} });
      const entry = adapter.toEntry(server, "cursor");
      expect(entry).not.toHaveProperty("env");
    });

    it("creates URL-based entry with headers (rewrites bare ${VAR} to ${VAR:-})", () => {
      // Headers go through `convertEnvVars` which now applies `makeResilient` for
      // standard-format agents (see env-vars.ts). Bare ${API_TOKEN} becomes
      // ${API_TOKEN:-} so that strict importers (Devin reading ~/.cursor/mcp.json)
      // don't crash when the env var is unset. Functionally identical for clients
      // that handle bash-style ${VAR:-default} substitution.
      const server = makeServer({
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer ${API_TOKEN}" },
        command: "",
        args: [],
        env: {},
      });
      const entry = adapter.toEntry(server, "cursor");
      expect(entry).toEqual({
        url: "https://api.example.com/mcp",
        headers: { Authorization: "Bearer ${API_TOKEN:-}" },
      });
      expect(entry).not.toHaveProperty("command");
    });

    it("creates URL-based entry without headers", () => {
      const server = makeServer({
        url: "https://example.com/mcp",
        command: "",
        args: [],
        env: {},
      });
      const entry = adapter.toEntry(server, "cursor");
      expect(entry).toEqual({ url: "https://example.com/mcp" });
      expect(entry).not.toHaveProperty("headers");
      expect(entry).not.toHaveProperty("command");
    });

    it("sets Claude's required HTTP transport type for URL-based servers", () => {
      const server = makeServer({
        url: "https://mcp.figma.com/mcp",
        command: "",
        args: [],
        env: {},
      });

      expect(adapter.toEntry(server, "claude-code")).toEqual({
        type: "http",
        url: "https://mcp.figma.com/mcp",
      });
      expect(adapter.toEntry(server, "claude-desktop")).toEqual({
        type: "http",
        url: "https://mcp.figma.com/mcp",
      });
      expect(adapter.toEntry(server, "cursor")).toEqual({
        url: "https://mcp.figma.com/mcp",
      });
    });

    it("includes env on URL-based entry when present (rewrites bare ${VAR} to ${VAR:-})", () => {
      // Same rationale as the headers test above — bare ${TOKEN} becomes ${TOKEN:-}
      // in the header. The env field itself contains a concrete value (no placeholder
      // to rewrite), so it passes through unchanged.
      const server = makeServer({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN}" },
        command: "",
        args: [],
        env: { TOKEN: "my-secret" },
      });
      const entry = adapter.toEntry(server, "cursor");
      expect(entry).toEqual({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer ${TOKEN:-}" },
        env: { TOKEN: "my-secret" },
      });
    });

    it("does not write resolved Devin env secrets when the shell can provide them at runtime", () => {
      const previous = process.env.DEVIN_ADAPTER_SECRET;
      process.env.DEVIN_ADAPTER_SECRET = "super-secret-value";
      try {
        const server = makeServer({
          env: {
            DEVIN_ADAPTER_SECRET: "${DEVIN_ADAPTER_SECRET}",
            APP_ENV: "dev",
          },
        });
        const entry = adapter.toEntry(server, "devin");
        expect(entry).toEqual({
          command: "npx",
          args: ["-y", "@test/server"],
          env: { APP_ENV: "dev" },
        });
        expect(JSON.stringify(entry)).not.toContain("super-secret-value");
      } finally {
        if (previous === undefined) delete process.env.DEVIN_ADAPTER_SECRET;
        else process.env.DEVIN_ADAPTER_SECRET = previous;
      }
    });

    it("removes older resolved Devin env secrets when updating an entry that now inherits them", () => {
      const previous = process.env.DEVIN_ADAPTER_SECRET;
      process.env.DEVIN_ADAPTER_SECRET = "super-secret-value";
      try {
        const server = makeServer({
          env: {
            DEVIN_ADAPTER_SECRET: "${DEVIN_ADAPTER_SECRET}",
            APP_ENV: "dev",
          },
        });
        const entry = adapter.toEntry(server, "devin");
        const entries: Record<string, Record<string, unknown>> = {
          "test-server": {
            command: "npx",
            args: ["-y", "@test/server"],
            env: { DEVIN_ADAPTER_SECRET: "old-token", USER_EXTRA: "keep" },
          },
        };

        expect(adapter.entriesMatch(entries["test-server"], entry)).toBe(false);
        adapter.applyUpdate(entries, "test-server", entry);
        expect(entries["test-server"].env).toEqual({ USER_EXTRA: "keep", APP_ENV: "dev" });
      } finally {
        if (previous === undefined) delete process.env.DEVIN_ADAPTER_SECRET;
        else process.env.DEVIN_ADAPTER_SECRET = previous;
      }
    });
  });

  describe("entriesMatch", () => {
    it("returns true for identical entries", () => {
      const entry = { command: "node", args: ["a"] };
      expect(adapter.entriesMatch(entry, { ...entry })).toBe(true);
    });

    it("returns false for different entries", () => {
      expect(adapter.entriesMatch({ command: "node", args: ["a"] }, { command: "node", args: ["b"] })).toBe(false);
    });

    it("ignores user-added fields when comparing", () => {
      const existing = { command: "node", args: ["a"], autoApprove: ["tool"], description: "custom" };
      const desired = { command: "node", args: ["a"] };
      expect(adapter.entriesMatch(existing, desired)).toBe(true);
    });

    it("ignores user-added env keys when comparing", () => {
      const existing = { command: "node", env: { API_KEY: "x", DEBUG: "true" } };
      const desired = { command: "node", env: { API_KEY: "x" } };
      expect(adapter.entriesMatch(existing, desired)).toBe(true);
    });

    it("detects changed env values for agentbrew keys", () => {
      const existing = { command: "node", env: { API_KEY: "old" } };
      const desired = { command: "node", env: { API_KEY: "new" } };
      expect(adapter.entriesMatch(existing, desired)).toBe(false);
    });

    it("detects a missing required managed transport type", () => {
      const existing = { url: "https://mcp.figma.com/mcp" };
      const desired = { type: "http", url: "https://mcp.figma.com/mcp" };
      expect(adapter.entriesMatch(existing, desired)).toBe(false);
    });
  });

  describe("applyUpdate", () => {
    it("merges entry preserving user-added fields", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "old", extra: "field", autoApprove: ["tool"] },
      };
      adapter.applyUpdate(entries, "srv", { command: "new" });
      expect(entries.srv.command).toBe("new");
      expect(entries.srv.extra).toBe("field");
      expect(entries.srv.autoApprove).toEqual(["tool"]);
    });

    it("adds new entry", () => {
      const entries: Record<string, Record<string, unknown>> = {};
      adapter.applyUpdate(entries, "new-srv", { command: "node" });
      expect(entries["new-srv"]).toEqual({ command: "node" });
    });

    it("merges env vars preserving user-added keys", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "node", env: { USER_KEY: "keep", API_KEY: "old" } },
      };
      adapter.applyUpdate(entries, "srv", { command: "node", env: { API_KEY: "new", NEW_KEY: "added" } });
      expect(entries.srv.env).toEqual({ USER_KEY: "keep", API_KEY: "new", NEW_KEY: "added" });
    });

    it("merges headers preserving user-added keys", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "node", headers: { Authorization: "Bearer user-token", "X-Custom": "keep" } },
      };
      adapter.applyUpdate(entries, "srv", { command: "node", headers: { "X-Api-Key": "new-key" } });
      expect(entries.srv.headers).toEqual({
        Authorization: "Bearer user-token",
        "X-Custom": "keep",
        "X-Api-Key": "new-key",
      });
    });

    it("preserves user-resolved env value when incoming is a placeholder", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "node", env: { GITHUB_TOKEN: "ghp_abc123real" } },
      };
      adapter.applyUpdate(entries, "srv", { command: "node", env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } });
      expect(entries.srv.env).toEqual({ GITHUB_TOKEN: "ghp_abc123real" });
    });

    it("allows a new concrete value to overwrite a placeholder", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "node", env: { TOKEN: "${TOKEN}" } },
      };
      adapter.applyUpdate(entries, "srv", { command: "node", env: { TOKEN: "resolved-value" } });
      expect(entries.srv.env).toEqual({ TOKEN: "resolved-value" });
    });

    // ── agentbrew-sync-clear-stale-mcp-fields: a shape switch must drop stale managed fields ──
    it("clears stale args/env when an entry switches to a bare command (npx → absolute wrapper)", () => {
      const entries: Record<string, Record<string, unknown>> = {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_stale" },
        },
      };
      adapter.applyUpdate(entries, "github", { command: "/Users/x/.local/bin/organization-github-mcp" });
      expect(entries.github).toEqual({ command: "/Users/x/.local/bin/organization-github-mcp" });
    });

    it("clears stale command/args/env when switching from stdio to a URL server", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "npx", args: ["-y", "@x/server"], env: { K: "v" } },
      };
      adapter.applyUpdate(entries, "srv", { url: "https://example.com/mcp" });
      expect(entries.srv).toEqual({ url: "https://example.com/mcp" });
    });

    it("adds Claude's managed HTTP transport type to an existing URL server", () => {
      const entries: Record<string, Record<string, unknown>> = {
        figma: { url: "https://mcp.figma.com/mcp" },
      };
      adapter.applyUpdate(entries, "figma", { type: "http", url: "https://mcp.figma.com/mcp" });
      expect(entries.figma).toEqual({ type: "http", url: "https://mcp.figma.com/mcp" });
    });

    it("clears stale url/headers when switching from a URL server to stdio", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
      };
      adapter.applyUpdate(entries, "srv", { command: "node", args: ["server.js"] });
      expect(entries.srv).toEqual({ command: "node", args: ["server.js"] });
    });

    it("preserves user-added top-level keys while clearing stale managed fields", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: {
          command: "npx",
          args: ["-y", "@x/server"],
          env: { K: "v" },
          autoApprove: ["tool"],
          disabled: false,
        },
      };
      adapter.applyUpdate(entries, "srv", { command: "/abs/wrapper" });
      expect(entries.srv).toEqual({ command: "/abs/wrapper", autoApprove: ["tool"], disabled: false });
    });
  });

  describe("isPrunable", () => {
    it("always returns true", () => {
      expect(adapter.isPrunable("test-server", {})).toBe(true);
    });
  });

  describe("discoverServers", () => {
    it("returns empty array for non-existent file", () => {
      expect(adapter.discoverServers(join(tmp, "missing.json"), "mcpServers")).toEqual([]);
    });

    it("discovers servers from JSON config", () => {
      const config = {
        mcpServers: {
          myserver: { command: "node", args: ["srv.js"], env: { KEY: "val" } },
        },
      };
      const configPath = join(tmp, "mcp.json");
      writeFileSync(configPath, JSON.stringify(config));

      const servers = adapter.discoverServers(configPath, "mcpServers");
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("myserver");
      expect(servers[0].command).toBe("node");
      expect(servers[0].args).toEqual(["srv.js"]);
      expect(servers[0].env).toEqual({ KEY: "val" });
    });
  });

  describe("removeServer", () => {
    it("removes server and returns true", () => {
      const config = {
        mcpServers: {
          keep: { command: "a" },
          remove: { command: "b" },
        },
      };
      const configPath = join(tmp, "mcp.json");
      writeFileSync(configPath, JSON.stringify(config));

      const result = adapter.removeServer(configPath, "remove", "mcpServers");
      expect(result).toBe(true);

      const updated = JSON.parse(readFileSync(configPath, "utf-8"));
      expect(updated.mcpServers).toEqual({ keep: { command: "a" } });
    });

    it("returns false when server not found", () => {
      const configPath = join(tmp, "mcp.json");
      writeFileSync(configPath, JSON.stringify({ mcpServers: {} }));

      expect(adapter.removeServer(configPath, "nonexistent", "mcpServers")).toBe(false);
    });

    it("returns false for non-existent file", () => {
      expect(adapter.removeServer(join(tmp, "nope.json"), "srv", "mcpServers")).toBe(false);
    });
  });
});

// ── OpenCodeAdapter ─────────────────────────────────────────────────────────

// opencode 1.14+ rejects the old `{command, args}` MCP stdio shape — its config
// schema is `{ type: "local", command: [cmd, ...args] }` with `environment`
// (not `env`), and `additionalProperties: false`. These tests guard the shape
// conversion + idempotency (a second sync over an opencode 1.14+ config must
// be a no-op — `entriesMatch` returns true).
describe("OpenCodeAdapter", () => {
  let tmp: string;
  let adapter: OpenCodeAdapter;

  beforeEach(() => {
    tmp = makeTmpDir();
    adapter = new OpenCodeAdapter();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  describe("toEntry", () => {
    it("emits opencode 1.14+ stdio shape: { type: 'local', command: [cmd, ...args] }", () => {
      const server = makeServer();
      const entry = adapter.toEntry(server, "opencode");
      expect(entry).toEqual({
        type: "local",
        command: ["npx", "-y", "@test/server"],
        environment: { API_KEY: "secret123" },
      });
      expect(entry).not.toHaveProperty("args");
      expect(entry).not.toHaveProperty("env");
    });

    it("collapses command + args into single array even when args is empty", () => {
      const server = makeServer({ args: [], env: {} });
      const entry = adapter.toEntry(server, "opencode");
      expect(entry).toEqual({ type: "local", command: ["npx"] });
    });

    it("emits remote shape for url-based servers", () => {
      const server = makeServer({
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
        command: "",
        args: [],
        env: {},
      });
      const entry = adapter.toEntry(server, "opencode");
      expect(entry).toEqual({
        type: "remote",
        url: "https://example.com/mcp",
        headers: { Authorization: "Bearer x" },
      });
      expect(entry).not.toHaveProperty("command");
      expect(entry).not.toHaveProperty("environment");
    });
  });

  describe("entriesMatch", () => {
    it("returns true when desired round-trips through readEntries (idempotency)", () => {
      // Write a config in opencode 1.14+ shape, read it back, then compare to
      // a fresh toEntry() output. A second sync must be a no-op.
      const configPath = join(tmp, "opencode.json");
      const server = makeServer();
      const desired = adapter.toEntry(server, "opencode");
      adapter.writeEntries(configPath, { "test-server": desired }, "mcp");

      const readBack = adapter.readEntries(configPath, "mcp");
      expect(adapter.entriesMatch(readBack["test-server"], desired)).toBe(true);
    });

    it("returns false when type differs (old `{command, args}` vs new `{type, command:[]}`)", () => {
      const existing = { command: "npx", args: ["-y", "@test/server"] };
      const desired = adapter.toEntry(makeServer(), "opencode");
      expect(adapter.entriesMatch(existing, desired)).toBe(false);
    });

    it("ignores user-added metadata keys (enabled, timeout)", () => {
      const desired = adapter.toEntry(makeServer({ env: {} }), "opencode");
      const existing = { ...desired, enabled: true, timeout: 30000 };
      expect(adapter.entriesMatch(existing, desired)).toBe(true);
    });

    it("detects changed command array", () => {
      const desired = adapter.toEntry(makeServer(), "opencode");
      const existing = { type: "local", command: ["npx", "-y", "@test/different"] };
      expect(adapter.entriesMatch(existing, desired)).toBe(false);
    });
  });

  describe("applyUpdate", () => {
    it("strips legacy `args` and scalar `command` from existing entry", () => {
      // opencode's schema is `additionalProperties: false` — a stray `args`
      // key from an old-format entry would block opencode-serve.
      const entries: Record<string, Record<string, unknown>> = {
        srv: { command: "npx", args: ["-y", "@old/pkg"], env: { OLD: "val" } },
      };
      const newEntry = adapter.toEntry(makeServer({ name: "srv", env: {} }), "opencode");
      adapter.applyUpdate(entries, "srv", newEntry);
      expect(entries.srv).toEqual({ type: "local", command: ["npx", "-y", "@test/server"] });
      expect(entries.srv).not.toHaveProperty("args");
      expect(entries.srv).not.toHaveProperty("env");
    });

    it("preserves user metadata keys (enabled, timeout) on existing entry", () => {
      const entries: Record<string, Record<string, unknown>> = {
        srv: { type: "local", command: ["npx", "-y", "@old/pkg"], enabled: true, timeout: 5000 },
      };
      const newEntry = adapter.toEntry(makeServer({ name: "srv", env: {} }), "opencode");
      adapter.applyUpdate(entries, "srv", newEntry);
      expect(entries.srv.enabled).toBe(true);
      expect(entries.srv.timeout).toBe(5000);
      expect(entries.srv.command).toEqual(["npx", "-y", "@test/server"]);
    });
  });

  describe("discoverServers", () => {
    it("reads array-command back into { command, args }", () => {
      const config = {
        mcp: {
          srv: { type: "local", command: ["npx", "-y", "@test/server"], environment: { K: "v" } },
        },
      };
      const configPath = join(tmp, "opencode.json");
      writeFileSync(configPath, JSON.stringify(config));

      const servers = adapter.discoverServers(configPath, "mcp");
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("srv");
      expect(servers[0].command).toBe("npx");
      expect(servers[0].args).toEqual(["-y", "@test/server"]);
      expect(servers[0].env).toEqual({ K: "v" });
    });
  });
});

// ── getAdapter factory ──────────────────────────────────────────────────────

// Slice 4b of `delegate-mcp-to-mcpm`: `ClaudeAdapter` (with its `claude
// mcp add-json` / `claude mcp remove` CLI bridge) and `getClaudeAdapter`
// were deleted. claude-code is filtered out of `getMcpTargetAgents` post-
// slice-4a, so the bridge was unreachable; `getAdapter` now falls through
// to `JsonAdapter` for any leftover claude-code caller (e.g. test fixtures).
//
// ── TomlAdapter (codex) ─────────────────────────────────────────────────────

describe("TomlAdapter (codex)", () => {
  const codex = getAdapter({ name: "codex", mcpFormat: "toml" });
  let tmp: string;
  let configPath: string;

  beforeEach(() => {
    tmp = makeTmpDir();
    configPath = join(tmp, "config.toml");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function remote(headers?: Record<string, string>): McpServer {
    return makeServer({ name: "remote", command: "", args: [], env: {}, url: "https://example.com/mcp", headers });
  }

  it("writes servers under mcp_servers and keeps other top-level keys", () => {
    writeFileSync(configPath, 'model = "gpt-5.5"\n\n[projects."/tmp/x"]\ntrust_level = "trusted"\n');
    codex.writeEntries(configPath, { remote: { url: "https://example.com/mcp" } }, "mcp_servers");

    const raw = readFileSync(configPath, "utf-8");
    expect(raw).toContain('model = "gpt-5.5"');
    expect(raw).toContain('trust_level = "trusted"');
    expect(codex.readEntries(configPath, "mcp_servers")).toEqual({ remote: { url: "https://example.com/mcp" } });
  });

  it("refuses to read or write an unparseable file instead of overwriting it", () => {
    writeFileSync(configPath, "this is = = not toml");
    expect(() => codex.readEntries(configPath, "mcp_servers")).toThrow();
    expect(() => codex.writeEntries(configPath, {}, "mcp_servers")).toThrow();
    expect(readFileSync(configPath, "utf-8")).toBe("this is = = not toml");
  });

  it("emits only url for a remote server — never env or args", () => {
    const entry = codex.toEntry({ ...remote(), env: { TOKEN: "x" } }, "codex");
    expect(entry).toEqual({ url: "https://example.com/mcp" });
  });

  it("maps headers to Codex header fields", () => {
    const entry = codex.toEntry(
      remote({ Authorization: "Bearer ${API_TOKEN}", "X-Team": "${TEAM_ID}", "X-Client": "agentbrew" }),
      "codex",
    );
    expect(entry).toEqual({
      url: "https://example.com/mcp",
      bearer_token_env_var: "API_TOKEN",
      env_http_headers: { "X-Team": "TEAM_ID" },
      http_headers: { "X-Client": "agentbrew" },
    });
  });

  it("throws for a header that mixes text with an env var", () => {
    expect(() => codex.toEntry(remote({ "X-Key": "key-${API_KEY}" }), "codex")).toThrow(/Codex cannot express/);
  });

  it("keeps stdio entries in the standard command/args/env shape", () => {
    expect(codex.toEntry(makeServer({ env: {} }), "codex")).toEqual({ command: "npx", args: ["-y", "@test/server"] });
  });

  it("treats an unchanged remote entry as a match and a changed header as drift", () => {
    const desired = codex.toEntry(remote({ Authorization: "Bearer ${API_TOKEN}" }), "codex");
    expect(codex.entriesMatch({ ...desired, startup_timeout_sec: 20 }, desired)).toBe(true);
    expect(codex.entriesMatch({ ...desired, bearer_token_env_var: "OTHER" }, desired)).toBe(false);
  });

  it("drops Codex header fields the desired entry no longer declares", () => {
    const entries: Record<string, Record<string, unknown>> = {
      remote: { url: "https://example.com/mcp", bearer_token_env_var: "OLD", startup_timeout_sec: 20 },
    };
    codex.applyUpdate(entries, "remote", codex.toEntry(remote(), "codex"));
    expect(entries.remote).toEqual({ url: "https://example.com/mcp", startup_timeout_sec: 20 });
  });

  it("discovers Codex header fields back as canonical headers", () => {
    writeFileSync(
      configPath,
      '[mcp_servers.remote]\nurl = "https://example.com/mcp"\nbearer_token_env_var = "API_TOKEN"\n' +
        '[mcp_servers.remote.http_headers]\nX-Client = "agentbrew"\n',
    );
    const [server] = codex.discoverServers(configPath, "mcp_servers");
    expect(server.url).toBe("https://example.com/mcp");
    expect(server.headers).toEqual({ "X-Client": "agentbrew", Authorization: "Bearer ${API_TOKEN}" });
  });

  it("removes one server and leaves the rest", () => {
    codex.writeEntries(
      configPath,
      { a: { url: "https://a.example/mcp" }, b: { url: "https://b.example/mcp" } },
      "mcp_servers",
    );
    expect(codex.removeServer(configPath, "a", "mcp_servers")).toBe(true);
    expect(codex.removeServer(configPath, "missing", "mcp_servers")).toBe(false);
    expect(Object.keys(codex.readEntries(configPath, "mcp_servers"))).toEqual(["b"]);
  });
});

// The yaml and toml adapters extend `JsonAdapter` and override only the file
// format (and, for codex, the remote-entry shape).
describe("getAdapter", () => {
  it("returns JsonAdapter for claude-code (slice 4b: ClaudeAdapter deleted)", () => {
    const adapter = getAdapter({ name: "claude-code", mcpFormat: "json" });
    expect(adapter).toBeInstanceOf(JsonAdapter);
  });

  it("returns a JsonAdapter subclass for yaml format", () => {
    const adapter = getAdapter({ name: "goose", mcpFormat: "yaml" });
    expect(adapter).toBeInstanceOf(JsonAdapter);
  });

  it("returns a JsonAdapter subclass for toml format", () => {
    const adapter = getAdapter({ name: "codex", mcpFormat: "toml" });
    expect(adapter).toBeInstanceOf(JsonAdapter);
  });

  it("returns JsonAdapter for json format", () => {
    const adapter = getAdapter({ name: "cursor", mcpFormat: "json" });
    expect(adapter).toBeInstanceOf(JsonAdapter);
  });

  it("returns JsonAdapter when mcpFormat is undefined", () => {
    const adapter = getAdapter({ name: "unknown-agent", mcpFormat: undefined });
    expect(adapter).toBeInstanceOf(JsonAdapter);
  });

  // Overlay/product formats (e.g. overlay-desktop) + the unknown-format error
  // path are covered hermetically in src/overlay-injection.test.ts (mocked state).

  it("returns OpenCodeAdapter for opencode format", () => {
    const adapter = getAdapter({ name: "opencode", mcpFormat: "opencode" });
    expect(adapter).toBeInstanceOf(OpenCodeAdapter);
  });
});

// ── Regression: agentbrew-sync-clear-stale-mcp-fields (Devin + Windsurf) ──────
// Devin and Windsurf both resolve to JsonAdapter (mcpFormat defaults to "json").
// When central state switches `github` from `{ command: "npx", args, env }` to a
// bare `{ command: "/abs/organization-github-mcp" }`, the generated config must not keep
// the previous shape's args/env (it caused Devin to invoke the organization wrapper with
// public-GitHub-MCP args).
describe.each(["devin", "windsurf"])("shape switch clears stale fields for %s", (agentName) => {
  it("leaves an organization wrapper entry as exactly { command } after the previous npx shape", () => {
    const adapter = getAdapter({ name: agentName, mcpFormat: undefined } as Parameters<typeof getAdapter>[0]);
    const wrapper = "/Users/x/.local/bin/organization-github-mcp";
    const entries: Record<string, Record<string, unknown>> = {
      github: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PERSONAL_ACCESS_TOKEN}" },
      },
    };
    const entry = adapter.toEntry(makeServer({ name: "github", command: wrapper, args: [], env: {} }), agentName);
    adapter.applyUpdate(entries, "github", entry);
    expect(entries.github.command).toBe(wrapper);
    expect(entries.github).not.toHaveProperty("args");
    expect(entries.github).not.toHaveProperty("env");
  });
});
