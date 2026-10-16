import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => `${process.env.TMPDIR ?? "/tmp"}/agentbrew-repair-node-dir-${process.pid}`);

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("../utils.js", () => ({
  expandHome: (p: string) => p.replace(/^~/, home),
}));

import { extractPlistPath } from "../drift-checks/launchagent-path.js";
import { repairAgentbrewLaunchAgentPaths } from "./launchagent.js";

const PLIST_NODE_DIR = "/fixture/plist-node/bin";

function stalePlist(): string {
  return `<plist><dict>
<key>ProgramArguments</key>
<array>
<string>${PLIST_NODE_DIR}/node</string>
<string>agentbrew</string>
</array>
<key>EnvironmentVariables</key>
<dict>
<key>PATH</key><string>/usr/bin:/bin</string>
</dict>
</dict></plist>`;
}

describe("repairAgentbrewLaunchAgentPaths node dir", () => {
  const plistPath = join(home, "Library/LaunchAgents/com.agentbrew.fixture-job.plist");

  beforeAll(() => {
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plistPath, stalePlist());
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it.runIf(process.platform === "darwin")("starts the repaired PATH with the plist's own node dir", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await repairAgentbrewLaunchAgentPaths()).toBe(1);

    const repaired = extractPlistPath(readFileSync(plistPath, "utf-8")) ?? "";
    expect(repaired.split(":")[0]).toBe(PLIST_NODE_DIR);
    expect(repaired).not.toContain(`${process.execPath.replace(/\/node$/u, "")}:`);
  });
});
