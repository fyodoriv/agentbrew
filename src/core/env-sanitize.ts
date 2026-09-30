import chalk from "chalk";
import { ICON_SUCCESS, ICON_WARNING } from "../ui/output.js";

/**
 * Default list of env vars that can leak across agent boundaries and cause failures.
 * When an orchestrator (e.g. minsky) launches child agent sessions, these vars
 * from the parent shell override each child's defaults — often pointing to models
 * the child process doesn't have access to. Unsetting them before launch prevents
 * 100% failure rates in multi-agent pipelines.
 */
export const DEFAULT_SANITIZE_VARS = [
  "ANTHROPIC_MODEL",
  "OPENAI_MODEL",
  "CLAUDE_MODEL",
  "CLAUDECODE",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
] as const;

interface EnvWarning {
  variable: string;
  value: string;
}

/** Check which dangerous env vars are currently set in the shell. */
export function checkEnvHygiene(variables?: readonly string[]): EnvWarning[] {
  const toCheck = variables ?? DEFAULT_SANITIZE_VARS;
  const warnings: EnvWarning[] = [];

  for (const variable of toCheck) {
    const value = process.env[variable];
    if (value !== undefined && value !== "") {
      warnings.push({ variable, value });
    }
  }

  return warnings;
}

/** Generate shell commands to unset dangerous env vars. */
export function generateSanitizeCommands(variables?: readonly string[]): string {
  const toCheck = variables ?? DEFAULT_SANITIZE_VARS;
  const setVars = toCheck.filter((variable) => {
    const value = process.env[variable];
    return value !== undefined && value !== "";
  });

  if (setVars.length === 0) {
    return "";
  }

  return `unset ${setVars.join(" ")}`;
}

/** Display env check results to the console. */
export function displayEnvCheck(warnings: EnvWarning[]): void {
  if (warnings.length === 0) {
    console.log(`${ICON_SUCCESS} No dangerous env vars detected`);
    return;
  }

  console.error(chalk.bold(`\n${ICON_WARNING} ${warnings.length} env var(s) could leak across agent boundaries:\n`));
  for (const warning of warnings) {
    const truncated = warning.value.length > 40 ? `${warning.value.slice(0, 37)}...` : warning.value;
    console.log(`  ${chalk.yellow(warning.variable)}=${chalk.dim(truncated)}`);
  }
  console.log(chalk.dim(`\n  These vars override agent defaults when an orchestrator launches child sessions.`));
  console.log(chalk.dim(`  Run ${chalk.white("eval $(agentbrew env sanitize)")} to unset them.\n`));
}

/** Display sanitize output (shell commands to unset vars). */
export function displaySanitizeCommands(variables?: readonly string[]): void {
  const command = generateSanitizeCommands(variables);
  if (command === "") {
    // Print nothing to stdout — clean eval target
    console.error(`${ICON_SUCCESS} No dangerous env vars to unset`);
    return;
  }

  // Print just the unset command to stdout so `eval $(agentbrew env sanitize)` works
  console.log(command);
}
