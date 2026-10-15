/**
 * Tests for `src/commands/cli-skills.ts` — the `agentbrew skills` command group.
 *
 * Covers: `skills validate` is registered (drift and status hints name it),
 * a valid built-in skill root exits 0, and an invalid one sets exit code 1.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSkillsCommands } from "./cli-skills.js";
import { buildTestProgram } from "./test-program.js";

let testRoot: string;
let logs: string[];

function writeSkill(name: string, content: string): void {
  const directory = join(testRoot, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), content);
}

async function runSkills(args: string[]): Promise<void> {
  const program = buildTestProgram(registerSkillsCommands);
  await program.parseAsync(["node", "agentbrew", "skills", ...args]);
}

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "agentbrew-cli-skills-"));
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(testRoot, { recursive: true, force: true });
});

describe("agentbrew skills validate", () => {
  it("is registered, so the drift and status hints name a real command", () => {
    const program = buildTestProgram(registerSkillsCommands);
    const skills = program.commands.find((command) => command.name() === "skills");
    const names = skills?.commands.map((command) => command.name()) ?? [];
    expect(names).toContain("validate");
  });

  it("exits 0 and reports every skill valid for a clean built-in root", async () => {
    writeSkill(
      "good-skill",
      "---\nname: good-skill\ndescription: A valid skill for tests. Don't use for real work.\n---\n\n# Good\n\nBody.\n",
    );
    await runSkills(["validate", "--builtins", "--built-in-skill-root", testRoot]);
    expect(process.exitCode).toBeUndefined();
    expect(logs.join("\n")).toContain("All 1 skills valid");
  });

  it("sets exit code 1 and names the error when a skill is invalid", async () => {
    writeSkill("bad-skill", "no frontmatter here\n");
    await runSkills(["validate", "--builtins", "--built-in-skill-root", testRoot]);
    expect(process.exitCode).toBe(1);
    expect(logs.join("\n")).toContain("Missing YAML frontmatter");
  });
});
