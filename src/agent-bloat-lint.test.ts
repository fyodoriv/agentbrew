import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BLOAT_RULE,
  collectAgentBloatFindings,
  lintCommandBloat,
  lintMdcBloat,
  lintSkillBloat,
  loadSkillBaselines,
  SKILL_BODY_TOKEN_HARD,
  SKILL_DESCRIPTION_MAX_CHARS,
  summarizeAgentBloat,
} from "./agent-bloat-lint.js";
import { isAlwaysApplied, isBroadGlob, parseMdcFrontmatter } from "./measure/mdc-frontmatter.js";

const temporaryRoots: string[] = [];

function temporaryRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-bloat-lint-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("mdc-frontmatter", () => {
  it("detects broad globs and always-applied rules", () => {
    const raw = `---\ndescription: test\nglobs: ["**/*.md"]\nalwaysApply: true\n---\n# Body\n`;
    const meta = parseMdcFrontmatter(raw);
    expect(isAlwaysApplied(meta)).toBe(true);
    expect(isBroadGlob("**/*.md")).toBe(true);
    expect(isBroadGlob("**/TASKS.md")).toBe(false);
  });
});

describe("lintSkillBloat", () => {
  it("errors when description exceeds agentskills.io max", () => {
    const desc = "x".repeat(SKILL_DESCRIPTION_MAX_CHARS + 1);
    const content = `---\nname: big\ndescription: ${desc}\n---\n# Skill\n`;
    const findings = lintSkillBloat(content, { path: "SKILL.md", dirName: "big" });
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: BLOAT_RULE.SKILL_DESCRIPTION_MAX, severity: "error" }),
    );
  });

  it("warns on body token budget and missing references/", () => {
    const body = `${"word ".repeat(SKILL_BODY_TOKEN_HARD * 2)}\n`;
    const content = `---\nname: huge\ndescription: ${"Use when testing bloat ".repeat(3)}\n---\n${body}`;
    const skillDir = temporaryRepo();
    const findings = lintSkillBloat(content, { path: "SKILL.md", dirName: "huge", skillDir });
    expect(findings.some((f) => f.ruleId === BLOAT_RULE.SKILL_BODY_HARD)).toBe(true);
    expect(findings.some((f) => f.ruleId === BLOAT_RULE.SKILL_NO_PROGRESSIVE_DISCLOSURE)).toBe(true);
  });

  it("errors on baseline growth without trim task", () => {
    const content = `---\nname: grow\ndescription: Use when you need to grow this skill for tests\n---\n${"grow ".repeat(4000)}\n`;
    const findings = lintSkillBloat(content, {
      path: "skill-plugins/dev/grow/SKILL.md",
      dirName: "grow",
      baseline: { tokens: 100, lines: 20 },
      hasOpenTrimTask: false,
    });
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: BLOAT_RULE.SKILL_BASELINE_GROWTH, severity: "error" }),
    );
  });
});

describe("lintCommandBloat", () => {
  it("errors when command exceeds hard char budget", () => {
    const findings = lintCommandBloat("x".repeat(9000), "/tmp/huge.md");
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: BLOAT_RULE.COMMAND_HARD, severity: "error" }));
  });
});

describe("lintMdcBloat", () => {
  it("errors on always-applied broad glob", () => {
    const content = `---\ndescription: scope creep\nglobs: ["**/*"]\nalwaysApply: true\n---\n# Rule\n`;
    const findings = lintMdcBloat(content, "templates/rules/bad.mdc");
    expect(findings).toContainEqual(
      expect.objectContaining({ ruleId: BLOAT_RULE.MDC_ALWAYS_APPLY_BROAD, severity: "error" }),
    );
  });
});

describe("collectAgentBloatFindings", () => {
  it("loads committed skill baselines from docs/skill-baselines.json", () => {
    const repoRoot = join(import.meta.dirname, "..");
    const baselines = loadSkillBaselines(repoRoot);
    expect(Object.keys(baselines).length).toBeGreaterThan(10);
    expect(baselines.grind?.tokens).toBeGreaterThan(1000);
    expect(baselines.grind?.tokens).toBeLessThanOrEqual(SKILL_BODY_TOKEN_HARD);
  });

  it("lints built-in skills without baseline regression on clean tree", () => {
    const repoRoot = join(import.meta.dirname, "..");
    const findings = collectAgentBloatFindings({ repoRoot, commandsDir: join(repoRoot, "empty-commands") });
    const growthErrors = findings.filter(
      (f) => f.ruleId === BLOAT_RULE.SKILL_BASELINE_GROWTH && f.severity === "error",
    );
    expect(growthErrors).toEqual([]);
    expect(summarizeAgentBloat(findings).errors).toBe(0);
  });

  it("reports template mdc broad glob warnings", () => {
    const repoRoot = temporaryRepo();
    mkdirSync(join(repoRoot, "templates", "rules"), { recursive: true });
    writeFileSync(
      join(repoRoot, "templates", "rules", "browser.mdc"),
      `---\ndescription: browser\nglobs: ["**/*.md"]\n---\n# Rule\n`,
    );
    mkdirSync(join(repoRoot, "docs"), { recursive: true });
    writeFileSync(join(repoRoot, "docs", "skill-baselines.json"), "{}\n");
    const findings = collectAgentBloatFindings({ repoRoot, commandsDir: join(repoRoot, "commands") });
    expect(findings.some((f) => f.ruleId === BLOAT_RULE.MDC_BROAD_GLOB)).toBe(true);
  });

  it("catalog-owned templates/rules pass bloat lint without broad-glob errors", () => {
    const repoRoot = join(import.meta.dirname, "..");
    const findings = collectAgentBloatFindings({ repoRoot, commandsDir: join(repoRoot, "empty-commands") }).filter(
      (f) => f.path.includes("templates/rules/"),
    );
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
    expect(findings.some((f) => f.ruleId === BLOAT_RULE.MDC_BROAD_GLOB && f.path.includes("browser-tasks"))).toBe(
      false,
    );
  });
});
