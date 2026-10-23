import { describe, expect, it, vi } from "vitest";
import { installFakeLaunchctl } from "../test-utils/fake-launchctl.js";
import { MEMORY_DAEMON_ENVIRONMENT, MEMORY_PYTHON_VERSION } from "./constants.js";
import {
  buildMaintainPlist,
  buildMemoryDaemonPlist,
  installMemoryLaunchAgents,
  isLabelDisabledInLaunchctlOutput,
  kickstartMemoryDaemon,
  MEMORY_AGENT_LABEL,
  MEMORY_MAINTAIN_LABEL,
  memoryDaemonPath,
  parseLaunchctlJobIdentity,
} from "./launchagent.js";

vi.mock("../sync/scheduler-paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync/scheduler-paths.js")>()),
  resolveSchedulerNode: () => "/stable/opt/node/bin/node",
}));

describe("memory LaunchAgent", () => {
  it("enables behavioral bootstrap and all canonical daemon invariants", () => {
    const plist = buildMemoryDaemonPlist("/Users/test", "/Users/test/logs", "/opt/homebrew/bin/uvx");

    expect(plist).toContain(`<string>${MEMORY_AGENT_LABEL}</string>`);
    for (const [key, value] of Object.entries(MEMORY_DAEMON_ENVIRONMENT)) {
      expect(plist).toContain(`<key>${key}</key>\n    <string>${value}</string>`);
    }
    expect(plist).toContain("<key>MCP_BOOTSTRAP_ENABLED</key>\n    <string>true</string>");
    expect(plist).toContain("<key>MCP_BOOTSTRAP_MAX_TOKENS</key>\n    <string>1536</string>");
    expect(plist).toContain("<key>LANG</key>\n    <string>C.UTF-8</string>");
  });

  it("keeps the daemon plist identical whatever Node or DOTFILES_DIR runs agentbrew", () => {
    const build = () => buildMemoryDaemonPlist("/Users/test", "/Users/test/logs", "/opt/homebrew/bin/uvx");
    const baseline = build();
    const original = process.env.DOTFILES_DIR;
    const execPath = Object.getOwnPropertyDescriptor(process, "execPath");
    try {
      process.env.DOTFILES_DIR = "/tmp/some-worktree";
      Object.defineProperty(process, "execPath", { value: "/tmp/other-node/bin/node", configurable: true });
      expect(build()).toBe(baseline);
    } finally {
      if (original === undefined) delete process.env.DOTFILES_DIR;
      else process.env.DOTFILES_DIR = original;
      if (execPath) Object.defineProperty(process, "execPath", execPath);
    }
  });

  it("pins the Python that uvx runs the service on", () => {
    const plist = buildMemoryDaemonPlist("/Users/test", "/Users/test/logs", "/opt/homebrew/bin/uvx");
    expect(plist).toContain(
      `<string>/opt/homebrew/bin/uvx</string>\n    <string>--python</string>\n    <string>${MEMORY_PYTHON_VERSION}</string>`,
    );
    expect(plist).toContain("<string>memory</string>\n    <string>server</string>");
  });

  it("puts the uvx directory first on the daemon PATH, once", () => {
    expect(memoryDaemonPath("/Users/test", "/Users/test/.local/bin/uvx")).toBe(
      "/Users/test/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    );
  });

  it("detects an exact disabled label without matching a sibling", () => {
    const output = `disabled services = {\n\t"${MEMORY_AGENT_LABEL}" => disabled\n\t"${MEMORY_MAINTAIN_LABEL}" => disabled\n}`;

    expect(isLabelDisabledInLaunchctlOutput(output, MEMORY_AGENT_LABEL)).toBe(true);
    expect(isLabelDisabledInLaunchctlOutput(output, MEMORY_MAINTAIN_LABEL)).toBe(true);
    expect(isLabelDisabledInLaunchctlOutput(output, "com.agentbrew.other")).toBe(false);
  });
});

describe("parseLaunchctlJobIdentity", () => {
  const output = [
    "gui/501/com.agentbrew.mcp-memory = {",
    "\tactive count = 1",
    "\tpath = /Users/test/Library/LaunchAgents/com.agentbrew.mcp-memory.plist",
    "\tstdout path = /Users/test/logs/mcp-memory.out.log",
    "\tinherited environment = {",
    "\t\tHOME => /tmp/inherited-home",
    "\t}",
    "\tenvironment = {",
    "\t\tLANG => C.UTF-8",
    "\t\tHOME => /Users/test",
    "\t}",
    "}",
  ].join("\n");

  it("reads the plist path and the job's own HOME", () => {
    expect(parseLaunchctlJobIdentity(output)).toEqual({
      path: "/Users/test/Library/LaunchAgents/com.agentbrew.mcp-memory.plist",
      home: "/Users/test",
    });
  });

  it("returns nulls when the fields are missing", () => {
    expect(parseLaunchctlJobIdentity("gui/501/x = {\n}")).toEqual({ path: null, home: null });
  });
});

describe("memory LaunchAgents under a scratch HOME", () => {
  it.runIf(process.platform === "darwin")("never loads, enables, or restarts a job in the user's launchd", () => {
    const fake = installFakeLaunchctl();
    vi.stubEnv("AGENTBREW_UVX_BIN", "/opt/homebrew/bin/uvx");
    try {
      expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, reason: expect.stringContaining("HOME") });
      expect(kickstartMemoryDaemon()).toBe(false);
      const changes = fake.calls().filter(([verb]) => verb !== "print" && verb !== "print-disabled");
      expect(changes).toEqual([]);
    } finally {
      fake.restore();
      vi.unstubAllEnvs();
    }
  });
});

describe("memory maintenance plist Node (#456)", () => {
  it("runs the Node link that survives upgrades, not the versioned process.execPath", () => {
    const plist = buildMaintainPlist("/Users/test", "/usr/bin:/bin", "/Users/test/logs");
    const program = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/u.exec(plist)?.[1];
    expect(program).toBe("/stable/opt/node/bin/node");
  });

  it("keeps AGENTBREW_NODE_BIN in the job env when the job runs that Node, like the check job", () => {
    vi.stubEnv("AGENTBREW_NODE_BIN", "/stable/opt/node/bin/node");
    try {
      const plist = buildMaintainPlist("/Users/test", "/usr/bin:/bin", "/Users/test/logs");
      expect(plist).toMatch(/<key>AGENTBREW_NODE_BIN<\/key>\s*<string>\/stable\/opt\/node\/bin\/node<\/string>/u);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
