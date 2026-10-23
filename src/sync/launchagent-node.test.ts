// #356: the plist `agentbrew auto-sync install` writes, and how it reloads.
// The plist lands in the scratch HOME (vitest.isolated-home.ts). launchctl is
// mocked: no test loads, unloads, or edits a real LaunchAgent.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchctl = vi.hoisted(() => vi.fn((..._args: unknown[]) => ""));
const spawnMock = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ unref: () => undefined })));

// These cases model a machine whose HOME is the user's home folder; the
// launchctl guard would skip every change under the scratch test HOME.
// child_process is mocked above, so this still runs nothing real.
vi.mock("../core/launchctl.js", async () => {
  const { execFileSync } = await import("node:child_process");
  return {
    launchdTargetsThisHome: () => true,
    runLaunchctl: (args: string[], options: object = {}) =>
      String(execFileSync("launchctl", args, { stdio: "pipe", ...options }) ?? ""),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn((command: string, args?: readonly string[], options?: object) =>
      command === "launchctl"
        ? launchctl(command, args, options)
        : actual.execFileSync(command, args as string[], options as never),
    ),
    spawn: spawnMock,
  };
});

import { checkLaunchAgentPathDrift, extractPlistProgramArguments } from "../drift-checks/launchagent-path.js";
import { autoSyncStatus } from "./auto-sync.js";
import { installLaunchAgent } from "./launchagent.js";

let root: string;

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", "com.agentbrew.check.plist");
}

function fakeNode(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "#!/bin/sh\necho v24.0.0\n");
  chmodSync(path, 0o755);
  return path;
}

function launchctlCalls(verb: string): unknown[][] {
  return launchctl.mock.calls.filter((call) => (call[1] as string[])[0] === verb);
}

beforeEach(() => {
  // Real path, like process.execPath (macOS tmpdir is a /var -> /private/var link).
  root = realpathSync(mkdtempSync(join(tmpdir(), "agentbrew-launchagent-node-")));
  launchctl.mockClear();
  spawnMock.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.XPC_SERVICE_NAME;
});

afterEach(() => {
  delete process.env.AGENTBREW_NODE_BIN;
  delete process.env.XPC_SERVICE_NAME;
});

describe("auto-sync LaunchAgent Node path (#356)", () => {
  it("writes AGENTBREW_NODE_BIN as the program and the first PATH folder", async () => {
    const node = fakeNode(join(root, "allowed", "bin", "node"));
    process.env.AGENTBREW_NODE_BIN = node;

    await installLaunchAgent();

    const plist = readFileSync(plistPath(), "utf-8");
    expect(extractPlistProgramArguments(plist)[0]).toBe(node);
    expect(plist).toMatch(new RegExp(`<key>PATH</key>\\s*<string>${dirname(node)}:`, "u"));
  });

  it("keeps AGENTBREW_NODE_BIN in the job env, so a rewrite inside the job keeps that Node", async () => {
    const node = fakeNode(join(root, "allowed", "bin", "node"));
    process.env.AGENTBREW_NODE_BIN = node;

    await installLaunchAgent();

    const plist = readFileSync(plistPath(), "utf-8");
    expect(plist).toMatch(new RegExp(`<key>AGENTBREW_NODE_BIN</key>\\s*<string>${node}</string>`, "u"));
  });

  it("leaves AGENTBREW_NODE_BIN out of the job env when it is not set", async () => {
    await installLaunchAgent();

    expect(readFileSync(plistPath(), "utf-8")).not.toContain("AGENTBREW_NODE_BIN");
  });

  it("from a terminal, still unloads and loads the job", async () => {
    process.env.AGENTBREW_NODE_BIN = fakeNode(join(root, "bin", "node"));

    await installLaunchAgent();

    expect(launchctlCalls("unload")).toHaveLength(1);
    expect(launchctlCalls("load")).toHaveLength(1);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("inside the job, never unloads its own plist and reloads it after the job exits", async () => {
    process.env.AGENTBREW_NODE_BIN = fakeNode(join(root, "bin", "node"));
    process.env.XPC_SERVICE_NAME = "com.agentbrew.check";

    await installLaunchAgent();

    expect(launchctlCalls("unload")).toHaveLength(0);
    expect(launchctlCalls("load")).toHaveLength(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], { detached: boolean }];
    expect(command).toBe("/bin/sh");
    expect(args).toContain(plistPath());
    expect(args).toContain(String(process.pid));
    expect(options.detached).toBe(true);
  });

  it("inside the job, does not reload when the plist did not change", async () => {
    process.env.AGENTBREW_NODE_BIN = fakeNode(join(root, "bin", "node"));
    await installLaunchAgent();
    spawnMock.mockClear();
    launchctl.mockClear();
    process.env.XPC_SERVICE_NAME = "com.agentbrew.check";

    await installLaunchAgent();

    expect(spawnMock).not.toHaveBeenCalled();
    expect(launchctlCalls("unload")).toHaveLength(0);
  });

  it("auto-sync status names a missing Node program and the fix", async () => {
    process.env.AGENTBREW_NODE_BIN = fakeNode(join(root, "bin", "node"));
    await installLaunchAgent();
    const plist = readFileSync(plistPath(), "utf-8");
    const gone = join(root, "Cellar", "node", "23.0.0", "bin", "node");
    writeFileSync(
      plistPath(),
      plist.replace(`<string>${join(root, "bin", "node")}</string>`, `<string>${gone}</string>`),
    );

    await autoSyncStatus();

    const errors = vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
    expect(errors.some((line) => line.includes(gone) && line.includes("agentbrew auto-sync install"))).toBe(true);
  });

  describe("status drift for the job's Node", () => {
    /** Install, then make the plist run `program` as if no override had been set. */
    async function installRunning(program: string): Promise<void> {
      const installed = fakeNode(join(root, "installed", "bin", "node"));
      process.env.AGENTBREW_NODE_BIN = installed;
      await installLaunchAgent();
      delete process.env.AGENTBREW_NODE_BIN;
      const plist = readFileSync(plistPath(), "utf-8")
        .replace(/\s*<key>AGENTBREW_NODE_BIN<\/key>\s*<string>[^<]*<\/string>/u, "")
        .replaceAll(installed, program)
        .replaceAll(dirname(installed), dirname(program));
      writeFileSync(plistPath(), plist);
    }

    function nodeDrift(): string[] {
      return checkLaunchAgentPathDrift()
        .map((item) => item.detail)
        .filter((detail) => detail.includes("runs "));
    }

    it("flags a Cellar Node path that a Node upgrade deletes, and names the opt link", async () => {
      const cellar = fakeNode(join(root, "homebrew", "Cellar", "node", "24.0.0", "bin", "node"));
      mkdirSync(join(root, "homebrew", "opt"), { recursive: true });
      symlinkSync("../Cellar/node/24.0.0", join(root, "homebrew", "opt", "node"));
      await installRunning(cellar);

      expect(nodeDrift()).toEqual([expect.stringContaining(join(root, "homebrew", "opt", "node", "bin", "node"))]);
    });

    it("flags a Node path that no longer exists", async () => {
      await installRunning(join(root, "gone", "bin", "node"));

      expect(nodeDrift()).toEqual([expect.stringContaining("no longer exists")]);
    });

    it("accepts a Node picked with AGENTBREW_NODE_BIN", async () => {
      process.env.AGENTBREW_NODE_BIN = fakeNode(join(root, "allowed", "bin", "node"));
      await installLaunchAgent();

      expect(nodeDrift()).toEqual([]);
    });
  });
});
