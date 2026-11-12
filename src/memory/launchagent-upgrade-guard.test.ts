import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../core/launchctl.js", () => ({
  launchdTargetsThisHome: () => true,
  probeLaunchctl: vi.fn((args: string[]) => ({ status: args[0] === "getenv" ? 0 : 113, stdout: "" })),
  runLaunchctl: vi.fn((args: string[]) => {
    if (args[0] === "print") throw new Error("fixture job not loaded");
    return "";
  }),
}));

import { probeLaunchctl, runLaunchctl } from "../core/launchctl.js";
import { MEMORY_PINNED_SPEC } from "./constants.js";
import { buildMemoryDaemonPlist, installMemoryLaunchAgents, MEMORY_AGENT_LABEL } from "./launchagent.js";
import { defaultMemoryDbPath } from "./paths.js";

const plist = join(homedir(), "Library/LaunchAgents", `${MEMORY_AGENT_LABEL}.plist`);

afterEach(() => {
  rmSync(plist, { force: true });
  rmSync(defaultMemoryDbPath(), { force: true });
  rmSync(join(homedir(), ".env"), { force: true });
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

  it("does not start a new job against a pre-existing default database", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    const db = defaultMemoryDbPath();
    mkdirSync(join(homedir(), "Library/Application Support/mcp-memory"), { recursive: true });
    writeFileSync(db, "synthetic existing database");

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("does not guess the database when an upstream working-directory dotenv exists", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    writeFileSync(join(homedir(), ".env"), "SYNTHETIC=1\n");

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("does not guess the database when launchd has a custom path", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    vi.mocked(probeLaunchctl).mockImplementation((args) =>
      args[0] === "getenv" ? { status: 0, stdout: "/fixture/custom-memory.db\n" } : { status: 113, stdout: "" },
    );
    try {
      expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
      expect(
        vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
      ).toEqual([]);
    } finally {
      vi.mocked(probeLaunchctl).mockImplementation((args) => ({ status: args[0] === "getenv" ? 0 : 113, stdout: "" }));
    }
  });

  it("does not start a new job when launchd environment cannot be checked", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    vi.mocked(probeLaunchctl).mockReturnValueOnce(undefined);
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
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

  it.each([
    [
      "different running pin",
      { status: 0, stdout: "\targuments = {\n\t\t--from\n\t\tmcp-memory-service[sqlite]==0.0.1\n\t}\n" },
    ],
    ["unknown running pin", { status: 0, stdout: "\targuments = {\n\t\tunknown\n\t}\n" }],
    ["failed launchd probe", undefined],
  ])("does not restart when the %s cannot be trusted", (_label, probe) => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist, buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx"));
    vi.mocked(probeLaunchctl).mockReturnValueOnce(probe);

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("permits a loaded job whose pin matches the installed file", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist, buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx"));
    vi.mocked(probeLaunchctl).mockReturnValueOnce({
      status: 0,
      stdout: `\targuments = {\n\t\t--from\n\t\t${MEMORY_PINNED_SPEC}\n\t}\n`,
    });

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: true });
  });
});
