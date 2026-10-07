import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("../utils.js", () => ({
  expandHome: vi.fn((p: string) => p.replace("~", "/home/user")),
}));

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildLaunchAgentPath,
  launchAgentPathHasRequiredPrefixes,
  requiredLaunchAgentPathPrefixes,
  resolveDotfilesBinPath,
} from "../sync/scheduler-paths.js";
import {
  checkLaunchAgentPathDrift,
  ensurePlistLocale,
  extractPlistPath,
  plistHasLocale,
  setPlistPath,
} from "./launchagent-path.js";

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReaddirSync = vi.mocked(readdirSync);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DOTFILES_DIR", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractPlistPath", () => {
  it("reads PATH from EnvironmentVariables", () => {
    const xml = `<dict><key>PATH</key><string>/a/bin:/b/bin</string></dict>`;
    expect(extractPlistPath(xml)).toBe("/a/bin:/b/bin");
  });
});

describe("setPlistPath", () => {
  it("replaces PATH string in plist XML", () => {
    const xml = `<dict><key>PATH</key><string>/old/bin</string></dict>`;
    expect(setPlistPath(xml, "/new/bin:/usr/bin")).toBe(
      `<dict><key>PATH</key><string>/new/bin:/usr/bin</string></dict>`,
    );
  });

  it("returns input unchanged when PATH key is missing", () => {
    const xml = `<dict><key>Label</key><string>com.example</string></dict>`;
    expect(setPlistPath(xml, "/new/bin")).toBe(xml);
  });
});

describe("plistHasLocale", () => {
  it("accepts LANG or LC_ALL", () => {
    expect(plistHasLocale("<key>LANG</key><string>C.UTF-8</string>")).toBe(true);
    expect(plistHasLocale("<key>LC_ALL</key><string>C.UTF-8</string>")).toBe(true);
  });

  it("rejects a plist with no locale key", () => {
    expect(plistHasLocale("<key>PATH</key><string>/usr/bin</string>")).toBe(false);
  });
});

describe("ensurePlistLocale", () => {
  it("adds LANG after PATH at the same indentation", () => {
    const xml = [
      "    <dict>",
      "        <key>PATH</key>",
      "        <string>/usr/bin:/bin</string>",
      "        <key>HOME</key>",
      "    </dict>",
    ].join("\n");
    expect(ensurePlistLocale(xml)).toBe(
      [
        "    <dict>",
        "        <key>PATH</key>",
        "        <string>/usr/bin:/bin</string>",
        "        <key>LANG</key>",
        "        <string>C.UTF-8</string>",
        "        <key>HOME</key>",
        "    </dict>",
      ].join("\n"),
    );
  });

  it("returns input unchanged when a locale is already set", () => {
    const xml = "<key>PATH</key><string>/usr/bin</string><key>LC_ALL</key><string>en_US.UTF-8</string>";
    expect(ensurePlistLocale(xml)).toBe(xml);
  });

  it("returns input unchanged when PATH key is missing", () => {
    const xml = `<dict><key>Label</key><string>com.example</string></dict>`;
    expect(ensurePlistLocale(xml)).toBe(xml);
  });
});

describe("buildLaunchAgentPath", () => {
  it("prepends node bin and dotfiles bin before /usr/bin", () => {
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      if (s.includes("dotfiles/bin")) return true;
      if (s === "/opt/homebrew/bin") return true;
      if (s.endsWith("/.local/bin")) return true;
      return false;
    });
    const pathValue = buildLaunchAgentPath("/home/user", "/home/user/.nvm/versions/node/v22.0.0/bin");
    expect(pathValue.startsWith("/home/user/.nvm/versions/node/v22.0.0/bin:")).toBe(true);
    expect(pathValue).toContain("/home/user/apps/tooling/dotfiles/bin");
    expect(pathValue).toContain("/usr/bin");
  });
});

