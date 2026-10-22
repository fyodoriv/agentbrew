import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listSettings, SETTINGS, setSetting } from "./settings.js";
import { getStatePath, invalidateState } from "./state.js";

// Real state.yaml round trips in the scratch HOME from vitest.isolated-home.ts.
function readStateFile(): Record<string, unknown> {
  return yaml.load(readFileSync(getStatePath(), "utf-8")) as Record<string, unknown>;
}

describe("settings table", () => {
  beforeEach(() => {
    rmSync(dirname(getStatePath()), { recursive: true, force: true });
    invalidateState();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("has a default inside the allowed values for every key", () => {
    for (const setting of SETTINGS) expect(setting.allowed).toContain(setting.default);
  });

  it("shows defaults with source 'default' when state.yaml is missing", () => {
    const rows = listSettings();
    expect(rows.map((r) => [r.key, r.value, r.source])).toEqual([
      ["claudePermissions", "manage", "default"],
      ["skillInstallMode", "auto", "default"],
    ]);
  });

  it("round-trips one value through state.yaml and keeps the other keys", () => {
    mkdirSync(dirname(getStatePath()), { recursive: true });
    writeFileSync(
      getStatePath(),
      yaml.dump({ schemaVersion: 1, agents: [{ name: "claude-code" }], catalogVersion: "x" }),
    );
    invalidateState();

    const result = setSetting("skillInstallMode", "native");

    expect(result.ok).toBe(true);
    const onDisk = readStateFile();
    expect(onDisk.skillInstallMode).toBe("native");
    expect(onDisk.agents).toEqual([{ name: "claude-code" }]);
    invalidateState();
    const row = listSettings().find((r) => r.key === "skillInstallMode");
    expect(row).toMatchObject({ value: "native", source: "state.yaml" });
  });

  it("creates a default state.yaml when none exists, so init keeps the choice later", () => {
    const result = setSetting("claudePermissions", "keep");
    expect(result.ok).toBe(true);
    expect(readStateFile()).toMatchObject({ claudePermissions: "keep", agents: [] });
  });

  it("refuses an unknown key and names the real keys", () => {
    const result = setSetting("claudePermission", "keep");
    expect(result).toMatchObject({ ok: false, error: "Unknown setting: claudePermission" });
    expect(result.ok ? "" : result.hint).toContain("claudePermissions, skillInstallMode");
  });

  it("refuses a value outside the allowed list and writes nothing", () => {
    const result = setSetting("claudePermissions", "off");
    expect(result).toMatchObject({ ok: false, error: "Invalid value for claudePermissions: off" });
    expect(result.ok ? "" : result.hint).toContain("manage, keep");
    expect(() => readFileSync(getStatePath())).toThrow();
  });

  it("refuses to save over a state.yaml it cannot read", () => {
    mkdirSync(dirname(getStatePath()), { recursive: true });
    writeFileSync(getStatePath(), "agents: [unclosed\n");
    invalidateState();

    const result = setSetting("claudePermissions", "keep");

    expect(result.ok).toBe(false);
    expect(readFileSync(getStatePath(), "utf-8")).toBe("agents: [unclosed\n");
  });
});
