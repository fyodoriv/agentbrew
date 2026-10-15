import type { Command } from "commander";
import type { SkillCoverageOptions } from "../skills/skill-coverage.js";
import { defaultBuiltInSkillRoot, runSkillsCoverage, validateBuiltInSkills } from "../skills/skill-coverage.js";
import { showValidationResults, summarizeValidation, validateAllSkills } from "../skills/validate.js";

interface SkillsValidateOptions {
  builtins?: boolean;
  builtInSkillRoot?: string;
  verbose?: boolean;
}

/** CLI entry point for `agentbrew skills validate`. Sets exit code 1 when any skill has an error. */
export function runSkillsValidate(options: SkillsValidateOptions = {}): void {
  const summary = options.builtins
    ? summarizeValidation(validateBuiltInSkills(options.builtInSkillRoot ?? defaultBuiltInSkillRoot()))
    : validateAllSkills();
  showValidationResults(summary, options.verbose === true);
  if (summary.withErrors > 0) {
    process.exitCode = 1;
  }
}

/**
 * Registers the `skills` command group (namespaced like `mcp`, `rules`, `agents`).
 * It exposes `skills coverage` and `skills validate`.
 */
export function registerSkillsCommands(program: Command): void {
  const skills = program.command("skills").description("Inspect skills — structural and eval test coverage");

  skills
    .command("coverage")
    .description("Report skill structural (L1) and eval (L2) test coverage")
    .option("--builtins", "Only count in-repo skill-plugins/dev skills")
    .option("--built-in-skill-root <path>", "Skill directory for --builtins (default skill-plugins/dev)")
    .option("--ci", "Exit 1 when eval coverage is below --threshold")
    .option("--threshold <percent>", "Minimum eval-coverage percent for --ci (default 90)", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--json", "Output machine-readable JSON")
    .action((options: SkillCoverageOptions) => {
      runSkillsCoverage(options);
    });

  skills
    .command("validate")
    .description("Check SKILL.md frontmatter, body, and cross-references (exit 1 on errors)")
    .option("--builtins", "Only check in-repo skill-plugins/dev skills")
    .option("--built-in-skill-root <path>", "Skill directory for --builtins (default skill-plugins/dev)")
    .option("--verbose", "Also show valid skills and info-level notes")
    .action((options: SkillsValidateOptions) => {
      runSkillsValidate(options);
    });
}
