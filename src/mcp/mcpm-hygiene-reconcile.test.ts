import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentConfig, McpServer } from "../types.js";
import { findStaleBareKeys, reconcileIntersectionClientEntries, sweepMcpmHygiene } from "./mcpm-hygiene.js";

function server(name: string, fields: Partial<McpServer>): McpServer {
  return { name, command: "", args: [], env: {}, source: "user", ...fields };
}

const tasksMcp = server("tasks-mcp", { command: "npx", args: ["-y", "tasks-mcp@0.10.2"] });
const context7 = server("context7", { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] });
const memory = server("memory", { url: "http://127.0.0.1:18765/mcp" });

function claudeCodeDefinition(home: string): Omit<AgentConfig, "detected"> {
  return { name: "claude-code", mcpConfig: join(home, ".claude.json") } as Omit<AgentConfig, "detected">;
}

describe("findStaleBareKeys", () => {
  it("flags a bare entry whose args differ from state", () => {
    expect(
      findStaleBareKeys(
        {
          "tasks-mcp": { command: "npx", args: ["-y", "tasks-mcp@0.5.0"] },
          context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] },
        },
        [tasksMcp, context7],
      ),
    ).toEqual(["tasks-mcp"]);
  });

  it("compares remote entries by url only", () => {
    expect(findStaleBareKeys({ memory: { type: "http", url: memory.url } }, [memory])).toEqual([]);
    expect(findStaleBareKeys({ memory: { url: "http://127.0.0.1:1/mcp" } }, [memory])).toEqual(["memory"]);
  });

  it("ignores names that state does not define", () => {
    expect(findStaleBareKeys({ webstorm: { url: "http://127.0.0.1:64542/stream" } }, [tasksMcp])).toEqual([]);
  });
});

describe("reconcileIntersectionClientEntries", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "agentbrew-reconcile-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("drops a stale bare entry and reports the server as unreachable", () => {
    const claudeJson = join(home, ".claude.json");
    writeFileSync(
      claudeJson,
      JSON.stringify({
        theme: "dark",
        mcpServers: {
          "tasks-mcp": { command: "npx", args: ["-y", "tasks-mcp@0.5.0"] },
          context7: { command: "npx", args: ["-y", "@upstash/context7-mcp@latest"] },
          mcpm_memory: { command: "mcpm", args: ["run", "memory"] },
        },
      }),
    );

    const unreachable = reconcileIntersectionClientEntries(
      [claudeCodeDefinition(home)],
      ["claude-code"],
      [tasksMcp, context7, memory],
    );

    expect([...unreachable]).toEqual(["tasks-mcp"]);
    const written = JSON.parse(readFileSync(claudeJson, "utf-8"));
    expect(Object.keys(written.mcpServers).sort()).toEqual(["context7", "mcpm_memory"]);
    expect(written.theme).toBe("dark");
  });

  it("sweeps redundant mcpm wrappers with caller-supplied agent definitions", () => {
    const claudeJson = join(home, ".claude.json");
    writeFileSync(
      claudeJson,
      JSON.stringify({ mcpServers: { playwright: { command: "npx" }, mcpm_playwright: { command: "mcpm" } } }),
    );

    const results = sweepMcpmHygiene({ agentDefinitions: [claudeCodeDefinition(home)] });

    expect(results.map((result) => result.removedKeys)).toEqual([["mcpm_playwright"]]);
    expect(Object.keys(JSON.parse(readFileSync(claudeJson, "utf-8")).mcpServers)).toEqual(["playwright"]);
  });

  it("leaves clients alone when they are not detected", () => {
    const claudeJson = join(home, ".claude.json");
    const original = JSON.stringify({ mcpServers: { "tasks-mcp": { command: "npx", args: ["old"] } } });
    writeFileSync(claudeJson, original);

    expect(reconcileIntersectionClientEntries([claudeCodeDefinition(home)], ["cursor"], [tasksMcp]).size).toBe(0);
    expect(readFileSync(claudeJson, "utf-8")).toBe(original);
  });
});
