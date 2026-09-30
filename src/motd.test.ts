import { beforeEach, describe, expect, it, vi } from "vitest";
import { printMotd } from "./motd.js";

vi.mock("./state.js", () => ({
  loadState: vi.fn(),
}));

vi.mock("./core/errors.js", () => ({
  loadSyncErrors: vi.fn(),
}));

vi.mock("./repair-log.js", () => ({
  getRepairSummary: vi.fn(() => null),
  clearRepairLog: vi.fn(),
  touchLastSeen: vi.fn(),
}));

vi.mock("./auto-upgrade.js", () => ({
  checkForAutoUpgrade: vi.fn(),
}));

const { loadState } = await import("./state.js");
const { loadSyncErrors } = await import("./core/errors.js");
const mockLoadState = vi.mocked(loadState);
const mockLoadSyncErrors = vi.mocked(loadSyncErrors);

function makeAgent(name: string) {
  return { name, detected: true, skillsDir: `~/.${name}/skills` };
}

function makeMcpServer(name: string) {
  return { name, command: "npx", args: [] as string[], env: {} as Record<string, string>, source: "user" as const };
}

function makeState(
  overrides: { agents?: ReturnType<typeof makeAgent>[]; mcpServers?: ReturnType<typeof makeMcpServer>[] } = {},
) {
  return {
    agents: overrides.agents ?? [],
    mcpServers: overrides.mcpServers ?? [],
    sources: [],
    catalogVersion: "0.1.0",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("printMotd", () => {
  it("prints status line for normal commands", () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("claude-code"), makeAgent("cursor")],
        mcpServers: [makeMcpServer("srv1"), makeMcpServer("srv2"), makeMcpServer("srv3")],
      }),
    );
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [],
    });

    printMotd("sync");

    expect(console.log).toHaveBeenCalledTimes(1);
    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain("2 agents");
    expect(output).toContain("3 servers");
    expect(output).toContain("synced just now");
  });

  it("stays silent for status command", () => {
    printMotd("status");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stays silent for check command", () => {
    printMotd("check");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stays silent for doctor command", () => {
    printMotd("doctor");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stays silent for init command", () => {
    printMotd("init");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stays silent for browse command", () => {
    printMotd("browse");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stays silent when no state exists", () => {
    mockLoadState.mockReturnValue(undefined as ReturnType<typeof loadState>);
    printMotd("sync");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("stays silent when command is undefined", () => {
    printMotd(undefined);
    expect(console.log).not.toHaveBeenCalled();
  });

  it("shows sync errors count", () => {
    mockLoadState.mockReturnValue(makeState({ agents: [makeAgent("a")] }));
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: new Date().toISOString(),
      errors: [
        { timestamp: "", code: "SYNC_ERROR", message: "mcp fail", module: "mcp" },
        { timestamp: "", code: "SYNC_ERROR", message: "rules fail", module: "rules" },
      ],
    });

    printMotd("catalog");

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain("2 sync error(s)");
  });

  it("shows stale warning when sync is old", () => {
    mockLoadState.mockReturnValue(makeState({ agents: [makeAgent("a")] }));
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    mockLoadSyncErrors.mockReturnValue({
      lastSyncAt: twoDaysAgo,
      errors: [],
    });

    printMotd("catalog");

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain("2d ago");
    expect(output).toContain("⚠");
  });

  it("works without sync error log", () => {
    mockLoadState.mockReturnValue(
      makeState({
        agents: [makeAgent("a")],
        mcpServers: [makeMcpServer("s")],
      }),
    );
    mockLoadSyncErrors.mockReturnValue(undefined);

    printMotd("sync");

    const output = vi.mocked(console.log).mock.calls[0][0] as string;
    expect(output).toContain("1 agents");
    expect(output).toContain("1 servers");
  });
});
