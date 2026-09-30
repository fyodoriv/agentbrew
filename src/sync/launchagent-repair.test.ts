import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync: vi.fn(),
}));
vi.mock("write-file-atomic", () => ({ sync: vi.fn() }));
vi.mock("../utils.js", () => ({ expandHome: vi.fn((p: string) => p.replace("~", "/home/user")) }));
vi.mock("../drift-checks/launchagent-path.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../drift-checks/launchagent-path.js")>()),
  listAgentbrewLaunchAgentPlists: () => [
    "/home/user/Library/LaunchAgents/com.agentbrew.mcp-memory.plist",
    "/home/user/Library/LaunchAgents/com.agentbrew.competitor-watch.plist",
  ],
}));
vi.mock("./scheduler-paths.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./scheduler-paths.js")>()),
  buildLaunchAgentPath: () => "/node/bin:/dotfiles/bin:/usr/bin:/bin",
  launchAgentPathHasRequiredPrefixes: () => false,
}));

import { readFileSync } from "node:fs";
import { sync as writeFileAtomicSync } from "write-file-atomic";
import { repairAgentbrewLaunchAgentPaths } from "./launchagent.js";

const plist = `<plist><dict>
<key>PATH</key><string>/opt/homebrew/bin:/usr/bin:/bin</string>
<key>LANG</key><string>C.UTF-8</string>
</dict></plist>`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.mocked(readFileSync).mockReturnValue(plist);
});

describe("repairAgentbrewLaunchAgentPaths", () => {
  it.runIf(process.platform === "darwin")("rewrites stale PATHs but never the memory daemon plist", async () => {
    const repaired = await repairAgentbrewLaunchAgentPaths();

    expect(repaired).toBe(1);
    const written = vi.mocked(writeFileAtomicSync).mock.calls.map(([path]) => String(path));
    expect(written).toEqual(["/home/user/Library/LaunchAgents/com.agentbrew.competitor-watch.plist"]);
  });
});
