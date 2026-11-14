import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../core/launchctl.js", () => ({
  launchdTargetsThisHome: () => true,
  probeLaunchctl: vi.fn(),
  runLaunchctl: vi.fn(),
}));

import { probeLaunchctl, runLaunchctl } from "../core/launchctl.js";
import { MEMORY_AGENT_LABEL, uninstallMemoryLaunchAgents } from "./launchagent.js";

const path = join(homedir(), "Library/LaunchAgents", `${MEMORY_AGENT_LABEL}.plist`);
const loaded = () => ({ status: 0, stdout: `\tpath = ${path}\n\tenvironment = {\n\t\tHOME => ${homedir()}\n\t}\n` });

afterEach(() => {
  rmSync(path, { force: true });
  vi.resetAllMocks();
});

it.runIf(process.platform === "darwin")("preserves the plist and reports an unload failure", () => {
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  writeFileSync(path, "fixture");
  vi.mocked(probeLaunchctl).mockReturnValue(loaded());
  vi.mocked(runLaunchctl).mockImplementation(() => {
    throw new Error("fixture unload failure");
  });
  expect(() => uninstallMemoryLaunchAgents()).toThrow();
  expect(existsSync(path)).toBe(true);
  expect(
    vi.mocked(runLaunchctl).mock.calls.some(([args]) => args.includes(`gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`)),
  ).toBe(true);
});

it.runIf(process.platform === "darwin")("removes a plist only when its job is verified absent", () => {
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  writeFileSync(path, "fixture");
  vi.mocked(probeLaunchctl).mockReturnValue({ status: 113, stdout: "" });
  uninstallMemoryLaunchAgents();
  expect(existsSync(path)).toBe(false);
  expect(runLaunchctl).not.toHaveBeenCalled();
});

it.runIf(process.platform === "darwin")("refuses an unknown or mismatched job without removing its plist", () => {
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  writeFileSync(path, "fixture");
  vi.mocked(probeLaunchctl).mockReturnValueOnce(undefined).mockReturnValueOnce({
    status: 0,
    stdout: "\tpath = /fixture/other\n\tenvironment = {\n\t\tHOME => /fixture\n\t}\n",
  });
  expect(() => uninstallMemoryLaunchAgents()).toThrow();
  expect(() => uninstallMemoryLaunchAgents()).toThrow();
  expect(existsSync(path)).toBe(true);
  expect(runLaunchctl).not.toHaveBeenCalled();
});

it.runIf(process.platform === "darwin")("retains the plist when shutdown cannot be verified", () => {
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  writeFileSync(path, "fixture");
  vi.mocked(probeLaunchctl).mockReturnValue(loaded());
  expect(() => uninstallMemoryLaunchAgents()).toThrow();
  expect(existsSync(path)).toBe(true);
});

it.runIf(process.platform === "darwin")("removes the plist after the matching job stops", () => {
  mkdirSync(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  writeFileSync(path, "fixture");
  vi.mocked(probeLaunchctl).mockReturnValueOnce(loaded()).mockReturnValue({ status: 113, stdout: "" });
  uninstallMemoryLaunchAgents();
  expect(existsSync(path)).toBe(false);
  expect(runLaunchctl).toHaveBeenCalledWith(
    ["bootout", `gui/${userInfo().uid}/${MEMORY_AGENT_LABEL}`],
    expect.any(Object),
  );
});