describe("launchAgentPathHasRequiredPrefixes", () => {
  it("accepts PATH with node and dotfiles segments first", () => {
    mockExistsSync.mockReturnValue(true);
    const prefixes = requiredLaunchAgentPathPrefixes("/home/user");
    const pathValue = `${prefixes.join(":")}:/usr/bin:/bin`;
    expect(launchAgentPathHasRequiredPrefixes(pathValue, "/home/user")).toBe(true);
  });

  it("rejects PATH that starts with /usr/bin only", () => {
    mockExistsSync.mockReturnValue(true);
    expect(launchAgentPathHasRequiredPrefixes("/usr/bin:/bin", "/home/user")).toBe(false);
  });

  it("rejects PATH that puts the fnm default ahead of the running node", () => {
    const fnmBin = "/home/user/.local/share/fnm/node-versions/v22.1.0/installation/bin";
    const nodeBin = dirname(process.execPath);
    const dotfilesBin = "/home/user/apps/tooling/dotfiles/bin";
    mockReadFileSync.mockImplementation((p) => {
      if (String(p) === "/home/user/.node-version") return "22.1.0\n";
      throw new Error("ENOENT");
    });
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s === "/home/user/.node-version" || s === fnmBin || s === dotfilesBin;
    });
    expect(launchAgentPathHasRequiredPrefixes(`${fnmBin}:${nodeBin}:${dotfilesBin}:/usr/bin`, "/home/user")).toBe(
      false,
    );
    expect(launchAgentPathHasRequiredPrefixes(`${nodeBin}:${fnmBin}:${dotfilesBin}:/usr/bin`, "/home/user")).toBe(true);
  });
});

describe("checkLaunchAgentPathDrift", () => {
  it("returns empty on non-darwin", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux" });
    try {
      expect(checkLaunchAgentPathDrift()).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
  });

  it("flags stale com.agentbrew.check plist missing dotfiles bin", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.includes("LaunchAgents") || s.includes("dotfiles/bin");
    });
    mockReaddirSync.mockReturnValue(["com.agentbrew.check.plist"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(`<?xml version="1.0"?>
<plist><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
</dict></plist>`);

    const drift = checkLaunchAgentPathDrift();
    expect(drift.length).toBeGreaterThan(0);
    expect(drift[0]?.type).toBe("launchagent");
    expect(drift[0]?.detail).toContain(resolveDotfilesBinPath("/home/user"));
    Object.defineProperty(process, "platform", { value: original });
  });

  it("accepts a PATH rooted in the configured Dotfiles worktree", () => {
    const original = process.platform;
    const dotfilesBin = "/home/user/apps/tooling/dotfiles-applied/bin";
    Object.defineProperty(process, "platform", { value: "darwin" });
    vi.stubEnv("DOTFILES_DIR", "/home/user/apps/tooling/dotfiles-applied");
    mockExistsSync.mockImplementation((path) => {
      const value = String(path);
      return value.includes("LaunchAgents") || value === dotfilesBin;
    });
    mockReaddirSync.mockReturnValue(["com.agentbrew.check.plist"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(`<?xml version="1.0"?>
<plist><dict>
<key>PATH</key><string>${dotfilesBin}:${dirname(process.execPath)}:/usr/bin:/bin</string>
<key>LANG</key><string>C.UTF-8</string>
</dict></plist>`);

    try {
      expect(checkLaunchAgentPathDrift()).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
  });

  it("leaves the memory daemon's fixed PATH alone but still checks its locale", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockExistsSync.mockImplementation((path) => String(path).includes("LaunchAgents"));
    mockReaddirSync.mockReturnValue([
      "com.agentbrew.mcp-memory.plist",
      "com.agentbrew.check.plist",
    ] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(`<?xml version="1.0"?>
<plist><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
</dict></plist>`);

    try {
      const details = checkLaunchAgentPathDrift().map((item) => item.detail);
      expect(details.filter((d) => d.includes("com.agentbrew.mcp-memory.plist"))).toEqual([
        "/home/user/Library/LaunchAgents/com.agentbrew.mcp-memory.plist: no LANG, so launchd runs it without a locale — run agentbrew fix",
      ]);
      expect(details.some((d) => d.includes("com.agentbrew.check.plist: PATH missing node"))).toBe(true);
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
  });

  it("flags a plist with a good PATH but no locale", () => {
    const original = process.platform;
    const dotfilesBin = "/home/user/apps/tooling/dotfiles-applied/bin";
    Object.defineProperty(process, "platform", { value: "darwin" });
    vi.stubEnv("DOTFILES_DIR", "/home/user/apps/tooling/dotfiles-applied");
    mockExistsSync.mockImplementation((path) => {
      const value = String(path);
      return value.includes("LaunchAgents") || value === dotfilesBin;
    });
    mockReaddirSync.mockReturnValue(["com.agentbrew.mcp-memory.plist"] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(`<?xml version="1.0"?>
<plist><dict>
<key>PATH</key><string>${dotfilesBin}:${dirname(process.execPath)}:/usr/bin:/bin</string>
</dict></plist>`);

    try {
      const drift = checkLaunchAgentPathDrift();
      expect(drift).toHaveLength(1);
      expect(drift[0]?.detail).toContain("com.agentbrew.mcp-memory.plist: no LANG");
    } finally {
      Object.defineProperty(process, "platform", { value: original });
    }
  });
});
