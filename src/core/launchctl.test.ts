import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFakeLaunchctl } from "../test-utils/fake-launchctl.js";
import { launchdTargetsThisHome, runLaunchctl } from "./launchctl.js";

let fake: ReturnType<typeof installFakeLaunchctl>;

beforeEach(() => {
  fake = installFakeLaunchctl();
});

afterEach(() => {
  fake.restore();
  vi.unstubAllEnvs();
});

describe("launchctl guard", () => {
  it("never changes launchd when HOME is not the user's home folder", () => {
    expect(launchdTargetsThisHome()).toBe(false);

    for (const verb of ["load", "unload", "bootstrap", "bootout", "enable", "disable", "kickstart"]) {
      expect(runLaunchctl([verb, "/nonexistent/scratch.plist"])).toBe("");
    }

    expect(fake.calls()).toEqual([]);
  });

  it("still runs read-only queries under a scratch HOME", () => {
    expect(() => runLaunchctl(["print", "gui/0/none"])).toThrow();
    expect(fake.calls()).toEqual([["print", "gui/0/none"]]);
  });

  it("changes launchd when HOME is the user's home folder, with or without a trailing slash", () => {
    vi.stubEnv("HOME", `${userInfo().homedir}/`);
    expect(launchdTargetsThisHome()).toBe(true);
    runLaunchctl(["load", "/nonexistent/real plist.plist"]);
    expect(fake.calls()).toEqual([["load", "/nonexistent/real plist.plist"]]);
  });
});

describe("launchctl call sites", () => {
  it("each guarded shell spawn checks the HOME guard first", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "sync", "launchagent.ts"), "utf-8");
    const reload = text.slice(text.indexOf("function reloadAfterExit("));
    expect(reload.slice(0, reload.indexOf("spawn("))).toContain("if (!launchdTargetsThisHome()) return;");
  });
});
