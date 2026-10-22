import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getStatePath, invalidateState } from "../state.js";
import { registerConfigCommand } from "./cli-config.js";
import { buildTestProgram } from "./test-program.js";

// Real settings and state modules on the scratch HOME from vitest.isolated-home.ts.
async function run(...args: string[]): Promise<{ out: string; err: string; exitCode: number }> {
  let out = "";
  let err = "";
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    out += `${parts.join(" ")}\n`;
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    err += `${parts.join(" ")}\n`;
  });
  process.exitCode = undefined;
  await buildTestProgram(registerConfigCommand).parseAsync(["node", "agentbrew", ...args]);
  const exitCode = Number(process.exitCode ?? 0);
  process.exitCode = undefined;
  vi.restoreAllMocks();
  return { out, err, exitCode };
}

describe("agentbrew config", () => {
  beforeEach(() => {
    rmSync(dirname(getStatePath()), { recursive: true, force: true });
    invalidateState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows every setting with its value, source, and allowed values", async () => {
    const { out, exitCode } = await run("config");
    expect(exitCode).toBe(0);
    expect(out).toMatch(/claudePermissions\s+manage \(default\)\s+manage \| keep/);
    expect(out).toMatch(/skillInstallMode\s+auto \(default\)\s+auto \| delegate \| native/);
    expect(out).toContain("agentbrew config set <key> <value>");
  });

  it("set validates, saves, and the next show reports the state.yaml source", async () => {
    const set = await run("config", "set", "skillInstallMode", "native");
    expect(set.exitCode).toBe(0);
    expect(set.out).toContain("skillInstallMode = native");

    const { out } = await run("config", "--json");
    const parsed = JSON.parse(out) as { settings: Array<{ key: string; value: string; source: string }> };
    expect(parsed.settings.find((s) => s.key === "skillInstallMode")).toMatchObject({
      value: "native",
      source: "state.yaml",
    });
  });

  it("set refuses a bad value with exit 1 and the allowed list", async () => {
    const { err, out, exitCode } = await run("config", "set", "claudePermissions", "never");
    expect(exitCode).toBe(1);
    expect(err).toContain("Invalid value for claudePermissions: never");
    expect(out).toContain("Allowed values: manage, keep");
  });

  it("rejects an unknown config subcommand", async () => {
    const { err, exitCode } = await run("config", "get");
    expect(exitCode).toBe(1);
    expect(err).toContain("Unknown config command: get");
  });
});
