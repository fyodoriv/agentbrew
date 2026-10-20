/** `agentbrew team` was removed in 1.0 (#208 step 12); it must explain, not say "unknown command". */
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import { registerTeamCommands } from "./commands/cli-team.js";

describe("agentbrew team (removed in 1.0)", () => {
  it.each([
    ["set", "git@git.example.com:acme/overlay.git"],
    ["unset"],
    ["status"],
    [],
  ])("team %s prints the migration path and exits 1", async (...args: string[]) => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m: string) => void errors.push(m));
    process.exitCode = undefined;
    const program = new Command().exitOverride();
    registerTeamCommands(program);
    await program.parseAsync(["node", "t", "team", ...args.filter(Boolean)]);
    spy.mockRestore();
    expect(errors.join("\n")).toMatch(/removed in agentbrew 1\.0/);
    expect(errors.join("\n")).toMatch(/agentbrew plugin migrate/);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });
});
