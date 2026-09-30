import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const delegateMcpUninstall = vi.fn((opts: { serverName: string }) => ({
  ok: true,
  carveOuts: [],
  perClient: [{ client: "claude-code", ok: true }],
  globalUninstall: { ok: true },
  serverName: opts.serverName,
}));

vi.mock("../sync/mcp-delegate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync/mcp-delegate.js")>();
  return { ...actual, delegateMcpUninstall };
});

const { uninstallBrokenMcpmRegistryServers, uninstallQuarantinedMcpmServers } = await import("./mcpm-hygiene.js");

describe("mcpm uninstall skips servers mcpm does not register", () => {
  let configDir: string;
  const previousDir = process.env.AGENTBREW_MCPM_CONFIG_DIR;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "agentbrew-mcpm-"));
    process.env.AGENTBREW_MCPM_CONFIG_DIR = configDir;
    delegateMcpUninstall.mockClear();
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (previousDir === undefined) delete process.env.AGENTBREW_MCPM_CONFIG_DIR;
    else process.env.AGENTBREW_MCPM_CONFIG_DIR = previousDir;
  });

  function registerInMcpm(...names: string[]): void {
    const servers = Object.fromEntries(names.map((name) => [name, { name, command: "npx" }]));
    writeFileSync(join(configDir, "servers.json"), JSON.stringify(servers));
  }

  // Regression: each sync re-ran `mcpm client edit --remove-server` for every
  // intersection client on servers already gone from mcpm, so `status --fix`
  // spent over an hour on no-op subprocesses.
  it("does not spawn mcpm for a quarantined server that is already uninstalled", () => {
    registerInMcpm("context7");
    expect(uninstallQuarantinedMcpmServers(["claude-code"], ["blocked"], false)).toEqual([]);
    expect(delegateMcpUninstall).not.toHaveBeenCalled();
  });

  it("uninstalls a quarantined server that mcpm still registers", () => {
    registerInMcpm("blocked", "context7");
    expect(uninstallQuarantinedMcpmServers(["claude-code"], ["blocked"], false)).toEqual(["blocked"]);
    expect(delegateMcpUninstall).toHaveBeenCalledTimes(1);
    expect(delegateMcpUninstall).toHaveBeenCalledWith({ serverName: "blocked", agents: ["claude-code"] });
  });

  it("only uninstalls the blocklisted servers mcpm still registers", () => {
    registerInMcpm("jira-mcp");
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], false, new Set())).toEqual(["jira-mcp"]);
    expect(delegateMcpUninstall).toHaveBeenCalledTimes(1);
  });

  it("does nothing when mcpm has no servers.json", () => {
    expect(uninstallBrokenMcpmRegistryServers(["claude-code"], false, new Set())).toEqual([]);
    expect(delegateMcpUninstall).not.toHaveBeenCalled();
  });
});
