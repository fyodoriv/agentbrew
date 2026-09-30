import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./validate.js", () => ({
  validateAllSkills: vi.fn(),
  validateEvals: vi.fn(),
  validateSkill: vi.fn(),
}));

import { computeSkillCoverage, runSkillsCoverage } from "./skill-coverage.js";
import { validateAllSkills, validateEvals, validateSkill } from "./validate.js";

const mockValidateAllSkills = vi.mocked(validateAllSkills);
const mockValidateEvals = vi.mocked(validateEvals);
const mockValidateSkill = vi.mocked(validateSkill);
const temporaryRoots: string[] = [];

function skillResult(name: string, valid: boolean, sourceLabel = "agentbrew", directory = `/skills/${name}`) {
  return { name, directory, sourceLabel, issues: [], valid };
}

function summaryOf(results: ReturnType<typeof skillResult>[]) {
  return {
    total: results.length,
    valid: results.filter((r) => r.valid).length,
    withErrors: results.filter((r) => !r.valid).length,
    withWarnings: 0,
    results,
  };
}

const evalError = [{ severity: "error" as const, message: "Missing evals/evals.json", field: "evals" }];

function createBuiltInSkillRoot(names: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "agentbrew-skills-"));
  temporaryRoots.push(root);
  for (const name of names) {
    const skillDirectory = join(root, name);
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`);
  }
  return root;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateSkill.mockImplementation((directory: string, sourceLabel: string) =>
    skillResult(basename(directory), true, sourceLabel, directory),
  );
  process.exitCode = undefined;
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe("computeSkillCoverage", () => {
  it("computes L1 (structural) and L2 (eval) percentages", () => {
    mockValidateAllSkills.mockReturnValue(summaryOf([skillResult("a", true), skillResult("b", false)]));
    // 'a' has valid evals, 'b' does not.
    mockValidateEvals.mockImplementation((dir: string) => (dir.endsWith("/a") ? [] : evalError));
    const summary = computeSkillCoverage();
    expect(summary.total).toBe(2);
    expect(summary.structuralValid).toBe(1);
    expect(summary.evalValid).toBe(1);
    expect(summary.l1Percent).toBe(50);
    expect(summary.l2Percent).toBe(50);
    expect(summary.structuralWarningTotal).toBe(0);
  });

  it("reports 0% on an empty skill set without dividing by zero", () => {
    mockValidateAllSkills.mockReturnValue(summaryOf([]));
    const summary = computeSkillCoverage();
    expect(summary.l1Percent).toBe(0);
    expect(summary.l2Percent).toBe(0);
  });

  it("counts a skill with only warning-severity eval issues as covered", () => {
    mockValidateAllSkills.mockReturnValue(summaryOf([skillResult("a", true)]));
    mockValidateEvals.mockReturnValue([
      { severity: "warning" as const, message: "skill_name mismatch", field: "evals" },
    ]);
    const summary = computeSkillCoverage();
    expect(summary.evalValid).toBe(1);
  });

  it("scans every in-repo built-in skill directory", () => {
    mockValidateAllSkills.mockReturnValue(
      summaryOf([
        skillResult("agentbrew-status", true, "agentbrew", "/repo/skill-plugins/dev/agentbrew-status"),
        skillResult("external-debug", true, "external", "/sources/debug"),
      ]),
    );
    mockValidateEvals.mockReturnValue([]);
    const builtInSkillRoot = createBuiltInSkillRoot(["agentbrew-status", "sync-agent-config"]);
    expect(computeSkillCoverage().total).toBe(2);
    expect(computeSkillCoverage({ builtins: true, builtInSkillRoot }).entries.map((entry) => entry.name)).toEqual([
      "agentbrew-status",
      "sync-agent-config",
    ]);
  });
});

describe("runSkillsCoverage", () => {
  function oneSkill(hasValidEvals: boolean) {
    mockValidateAllSkills.mockReturnValue(summaryOf([skillResult("a", true)]));
    mockValidateEvals.mockReturnValue(hasValidEvals ? [] : evalError);
  }

  it("sets process.exitCode = 1 when --ci and below threshold", () => {
    oneSkill(false); // 0% eval coverage
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    runSkillsCoverage({ ci: true, threshold: 90 });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("does not set exitCode when --ci and at or above threshold", () => {
    oneSkill(true); // 100%
    vi.spyOn(console, "log").mockImplementation(() => {});
    runSkillsCoverage({ ci: true, threshold: 90 });
    expect(process.exitCode).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("requires every in-repo built-in skill to have spec-valid evals in CI", () => {
    const builtInSkillRoot = createBuiltInSkillRoot(["agentbrew-status", "sync-agent-config"]);
    mockValidateEvals.mockImplementation((dir: string) => (dir.endsWith("/agentbrew-status") ? [] : evalError));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runSkillsCoverage({ builtins: true, builtInSkillRoot, ci: true, threshold: 50 });
    expect(process.exitCode).toBe(1);
    expect(error.mock.calls.flat().join("\n")).toContain("in-repo custom skills require spec-valid evals/evals.json");
  });

  it("never sets exitCode without --ci", () => {
    oneSkill(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    runSkillsCoverage({});
    expect(process.exitCode).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("emits machine-readable JSON with --json", () => {
    oneSkill(true);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    runSkillsCoverage({ json: true });
    const output = spy.mock.calls.flat().join("\n");
    expect(output).toContain('"l2Percent"');
    vi.restoreAllMocks();
  });
});
