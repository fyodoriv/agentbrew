import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("../core/launchctl.js", () => ({
  launchdTargetsThisHome: () => true,
  probeLaunchctl: vi.fn((args: string[]) => ({ status: args[0] === "getenv" ? 0 : 113, stdout: "" })),
  runLaunchctl: vi.fn(() => ""),
}));

import { runLaunchctl } from "../core/launchctl.js";
import { acquireMemoryControlLock } from "./control-lock.js";
import {
  installMemoryLaunchAgents,
  kickstartMemoryDaemon,
  MEMORY_AGENT_LABEL,
  MEMORY_MAINTAIN_LABEL,
  uninstallMemoryLaunchAgents,
} from "./launchagent.js";

it.runIf(process.platform === "darwin")("blocks service controls while another owner holds the lock", () => {
  const dir = join(homedir(), ".config/agentbrew/memory-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const release = acquireMemoryControlLock(join(dir, "control.lock"));
  try {
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(kickstartMemoryDaemon()).toBe(false);
    expect(() => uninstallMemoryLaunchAgents()).toThrow();
    expect(runLaunchctl).not.toHaveBeenCalled();
  } finally {
    release();
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")("blocks service controls while upgrade recovery is required", () => {
  const dir = join(homedir(), ".config/agentbrew/memory-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "upgrade-intent.json"), "partial", { mode: 0o600 });
  try {
    vi.clearAllMocks();
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: false, upgradeBlocked: true });
    expect(kickstartMemoryDaemon()).toBe(false);
    expect(() => uninstallMemoryLaunchAgents()).toThrow("recovery");
    expect(runLaunchctl).not.toHaveBeenCalled();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")("releases control after a failed restart", () => {
  const dir = join(homedir(), ".config/agentbrew/memory-control");
  try {
    vi.clearAllMocks();
    vi.mocked(runLaunchctl).mockImplementationOnce(() => {
      throw new Error("fixture restart failed");
    });
    expect(kickstartMemoryDaemon()).toBe(false);
    expect(kickstartMemoryDaemon()).toBe(true);
    expect(runLaunchctl).toHaveBeenCalledTimes(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it.runIf(process.platform === "darwin")("allows setup and removal after control is released", () => {
  const dir = join(homedir(), ".config/agentbrew/memory-control");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const release = acquireMemoryControlLock(join(dir, "control.lock"));
  release();
  try {
    vi.clearAllMocks();
    vi.stubEnv("AGENTBREW_UVX_BIN", "/fixture/uvx");
    expect(installMemoryLaunchAgents()).toMatchObject({ installed: true });
    expect(() => uninstallMemoryLaunchAgents()).not.toThrow();
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
    for (const label of [MEMORY_AGENT_LABEL, MEMORY_MAINTAIN_LABEL]) {
      rmSync(join(homedir(), "Library/LaunchAgents", `${label}.plist`), { force: true });
    }
  }
});

import { spawn } from "node:child_process";
import { once } from "node:events";

it.runIf(process.platform === "darwin")(
  "blocks a restart while another process owns control, then allows it",
  async () => {
    const dir = join(homedir(), ".config/agentbrew/memory-control");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const code = `import { acquireMemoryControlLock } from "./src/memory/control-lock.ts";
      acquireMemoryControlLock(process.argv[1]); console.log("ready"); setInterval(() => {}, 1000);`;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", code, join(dir, "control.lock")],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const exited = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", () => resolve());
    });
    try {
      const [ready] = await once(child.stdout, "data", { signal: AbortSignal.timeout(10_000) });
      expect(String(ready)).toContain("ready");
      vi.clearAllMocks();
      expect(kickstartMemoryDaemon()).toBe(false);
      expect(runLaunchctl).not.toHaveBeenCalled();
      child.kill("SIGTERM");
      await exited;
      expect(kickstartMemoryDaemon()).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
