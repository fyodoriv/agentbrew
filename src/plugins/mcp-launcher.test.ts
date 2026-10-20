/** Secrets by reference, launchers, and pinned MCP runtimes: step 9 of #208. */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const { home, previousHome } = vi.hoisted(() => {
  const { mkdtempSync: mk } = require("node:fs") as typeof import("node:fs");
  const { tmpdir: td } = require("node:os") as typeof import("node:os");
  const { join: j } = require("node:path") as typeof import("node:path");
  const previous = process.env.HOME;
  const dir = mk(j(td(), "mcp-launcher-home-"));
  process.env.HOME = dir;
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  return { home: dir, previousHome: previous };
});

import { fixtureKey, pluginFixture } from "../test-utils/plugin-fixture.js";
import { emitClaudeNative, marketplaceDir } from "./claude-native.js";
import { launcherPath, type PluginMcpServer, validateMcpServers } from "./mcp-launcher.js";
import { addPlugin } from "./store.js";

const KEY = fixtureKey();
const TOKEN = "s3cr3t-test-token-value";

function server(extra: Partial<PluginMcpServer>): PluginMcpServer {
  return { name: "acme-jira", command: "node", args: ["server.js"], ...extra };
}

function install(servers: PluginMcpServer[]): void {
  const f = pluginFixture({
    schema: 1,
    name: "acme",
    version: "1.0.0",
    capabilities: { mcp_servers: servers.map((s) => s.name) },
    contributes: { mcp_servers: "mcp/servers.yaml" },
  });
  f.release("v1", { "mcp/servers.yaml": yaml.dump(servers) });
  addPlugin(`${f.dir}@v1`, { yes: true, signer: KEY.pub });
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  for (const d of [".config", ".local", ".claude"]) rmSync(join(home, d), { recursive: true, force: true });
});

afterAll(() => {
  process.env.HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

describe("validateMcpServers", () => {
  it("accepts references and pinned runtimes", () => {
    expect(
      validateMcpServers([
        server({ env: { A: "env:ACME_A", B: "keychain:acme-b", C: "op://vault/item/field" } }),
        server({ name: "n", command: "npx", args: ["-y", "@acme/mcp@1.2.3"] }),
        server({ name: "u", command: "uvx", args: ["acme-mcp==0.4.1"] }),
      ]),
    ).toEqual([]);
  });

  it.each([
    [
      server({ env: { TOKEN } }),
      "acme-jira: env TOKEN must be a reference (keychain:, env:, op://), not a literal value",
    ],
    [
      server({ command: "npx", args: ["-y", "@acme/mcp@latest"] }),
      "acme-jira: npx package @acme/mcp@latest is not pinned to an exact version",
    ],
    [
      server({ command: "npx", args: ["-y", "acme-mcp"] }),
      "acme-jira: npx package acme-mcp is not pinned to an exact version",
    ],
    [server({ command: "npx", args: ["-y"] }), "acme-jira: npx has no package"],
    [
      server({ command: "uvx", args: ["acme-mcp"] }),
      "acme-jira: uvx package acme-mcp is not pinned to an exact version",
    ],
  ])("refuses %j", (entry, message) => {
    expect(validateMcpServers([entry])).toEqual([message]);
  });

  it("plugin add refuses a literal secret", () => {
    expect(() => install([server({ env: { TOKEN } })])).toThrow(/must be a reference/);
  });
});

describe("launchers", () => {
  it("resolve env references at process start and keep secrets out of every generated config", () => {
    install([server({ command: "sh", args: ["-c", 'printf %s "$TOKEN"'], env: { TOKEN: "env:ACME_TOKEN" } })]);
    emitClaudeNative();

    const launcher = launcherPath("acme", "acme-jira");
    const out = execFileSync(launcher, { env: { ...process.env, ACME_TOKEN: TOKEN }, encoding: "utf-8" });
    expect(out).toBe(TOKEN);

    const mcp = JSON.parse(readFileSync(join(marketplaceDir(), "plugins", "acme", ".mcp.json"), "utf-8"));
    expect(mcp.mcpServers["acme-jira"]).toEqual({ command: launcher, args: [] });

    const generated = [
      join(home, ".claude", "settings.json"),
      launcher,
      ...readdirSync(join(marketplaceDir(), "plugins", "acme"), { recursive: true })
        .map((f) => join(marketplaceDir(), "plugins", "acme", String(f)))
        .filter((f) => f.endsWith(".json")),
    ];
    for (const file of generated) expect(readFileSync(file, "utf-8")).not.toContain(TOKEN);
  });

  it("a missing env reference fails at start with a clear message", () => {
    install([server({ command: "true", env: { TOKEN: "env:ACME_MISSING" } })]);
    emitClaudeNative();
    const env = { ...process.env };
    delete env.ACME_MISSING;
    expect(() => execFileSync(launcherPath("acme", "acme-jira"), { env, stdio: "pipe" })).toThrow(/ACME_MISSING/);
  });

  it("quotes arguments so they cannot inject shell", () => {
    install([server({ command: "printf", args: ["%s", "$(touch /tmp/x); 'q'"] })]);
    emitClaudeNative();
    expect(execFileSync(launcherPath("acme", "acme-jira"), { encoding: "utf-8" })).toBe("$(touch /tmp/x); 'q'");
  });
});
