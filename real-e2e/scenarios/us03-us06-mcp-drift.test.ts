import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  runScenarioCli,
  runScenarioEval,
  runWithScenarioSandbox,
  seedScenarioState,
} from "../../src/real-e2e/scenario-fixture.js";

interface McpEntry {
  args?: string[];
  command?: string;
  description?: string;
}

interface McpConfig {
  mcpServers?: Record<string, McpEntry>;
}

function readMcpConfig(configPath: string): McpConfig {
  return JSON.parse(readFileSync(configPath, "utf-8")) as McpConfig;
}

function writeProbeCleanMcpServer(scriptPath: string): void {
  writeFileSync(
    scriptPath,
    [
      'process.stdin.setEncoding("utf8");',
      'let buffer = "";',
      'const responses = { initialize: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "agentbrew-real-e2e", version: "1.0.0" } }, "tools/list": { tools: [] } };',
      'process.stdin.on("data", (chunk) => {',
      "  buffer += chunk;",
      '  let newlineIndex = buffer.indexOf("\\n");',
      "  while (newlineIndex !== -1) {",
      "    const line = buffer.slice(0, newlineIndex).trim();",
      "    buffer = buffer.slice(newlineIndex + 1);",
      '    newlineIndex = buffer.indexOf("\\n");',
      "    if (!line) continue;",
      "    const message = JSON.parse(line);",
      '    if (message.method === "notifications/initialized" || message.id === undefined) continue;',
      "    const result = responses[message.method] ?? {};",
      '    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\\n`);',
      "  }",
      "});",
    ].join("\n"),
    "utf-8",
  );
}

function writeUserMcpConfig(configPath: string, serverScriptPath: string): void {
  writeFileSync(
    configPath,
    `${JSON.stringify(
      {
        mcpServers: {
          "local-only": {
            command: "node",
            args: [serverScriptPath],
            description: "Keep my local MCP server",
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

describe("us03/us06 mcp drift", () => {
  it("syncs MCP servers, repairs managed drift, and preserves user-added servers", async () => {
    await runWithScenarioSandbox("us03-us06-mcp-drift", async ({ fixtureDir, rootDir }) => {
      const homeDir = join(rootDir, "home");
      const repoRoot = resolve(import.meta.dirname, "..", "..");
      const stateModule = pathToFileURL(join(repoRoot, "src", "state.ts")).href;
      const serverDir = join(homeDir, ".config", "agentbrew", "real-e2e");
      const serverScriptPath = join(serverDir, "mcp-server.mjs");

      cpSync(join(fixtureDir, "home"), homeDir, { recursive: true });
      mkdirSync(serverDir, { recursive: true });
      writeProbeCleanMcpServer(serverScriptPath);
      writeUserMcpConfig(join(homeDir, ".kiro", "settings", "mcp.json"), serverScriptPath);
      await seedScenarioState(homeDir, repoRoot);
      await runScenarioEval({
        args: [],
        homeDir,
        repoRoot,
        statements: [
          `import { loadState, saveState } from ${JSON.stringify(stateModule)};`,
          "const state = loadState();",
          "if (!state) throw new Error('state not seeded');",
          `state.mcpServers = [{ name: 'project-docs', command: 'node', args: [${JSON.stringify(serverScriptPath)}], env: {}, source: 'real-e2e' }];`,
          "saveState(state);",
        ],
      });

      const initialSync = await runScenarioCli({
        args: ["sync", "--only", "mcp", "--sequential"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(initialSync.stdout).toContain("Syncing: mcp");

      const kiroMcpPath = join(homeDir, ".kiro", "settings", "mcp.json");
      let kiroMcp = readMcpConfig(kiroMcpPath);
      expect(kiroMcp.mcpServers?.["project-docs"]).toEqual({
        command: "node",
        args: [serverScriptPath],
      });
      expect(kiroMcp.mcpServers?.["local-only"]?.description).toBe("Keep my local MCP server");

      delete kiroMcp.mcpServers?.["project-docs"];
      writeFileSync(kiroMcpPath, `${JSON.stringify(kiroMcp, null, 2)}\n`, "utf-8");

      const repairResult = await runScenarioCli({
        args: ["status", "--fix"],
        cwd: rootDir,
        homeDir,
        repoRoot,
      });
      expect(repairResult.stdout).toContain("auto-repairing");
      expect(repairResult.stderr).toContain("kiro [mcp] — missing server: project-docs");
      expect(repairResult.stdout).toContain("All drift resolved");

      kiroMcp = readMcpConfig(kiroMcpPath);
      expect(kiroMcp.mcpServers?.["project-docs"]).toEqual({
        command: "node",
        args: [serverScriptPath],
      });
      expect(kiroMcp.mcpServers?.["local-only"]?.description).toBe("Keep my local MCP server");
    });
  }, 120_000);
});
