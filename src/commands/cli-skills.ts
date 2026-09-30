import type { Command } from "commander";
import type { SkillCoverageOptions } from "../skills/skill-coverage.js";
import { runSkillsCoverage } from "../skills/skill-coverage.js";

/**
 * Registers the `skills` command group (namespaced like `mcp`, `rules`, `agents`).
 * Today it exposes `skills coverage`; future skill-quality subcommands land here.
 */
export function registerSkillsCommands(program: Command): void {
  const skills = program.command("skills").description("Inspect skills — structural and eval test coverage");

  skills
    .command("coverage")
    .description("Report skill structural (L1) and eval (L2) test coverage")
    .option("--builtins", "Only count in-repo skill-plugins/dev skills")
    .option("--ci", "Exit 1 when eval coverage is below --threshold")
    .option("--threshold <percent>", "Minimum eval-coverage percent for --ci (default 90)", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--json", "Output machine-readable JSON")
    .action((options: SkillCoverageOptions) => {
      runSkillsCoverage(options);
    });
}
