import type { Command } from "commander";
import { checkEnvHygiene, displayEnvCheck, displaySanitizeCommands } from "../core/env-sanitize.js";

/**
 * Registers the `env` command group for managing environment variable hygiene
 * across agent boundaries. Prevents model/API env vars from leaking into
 * child agent sessions during orchestration.
 */
export function registerEnvCommands(program: Command): void {
  const env = program.command("env").description("Check and sanitize environment variables for agent hygiene");

  env
    .command("check")
    .description("Warn about env vars that could leak across agent boundaries")
    .action(() => {
      const warnings = checkEnvHygiene();
      displayEnvCheck(warnings);
      if (warnings.length > 0) {
        process.exitCode = 1;
      }
    });

  env
    .command("sanitize")
    .description("Print shell commands to unset dangerous env vars (use with eval)")
    .action(() => {
      displaySanitizeCommands();
    });
}
