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

  it("changes launchd when HOME is the user's home folder, with or without a trailing slash", () => {
    vi.stubEnv("HOME", `${userInfo().homedir}/`);
    expect(launchdTargetsThisHome()).toBe(true);
    runLaunchctl(["load", "/nonexistent/real plist.plist"]);
    expect(fake.calls()).toEqual([["load", "/nonexistent/real plist.plist"]]);
  });
});

// Files that spawn a shell running launchctl changes and check
// launchdTargetsThisHome() before the spawn. They are exempt from the shell
// checks only; a direct launchctl spawn is flagged everywhere.
const GUARDED_SHELL = new Set(["sync/launchagent.ts"]);
const SPAWN = "(?:execFileSync|execFile|spawnSync|spawn|execSync|exec|execa)\\(";
const CHANGE_VERB = "(?:load|unload|bootstrap|bootout|enable|disable|kickstart|kill|remove|submit)";

describe("launchctl call sites", () => {
  it("every launchctl call in src goes through the guard", () => {
    const root = join(import.meta.dirname, "..");
    // A direct spawn of launchctl, or a spawned shell script that runs a launchctl change.
    const direct = new RegExp(`${SPAWN}\\s*["'\`](?:/bin/)?launchctl\\b`);
    const viaShell = new RegExp(`${SPAWN}[\\s\\S]{0,400}?\\blaunchctl\\s+${CHANGE_VERB}\\b`);
    const shellScript = new RegExp(`=\\s*["'\`][^"'\`\\n]*\\blaunchctl\\s+${CHANGE_VERB}\\b[^"'\`\\n]*\\$\\d`);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== "test-utils" && name !== "fixtures") walk(path);
          continue;
        }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts") || path.endsWith(join("core", "launchctl.ts"))) continue;
        const text = readFileSync(path, "utf-8");
        const rel = relative(root, path);
        if (direct.test(text) || ((viaShell.test(text) || shellScript.test(text)) && !GUARDED_SHELL.has(rel))) {
          offenders.push(rel);
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("each guarded shell spawn checks the HOME guard first", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "sync", "launchagent.ts"), "utf-8");
    const reload = text.slice(text.indexOf("function reloadAfterExit("));
    expect(reload.slice(0, reload.indexOf("spawn("))).toContain("if (!launchdTargetsThisHome()) return;");
  });
});
