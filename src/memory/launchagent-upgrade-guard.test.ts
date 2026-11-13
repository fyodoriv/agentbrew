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
import { MEMORY_DAEMON_ENVIRONMENT, MEMORY_PINNED_SPEC, MEMORY_UVX_ARGS } from "./constants.js";
import * as invoke from "./invoke.js";
import { buildMemoryDaemonPlist, installMemoryLaunchAgents, MEMORY_AGENT_LABEL } from "./launchagent.js";
import { defaultMemoryDbPath } from "./paths.js";
import { prepareMemoryForMcpSync } from "./sync-hooks.js";

const plist = join(homedir(), "Library/LaunchAgents", `${MEMORY_AGENT_LABEL}.plist`);

afterEach(() => {
  rmSync(plist, { force: true });
  rmSync(defaultMemoryDbPath(), { force: true });
  rmSync(join(homedir(), ".env"), { force: true });
  vi.restoreAllMocks();
  vi.mocked(probeLaunchctl).mockImplementation((args) => ({ status: args[0] === "getenv" ? 0 : 113, stdout: "" }));
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function loadedJobOutput(plist: string, extraEnvironment = "", extraArgs = "", inherited = ""): string {
  const args = [
    "/fixture/uvx",
    ...MEMORY_UVX_ARGS,
    "server",
    "--streamable-http",
    "--sse-host",
    "127.0.0.1",
    "--sse-port",
    "18765",
  ];
  const env = Object.entries(MEMORY_DAEMON_ENVIRONMENT)
    .map(([key, value]) => `\t\t${key} => ${value}\n`)
    .join("");
  return `\tpath = ${plist}\n\tworking directory = ${homedir()}\n\targuments = {\n${args.map((arg) => `\t\t${arg}\n`).join("")}${extraArgs}\t}\n\tenvironment = {\n\t\tHOME => ${homedir()}\n${env}${extraEnvironment}\t}\n\tinherited environment = {\n${inherited}\t}\n\tdefault environment = {\n\t}\n`;
}

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

  it("does not restart an unchecked old job when the launcher cannot be resolved", async () => {
    vi.spyOn(invoke, "resolveUvxBin").mockReturnValue(undefined);
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const oldPlist = buildMemoryDaemonPlist(homedir(), "/fixture/logs", "/fixture/uvx").replace(
      MEMORY_PINNED_SPEC,
      "mcp-memory-service[sqlite]==0.0.1",
    );
    writeFileSync(plist, oldPlist);
    const kickstart = vi.fn();
    await expect(
      prepareMemoryForMcpSync(
        { agents: [], catalogVersion: "0.3.0", memory: { enabled: true } },
        {
          launchAgentSupported: () => true,
          initializeHealthy: async () => false,
          waitUntilHealthy: async () => true,
          kickstart,
        },
      ),
    ).rejects.toThrow("uvx not found");
    expect(kickstart).not.toHaveBeenCalled();
    expect(readFileSync(plist, "utf-8")).toBe(oldPlist);
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it.each([
    [
      "custom database",
      (value: string) =>
        value.replace(
          "<key>EnvironmentVariables</key>\n  <dict>",
          "<key>EnvironmentVariables</key>\n  <dict>\n    <key>MCP_MEMORY_SQLITE_PATH</key>\n    <string>/fixture/custom.db</string>",
        ),
    ],
    [
      "foreign working directory",
      (value: string) =>
        value.replace(
          `<key>WorkingDirectory</key>\n  <string>${homedir()}</string>`,
          "<key>WorkingDirectory</key>\n  <string>/fixture/other</string>",
        ),
    ],
  ])("does not reconcile a same-pin job with %s", (_label, mutate) => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = mutate(buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx"));
    writeFileSync(plist, old);
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("does not reconcile a same-pin job loaded from a foreign home", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockReturnValueOnce({
      status: 0,
      stdout: `\tpath = /fixture/foreign.plist\n\tworking directory = /fixture/foreign\n\targuments = {\n\t\t--from\n\t\t${MEMORY_PINNED_SPEC}\n\t}\n\tenvironment = {\n\t\tHOME => /fixture/foreign\n\t}\n`,
    });
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
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

  it("does not reconcile a loaded same-pin job with a custom database environment", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockReturnValueOnce({
      status: 0,
      stdout: loadedJobOutput(plist, "\t\tMCP_MEMORY_SQLITE_PATH => /fixture/custom.db\n"),
    });
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("does not reconcile a loaded job with additional arguments", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockReturnValueOnce({
      status: 0,
      stdout: loadedJobOutput(plist, "", "\t\t--extra\n"),
    });
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
  });

  it("does not reconcile a job with an inherited custom database", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockReturnValueOnce({
      status: 0,
      stdout: loadedJobOutput(plist, "", "", "\t\tMCP_MEMORY_SQLITE_PATH => /fixture/custom.db\n"),
    });
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
  });

  it("does not reconcile a job with an explicit XDG data directory", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockReturnValueOnce({
      status: 0,
      stdout: loadedJobOutput(plist, "\t\tXDG_DATA_HOME => /fixture/other\n"),
    });
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
  });

  it("does not load a stopped job with a custom launchd database path", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockImplementation((args) => ({
      status: args[0] === "getenv" ? 0 : 113,
      stdout: args[1] === "MCP_MEMORY_SQLITE_PATH" ? "/fixture/custom.db" : "",
    }));
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("does not restart a loaded job after launchd gains a custom database path", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    vi.mocked(probeLaunchctl).mockImplementation((args) =>
      args[0] === "print"
        ? { status: 0, stdout: loadedJobOutput(plist) }
        : { status: 0, stdout: args[1] === "MCP_MEMORY_SQLITE_PATH" ? "/fixture/custom.db" : "" },
    );
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
    expect(
      vi.mocked(runLaunchctl).mock.calls.filter(([args]) => ["load", "unload", "kickstart"].includes(args[0])),
    ).toEqual([]);
  });

  it("does not reconcile an existing job when an upstream dotenv file exists", () => {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
    const old = buildMemoryDaemonPlist(homedir(), "/old/logs", "/fixture/uvx");
    writeFileSync(plist, old);
    writeFileSync(join(homedir(), ".env"), "MCP_MEMORY_SQLITE_PATH=/fixture/custom.db\n");
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(readFileSync(plist, "utf-8")).toBe(old);
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
      stdout: loadedJobOutput(plist),
    });

    expect(installMemoryLaunchAgents()).toMatchObject({ installed: true });
  });
});
