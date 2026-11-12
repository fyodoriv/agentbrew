import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/launchctl.js", () => ({
  launchdTargetsThisHome: () => true,
  runLaunchctl: vi.fn((args: string[]) => {
    if (args[0] === "print") throw new Error("fixture job not loaded");
    return "";
  }),
}));

import { runLaunchctl } from "../core/launchctl.js";
import { MEMORY_PINNED_SPEC } from "./constants.js";
import { buildMemoryDaemonPlist, installMemoryLaunchAgents, MEMORY_AGENT_LABEL } from "./launchagent.js";

const plist = join(homedir(), "Library/LaunchAgents", `${MEMORY_AGENT_LABEL}.plist`);

afterEach(() => {
  rmSync(plist, { force: true });
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe.runIf(process.platform === "darwin")("memory daemon upgrade guard", () => {
  it.each([
    ["changed", "mcp-memory-service[sqlite]==0.0.1"],
    ["unknown", "unknown-package"],
  ])("does not replace or start an existing job with a %s pin", (_label, oldSpec) => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const oldPlist = buildMemoryDaemonPlist(homedir(), "/fixture/logs", "/fixture/uvx").replace(
      MEMORY_PINNED_SPEC,
      oldSpec,
    );
    writeFileSync(plist, oldPlist);

    const result = installMemoryLaunchAgents();

    expect(result).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(oldPlist);
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("allows an existing job pinned to the same version to be reconciled", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist, buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx"));

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: true });
    expect(vi.mocked(runLaunchctl).mock.calls.some(([args]) => args[0] === "load")).toBe(true);
  });

  it("allows a fresh install when no job exists", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: true });
    expect(vi.mocked(runLaunchctl).mock.calls.some(([args]) => args[0] === "load")).toBe(true);
  });

  it("blocks a job whose installed pin cannot be read", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    mkdirSync(plist);
    try {
      expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
      expect(
        vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
      ).toEqual([]);
    } finally {
      rmSync(plist, { recursive: true, force: true });
    }
  });
});
