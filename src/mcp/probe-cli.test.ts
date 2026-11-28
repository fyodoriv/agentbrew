import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "../core/agents.js";
import { probeAllServers } from "./probe.js";
import { runProbe } from "./probe-cli.js";

vi.mock("../core/agents.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../core/agents.js")>()),
  loadAgentDefinitions: vi.fn(),
}));

vi.mock("./catalog-smoke.js", () => ({
  buildDeepSmokeMap: vi.fn(),
  buildSchedulerProbeSuppressionMap: vi.fn(() => new Map()),
}));

vi.mock("./health-snapshot.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./health-snapshot.js")>()),
  saveMcpHealthSnapshot: vi.fn(),
}));

vi.mock("./probe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./probe.js")>()),
  probeAllServers: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

it.each([
  { status: "needs_auth", exit: 0, message: "needs sign-in", summary: "sign-in needed for 1" },
  { status: "init_error", exit: 1, message: "init_error", summary: "1 MCP probe(s) failed" },
] as const)("renders $status and returns $exit", async ({ status, exit, message, summary }) => {
  const scratch = mkdtempSync(join(tmpdir(), "mcp-probe-cli-"));
  const configPath = join(scratch, "mcp.json");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    writeFileSync(configPath, JSON.stringify({ mcpServers: { remote: { url: "https://example.com/mcp" } } }));
    vi.mocked(loadAgentDefinitions).mockReturnValue([{ name: "fixture", skillsDir: scratch, mcpConfig: configPath }]);
    vi.mocked(probeAllServers).mockResolvedValue([{ name: "remote", agent: "fixture", status, latencyMs: 1 }]);

    expect(await runProbe({ agentFilter: "fixture" })).toBe(exit);
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain(message);
    expect(output).toContain(summary);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
