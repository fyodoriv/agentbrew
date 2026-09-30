import { describe, expect, it } from "vitest";
import type { AgentConfig, McpServer } from "../types.js";
import { AGENT_DEFINITIONS } from "../types.js";
import { getAdapter } from "./adapters.js";
import { validateMcpEntryAgainstSchema } from "./schema-contract.js";

function defOf(name: string): Omit<AgentConfig, "detected"> {
  const agent = AGENT_DEFINITIONS.find((entry) => entry.name === name);
  if (!agent) throw new Error(`missing agent definition: ${name}`);
  return agent;
}

function server(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: "contract-server",
    command: "npx",
    args: ["-y", "@example/mcp"],
    env: { API_TOKEN: "test-token" },
    source: "user",
    ...overrides,
  };
}

const CONTRACT_AGENT_NAMES = ["opencode", "claude-code", "devin"] as const;

const SERVER_MATRIX: Array<{ label: string; server: McpServer }> = [
  { label: "stdio with env", server: server() },
  { label: "stdio without args", server: server({ args: [], env: {} }) },
  { label: "stdio with inherited env", server: server({ env: { SCHEMA_CONTRACT_TOKEN: "${SCHEMA_CONTRACT_TOKEN}" } }) },
  {
    label: "url with headers",
    server: server({
      command: "",
      args: [],
      env: {},
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer ${API_TOKEN}" },
    }),
  },
  {
    label: "url with env",
    server: server({
      command: "",
      args: [],
      env: { API_TOKEN: "test-token" },
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer ${API_TOKEN}" },
    }),
  },
];

describe("MCP adapter schema contracts", () => {
  it.each(CONTRACT_AGENT_NAMES)("%s has a schema-contract fixture", (agentName) => {
    const agent = defOf(agentName);
    const entry = getAdapter(agent).toEntry(server(), agentName);
    expect(validateMcpEntryAgainstSchema(agentName, "contract-server", entry)).toBeUndefined();
  });

  it.each(
    CONTRACT_AGENT_NAMES.flatMap((agentName) => SERVER_MATRIX.map((fixture) => ({ agentName, ...fixture }))),
  )("$agentName accepts adapter output for $label", ({ agentName, server }) => {
    const agent = defOf(agentName);
    const entry = getAdapter(agent).toEntry(server, agentName);

    expect(validateMcpEntryAgainstSchema(agentName, server.name, entry)).toBeUndefined();
  });

  it("rejects the pre-fix opencode stdio shape", () => {
    const invalidEntry = { command: "npx", args: ["-y", "@example/mcp"], env: { API_TOKEN: "test-token" } };

    expect(validateMcpEntryAgainstSchema("opencode", "contract-server", invalidEntry)).toContain(
      "schema validation failed for opencode.contract-server",
    );
  });
});
