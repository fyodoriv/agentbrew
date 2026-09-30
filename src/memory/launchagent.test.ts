import { describe, expect, it } from "vitest";
import { MEMORY_DAEMON_ENVIRONMENT } from "./constants.js";
import {
  buildMemoryDaemonPlist,
  isLabelDisabledInLaunchctlOutput,
  MEMORY_AGENT_LABEL,
  MEMORY_MAINTAIN_LABEL,
  memoryDaemonPath,
} from "./launchagent.js";

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
