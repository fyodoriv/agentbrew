import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProjectAssets, formatProjectAssets } from "./project-detect.js";

const tmpDir = `/tmp/project-detect-test-${Date.now()}`;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("detectProjectAssets", () => {
  it("returns undefined for empty directory", () => {
    expect(detectProjectAssets(tmpDir)).toBeUndefined();
  });

  it("detects Agentfile", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    const result = detectProjectAssets(tmpDir);
    expect(result?.agentfile).toBe("Agentfile");
  });

  it("does NOT detect legacy .agentbrew.yaml (format removed; it must be renamed to Agentfile.yaml)", () => {
    writeFileSync(join(tmpDir, ".agentbrew.yaml"), "mcp:\n  - test\n");
    const result = detectProjectAssets(tmpDir);
    expect(result?.agentfile).toBeUndefined();
  });

  it("detects Claude skills", () => {
    const skillDir = join(tmpDir, ".claude", "skills", "debug");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# debug");
    const result = detectProjectAssets(tmpDir);
    expect(result?.skills).toHaveLength(1);
    expect(result?.skills[0].agent).toBe("claude");
  });

  it("detects Cursor rules", () => {
    const rulesDir = join(tmpDir, ".cursor", "rules");
    mkdirSync(rulesDir, { recursive: true });
    writeFileSync(join(rulesDir, "code-style.mdc"), "---\ndescription: test\n---\ncontent");
    const result = detectProjectAssets(tmpDir);
    expect(result?.rules).toHaveLength(1);
    expect(result?.rules[0].agent).toBe("cursor");
    expect(result?.rules[0].count).toBe(1);
  });

  it("detects AGENTS.md instruction file", () => {
    writeFileSync(join(tmpDir, "AGENTS.md"), "# Project instructions");
    const result = detectProjectAssets(tmpDir);
    expect(result?.instructions).toContain("AGENTS.md");
  });

  it("detects multiple asset types simultaneously", () => {
    writeFileSync(join(tmpDir, "Agentfile"), "mcp:\n  - context7\n");
    writeFileSync(join(tmpDir, "AGENTS.md"), "# Instructions");
    const skillDir = join(tmpDir, ".claude", "skills", "debug");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# debug");

    const result = detectProjectAssets(tmpDir);
    expect(result?.agentfile).toBe("Agentfile");
    expect(result?.skills).toHaveLength(1);
    expect(result?.instructions).toContain("AGENTS.md");
  });

  it("ignores empty skill directories", () => {
    mkdirSync(join(tmpDir, ".claude", "skills"), { recursive: true });
    // Dir exists but is empty
    expect(detectProjectAssets(tmpDir)).toBeUndefined();
  });
});

describe("formatProjectAssets", () => {
  it("formats a simple Agentfile-only result", () => {
    const output = formatProjectAssets({
      agentfile: "Agentfile",
      skills: [],
      rules: [],
      commands: [],
      instructions: [],
    });
    expect(output).toContain("Agentfile");
    expect(output).toContain("declarative manifest");
  });

  it("formats skills and instructions", () => {
    const output = formatProjectAssets({
      skills: [{ agent: "claude", count: 3 }],
      rules: [],
      commands: [],
      instructions: ["AGENTS.md"],
    });
    expect(output).toContain("3 skill(s)");
    expect(output).toContain("AGENTS.md");
  });
});
