import { readdirSync, readFileSync, statSync } from "node:fs";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
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

  it("changes launchd when HOME is the user's home folder", () => {
    vi.stubEnv("HOME", userInfo().homedir);
    expect(launchdTargetsThisHome()).toBe(true);
    runLaunchctl(["load", "/nonexistent/real.plist"]);
    expect(fake.calls()).toEqual([["load", "/nonexistent/real.plist"]]);
  });
});

describe("launchctl call sites", () => {
  it("every launchctl call in src goes through the guard", () => {
    const root = join(import.meta.dirname, "..");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "test-utils" && name !== "fixtures") walk(path);
          continue;
        }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts") || path.endsWith(join("core", "launchctl.ts"))) continue;
        if (/(?:execFileSync|execFile|spawnSync|spawn|execSync)\(\s*["'`]launchctl/.test(readFileSync(path, "utf-8"))) {
          offenders.push(relative(root, path));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
