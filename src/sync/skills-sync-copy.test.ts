// #366: a real directory that holds a copy of a managed skill must not hide
// the managed symlink. Sync backs the copy up and links the source; status
// reports the copy as skills drift until sync fixes it.
// Real `expandHome` and agent definitions: every path is under the scratch
// HOME from vitest.isolated-home.ts.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../state.js", () => ({
  loadState: vi.fn(),
  saveState: vi.fn(),
}));

import { checkSkillsDrift, checkUserCreatedSkills } from "../drift-checks/skills.js";
import { loadState } from "../state.js";
import type { AgentBrewState } from "../types.js";
import { syncSkills } from "./skills-sync.js";

const mockLoadState = vi.mocked(loadState);

let sourceDir: string;

function writeSkill(dir: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), text);
}

function vendorNeutralDir(): string {
  return join(homedir(), ".agents", "skills");
}

function claudeSkillsDir(): string {
  return join(homedir(), ".claude", "skills");
}

/** Every backup folder that holds `<label>/<name>`. */
function backupsOf(label: string, name: string): string[] {
  const root = join(homedir(), ".config", "agentbrew", "backups", "skill-copies");
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((stamp) => join(root, stamp, label, name))
    .filter((path) => existsSync(path));
}

function useState(skillSourceDirs: AgentBrewState["skillSourceDirs"]): void {
  mockLoadState.mockReturnValue({
    agents: [{ name: "claude-code", detected: true, skillsDir: "~/.claude/skills" }],
    sources: [],
    mcpServers: [],
    catalogVersion: "0.1.0",
    skillSourceDirs,
  } as unknown as AgentBrewState);
}

beforeEach(() => {
  // One scratch HOME serves the whole file: start each test from empty folders.
  for (const dir of [".agents", ".claude", ".config"]) rmSync(join(homedir(), dir), { recursive: true, force: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // No built-in skills: point AGENTBREW_DIR at an empty folder.
  process.env.AGENTBREW_DIR = mkdtempSync(join(tmpdir(), "agentbrew-copy-test-repo-"));
  sourceDir = mkdtempSync(join(tmpdir(), "agentbrew-copy-test-source-"));
  useState([{ label: "overlay", path: sourceDir }]);
});

describe("stale skill copies (#366)", () => {
  it("sync backs up a stale copy and links the source in its place", async () => {
    writeSkill(join(sourceDir, "x"), "new text");
    writeSkill(join(vendorNeutralDir(), "x"), "old text");

    await syncSkills({ quiet: true });

    const dest = join(vendorNeutralDir(), "x");
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(realpathSync(readlinkSync(dest))).toBe(realpathSync(join(sourceDir, "x")));
    expect(readFileSync(join(dest, "SKILL.md"), "utf-8")).toBe("new text");
    const backups = backupsOf(".agents", "x");
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(backups[0], "SKILL.md"), "utf-8")).toBe("old text");
  });

  it("compact sync output still names the moved copy and its backup", async () => {
    writeSkill(join(sourceDir, "x"), "new text");
    writeSkill(join(vendorNeutralDir(), "x"), "old text");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await syncSkills({ compact: true });

    expect(result.replacedCopies).toHaveLength(1);
    const lines = errors.mock.calls.map((call) => String(call[0]));
    expect(
      lines.some((line) => line.includes("x was a copy") && line.includes(result.replacedCopies[0].backupPath)),
    ).toBe(true);
  });

  it("sync fixes a stale copy in an agent skills folder too", async () => {
    writeSkill(join(sourceDir, "x"), "new text");
    writeSkill(join(claudeSkillsDir(), "x"), "old text");

    await syncSkills({ quiet: true });

    expect(lstatSync(join(claudeSkillsDir(), "x")).isSymbolicLink()).toBe(true);
    expect(backupsOf("claude-code", "x")).toHaveLength(1);
  });

  it("sync keeps a directory that holds no SKILL.md (the user's own data)", async () => {
    writeSkill(join(sourceDir, "x"), "new text");
    const userDir = join(vendorNeutralDir(), "x");
    mkdirSync(userDir, { recursive: true });
    writeFileSync(join(userDir, "notes.txt"), "mine");

    await syncSkills({ quiet: true });

    expect(lstatSync(userDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(userDir, "notes.txt"), "utf-8")).toBe("mine");
    expect(backupsOf(".agents", "x")).toHaveLength(0);
  });

  it("sync never moves a source folder that lives in a skills folder", async () => {
    // The user registered their own skills folder as a source.
    writeSkill(join(claudeSkillsDir(), "x"), "source text");
    useState([{ label: "own", path: claudeSkillsDir() }]);

    await syncSkills({ quiet: true });

    expect(lstatSync(join(claudeSkillsDir(), "x")).isDirectory()).toBe(true);
    expect(readFileSync(join(claudeSkillsDir(), "x", "SKILL.md"), "utf-8")).toBe("source text");
    expect(backupsOf("claude-code", "x")).toHaveLength(0);
  });

  it("dry-run sync leaves the copy in place", async () => {
    writeSkill(join(sourceDir, "x"), "new text");
    writeSkill(join(vendorNeutralDir(), "x"), "old text");

    await syncSkills({ quiet: true, dryRun: true });

    expect(lstatSync(join(vendorNeutralDir(), "x")).isSymbolicLink()).toBe(false);
    expect(backupsOf(".agents", "x")).toHaveLength(0);
  });

  it("status reports the stale copy as skills drift until sync fixes it", async () => {
    writeSkill(join(sourceDir, "x"), "new text");
    writeSkill(join(vendorNeutralDir(), "x"), "old text");

    const before = checkSkillsDrift();
    expect(before).toEqual([
      expect.objectContaining({ agent: ".agents", type: "skills", detail: expect.stringContaining("x") }),
    ]);
    expect(before[0].detail).toContain("copy");

    await syncSkills({ quiet: true });

    expect(checkSkillsDrift()).toEqual([]);
  });

  it("status lists a copy in an agent folder as drift, not as a user addition", () => {
    writeSkill(join(sourceDir, "x"), "new text");
    writeSkill(join(claudeSkillsDir(), "x"), "old text");
    writeSkill(join(claudeSkillsDir(), "mine"), "my own skill");

    expect(checkSkillsDrift()).toEqual([expect.objectContaining({ agent: "claude-code", type: "skills" })]);
    expect(checkUserCreatedSkills().map((item) => item.detail)).toEqual(["user-created skill: mine"]);
  });
});
