import { describe, expect, it, vi } from "vitest";
import type { AgentBrewState } from "../types.js";
import { prepareMemoryForMcpSync } from "./sync-hooks.js";

function state(enabled: boolean): AgentBrewState {
  return {
    agents: [],
    catalogVersion: "0.3.0",
    memory: { enabled },
  };
}

describe("prepareMemoryForMcpSync", () => {
  it("does nothing when memory is disabled", async () => {
    const installLaunchAgents = vi.fn();
    await prepareMemoryForMcpSync(state(false), { installLaunchAgents });
    expect(installLaunchAgents).not.toHaveBeenCalled();
  });

  it("reconciles changed LaunchAgents and waits for the daemon", async () => {
    const waitUntilHealthy = vi.fn(async () => true);
    const kickstart = vi.fn();

    await prepareMemoryForMcpSync(state(true), {
      launchAgentSupported: () => true,
      installLaunchAgents: () => ({ installed: true, changed: true }),
      initializeHealthy: vi.fn(async () => false),
      waitUntilHealthy,
      kickstart,
    });

    expect(waitUntilHealthy).toHaveBeenCalledTimes(1);
    expect(kickstart).not.toHaveBeenCalled();
  });

  it("kickstarts an unchanged but unhealthy daemon and waits for recovery", async () => {
    const kickstart = vi.fn();
    const waitUntilHealthy = vi.fn(async () => true);

    await prepareMemoryForMcpSync(state(true), {
      launchAgentSupported: () => true,
      installLaunchAgents: () => ({ installed: true, changed: false }),
      initializeHealthy: vi.fn(async () => false),
      waitUntilHealthy,
      kickstart,
    });

    expect(kickstart).toHaveBeenCalledTimes(1);
    expect(waitUntilHealthy).toHaveBeenCalledTimes(1);
  });

  it("requires tools/list during unchanged-daemon readiness", async () => {
    const toolsListHealthy = vi.fn(async () => false);
    const kickstart = vi.fn();
    const waitUntilHealthy = vi.fn(async () => true);

    await prepareMemoryForMcpSync(state(true), {
      launchAgentSupported: () => true,
      installLaunchAgents: () => ({ installed: true, changed: false }),
      initializeHealthy: vi.fn(async () => true),
      toolsListHealthy,
      waitUntilHealthy,
      kickstart,
    });

    expect(toolsListHealthy).toHaveBeenCalledTimes(1);
    expect(kickstart).toHaveBeenCalledTimes(1);
    expect(waitUntilHealthy).toHaveBeenCalledTimes(1);
  });

  it("fails when the shared endpoint remains unavailable", async () => {
    await expect(
      prepareMemoryForMcpSync(state(true), {
        launchAgentSupported: () => true,
        installLaunchAgents: () => ({ installed: true, changed: false }),
        initializeHealthy: vi.fn(async () => false),
        waitUntilHealthy: vi.fn(async () => false),
        kickstart: vi.fn(),
      }),
    ).rejects.toThrow("shared memory MCP unavailable");
  });
});
