import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSkillParentDirs } from "./add-source.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "agentbrew-skill-dirs-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("findSkillParentDirs", () => {
  it("finds skills at repo root", () => {
    mkdirSync(join(tmp, "my-skill"));
    writeFileSync(join(tmp, "my-skill", "SKILL.md"), "# Skill");

    const dirs = findSkillParentDirs(tmp);
    expect(dirs).toEqual([tmp]);
  });

  it("finds skills in skills/ subdirectory", () => {
    mkdirSync(join(tmp, "skills", "my-skill"), { recursive: true });
    writeFileSync(join(tmp, "skills", "my-skill", "SKILL.md"), "# Skill");

    const dirs = findSkillParentDirs(tmp);
    expect(dirs).toContain(join(tmp, "skills"));
  });

  it("finds skills in deep non-standard paths", () => {
    mkdirSync(join(tmp, "src", "scaffold", "cursor", "skills", "alert"), { recursive: true });
    writeFileSync(join(tmp, "src", "scaffold", "cursor", "skills", "alert", "SKILL.md"), "# Skill");

    const dirs = findSkillParentDirs(tmp);
    expect(dirs).toContain(join(tmp, "src", "scaffold", "cursor", "skills"));
  });

  it("finds multiple skill parent directories (e.g. minsky orchestrator + enterprise)", () => {
    mkdirSync(join(tmp, "skill-plugins", "orchestrator", "research"), { recursive: true });
    writeFileSync(join(tmp, "skill-plugins", "orchestrator", "research", "SKILL.md"), "# Skill");
    mkdirSync(join(tmp, "skill-plugins", "enterprise", "review"), { recursive: true });
    writeFileSync(join(tmp, "skill-plugins", "enterprise", "review", "SKILL.md"), "# Skill");

    const dirs = findSkillParentDirs(tmp);
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain(join(tmp, "skill-plugins", "orchestrator"));
    expect(dirs).toContain(join(tmp, "skill-plugins", "enterprise"));
  });

  it("finds skills in hidden .agents/skills/ directory at depth 0", () => {
    mkdirSync(join(tmp, ".agents", "skills", "deploy"), { recursive: true });
    writeFileSync(join(tmp, ".agents", "skills", "deploy", "SKILL.md"), "# Skill");

    const dirs = findSkillParentDirs(tmp);
    expect(dirs).toContain(join(tmp, ".agents", "skills"));
  });

  it("returns empty array when no skills found", () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src", "index.ts"), "// code");

    expect(findSkillParentDirs(tmp)).toEqual([]);
  });

  it("skips node_modules and .git", () => {
    mkdirSync(join(tmp, "node_modules", "pkg", "skills", "bad"), { recursive: true });
    writeFileSync(join(tmp, "node_modules", "pkg", "skills", "bad", "SKILL.md"), "# Bad");
    mkdirSync(join(tmp, ".git", "hooks"), { recursive: true });

    expect(findSkillParentDirs(tmp)).toEqual([]);
  });
});
