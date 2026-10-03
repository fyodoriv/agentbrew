import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { findAgentbrewRepoRoot } from "../core/repo-root.js";
import { checkSkillStructure } from "./skill-structural.js";
import type { SkillValidationResult } from "./validate.js";
import { validateAllSkills, validateEvals, validateSkill } from "./validate.js";

// ── Types ──────────────────────────────────────────────────────────────────

interface SkillCoverageEntry {
  name: string;
  sourceLabel: string;
  structurallyValid: boolean;
  hasValidEvals: boolean;
  structuralWarnings: number;
}

interface SkillCoverageSummary {
  total: number;
  structuralValid: number;
  evalValid: number;
  /** Total broken-link / oversized-SKILL.md warnings across all skills. */
  structuralWarningTotal: number;
  /** Percent of skills with no structural (frontmatter/body/link) errors. */
  l1Percent: number;
  /** Percent of skills shipping a spec-valid evals/evals.json. */
  l2Percent: number;
  entries: SkillCoverageEntry[];
}

export interface SkillCoverageOptions {
  builtins?: boolean;
  builtInSkillRoot?: string;
  ci?: boolean;
  threshold?: number;
  json?: boolean;
}

const BUILTIN_SKILL_SOURCE_LABEL = "agentbrew";
const DEFAULT_THRESHOLD = 90;

/** Built-in skills of the agentbrew checkout, from the bundled dist/cli.js or from src/. */
function defaultBuiltInSkillRoot(): string {
  const root = findAgentbrewRepoRoot("skill-plugins/dev") ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return join(root, "skill-plugins", "dev");
}

function isSkillDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory() && existsSync(join(directory, "SKILL.md"));
  } catch {
    return false;
  }
}

function validateBuiltInSkills(skillRoot: string): SkillValidationResult[] {
  if (!existsSync(skillRoot)) return [];
  const skillDirectories = readdirSync(skillRoot)
    .map((entry) => join(skillRoot, entry))
    .filter(isSkillDirectory)
    .sort((left, right) => left.localeCompare(right));
  const allSkillNames = new Set(skillDirectories.map((directory) => basename(directory)));
  return skillDirectories.map((directory) => validateSkill(directory, BUILTIN_SKILL_SOURCE_LABEL, allSkillNames));
}

// ── Computation ──────────────────────────────────────────────────────────────

/**
 * Compute structural (L1) and eval (L2) coverage across installed skills, or
 * across every in-repo custom skill when `builtins` is set. Deliberately does
 * NOT change the validateAllSkills error set, so `lint`/`status`/drift keep
 * their existing behaviour.
 */
export function computeSkillCoverage(options: SkillCoverageOptions = {}): SkillCoverageSummary {
  const results = options.builtins
    ? validateBuiltInSkills(options.builtInSkillRoot ?? defaultBuiltInSkillRoot())
    : validateAllSkills().results;
  const entries: SkillCoverageEntry[] = results.map((result) => ({
    name: result.name,
    sourceLabel: result.sourceLabel,
    structurallyValid: result.valid,
    hasValidEvals: !validateEvals(result.directory).some((issue) => issue.severity === "error"),
    structuralWarnings: checkSkillStructure(result.directory).filter((issue) => issue.severity === "warning").length,
  }));
  const total = entries.length;
  const structuralValid = entries.filter((entry) => entry.structurallyValid).length;
  const evalValid = entries.filter((entry) => entry.hasValidEvals).length;
  const structuralWarningTotal = entries.reduce((sum, entry) => sum + entry.structuralWarnings, 0);
  const percent = (count: number): number => (total === 0 ? 0 : Math.round((count / total) * 100));
  return {
    total,
    structuralValid,
    evalValid,
    structuralWarningTotal,
    l1Percent: percent(structuralValid),
    l2Percent: percent(evalValid),
    entries,
  };
}

// ── Display ──────────────────────────────────────────────────────────────────

function printSkillCoverage(summary: SkillCoverageSummary): void {
  console.log(chalk.bold(`\n  Skill coverage (${summary.total} skills)\n`));
  console.log(`  L1 structural: ${summary.l1Percent}% (${summary.structuralValid}/${summary.total})`);
  console.log(`  L2 eval:       ${summary.l2Percent}% (${summary.evalValid}/${summary.total})`);
  if (summary.structuralWarningTotal > 0) {
    console.log(
      chalk.dim(`  Structural:    ${summary.structuralWarningTotal} warning(s) (broken links / oversized SKILL.md)`),
    );
  }
  const missing = summary.entries.filter((entry) => !entry.hasValidEvals);
  if (missing.length > 0) {
    console.log(chalk.dim(`\n  ${missing.length} skill(s) without spec-valid evals/evals.json:`));
    for (const entry of missing) {
      console.log(chalk.dim(`    - ${entry.name}`));
    }
  }
  console.log();
}

function enforceCiCoverage(summary: SkillCoverageSummary, options: SkillCoverageOptions): void {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const requiredMissing = options.builtins ? summary.entries.filter((entry) => !entry.hasValidEvals) : [];
  if (requiredMissing.length > 0 && !options.json) {
    console.error(
      chalk.red(
        `  in-repo custom skills require spec-valid evals/evals.json: ${requiredMissing
          .map((entry) => entry.name)
          .join(", ")}`,
      ),
    );
  }
  if (summary.l2Percent < threshold && !options.json) {
    console.error(chalk.red(`  eval coverage ${summary.l2Percent}% is below threshold ${threshold}%`));
  }
  if (requiredMissing.length > 0 || summary.l2Percent < threshold) {
    process.exitCode = 1;
  }
}

/** CLI entry point for `agentbrew skills coverage`. */
export function runSkillsCoverage(options: SkillCoverageOptions = {}): void {
  const summary = computeSkillCoverage(options);
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    printSkillCoverage(summary);
  }
  if (options.ci) {
    enforceCiCoverage(summary, options);
  }
}
