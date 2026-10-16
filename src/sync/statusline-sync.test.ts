import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Manifest } from "../manifest.js";
import { desiredStatusLine, planStatusLine, syncStatusLine, userStatusLine } from "./statusline-sync.js";

let dir: string;
let settingsPath: string;

function writeSettings(value: object): void {
  writeFileSync(settingsPath, `${JSON.stringify(value, null, 2)}\n`);
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, "utf-8"));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "statusline-sync-"));
  settingsPath = join(dir, "settings.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("desiredStatusLine", () => {
  it("runs the deployed agent-perf helper with a 5 second refresh", () => {
    const desired = desiredStatusLine();

    expect(desired.type).toBe("command");
    expect(desired.command).toMatch(/^node \/.+\/\.config\/agentbrew\/scripts\/agent-perf\.mjs statusline$/);
    expect(desired.refreshInterval).toBe(5);
  });
});

describe("planStatusLine", () => {
  const desired = { type: "command" as const, command: "node /h/agent-perf.mjs statusline", refreshInterval: 5 };
  const old = { type: "command", command: "node /old/agent-perf.mjs statusline" };
  const users = { type: "command", command: "~/bin/my-status.sh" };

  it.each([
    ["absent", undefined, undefined, "installed"],
    ["null", null, undefined, "installed"],
    ["already ours", desired, undefined, "unchanged"],
    ["our older value", old, old, "updated"],
    ["the user's own, never recorded", users, undefined, "kept-user"],
    ["the user's own, after ours", users, old, "kept-user"],
  ])("%s → %s", (_label, current, lastWritten, action) => {
    expect(planStatusLine(current, lastWritten, desired)).toBe(action);
  });
});

describe("syncStatusLine", () => {
  it("installs into absent settings, keeps other keys, and records ownership", () => {
    writeSettings({ hooks: { Stop: [] }, model: "opus" });
    const manifest: Manifest = { hashes: {} };

    expect(syncStatusLine({ settingsPath, manifest, dryRun: false })).toBe("installed");

    expect(readSettings()).toEqual({ hooks: { Stop: [] }, model: "opus", statusLine: desiredStatusLine() });
    expect(manifest.managedStatusLine).toEqual(desiredStatusLine());
    expect(syncStatusLine({ settingsPath, manifest, dryRun: false })).toBe("unchanged");
  });

  it("never overwrites a statusLine that agentbrew did not write", () => {
    const users = { type: "command", command: "~/bin/my-status.sh", padding: 1 };
    writeSettings({ statusLine: users });
    const manifest: Manifest = { hashes: {}, managedStatusLine: { type: "command", command: "node old statusline" } };

    expect(syncStatusLine({ settingsPath, manifest, dryRun: false })).toBe("kept-user");

    expect(readSettings().statusLine).toEqual(users);
    expect(userStatusLine(settingsPath, manifest)).toEqual(users);
  });

  it("updates the value it wrote before", () => {
    const old = { type: "command", command: "node /old/agent-perf.mjs statusline" };
    writeSettings({ statusLine: old });
    const manifest: Manifest = { hashes: {}, managedStatusLine: old };

    expect(syncStatusLine({ settingsPath, manifest, dryRun: false })).toBe("updated");
    expect(readSettings().statusLine).toEqual(desiredStatusLine());
    expect(userStatusLine(settingsPath, manifest)).toBeNull();
  });

  it("writes nothing on a dry run or an unreadable file", () => {
    writeSettings({});
    const manifest: Manifest = { hashes: {} };
    expect(syncStatusLine({ settingsPath, manifest, dryRun: true })).toBe("installed");
    expect(readSettings()).toEqual({});
    expect(manifest.managedStatusLine).toBeUndefined();

    writeFileSync(settingsPath, "{ not json");
    expect(syncStatusLine({ settingsPath, manifest, dryRun: false })).toBeNull();
    expect(readFileSync(settingsPath, "utf-8")).toBe("{ not json");
  });
});
